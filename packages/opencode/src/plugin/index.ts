import type { Hooks, PluginInput, Plugin as PluginInstance, PluginModule } from "@opencode-ai/plugin"
import path from "path"
import { mkdir } from "fs/promises"
import semver from "semver"
import z from "zod"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { Effect, Layer, ServiceMap, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import {
  checkPluginPolicy,
  parsePluginSpecifier,
  PluginManifest,
  pluginKeys,
  pluginStorage,
  readPluginId,
  readPluginManifestFile,
  readPluginModuleManifest,
  readV1Plugin,
  resolvePluginId,
  resolvePluginRoot,
} from "./shared"
import { createOutlinePlugin } from "@opencode-ai/outline-server"
import { Global } from "../global"
import { mergeDeep } from "remeda"
import { isRecord } from "@/util/record"
import { PluginMeta } from "./meta"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  type Base = {
    id: string
    key: string
    plugin: string
    dir: string
    spec: string
  }

  export type Descriptor = {
    id: string
    spec: string
    version?: string
    keys: string[]
    source: "file" | "npm"
    target: string
    dir: string
    scope: Config.PluginScope
    options?: Config.PluginOptions
    manifest?: PluginManifest
    dataDir: string
    cacheDir: string
    configDir: string
    stateDir: string
  }

  export type Registry = {
    commands: Record<string, Base & NonNullable<PluginManifest["commands"]>[string]>
    agents: Record<string, Base & NonNullable<PluginManifest["agents"]>[string]>
    skills: Record<string, Base & NonNullable<PluginManifest["skills"]>[string]>
    mcpServers: Record<string, Base & NonNullable<PluginManifest["mcpServers"]>[string]>
    lspServers: Record<string, Base & Record<string, unknown>>
    outputStyles: Record<string, Base & NonNullable<PluginManifest["outputStyles"]>[string]>
    channels: Record<string, Base & NonNullable<PluginManifest["channels"]>[string]>
  }

  export const DescriptorInfo = z
    .object({
      id: z.string(),
      spec: z.string(),
      version: z.string().optional(),
      keys: z.array(z.string()),
      source: z.enum(["file", "npm"]),
      target: z.string(),
      dir: z.string(),
      scope: z.enum(["global", "local"]),
      options: z.record(z.string(), z.unknown()).optional(),
      manifest: PluginManifest.optional(),
      dataDir: z.string(),
      cacheDir: z.string(),
      configDir: z.string(),
      stateDir: z.string(),
    })
    .meta({
      ref: "PluginDescriptor",
    })

  export const ChannelInfo = z
    .object({
      id: z.string(),
      key: z.string(),
      plugin: z.string(),
      dir: z.string(),
      spec: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      prompt: z.string().optional(),
      path: z.string().optional(),
      enabled: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .meta({
      ref: "PluginChannel",
    })

  type State = {
    hooks: Hooks[]
    plugins: Descriptor[]
    registry: Registry
  }

  type Pending = {
    load?: PluginLoader.Loaded
    item: Descriptor
  }

  // Hook names that follow the (input, output) => Promise<void> trigger pattern
  type TriggerName = {
    [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
  }[keyof Hooks]

  export interface Interface {
    readonly trigger: <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(
      name: Name,
      input: Input,
      output: Output,
    ) => Effect.Effect<Output>
    readonly list: () => Effect.Effect<Hooks[]>
    readonly plugins: () => Effect.Effect<Descriptor[]>
    readonly registry: () => Effect.Effect<Registry>
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Plugin") {}

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [
    CodexAuthPlugin,
    CopilotAuthPlugin,
    GitlabAuthPlugin,
    PoeAuthPlugin,
    CloudflareWorkersAuthPlugin,
    CloudflareAIGatewayAuthPlugin,
    createOutlinePlugin(Global.Path.data),
  ]

  function isServerPlugin(value: unknown): value is PluginInstance {
    return typeof value === "function"
  }

  function getServerPlugin(value: unknown) {
    if (isServerPlugin(value)) return value
    if (!value || typeof value !== "object" || !("server" in value)) return
    if (!isServerPlugin(value.server)) return
    return value.server
  }

  function getLegacyPlugins(mod: Record<string, unknown>) {
    const seen = new Set<unknown>()
    const result: PluginInstance[] = []

    for (const entry of Object.values(mod)) {
      if (seen.has(entry)) continue
      seen.add(entry)
      const plugin = getServerPlugin(entry)
      if (!plugin) throw new TypeError("Plugin export is not a function")
      result.push(plugin)
    }

    return result
  }

  function publishPluginError(bus: Bus.Interface, message: string) {
    Effect.runFork(bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
  }

  function mergeManifest(...items: Array<PluginManifest | undefined>) {
    const list = items.filter(Boolean)
    if (list.length === 0) return
    return list.reduce<PluginManifest>((acc, item) => mergeDeep(acc, item!), {})
  }

  function scoped(plugin: string, key: string, name?: string) {
    if (name?.trim()) return name.trim()
    return `${plugin}:${key}`
  }

  function refs(item: Descriptor) {
    return Object.entries(item.manifest?.dependencies ?? {}).map(([key, value]) => {
      if (typeof value === "string") {
        return {
          id: key,
          optional: false,
          version: value,
        }
      }

      return {
        id: value.id?.trim() || key,
        optional: value.optional === true,
        version: value.version,
      }
    })
  }

  function version(item: Descriptor, range?: string) {
    if (!range) return true
    if (!item.version) return false
    if (semver.valid(item.version) && semver.validRange(range)) {
      return semver.satisfies(item.version, range)
    }
    return item.version === range
  }

  function dependencies(items: Pending[]) {
    const ready = new Map(items.map((item) => [item.item.id, item]))
    const blocked = new Map<string, string>()
    let changed = true

    while (changed) {
      changed = false
      for (const [id, row] of Array.from(ready.entries())) {
        const fail = refs(row.item).find((dep) => {
          const hit = ready.get(dep.id)
          if (!hit) return !dep.optional
          if (!version(hit.item, dep.version)) return !dep.optional
          return false
        })
        if (!fail) continue

        const rule = fail.version ? `${fail.id}@${fail.version}` : fail.id
        blocked.set(id, `Plugin ${row.item.spec} requires plugin ${rule}`)
        ready.delete(id)
        changed = true
      }
    }

    return {
      allowed: Array.from(ready.values()),
      blocked,
    }
  }

  async function input(
    base: Omit<PluginInput, "pluginID" | "pluginSpec" | "dataDir" | "cacheDir" | "configDir" | "stateDir">,
    item: Descriptor,
  ) {
    await Promise.all(
      [item.dataDir, item.cacheDir, item.configDir, item.stateDir].map((dir) => mkdir(dir, { recursive: true })),
    )
    return {
      ...base,
      pluginID: item.id,
      pluginSpec: item.spec,
      dataDir: item.dataDir,
      cacheDir: item.cacheDir,
      configDir: item.configDir,
      stateDir: item.stateDir,
    } satisfies PluginInput
  }

  function buildRegistry(plugins: Descriptor[]): Registry {
    const out: Registry = {
      commands: {},
      agents: {},
      skills: {},
      mcpServers: {},
      lspServers: {},
      outputStyles: {},
      channels: {},
    }

    for (const plugin of plugins) {
      const manifest = plugin.manifest
      if (!manifest) continue

      for (const [key, item] of Object.entries(manifest.commands ?? {})) {
        const id = scoped(plugin.id, key, item.name)
        out.commands[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.agents ?? {})) {
        const id = scoped(plugin.id, key, item.name)
        out.agents[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.skills ?? {})) {
        const id = scoped(plugin.id, key, item.name)
        out.skills[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.mcpServers ?? {})) {
        const id = scoped(plugin.id, key, item.name)
        out.mcpServers[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.lspServers ?? {})) {
        const id = scoped(plugin.id, key)
        out.lspServers[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.outputStyles ?? {})) {
        const id = scoped(plugin.id, key)
        out.outputStyles[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }

      for (const [key, item] of Object.entries(manifest.channels ?? {})) {
        const id = scoped(plugin.id, key)
        out.channels[id] = { ...item, id, key, plugin: plugin.id, dir: plugin.dir, spec: plugin.spec }
      }
    }

    return out
  }

  async function descriptor(
    input: Pick<PluginLoader.Resolved, "spec" | "source" | "target" | "pkg" | "options"> & {
      scope: Config.PluginScope
      mod?: Record<string, unknown>
    },
  ) {
    const dir = resolvePluginRoot(input.target, input.pkg)
    const file = await readPluginManifestFile(input.target, input.pkg).catch(() => undefined)
    const mod = input.mod ? readPluginModuleManifest(input.mod, input.spec) : undefined
    const manifest = mergeManifest(file, mod)
    const base = input.mod?.default
    const raw = readPluginId((isRecord(base) ? base.id : undefined) ?? manifest?.id ?? manifest?.name, input.spec)
    const id =
      raw || input.source === "npm"
        ? await resolvePluginId(input.source, input.spec, input.target, raw, input.pkg)
        : path.basename(dir)
    const dirs = pluginStorage(id)
    const keys = pluginKeys({
      spec: input.spec,
      id,
      target: input.target,
      pkg: input.pkg,
    })

    return {
      id,
      spec: input.spec,
      version:
        manifest?.version ??
        (typeof input.pkg?.json.version === "string" ? input.pkg.json.version.trim() || undefined : undefined),
      keys,
      source: input.source,
      target: input.target,
      dir,
      scope: input.scope,
      options: input.options,
      manifest,
      dataDir: dirs.dataDir,
      cacheDir: dirs.cacheDir,
      configDir: dirs.configDir,
      stateDir: dirs.stateDir,
    } satisfies Descriptor
  }

  async function start(
    load: PluginLoader.Loaded,
    item: Descriptor,
    base: Omit<PluginInput, "pluginID" | "pluginSpec" | "dataDir" | "cacheDir" | "configDir" | "stateDir">,
    hooks: Hooks[],
  ) {
    const mod = load.mod.default
    const next = await input(base, item)
    if (isRecord(mod) && "server" in mod) {
      const plugin = readV1Plugin(load.mod, load.spec, "server")
      hooks.push(await (plugin as PluginModule).server(next, load.options))
      return
    }

    if (item.manifest) return

    for (const server of getLegacyPlugins(load.mod)) {
      hooks.push(await server(next, load.options))
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service

      const state = yield* InstanceState.make<State>((ctx) =>
        Effect.gen(function* () {
          const hooks: Hooks[] = []
          const items: Descriptor[] = []

          const { Server } = yield* Effect.promise(() => import("../server/server"))

          const client = createOpencodeClient({
            baseUrl: "http://localhost:4096",
            directory: ctx.directory,
            headers: Flag.OPENCODE_SERVER_PASSWORD
              ? {
                  Authorization: `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
                }
              : undefined,
            fetch: async (...args) => Server.Default().app.fetch(...args),
          })
          const cfg = yield* config.get()
          const base = {
            client,
            project: ctx.project,
            worktree: ctx.worktree,
            directory: ctx.directory,
            get serverUrl(): URL {
              return Server.url ?? new URL("http://localhost:4096")
            },
            $: Bun.$ as PluginInput["$"],
          } satisfies Omit<PluginInput, "pluginID" | "pluginSpec" | "dataDir" | "cacheDir" | "configDir" | "stateDir">

          for (const plugin of INTERNAL_PLUGINS) {
            log.info("loading internal plugin", { name: plugin.name })
            const dirs = pluginStorage(plugin.name, cfg.plugins?.cache)
            const init = yield* Effect.tryPromise({
              try: async () => {
                await Promise.all(
                  [dirs.dataDir, dirs.cacheDir, dirs.configDir, dirs.stateDir].map((dir) =>
                    mkdir(dir, { recursive: true }),
                  ),
                )
                return plugin({
                  ...base,
                  pluginID: plugin.name,
                  pluginSpec: plugin.name,
                  ...dirs,
                })
              },
              catch: (err) => {
                log.error("failed to load internal plugin", { name: plugin.name, error: err })
              },
            }).pipe(Effect.option)
            if (init._tag === "Some") hooks.push(init.value)
          }

          const origins = Flag.OPENCODE_PURE ? [] : (cfg.plugin_origins ?? [])
          if (Flag.OPENCODE_PURE && cfg.plugin_origins?.length) {
            log.info("skipping external plugins in pure mode", { count: cfg.plugin_origins.length })
          }
          if (origins.length) yield* config.waitForDependencies()

          const loaded = yield* Effect.promise(() =>
            PluginLoader.loadExternal({
              items: origins,
              kind: "server",
              finish: async (load, origin) => {
                try {
                  const item = await descriptor({ ...load, scope: origin.scope, mod: load.mod })
                  return { load, item } satisfies Pending
                } catch (err) {
                  const message = errorMessage(err)
                  log.error("failed to load plugin", { path: load.spec, error: message })
                  publishPluginError(bus, `Failed to load plugin ${load.spec}: ${message}`)
                }
              },
              missing: async (load, origin) => {
                const item = await descriptor({ ...load, scope: origin.scope }).catch((err) => {
                  const message = errorMessage(err)
                  log.error("failed to read plugin manifest", { path: load.spec, error: message })
                  publishPluginError(bus, `Failed to load plugin ${load.spec}: ${message}`)
                  return undefined
                })
                if (!item?.manifest) return
                return { item } satisfies Pending
              },
              report: {
                start(candidate) {
                  log.info("loading plugin", { path: candidate.plan.spec })
                },
                missing(candidate, _retry, message) {
                  log.warn("plugin has no server entrypoint", { path: candidate.plan.spec, message })
                },
                error(candidate, _retry, stage, error, resolved) {
                  const spec = candidate.plan.spec
                  const cause = error instanceof Error ? (error.cause ?? error) : error
                  const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

                  if (stage === "install") {
                    const parsed = parsePluginSpecifier(spec)
                    log.error("failed to install plugin", { pkg: parsed.pkg, version: parsed.version, error: message })
                    publishPluginError(bus, `Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                    return
                  }

                  if (stage === "compatibility") {
                    log.warn("plugin incompatible", { path: spec, error: message })
                    publishPluginError(bus, `Plugin ${spec} skipped: ${message}`)
                    return
                  }

                  if (stage === "entry") {
                    log.error("failed to resolve plugin server entry", { path: spec, error: message })
                    publishPluginError(bus, `Failed to load plugin ${spec}: ${message}`)
                    return
                  }

                  log.error("failed to load plugin", { path: spec, target: resolved?.entry, error: message })
                  publishPluginError(bus, `Failed to load plugin ${spec}: ${message}`)
                },
              },
            }),
          )
          const allowed: Pending[] = []
          for (const row of loaded) {
            const hit = checkPluginPolicy(cfg.plugins?.policy, {
              spec: row.item.spec,
              id: row.item.id,
              target: row.item.target,
            })
            if (!hit.ok) {
              log.warn("plugin blocked by policy", { spec: row.item.spec, reason: hit.reason })
              publishPluginError(bus, hit.reason)
              continue
            }
            row.item.keys = hit.keys
            const dirs = pluginStorage(row.item.id, cfg.plugins?.cache)
            row.item.dataDir = dirs.dataDir
            row.item.cacheDir = dirs.cacheDir
            row.item.configDir = dirs.configDir
            row.item.stateDir = dirs.stateDir
            allowed.push(row)
          }

          const deps = dependencies(allowed)
          for (const reason of deps.blocked.values()) {
            log.warn("plugin skipped due to missing dependency", { reason })
            publishPluginError(bus, reason)
          }

          items.push(...deps.allowed.map((row) => row.item))

          yield* Effect.tryPromise({
            try: () =>
              PluginMeta.touchMany(
                deps.allowed.map((row) => ({
                  spec: row.item.spec,
                  target: row.item.target,
                  id: row.item.id,
                })),
              ),
            catch: () => undefined,
          }).pipe(Effect.ignore)

          for (const row of deps.allowed) {
            if (!row.load) continue
            yield* Effect.tryPromise({
              try: () => start(row.load!, row.item, base, hooks),
              catch: (err) => {
                const message = errorMessage(err)
                log.error("failed to initialize plugin", { spec: row.item.spec, error: message })
                publishPluginError(bus, `Failed to load plugin ${row.item.spec}: ${message}`)
              },
            }).pipe(Effect.ignore)
          }

          // Notify plugins of current config
          for (const hook of hooks) {
            yield* Effect.tryPromise({
              try: () => Promise.resolve((hook as any).config?.(cfg)),
              catch: (err) => {
                log.error("plugin config hook failed", { error: err })
              },
            }).pipe(Effect.ignore)
          }

          // Subscribe to bus events, fiber interrupted when scope closes
          yield* bus.subscribeAll().pipe(
            Stream.runForEach((input) =>
              Effect.sync(() => {
                for (const hook of hooks) {
                  hook["event"]?.({ event: input as any })
                }
              }),
            ),
            Effect.forkScoped,
          )

          return { hooks, plugins: items, registry: buildRegistry(items) }
        }).pipe(Effect.orDie),
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends TriggerName,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output) {
        if (!name) return output
        const s = yield* InstanceState.get(state)
        for (const hook of s.hooks) {
          const fn = hook[name] as any
          if (!fn) continue
          yield* Effect.promise(async () => fn(input, output))
        }
        return output
      })

      const list = Effect.fn("Plugin.list")(function* () {
        const s = yield* InstanceState.get(state)
        return s.hooks
      })

      const plugins = Effect.fn("Plugin.plugins")(function* () {
        const s = yield* InstanceState.get(state)
        return s.plugins
      })

      const registryState = Effect.fn("Plugin.registry")(function* () {
        const s = yield* InstanceState.get(state)
        return s.registry
      })

      const init = Effect.fn("Plugin.init")(function* () {
        yield* InstanceState.get(state)
      })

      return Service.of({ trigger, list, plugins, registry: registryState, init })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    return runPromise((svc) => svc.trigger(name, input, output))
  }

  export async function list(): Promise<Hooks[]> {
    return runPromise((svc) => svc.list())
  }

  export async function plugins() {
    return runPromise((svc) => svc.plugins())
  }

  export async function registry() {
    return runPromise((svc) => svc.registry())
  }

  export async function init() {
    return runPromise((svc) => svc.init())
  }
}
