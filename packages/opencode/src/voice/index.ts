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
type EnvInfo = {
  root: string
  venv: string
  python: string
  marker: string
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
    worker?: Worker
    ensure?: Promise<void>
    queue: Promise<void>
  }

  const state: State = {
    phase: "idle",
    device: "auto",
    bin: {},
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

  async function ensureFfmpeg(next: PathInfo) {
    const ffmpeg = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    const ffprobe = path.join(next.ffmpeg_dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    if ((await Filesystem.exists(ffmpeg)) && (await Filesystem.exists(ffprobe))) {
      state.bin = { ffmpeg, ffprobe }
      return state.bin
    }

    const sys = {
      ffmpeg: which("ffmpeg") ?? undefined,
      ffprobe: which("ffprobe") ?? undefined,
    }
    if (sys.ffmpeg && sys.ffprobe) {
      state.bin = sys
      return state.bin
    }

    if (process.platform != "win32" || process.arch != "x64") {
      state.bin = {}
      return state.bin
    }

    log.info("downloading ffmpeg", { url: win.url })
    const res = await fetch(win.url)
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

  async function run(cmd: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
    const out = await Process.run(cmd, {
      cwd,
      env,
      stdin: "ignore",
    })
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

  async function ensureVenv(next: PathInfo, config: VoiceConfigResolved, kind: Kind) {
    const item = envInfo(next, kind)
    if (!(await Filesystem.exists(config.runtime.python))) {
      throw new Error(`Python not found: ${config.runtime.python}`)
    }
    if (!(await Filesystem.exists(item.python))) {
      await run([config.runtime.python, "-m", "venv", item.venv], item.root)
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

    await run([item.python, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], item.root)
    await run([item.python, ...torch], item.root)
    await run(
      [
        item.python,
        "-m",
        "pip",
        "install",
        ...(kind == "stt" ? [`whisperx==${install.whisperx}`] : [`omnivoice==${install.omnivoice}`, "soundfile"]),
      ],
      item.root,
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
    readonly proc: Process.Child
    warmed = false
    private readonly wait = new Map<string, { ok: (value: unknown) => void; err: (error: Error) => void }>()

    constructor(kind: Kind, next: PathInfo, config: VoiceConfigResolved, file: string) {
      this.kind = kind
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
        if (state.worker === this) {
          state.worker = undefined
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
    apply(out, config)
  }

  async function stop() {
    const prev = state.worker
    state.worker = undefined
    await prev?.stop().catch(() => undefined)
  }

  async function start(next: PathInfo, config: VoiceConfigResolved, kind: Kind) {
    await set("starting")
    await stop()
    const file = await ensureWorker(next)
    const worker = new Worker(kind, next, config, file)
    state.worker = worker
    await probe(worker, config)
    await set("ready", { device: state.device })
    return worker
  }

  async function ensureTarget(target: Kind | "all", preload = false) {
    if (state.ensure) {
      await state.ensure
      return
    }
    state.ensure = (async () => {
      const config = await cfg()
      if (!config.runtime.enabled) {
        await set("disabled")
        return
      }
      const next = paths()
      await set("ensuring")
      await dirs(next)
      await ensureFfmpeg(next)
      if (!state.bin.ffmpeg || !state.bin.ffprobe) throw new Error("ffmpeg is unavailable")
      const list = target == "all" ? (["stt", "tts"] as const) : [target]
      if (state.worker && list.includes(state.worker.kind)) await stop()
      for (const item of list) {
        await ensureVenv(next, config, item)
      }
      const boot = target == "all" ? "stt" : target
      if (preload) {
        for (const item of list) {
          const worker = await start(next, config, item)
          await warm(worker, config)
        }
        return
      }
      await start(next, config, boot)
    })()
      .catch(async (err) => {
        await set("error", { err: err instanceof Error ? err.message : String(err) })
        throw err
      })
      .finally(() => {
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
      await ensureTarget(kind, false)
    }
    let worker = state.worker
    if (!worker || worker.kind != kind) {
      worker = await start(info, next, kind)
    }
    if (preload) await warm(worker, next)
    return { config: next, paths: info, worker }
  }

  async function serial<T>(kind: Kind, fn: () => Promise<T>) {
    const task = state.queue.then(async () => {
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

  async function transcribeFile(file: string, config: VoiceConfigResolved, language?: string) {
    const { worker } = await ready("stt", false, config)
    const out = await worker.req({
      cmd: "transcribe",
      input: {
        cfg: config,
        path: file,
        language,
        diarization: false,
      },
    })
    return TranscribeOutput.parse(out)
  }

  export async function status() {
    const config = await cfg()
    const next = paths()
    const ready = state.phase == "ready" || state.phase == "busy"
    return Status.parse({
      ready,
      phase: config.runtime.enabled ? state.phase : "disabled",
      active_engine: state.worker?.kind ?? null,
      device: state.device,
      diarization: config.stt.diarization && !!config.runtime.hf_token,
      worker: !!state.worker,
      ffmpeg: !!state.bin.ffmpeg && !!state.bin.ffprobe,
      error: state.err,
      config,
      paths: {
        ...next,
        ffmpeg: state.bin.ffmpeg,
        ffprobe: state.bin.ffprobe,
      },
    })
  }

  export async function ensure(input: z.input<typeof EnsureInput> = {}) {
    const opts = EnsureInput.parse(input)
    await ensureTarget("all", !!opts.preload)
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
      return SynthesizeOutput.parse(out)
    })
  }
}
