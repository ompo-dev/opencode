import fs from "fs/promises"
import path from "path"
import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js"
import z from "zod"
import workerText from "./worker.py" with { type: "text" }
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Process } from "@/util/process"
import { which } from "@/util/which"
import {
  AssetInput,
  AssetOutput,
  CancelInput,
  type VoiceConfigResolved,
  type VoiceStatus,
  EnsureInput,
  Paths,
  ReferenceInput,
  ReferenceOutput,
  SynthesizeInput,
  Status,
  SynthesizeOutput,
  TranscribeOutput,
  TranscribeInput,
  voiceCfg,
  voiceDesignText,
  voicePreset,
} from "@opencode-ai/voice/schema"
import { Req, Res, type VoiceWorkerReq, type VoiceWorkerRes } from "@opencode-ai/voice/protocol"

const workerFile = fileURLToPath(new URL("./worker.py", import.meta.url))
const omnivoice = "k2-fsa/OmniVoice"
const install = {
  torch: "2.8.0",
  torchaudio: "2.8.0",
  whisperx: "3.8.5",
  omnivoice: "0.1.4",
}
const win = {
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
}

type Kind = "stt" | "tts"
type PathInfo = z.infer<typeof Paths>
type Bin = {
  ffmpeg?: string
  ffprobe?: string
}
type Probe = {
  active_engine: Kind | null
  device: string
}
type Task = {
  target: Kind | "all"
  stage: string
  progress: number
}
type EnvInfo = {
  root: string
  venv: string
  python: string
  marker: string
}
type Registry = {
  downloaded: string[]
}

export function voicePaths(input: { data: string; cache: string; bin?: Bin }) {
  const root = path.join(input.data, "voice")
  const references = path.join(root, "references")
  const stt_root = path.join(root, "stt")
  const stt_venv = path.join(stt_root, "venv")
  const tts_root = path.join(root, "tts")
  const tts_venv = path.join(tts_root, "venv")
  return Paths.parse({
    root,
    references,
    stt_root,
    stt_venv,
    stt_python: python(stt_venv),
    stt_marker: path.join(stt_root, "install.json"),
    tts_root,
    tts_venv,
    tts_python: python(tts_venv),
    tts_marker: path.join(tts_root, "install.json"),
    ffmpeg_dir: path.join(root, "ffmpeg"),
    ffmpeg: input.bin?.ffmpeg,
    ffprobe: input.bin?.ffprobe,
    hf: path.join(root, "hf"),
    tmp: path.join(input.cache, "voice"),
  })
}

export function resolveSynth(config: VoiceConfigResolved, input: z.input<typeof SynthesizeInput>) {
  const req = SynthesizeInput.parse(input)
  const pick = req.preset ? voicePreset(config, req.preset) : voicePreset(config)

  const design = {
    ...pick?.design,
    ...req.design,
  }
  const base = voiceDesignText(design)
  const extra = req.instruct ?? pick?.instruct
  const instruct =
    base && extra?.trim()
      ? `${base}${design.chinese_dialect ? "，" : ", "}${extra.trim()}`
      : [base, extra].filter((item): item is string => !!item?.trim()).join(" ")

  return SynthesizeInput.parse({
    text: req.text,
    preset: pick?.id,
    mode: req.mode ?? pick?.mode,
    ref_audio_path: req.ref_audio_path ?? pick?.ref_audio_path,
    ref_text: req.ref_text ?? pick?.ref_text,
    instruct: instruct || undefined,
    design: Object.values(design).some(Boolean) ? design : undefined,
    tags: req.tags ?? pick?.tags,
    language: req.language ?? pick?.language,
    speed: req.speed ?? pick?.speed ?? config.tts.speed,
    duration: req.duration ?? config.tts.duration,
    num_step: req.num_step ?? config.tts.num_step,
  })
}

function python(venv: string) {
  return path.join(venv, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")
}

function envInfo(paths: PathInfo, kind: Kind): EnvInfo {
  if (kind === "stt") {
    return {
      root: paths.stt_root,
      venv: paths.stt_venv,
      python: paths.stt_python,
      marker: paths.stt_marker,
    }
  }
  return {
    root: paths.tts_root,
    venv: paths.tts_venv,
    python: paths.tts_python,
    marker: paths.tts_marker,
  }
}

function needRefText(input: z.infer<typeof SynthesizeInput>) {
  if (input.mode === "design") return false
  if (input.instruct) return false
  if (input.ref_text) return false
  return !!input.ref_audio_path
}

export namespace Voice {
  const log = Log.create({ service: "voice" })

  type State = {
    phase: VoiceStatus["phase"]
    err?: string
    device: string
    bin: Bin
    workers: Partial<Record<Kind, Worker>>
    active?: Kind
    task?: Task
    ensure?: Promise<void>
    abort?: AbortController
    queue: Promise<void>
  }

  const state: State = {
    phase: "idle",
    device: "auto",
    bin: {},
    workers: {},
    queue: Promise.resolve(),
  }

  export const Updated = BusEvent.define("voice.updated", Status)

  async function cfg() {
    return voiceCfg((await Config.getGlobal()).voice)
  }

  function paths() {
    return voicePaths({
      data: Global.Path.data,
      cache: Global.Path.cache,
      bin: state.bin,
    })
  }

  function spec(kind: Kind, config: VoiceConfigResolved) {
    return {
      engine: kind,
      python: config.runtime.python,
      device: config.runtime.device,
      dtype: config.runtime.dtype,
      install,
      platform: `${process.platform}-${process.arch}`,
    }
  }

  function sig(kind: Kind, config: VoiceConfigResolved) {
    if (kind === "stt") {
      return JSON.stringify({
        device: config.runtime.device,
        model: config.stt.model,
        language: config.stt.language,
        compute_type: config.stt.compute_type,
        beam_size: config.stt.beam_size,
      })
    }
    return JSON.stringify({
      device: config.runtime.device,
      dtype: config.runtime.dtype,
      model: omnivoice,
    })
  }

  function registryFile(next: PathInfo) {
    return path.join(next.stt_root, "models.json")
  }

  async function emit() {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Updated.type,
        properties: await status(),
      },
    })
  }

  async function set(
    phase: VoiceStatus["phase"],
    input: {
      device?: string
      err?: string
    } = {},
  ) {
    state.phase = phase
    if ("device" in input && input.device) state.device = input.device
    state.err = input.err
    await emit()
  }

  async function task(next?: Task) {
    state.task = next
    await emit()
  }

  async function dirs(next: PathInfo) {
    await Promise.all([
      fs.mkdir(next.root, { recursive: true }),
      fs.mkdir(next.references, { recursive: true }),
      fs.mkdir(next.stt_root, { recursive: true }),
      fs.mkdir(next.tts_root, { recursive: true }),
      fs.mkdir(next.ffmpeg_dir, { recursive: true }),
      fs.mkdir(next.hf, { recursive: true }),
      fs.mkdir(next.tmp, { recursive: true }),
    ])
  }

  async function json(file: string) {
    return Filesystem.readJson(file).catch(() => undefined)
  }

  async function registry(next: PathInfo): Promise<Registry> {
    const out = await json(registryFile(next))
    return {
      downloaded: Array.isArray(out?.downloaded)
        ? out.downloaded.filter((item: unknown): item is string => typeof item === "string" && !!item.trim())
        : [],
    }
  }

  async function mark(next: PathInfo, id: string) {
    const out = await registry(next)
    if (out.downloaded.includes(id)) return
    await Filesystem.writeJson(registryFile(next), {
      downloaded: [...out.downloaded, id],
    })
  }

  function abortError() {
    const err = new Error("Voice ensure cancelled")
    err.name = "AbortError"
    return err
  }

  function aborted(err: unknown) {
    if (!(err instanceof Error)) return false
    return err.name === "AbortError" || err.message === "Voice ensure cancelled"
  }

  async function installNeeded(next: PathInfo, config: VoiceConfigResolved, kind: Kind) {
    const info = await json(envInfo(next, kind).marker)
    if (!info) return true
    return JSON.stringify(info) !== JSON.stringify(spec(kind, config))
  }

  async function missing(next: PathInfo, config: VoiceConfigResolved, kind: Kind) {
    const item = envInfo(next, kind)
    if (!(await Filesystem.exists(item.python))) return true
    return installNeeded(next, config, kind)
  }

  async function detectFfmpeg(next: PathInfo): Promise<Bin> {
    const ffmpeg = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    const ffprobe = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    if ((await Filesystem.exists(ffmpeg)) && (await Filesystem.exists(ffprobe))) {
      return { ffmpeg, ffprobe }
    }

    const sys = {
      ffmpeg: which("ffmpeg") ?? undefined,
      ffprobe: which("ffprobe") ?? undefined,
    }
    if (sys.ffmpeg && sys.ffprobe) {
      return sys
    }

    return {}
  }

  async function ensureFfmpeg(next: PathInfo, abort?: AbortSignal) {
    const ffmpeg = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    const ffprobe = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    const found = await detectFfmpeg(next)
    if (found.ffmpeg && found.ffprobe) {
      state.bin = found
      return state.bin
    }

    if (process.platform != "win32" || process.arch != "x64") {
      state.bin = {}
      return state.bin
    }

    log.info("downloading ffmpeg", { url: win.url })
    const res = await fetch(win.url, { signal: abort })
    if (!res.ok) throw new Error(`Failed to download ffmpeg: ${res.status}`)
    const buf = await res.arrayBuffer()
    const zip = new ZipReader(new BlobReader(new Blob([buf])))
    const entries = await zip.getEntries()
    for (const entry of entries) {
      const name = entry.filename.replaceAll("\\", "/")
      const base = path.basename(name).toLowerCase()
      if (!["ffmpeg.exe", "ffprobe.exe"].includes(base)) continue
      if (typeof entry.getData != "function") continue
      const blob = await entry.getData(new BlobWriter())
      await Filesystem.write(path.join(next.ffmpeg_dir, base), Buffer.from(await blob.arrayBuffer()))
    }
    await zip.close()
    state.bin = {
      ffmpeg: (await Filesystem.exists(ffmpeg)) ? ffmpeg : undefined,
      ffprobe: (await Filesystem.exists(ffprobe)) ? ffprobe : undefined,
    }
    return state.bin
  }

  async function run(cmd: string[], cwd?: string, env?: NodeJS.ProcessEnv, abort?: AbortSignal) {
    const out = await Process.run(cmd, {
      cwd,
      env,
      stdin: "ignore",
      abort,
    }).catch((err) => {
      if (abort?.aborted) throw abortError()
      throw err
    })
    if (abort?.aborted) throw abortError()
    if (out.stdout.length) log.info(out.stdout.toString().trim())
    if (out.stderr.length) log.info(out.stderr.toString().trim())
    return out
  }

  async function ensureWorker(next: PathInfo) {
    if (await Filesystem.exists(workerFile)) return workerFile
    const file = path.join(next.root, "worker.py")
    const current = await fs.readFile(file, "utf8").catch(() => "")
    if (current !== workerText) {
      await fs.writeFile(file, workerText, "utf8")
    }
    return file
  }

  async function ensureVenv(next: PathInfo, config: VoiceConfigResolved, kind: Kind, abort?: AbortSignal) {
    const item = envInfo(next, kind)
    if (!(await Filesystem.exists(config.runtime.python))) {
      throw new Error(`Python not found: ${config.runtime.python}`)
    }
    if (!(await Filesystem.exists(item.python))) {
      await run([config.runtime.python, "-m", "venv", item.venv], item.root, undefined, abort)
    }
    if (!(await installNeeded(next, config, kind))) return

    const torch =
      process.platform == "win32" && config.runtime.device != "cpu" && config.runtime.device != "mps"
        ? [
            "-m",
            "pip",
            "install",
            `torch==${install.torch}+cu128`,
            `torchaudio==${install.torchaudio}+cu128`,
            "--extra-index-url",
            "https://download.pytorch.org/whl/cu128",
          ]
        : ["-m", "pip", "install", `torch==${install.torch}`, `torchaudio==${install.torchaudio}`]

    await run([item.python, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], item.root, undefined, abort)
    await run([item.python, ...torch], item.root, undefined, abort)
    await run(
      [
        item.python,
        "-m",
        "pip",
        "install",
        ...(kind == "stt" ? [`whisperx==${install.whisperx}`] : [`omnivoice==${install.omnivoice}`, "soundfile"]),
      ],
      item.root,
      undefined,
      abort,
    )
    await Filesystem.writeJson(item.marker, spec(kind, config))
  }

  function decode(input: string) {
    const match = input.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
    if (!match) throw new Error("Invalid audio payload")
    if (match[2]) return Buffer.from(match[3], "base64")
    return Buffer.from(decodeURIComponent(match[3]))
  }

function stem(input?: string) {
  const text = (input ?? "reference").trim().toLowerCase()
  const clean = text
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return clean || "reference"
}

function audioType(file: string) {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".wav") return "audio/wav"
  if (ext === ".mp3") return "audio/mpeg"
  if (ext === ".ogg") return "audio/ogg"
  if (ext === ".flac") return "audio/flac"
  if (ext === ".m4a") return "audio/mp4"
  return "application/octet-stream"
}

  function procEnv(next: PathInfo, config: VoiceConfigResolved, kind: Kind) {
    const list = [next.ffmpeg_dir, process.env.PATH ?? process.env.Path ?? ""].filter(Boolean).join(path.delimiter)
    return {
      ...process.env,
      HF_HOME: next.hf,
      HF_TOKEN: config.runtime.hf_token,
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      HUGGINGFACE_HUB_TOKEN: config.runtime.hf_token,
      HUGGING_FACE_HUB_TOKEN: config.runtime.hf_token,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      XDG_CACHE_HOME: Global.Path.cache,
      XDG_DATA_HOME: Global.Path.data,
      PATH: list,
      Path: list,
      OPENCODE_VOICE_ENGINE: kind,
      OPENCODE_VOICE_FFMPEG: state.bin.ffmpeg,
      OPENCODE_VOICE_FFPROBE: state.bin.ffprobe,
      OPENCODE_VOICE_ROOT: next.root,
      OPENCODE_VOICE_DEVICE: config.runtime.device,
    }
  }

  class Worker {
    readonly kind: Kind
    readonly sig: string
    readonly proc: Process.Child
    device?: string
    warmed = false
    private readonly wait = new Map<string, { ok: (value: unknown) => void; err: (error: Error) => void }>()

    constructor(kind: Kind, next: PathInfo, config: VoiceConfigResolved, file: string) {
      this.kind = kind
      this.sig = sig(kind, config)
      this.proc = Process.spawn([envInfo(next, kind).python, "-u", file], {
        cwd: next.root,
        env: procEnv(next, config, kind),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })

      if (!this.proc.stdout || !this.proc.stdin || !this.proc.stderr) {
        throw new Error("Voice worker streams are unavailable")
      }

      const out = createInterface({ input: this.proc.stdout })
      out.on("line", (line) => {
        const text = line.trim()
        if (!text) return
        if (!text.startsWith("{")) {
          log.info(text)
          return
        }
        let msg: VoiceWorkerRes
        try {
          msg = Res.parse(JSON.parse(text))
        } catch (err) {
          log.warn("invalid voice worker line", { line: text, err })
          return
        }
        const slot = this.wait.get(msg.id)
        if (!slot) return
        this.wait.delete(msg.id)
        if (msg.type == "ok") slot.ok(msg.result)
        if (msg.type == "err") slot.err(new Error(msg.error))
      })

      const err = createInterface({ input: this.proc.stderr })
      err.on("line", (line) => {
        if (!line.trim()) return
        log.info(line)
      })

      void this.proc.exited.then((code) => {
        for (const [id, slot] of this.wait.entries()) {
          slot.err(new Error(`Voice worker exited with code ${code}`))
          this.wait.delete(id)
        }
        if (state.workers[this.kind] === this) {
          state.workers[this.kind] = undefined
          if (state.active === this.kind) state.active = undefined
          void set("error", { err: `Voice worker exited with code ${code}` })
        }
      })
    }

    async req(input: Omit<VoiceWorkerReq, "id">) {
      if (!this.proc.stdin) throw new Error("Voice worker stdin unavailable")
      const id = randomUUID()
      const req = Req.parse({ ...input, id })
      const task = new Promise<unknown>((ok, err) => {
        this.wait.set(id, { ok, err })
      })
      state.active = this.kind
      this.proc.stdin.write(JSON.stringify(req) + "\n")
      return task
    }

    async stop() {
      await Process.stop(this.proc)
    }
  }

  function apply(out: Probe, config: VoiceConfigResolved) {
    state.device = typeof out?.device == "string" ? out.device : config.runtime.device
  }

  async function probe(worker: Worker, config: VoiceConfigResolved) {
    const out = (await worker.req({ cmd: "status", input: { cfg: config } })) as Probe
    worker.device = out.device
    apply(out, config)
  }

  async function warm(worker: Worker, config: VoiceConfigResolved) {
    if (worker.warmed) return
    const out = (await worker.req({
      cmd: "warm",
      input: {
        cfg: config,
        stt: worker.kind == "stt",
        tts: worker.kind == "tts",
      },
    })) as Probe
    worker.warmed = true
    worker.device = out.device
    apply(out, config)
  }

  async function stop(kind?: Kind) {
    if (kind) {
      const prev = state.workers[kind]
      state.workers[kind] = undefined
      if (state.active === kind) state.active = undefined
      await prev?.stop().catch(() => undefined)
      return
    }
    await Promise.all((["stt", "tts"] as const).map((item) => stop(item)))
  }

  async function start(next: PathInfo, config: VoiceConfigResolved, kind: Kind, quiet = false) {
    if (!quiet) await set("starting")
    await stop(kind)
    const file = await ensureWorker(next)
    const worker = new Worker(kind, next, config, file)
    state.workers[kind] = worker
    state.active = kind
    await probe(worker, config)
    if (!quiet) await set("ready", { device: state.device })
    return worker
  }

  async function ensureTarget(target: Kind | "all", preload = false) {
    if (state.ensure) {
      await state.ensure
      return
    }
    const abort = new AbortController()
    state.abort = abort
    state.ensure = (async () => {
      const config = await cfg()
      if (!config.runtime.enabled) {
        await task()
        await set("disabled")
        return
      }
      const next = paths()
      await set("ensuring")
      await task({ target, stage: "dirs", progress: 5 })
      await dirs(next)
      await task({ target, stage: "ffmpeg", progress: 12 })
      abort.signal.throwIfAborted()
      await ensureFfmpeg(next, abort.signal)
      if (!state.bin.ffmpeg || !state.bin.ffprobe) throw new Error("ffmpeg is unavailable")
      const list = target == "all" ? (["stt", "tts"] as const) : [target]
      for (const [idx, item] of list.entries()) {
        abort.signal.throwIfAborted()
        await task({
          target,
          stage: `install:${item}`,
          progress: 20 + Math.round(((idx + 1) / Math.max(1, list.length)) * 30),
        })
        await ensureVenv(next, config, item, abort.signal)
      }
      for (const [idx, item] of list.entries()) {
        abort.signal.throwIfAborted()
        let worker = state.workers[item]
        if (worker && worker.sig !== sig(item, config)) {
          await stop(item)
          worker = undefined
        }
        if (!worker) {
          await task({
            target,
            stage: `start:${item}`,
            progress: 55 + Math.round(((idx + 1) / Math.max(1, list.length)) * (preload ? 15 : 45)),
          })
          worker = await start(next, config, item, true)
        }
        if (!preload) continue
        await task({
          target,
          stage: `warm:${item}`,
          progress: 72 + Math.round(((idx + 1) / Math.max(1, list.length)) * 28),
        })
        abort.signal.throwIfAborted()
        await warm(worker, config)
        if (item === "stt") await mark(next, config.stt.model)
      }
      await task({ target, stage: "ready", progress: 100 })
      await set("ready", { device: state.device })
    })()
      .catch(async (err) => {
        if (abort.signal.aborted || aborted(err)) {
          await set(Object.values(state.workers).some(Boolean) ? "ready" : "idle", {
            device: state.device,
            err: undefined,
          })
          return
        }
        await set("error", { err: err instanceof Error ? err.message : String(err) })
        throw err
      })
      .finally(async () => {
        await task()
        if (state.abort === abort) state.abort = undefined
        state.ensure = undefined
      })
    await state.ensure
  }

  async function ready(kind: Kind, preload = false, config?: VoiceConfigResolved) {
    const next = config ?? (await cfg())
    if (!next.runtime.enabled) {
      await set("disabled")
      throw new Error("Voice runtime is disabled")
    }
    const info = paths()
    await dirs(info)
    if (!state.bin.ffmpeg || !state.bin.ffprobe) {
      await ensureFfmpeg(info)
    }
    if (await missing(info, next, kind)) {
      if (!next.runtime.install_on_demand) throw new Error(`Voice ${kind.toUpperCase()} runtime is not installed`)
      await ensureTarget(kind, preload)
    }
    let worker = state.workers[kind]
    if (worker && worker.sig !== sig(kind, next)) {
      await stop(kind)
      worker = undefined
    }
    if (!worker) {
      await task({ target: kind, stage: `start:${kind}`, progress: 40 })
      worker = await start(info, next, kind)
    }
    if (preload && !worker.warmed) {
      await task({ target: kind, stage: `warm:${kind}`, progress: 80 })
      await warm(worker, next)
      if (kind === "stt") await mark(info, next.stt.model)
      await task()
    }
    return { config: next, paths: info, worker }
  }

  async function serial<T>(kind: Kind, fn: () => Promise<T>) {
    const task = state.queue.then(async () => {
      state.active = kind
      await set("busy")
      try {
        return await fn()
      } finally {
        await set("ready")
      }
    })
    state.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  function touches(kind: Kind, item?: Task) {
    if (!item) return false
    if (item.target === "all") return true
    return item.target === kind
  }

  function note(kind: Kind, item?: Task) {
    if (!touches(kind, item)) return
    return item?.stage
  }

  async function transcribeFile(file: string, config: VoiceConfigResolved, language?: string) {
    const { worker, paths: info } = await ready("stt", false, config)
    const out = await worker.req({
      cmd: "transcribe",
      input: {
        cfg: config,
        path: file,
        language,
        diarization: false,
      },
    })
    worker.warmed = true
    await mark(info, config.stt.model)
    return TranscribeOutput.parse(out)
  }

  export async function status() {
    const config = await cfg()
    const next = paths()
    const [sttInstalled, ttsInstalled, saved, ffmpegBin, pythonFound] = await Promise.all([
      Filesystem.exists(next.stt_python).then((hit) => hit && Filesystem.exists(next.stt_marker)),
      Filesystem.exists(next.tts_python).then((hit) => hit && Filesystem.exists(next.tts_marker)),
      registry(next),
      state.bin.ffmpeg && state.bin.ffprobe ? Promise.resolve(state.bin) : detectFfmpeg(next),
      Filesystem.exists(config.runtime.python),
    ])
    if (!state.bin.ffmpeg && ffmpegBin.ffmpeg && ffmpegBin.ffprobe) state.bin = ffmpegBin
    const stt = state.workers.stt
    const tts = state.workers.tts
    const taskInfo = state.task
    const sttLoading = touches("stt", taskInfo)
    const ttsLoading = touches("tts", taskInfo)
    const sttDownloaded = Array.from(
      new Set([
        ...saved.downloaded,
        ...(stt?.warmed ? [config.stt.model] : []),
      ]),
    )
    const ready = state.phase == "ready" || state.phase == "busy"
    return Status.parse({
      ready,
      phase: config.runtime.enabled ? state.phase : "disabled",
      active_engine: state.active ?? null,
      device: state.device,
      diarization: config.stt.diarization && !!config.runtime.hf_token,
      worker: !!stt || !!tts,
      ffmpeg: !!ffmpegBin.ffmpeg && !!ffmpegBin.ffprobe,
      deps: {
        python: pythonFound,
        ffmpeg: !!ffmpegBin.ffmpeg && !!ffmpegBin.ffprobe,
      },
      error: state.err,
      activity: {
        target: taskInfo?.target ?? null,
        stage: taskInfo?.stage,
        progress: taskInfo?.progress,
      },
      engines: {
        stt: {
          installed: sttInstalled,
          worker: !!stt,
          warmed: !!stt?.warmed,
          standby: !!stt?.warmed,
          device: stt?.device,
          model: config.stt.model,
          loading: sttLoading,
          progress: sttLoading ? taskInfo?.progress : undefined,
          note: note("stt", taskInfo),
          models: Array.from(new Set([config.stt.model, ...sttDownloaded])).map((id) => ({
            id,
            downloaded: sttDownloaded.includes(id),
            active: id === config.stt.model,
            loading: sttLoading && id === config.stt.model,
            progress: sttLoading && id === config.stt.model ? taskInfo?.progress : undefined,
            note: sttLoading && id === config.stt.model ? note("stt", taskInfo) : undefined,
          })),
        },
        tts: {
          installed: ttsInstalled,
          worker: !!tts,
          warmed: !!tts?.warmed,
          standby: !!tts?.warmed,
          device: tts?.device,
          model: omnivoice,
          loading: ttsLoading,
          progress: ttsLoading ? taskInfo?.progress : undefined,
          note: note("tts", taskInfo),
          models: [
            {
              id: omnivoice,
              downloaded: ttsInstalled,
              active: true,
              loading: ttsLoading,
              progress: ttsLoading ? taskInfo?.progress : undefined,
              note: note("tts", taskInfo),
            },
          ],
        },
      },
      config,
      paths: {
        ...next,
        ffmpeg: ffmpegBin.ffmpeg,
        ffprobe: ffmpegBin.ffprobe,
      },
    })
  }

  export async function ensure(input: z.input<typeof EnsureInput> = {}) {
    const opts = EnsureInput.parse(input)
    await ensureTarget(opts.target ?? "all", !!opts.preload)
    return status()
  }

  export async function cancel(input: z.input<typeof CancelInput> = {}) {
    const opts = CancelInput.parse(input)
    const target = opts.target ?? state.task?.target ?? "all"
    if (state.abort && touches("stt", state.task) && target === "stt") {
      state.abort.abort()
    }
    if (state.abort && touches("tts", state.task) && target === "tts") {
      state.abort.abort()
    }
    if (state.abort && target === "all") {
      state.abort.abort()
    }
    if (state.ensure) await state.ensure
    return status()
  }

  export async function reference(input: z.input<typeof ReferenceInput>) {
    const req = ReferenceInput.parse(input)
    const config = await cfg()
    const next = paths()
    await dirs(next)
    const name = `${stem(req.name)}-${Date.now()}`
    const file = path.join(next.references, `${name}.wav`)
    await Filesystem.write(file, decode(req.audio))

    let text: string | undefined
    let language: string | undefined
    let transcript_error: string | undefined

    if (req.transcribe !== false) {
      try {
        const out = await serial("stt", async () => transcribeFile(file, config, req.language))
        text = out.text
        language = out.language
      } catch (error) {
        transcript_error = error instanceof Error ? error.message : String(error)
      }
    }

    return ReferenceOutput.parse({
      path: file,
      name: `${name}.wav`,
      duration_ms: req.duration_ms ?? 0,
      text,
      language,
      transcript_error,
    })
  }

  export async function asset(input: z.input<typeof AssetInput>) {
    const req = AssetInput.parse(input)
    if (!(await Filesystem.exists(req.path))) {
      throw new Error(`Voice asset not found: ${req.path}`)
    }
    const file = Bun.file(req.path)
    const buf = Buffer.from(await file.arrayBuffer())
    return AssetOutput.parse({
      path: req.path,
      name: path.basename(req.path),
      audio: `data:${audioType(req.path)};base64,${buf.toString("base64")}`,
    })
  }

  export async function transcribe(input: z.input<typeof TranscribeInput>) {
    const req = TranscribeInput.parse(input)
    return serial("stt", async () => {
      const config = await cfg()
      const next = paths()
      const { worker } = await ready("stt", false, config)
      const file = path.join(next.tmp, `${randomUUID()}.wav`)
      await Filesystem.write(file, decode(req.audio))
      try {
        const out = await worker.req({
          cmd: "transcribe",
          input: {
            cfg: config,
            path: file,
            language: req.language,
            diarization: req.diarization,
          },
        })
        worker.warmed = true
        await mark(next, config.stt.model)
        return TranscribeOutput.parse(out)
      } finally {
        await fs.unlink(file).catch(() => undefined)
      }
    })
  }

  export async function synthesize(input: z.input<typeof SynthesizeInput>) {
    return serial("tts", async () => {
      const config = await cfg()
      let req = resolveSynth(config, input)
      if (needRefText(req) && req.ref_audio_path) {
        const ref = await transcribeFile(req.ref_audio_path, config, req.language)
        req = SynthesizeInput.parse({
          ...req,
          ref_text: ref.text,
        })
      }
      const { worker } = await ready("tts", false, config)
      const out = await worker.req({
        cmd: "synthesize",
        input: {
          cfg: config,
          text: req.text,
          preset: req.preset,
          mode: req.mode,
          ref_audio_path: req.ref_audio_path,
          ref_text: req.ref_text,
          instruct: req.instruct,
          tags: req.tags,
          language: req.language,
          speed: req.speed,
          duration: req.duration,
          num_step: req.num_step,
        },
      })
      worker.warmed = true
      return SynthesizeOutput.parse(out)
    })
  }
}
