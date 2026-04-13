import { Effect, Layer, ServiceMap, Stream } from "effect"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  const count = (text: string) => {
    if (!text) return 0
    if (!text.endsWith("\n")) return text.split("\n").length
    return text.slice(0, -1).split("\n").length
  }

  const work = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, cwd: string, file: string) {
    const full = path.join(cwd, file)
    if (!(yield* fs.exists(full).pipe(Effect.orDie))) return ""
    const buf = yield* fs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
    if (Buffer.from(buf).includes(0)) return ""
    return Buffer.from(buf).toString("utf8")
  })

  const nums = (list: Git.Stat[]) =>
    new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

  const merge = (...lists: Git.Item[][]) => {
    const out = new Map<string, Git.Item>()
    lists.flat().forEach((item) => {
      if (!out.has(item.file)) out.set(item.file, item)
    })
    return [...out.values()]
  }

  const kind = (code: string) => {
    if (code === "??") return "untracked" as const
    if (code.includes("U")) return "unmerged" as const
    if (code.includes("A")) return "added" as const
    if (code.includes("D")) return "deleted" as const
    return "modified" as const
  }

  const staged = (code: string) => {
    const x = code[0]
    return !!x && x !== " " && x !== "?"
  }

  const unstaged = (code: string) => {
    const y = code[1]
    return !!y && y !== " " && y !== "?"
  }

  const paths = (list?: string[]) => (list && list.length > 0 ? list : ["."])

  const pick = <T extends { path: string }>(list: T[], input?: string[]) => {
    if (!input || input.length === 0) return list
    const set = new Set(input)
    return list.filter((item) => set.has(item.path))
  }

  const message = (result: Git.Result, fallback: string) => {
    const text = result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || fallback
    return text.replace(/^fatal:\s*/i, "").trim() || fallback
  }

  const files = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string | undefined,
    list: Git.Item[],
    map: Map<string, { additions: number; deletions: number }>,
  ) {
    const base = ref ? yield* git.prefix(cwd) : ""
    const patch = (file: string, before: string, after: string) =>
      formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
    const next = yield* Effect.forEach(
      list,
      (item) =>
        Effect.gen(function* () {
          const before = item.status === "added" || !ref ? "" : yield* git.show(cwd, ref, item.file, base)
          const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
          const stat = map.get(item.file)
          return {
            file: item.file,
            patch: patch(item.file, before, after),
            additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
            deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
            status: item.status,
          } satisfies FileDiff
        }),
      { concurrency: 8 },
    )
    return next.toSorted((a, b) => a.file.localeCompare(b.file))
  })

  const track = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string | undefined,
  ) {
    if (!ref) return yield* files(fs, git, cwd, ref, yield* git.status(cwd), new Map())
    const [list, stats] = yield* Effect.all([git.status(cwd), git.stats(cwd, ref)], { concurrency: 2 })
    return yield* files(fs, git, cwd, ref, list, nums(stats))
  })

  const compare = Effect.fnUntraced(function* (
    fs: AppFileSystem.Interface,
    git: Git.Interface,
    cwd: string,
    ref: string,
  ) {
    const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
      concurrency: 3,
    })
    return yield* files(
      fs,
      git,
      cwd,
      ref,
      merge(
        list,
        extra.filter((item) => item.code === "??"),
      ),
      nums(stats),
    )
  })

  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string().optional(),
      default_branch: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const FileDiff = z
    .object({
      file: z.string(),
      patch: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "VcsFileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  export const Change = z
    .object({
      path: z.string(),
      x: z.string(),
      y: z.string(),
      staged: z.boolean(),
      unstaged: z.boolean(),
      untracked: z.boolean(),
      status: z.enum(["added", "deleted", "modified", "unmerged", "untracked"]),
    })
    .meta({
      ref: "VcsChange",
    })
  export type Change = z.infer<typeof Change>

  export const Commit = z
    .object({
      hash: z.string(),
      short: z.string(),
      author: z.string(),
      email: z.string(),
      at: z.number().int(),
      refs: z.string().array(),
      subject: z.string(),
      body: z.string(),
    })
    .meta({
      ref: "VcsCommit",
    })
  export type Commit = z.infer<typeof Commit>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly defaultBranch: () => Effect.Effect<string | undefined>
    readonly diff: (mode: Mode) => Effect.Effect<FileDiff[]>
    readonly status: () => Effect.Effect<Change[]>
    readonly history: (limit?: number) => Effect.Effect<Commit[]>
    readonly stage: (paths?: string[]) => Effect.Effect<Change[]>
    readonly unstage: (paths?: string[]) => Effect.Effect<Change[]>
    readonly discard: (paths?: string[]) => Effect.Effect<Change[]>
    readonly commit: (message: string) => Effect.Effect<Commit>
  }

  interface State {
    current: string | undefined
    root: Git.Base | undefined
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Git.Service | Bus.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const git = yield* Git.Service
      const bus = yield* Bus.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")(function* (ctx) {
          if (ctx.project.vcs !== "git") {
            return { current: undefined, root: undefined }
          }

          const get = Effect.fnUntraced(function* () {
            return yield* git.branch(ctx.directory)
          })
          const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
            concurrency: 2,
          })
          const value = { current, root }
          log.info("initialized", { branch: value.current, default_branch: value.root?.name })

          yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
            Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
            Stream.runForEach((_evt) =>
              Effect.gen(function* () {
                const next = yield* get()
                if (next !== value.current) {
                  log.info("branch changed", { from: value.current, to: next })
                  value.current = next
                  yield* bus.publish(Event.BranchUpdated, { branch: next })
                }
              }),
            ),
            Effect.forkScoped,
          )

          return value
        }),
      )

      const init = Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state)
      })

      const branch = Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      })

      const defaultBranch = Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      })

      const diff = Effect.fn("Vcs.diff")(function* (mode: Mode) {
        const value = yield* InstanceState.get(state)
        if (Instance.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(
            fs,
            git,
            Instance.directory,
            (yield* git.hasHead(Instance.directory)) ? "HEAD" : undefined,
          )
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(Instance.directory, value.root.ref)
        if (!ref) return []
        return yield* compare(fs, git, Instance.directory, ref)
      })

      const status = Effect.fn("Vcs.status")(function* () {
        if (Instance.project.vcs !== "git") return []
        const list = yield* git.status(Instance.directory)
        return list.map((item) => ({
          path: item.file,
          x: item.code[0] ?? " ",
          y: item.code[1] ?? " ",
          staged: staged(item.code),
          unstaged: unstaged(item.code),
          untracked: item.code === "??",
          status: kind(item.code),
        }))
      })

      const history = Effect.fn("Vcs.history")(function* (limit = 40) {
        if (Instance.project.vcs !== "git") return []
        if (!(yield* git.hasHead(Instance.directory))) return []

        const result = yield* git.run(
          [
            "log",
            "--decorate=short",
            `--max-count=${Math.max(1, Math.min(limit, 100))}`,
            "--all",
            "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e",
          ],
          { cwd: Instance.directory },
        )
        if (result.exitCode !== 0) throw new Error(message(result, "Failed to read git history"))

        return result
          .text()
          .split("\x1e")
          .flatMap((item) => {
            const value = item.trim()
            if (!value) return []
            const [hash, short, author, email, at, refs, subject, body] = value.split("\x1f")
            if (!hash || !short || !author || !email || !at || subject === undefined || body === undefined) return []
            return [
              {
                hash,
                short,
                author,
                email,
                at: Number.parseInt(at, 10) || 0,
                refs: refs
                  ? refs
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean)
                  : [],
                subject,
                body: body.trim(),
              } satisfies Commit,
            ]
          })
      })

      const stage = Effect.fn("Vcs.stage")(function* (input?: string[]) {
        if (Instance.project.vcs !== "git") throw new Error("Git is not available for this project")
        const result = yield* git.run(["add", "-A", "--", ...paths(input)], { cwd: Instance.directory })
        if (result.exitCode !== 0) throw new Error(message(result, "Failed to stage changes"))
        return yield* status()
      })

      const unstage = Effect.fn("Vcs.unstage")(function* (input?: string[]) {
        if (Instance.project.vcs !== "git") throw new Error("Git is not available for this project")
        const list = pick(yield* status(), input).filter((item) => item.staged)
        if (list.length === 0) return yield* status()

        if (yield* git.hasHead(Instance.directory)) {
          const result = yield* git.run(["restore", "--staged", "--", ...list.map((item) => item.path)], {
            cwd: Instance.directory,
          })
          if (result.exitCode !== 0) throw new Error(message(result, "Failed to unstage changes"))
          return yield* status()
        }

        const result = yield* git.run(
          ["rm", "-r", "--cached", "--ignore-unmatch", "--", ...list.map((item) => item.path)],
          { cwd: Instance.directory },
        )
        if (result.exitCode !== 0) throw new Error(message(result, "Failed to unstage changes"))
        return yield* status()
      })

      const discard = Effect.fn("Vcs.discard")(function* (input?: string[]) {
        if (Instance.project.vcs !== "git") throw new Error("Git is not available for this project")
        const list = pick(yield* status(), input)
        if (list.length === 0) return yield* status()

        const head = yield* git.hasHead(Instance.directory)
        const tracked = list.filter((item) => !item.untracked).map((item) => item.path)
        const fresh = list.filter((item) => item.untracked).map((item) => item.path)
        const added = !head ? list.filter((item) => item.staged).map((item) => item.path) : []

        if (head && tracked.length > 0) {
          const result = yield* git.run(["restore", "--staged", "--worktree", "--source=HEAD", "--", ...tracked], {
            cwd: Instance.directory,
          })
          if (result.exitCode !== 0) throw new Error(message(result, "Failed to discard changes"))
        }

        if (!head && added.length > 0) {
          const result = yield* git.run(["rm", "-r", "-f", "--", ...added], { cwd: Instance.directory })
          if (result.exitCode !== 0) throw new Error(message(result, "Failed to discard changes"))
        }

        if (fresh.length > 0) {
          const result = yield* git.run(["clean", "-f", "-d", "--", ...fresh], { cwd: Instance.directory })
          if (result.exitCode !== 0) throw new Error(message(result, "Failed to discard changes"))
        }

        return yield* status()
      })

      const commit = Effect.fn("Vcs.commit")(function* (input: string) {
        if (Instance.project.vcs !== "git") throw new Error("Git is not available for this project")
        const value = input.trim()
        if (!value) throw new Error("Commit message cannot be empty")
        const result = yield* git.run(["commit", "-m", value], { cwd: Instance.directory })
        if (result.exitCode !== 0) throw new Error(message(result, "Failed to create commit"))
        return (yield* history(1))[0]!
      })

      return Service.of({ init, branch, defaultBranch, diff, status, history, stage, unstage, discard, commit })
    }),
  )

  const defaultLayer = layer.pipe(
    Layer.provide(Git.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Bus.layer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function init() {
    return runPromise((svc) => svc.init())
  }

  export async function branch() {
    return runPromise((svc) => svc.branch())
  }

  export async function defaultBranch() {
    return runPromise((svc) => svc.defaultBranch())
  }

  export async function diff(mode: Mode) {
    return runPromise((svc) => svc.diff(mode))
  }

  export async function status() {
    return runPromise((svc) => svc.status())
  }

  export async function history(limit?: number) {
    return runPromise((svc) => svc.history(limit))
  }

  export async function stage(paths?: string[]) {
    return runPromise((svc) => svc.stage(paths))
  }

  export async function unstage(paths?: string[]) {
    return runPromise((svc) => svc.unstage(paths))
  }

  export async function discard(paths?: string[]) {
    return runPromise((svc) => svc.discard(paths))
  }

  export async function commit(message: string) {
    return runPromise((svc) => svc.commit(message))
  }
}
