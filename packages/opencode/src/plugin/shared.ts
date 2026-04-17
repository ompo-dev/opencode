import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import npa from "npm-package-arg"
import semver from "semver"
import z from "zod"
import { Global } from "@/global"
import { Npm } from "@/npm"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

// Old npm package names for plugins that are now built-in
export const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

function parse(spec: string) {
  try {
    return npa(spec)
  } catch {}
}

export function parsePluginSpecifier(spec: string) {
  const hit = parse(spec)
  if (hit?.type === "alias" && !hit.name) {
    const sub = (hit as npa.AliasResult).subSpec
    if (sub?.name) {
      const version = !sub.rawSpec || sub.rawSpec === "*" ? "latest" : sub.rawSpec
      return { pkg: sub.name, version }
    }
  }
  if (!hit?.name) return { pkg: spec, version: "" }
  if (hit.raw === hit.name) return { pkg: hit.name, version: "latest" }
  return { pkg: hit.name, version: hit.rawSpec }
}

function template(input: string, name: string, version: string) {
  return input.replaceAll("{name}", name).replaceAll("{version}", version)
}

function joinMarketplace(base: string, name: string, kind: PluginMarketplace["type"]) {
  if (!base) return name
  if (base.includes("{name}") || base.includes("{version}")) return base
  if (kind === "git") {
    if (/[\\/:\-]$/.test(base)) return base + name
    return `${base}/${name}`
  }
  if (kind === "file" || kind === "directory") {
    if (base.startsWith("file://")) {
      if (/[\\/]$/.test(base)) return base + name
      return `${base}/${name}`
    }
    return path.join(base, name)
  }
  if (base.endsWith("/")) return base + name
  return base + name
}

export function resolveMarketplaceSpec(spec: string, marketplaces?: Record<string, PluginMarketplace>) {
  const idx = spec.indexOf(":")
  if (idx <= 0) return spec
  const key = spec.slice(0, idx).trim()
  const tail = spec.slice(idx + 1).trim()
  if (!key || !tail) return spec

  const item = marketplaces?.[key]
  if (!item) return spec

  const parsed = parsePluginSpecifier(tail)
  const kind = item.type ?? "npm"
  const base = template(joinMarketplace(item.url?.trim() ?? "", parsed.pkg, kind), parsed.pkg, parsed.version)

  if (kind === "git") {
    if (!parsed.version || parsed.version === "latest" || base.includes("{version}")) return base
    return `${base}#${parsed.version}`
  }

  if (kind === "file" || kind === "directory") return base
  if (!parsed.version || parsed.version === "latest" || base.includes("{version}")) return base
  return `${base}@${parsed.version}`
}

export type PluginSource = "file" | "npm"
export type PluginKind = "server" | "tui"
type PluginMode = "strict" | "detect"

export type PluginPackage = {
  dir: string
  pkg: string
  json: Record<string, unknown>
}

export type PluginPolicy = {
  lockdown?: boolean
  allow?: string[]
  deny?: string[]
}

export type PluginMarketplace = {
  url?: string
  type?: "npm" | "git" | "file" | "directory"
}

export type PluginCache = {
  directory?: string
  version?: string
}

export type PluginStorage = {
  dataDir: string
  cacheDir: string
  configDir: string
  stateDir: string
}

const PluginCommand = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    template: z.string().optional(),
    path: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    subtask: z.boolean().optional(),
  })
  .catchall(z.unknown())

const PluginSkill = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    path: z.string(),
    paths: z.array(z.string()).optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    mode: z.enum(["inline", "subagent"]).optional(),
  })
  .catchall(z.unknown())

const PluginAgent = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
    path: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    model: z.string().optional(),
    variant: z.string().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    color: z.string().optional(),
    hidden: z.boolean().optional(),
    steps: z.number().int().positive().optional(),
    permission: z.record(z.string(), z.unknown()).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown())

const PluginMcpServer = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown())

const PluginOutputStyle = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
    path: z.string().optional(),
    keepCodingInstructions: z.boolean().optional(),
    forceForPlugin: z.boolean().optional(),
  })
  .catchall(z.unknown())

const PluginChannel = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
    path: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .catchall(z.unknown())

const PluginRef = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .catchall(z.unknown())

export const PluginManifest = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    version: z.string().optional(),
    hooks: z.array(z.string()).optional(),
    dependencies: z.record(z.string(), z.union([z.string(), PluginRef])).optional(),
    commands: z.record(z.string(), PluginCommand).optional(),
    agents: z.record(z.string(), PluginAgent).optional(),
    skills: z.record(z.string(), PluginSkill).optional(),
    mcpServers: z.record(z.string(), PluginMcpServer).optional(),
    lspServers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    outputStyles: z.record(z.string(), PluginOutputStyle).optional(),
    userConfig: z.record(z.string(), z.unknown()).optional(),
    channels: z.record(z.string(), PluginChannel).optional(),
  })
  .catchall(z.unknown())
export type PluginManifest = z.infer<typeof PluginManifest>

export type PluginEntry = {
  spec: string
  source: PluginSource
  target: string
  pkg?: PluginPackage
  entry?: string
}

const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]

export function pluginSource(spec: string): PluginSource {
  if (isPathPluginSpec(spec)) return "file"
  return "npm"
}

function resolveExportPath(raw: string, dir: string) {
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  if (path.isAbsolute(raw)) return raw
  return path.resolve(dir, raw)
}

function isAbsolutePath(raw: string) {
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
}

function extractExportValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  for (const key of ["import", "default"]) {
    const nested = value[key]
    if (typeof nested === "string") return nested
  }
  return undefined
}

function packageMain(pkg: PluginPackage) {
  const value = pkg.json.main
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

function resolvePackageFile(spec: string, raw: string, kind: string, pkg: PluginPackage) {
  const resolved = resolveExportPath(raw, pkg.dir)
  const root = Filesystem.resolve(pkg.dir)
  const next = Filesystem.resolve(resolved)
  if (!Filesystem.contains(root, next)) {
    throw new Error(`Plugin ${spec} resolved ${kind} entry outside plugin directory`)
  }
  return next
}

export function resolvePluginRoot(target: string, pkg?: PluginPackage) {
  if (pkg) return pkg.dir
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  return path.extname(file) ? path.dirname(file) : file
}

function clean(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

function pattern(input: string) {
  return new RegExp(`^${input.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
}

function match(rule: string, values: string[]) {
  const next = rule.trim()
  if (!next) return false
  const rx = pattern(next)
  return values.some((value) => rx.test(value))
}

export function pluginKeys(input: {
  spec: string
  id?: string
  target?: string
  pkg?: PluginPackage
}) {
  const out = new Set<string>()
  const add = (value?: string) => {
    const next = value?.trim()
    if (next) out.add(next)
  }

  add(input.spec)
  add(input.id)

  if (!isPathPluginSpec(input.spec)) {
    add(parsePluginSpecifier(input.spec).pkg)
  }

  if (input.pkg && typeof input.pkg.json.name === "string") {
    add(input.pkg.json.name)
  }

  if (input.target) {
    add(path.basename(resolvePluginRoot(input.target, input.pkg)))
  }

  return Array.from(out)
}

export function checkPluginPolicy(
  policy: PluginPolicy | undefined,
  input: {
    spec: string
    id?: string
    target?: string
    pkg?: PluginPackage
  },
) {
  const keys = pluginKeys(input)
  const deny = policy?.deny?.find((item) => match(item, keys))
  if (deny) {
    return {
      ok: false as const,
      keys,
      reason: `Plugin ${input.spec} is denied by policy rule ${deny}`,
    }
  }

  if (policy?.lockdown) {
    const allow = policy.allow?.find((item) => match(item, keys))
    if (!allow) {
      return {
        ok: false as const,
        keys,
        reason: `Plugin ${input.spec} is blocked by plugin lockdown policy`,
      }
    }
  }

  return {
    ok: true as const,
    keys,
  }
}

export function pluginStorage(id: string, cache?: PluginCache): PluginStorage {
  const key = clean(id)
  const version = clean(cache?.version ?? "default")
  const root = cache?.directory ? Filesystem.resolve(cache.directory) : path.join(Global.Path.cache, "plugin")
  return {
    dataDir: path.join(Global.Path.data, "plugin", key),
    cacheDir: path.join(root, version, key),
    configDir: path.join(Global.Path.config, "plugin", key),
    stateDir: path.join(Global.Path.state, "plugin", key),
  }
}

export function resolvePluginAsset(spec: string, raw: string, target: string, pkg?: PluginPackage) {
  const root = resolvePluginRoot(target, pkg)
  const file = resolveExportPath(raw, root)
  const next = Filesystem.resolve(file)
  if (!Filesystem.contains(Filesystem.resolve(root), next)) {
    throw new Error(`Plugin ${spec} resolved asset outside plugin directory`)
  }
  return next
}

function resolvePackagePath(spec: string, raw: string, kind: PluginKind, pkg: PluginPackage) {
  return pathToFileURL(resolvePackageFile(spec, raw, kind, pkg)).href
}

function resolvePackageEntrypoint(spec: string, kind: PluginKind, pkg: PluginPackage) {
  const exports = pkg.json.exports
  if (isRecord(exports)) {
    const raw = extractExportValue(exports[`./${kind}`])
    if (raw) return resolvePackagePath(spec, raw, kind, pkg)
  }

  if (kind !== "server") return
  const main = packageMain(pkg)
  if (!main) return
  return resolvePackagePath(spec, main, kind, pkg)
}

function targetPath(target: string) {
  if (target.startsWith("file://")) return fileURLToPath(target)
  if (path.isAbsolute(target)) return target
}

async function resolveDirectoryIndex(dir: string) {
  for (const name of INDEX_FILES) {
    const file = path.join(dir, name)
    if (await Filesystem.exists(file)) return file
  }
}

async function resolveTargetDirectory(target: string) {
  const file = targetPath(target)
  if (!file) return
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) return
  return file
}

async function resolvePluginEntrypoint(spec: string, target: string, kind: PluginKind, pkg?: PluginPackage) {
  const source = pluginSource(spec)
  const hit =
    pkg ?? (source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined))
  if (!hit) return target

  const entry = resolvePackageEntrypoint(spec, kind, hit)
  if (entry) return entry

  const dir = await resolveTargetDirectory(target)

  if (kind === "tui") {
    if (source === "file" && dir) {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    if (source === "npm") return
    if (dir) return

    return target
  }

  if (dir && isRecord(hit.json.exports)) {
    if (source === "file") {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    return
  }

  return target
}

export function isPathPluginSpec(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || isAbsolutePath(spec)
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file://") ? fileURLToPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) {
    if (spec.startsWith("file://")) return spec
    return pathToFileURL(file).href
  }

  if (await Filesystem.exists(path.join(file, "package.json"))) {
    return pathToFileURL(file).href
  }

  const index = await resolveDirectoryIndex(file)
  if (index) return pathToFileURL(index).href

  throw new Error(`Plugin directory ${file} is missing package.json or index file`)
}

export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {
  if (!semver.valid(opencodeVersion) || semver.major(opencodeVersion) === 0) return
  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  if (!hit) return
  const engines = hit.json.engines
  if (!isRecord(engines)) return
  const range = engines.opencode
  if (typeof range !== "string") return
  if (!semver.satisfies(opencodeVersion, range)) {
    throw new Error(`Plugin requires opencode ${range} but running ${opencodeVersion}`)
  }
}

export async function resolvePluginTarget(spec: string) {
  if (isPathPluginSpec(spec)) return resolvePathPluginTarget(spec)
  const hit = parse(spec)
  const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
  const result = await Npm.add(pkg)
  return result.directory
}

export async function readPluginPackage(target: string): Promise<PluginPackage> {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.statAsync(file)
  const dir = stat?.isDirectory() ? file : path.dirname(file)
  const pkg = path.join(dir, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

function embeddedManifest(json: Record<string, unknown>) {
  for (const key of ["opencode", "opencodePlugin", "opencode-plugin"]) {
    const raw = json[key]
    const parsed = PluginManifest.safeParse(raw)
    if (parsed.success) return parsed.data
  }
}

export async function readPluginManifestFile(target: string, pkg?: PluginPackage) {
  const root = resolvePluginRoot(target, pkg)
  const file = path.join(root, "plugin.json")
  if (await Filesystem.exists(file)) {
    const raw = await Filesystem.readJson(file)
    const parsed = PluginManifest.safeParse(raw)
    if (!parsed.success) {
      throw new TypeError(`Plugin manifest ${file} is invalid`)
    }
    return parsed.data
  }

  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  if (!hit) return
  return embeddedManifest(hit.json)
}

export function readPluginModuleManifest(mod: Record<string, unknown>, spec: string) {
  const value = mod.default
  if (!isRecord(value)) return
  const parsed = PluginManifest.safeParse(value.manifest)
  if (value.manifest === undefined) return
  if (!parsed.success) {
    throw new TypeError(`Plugin ${spec} has invalid manifest export`)
  }
  return parsed.data
}

export async function createPluginEntry(spec: string, target: string, kind: PluginKind): Promise<PluginEntry> {
  const source = pluginSource(spec)
  const pkg =
    source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined)
  const entry = await resolvePluginEntrypoint(spec, target, kind, pkg)
  return {
    spec,
    source,
    target,
    pkg,
    entry,
  }
}

export function readPackageThemes(spec: string, pkg: PluginPackage) {
  const field = pkg.json["oc-themes"]
  if (field === undefined) return []
  if (!Array.isArray(field)) {
    throw new TypeError(`Plugin ${spec} has invalid oc-themes field`)
  }

  const list = field.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid oc-themes entry`)
    }

    const raw = item.trim()
    if (!raw) {
      throw new TypeError(`Plugin ${spec} has empty oc-themes entry`)
    }
    if (raw.startsWith("file://") || isAbsolutePath(raw)) {
      throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
    }

    return resolvePackageFile(spec, raw, "oc-themes", pkg)
  })

  return Array.from(new Set(list))
}

export function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: PluginMode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

export async function resolvePluginId(
  source: PluginSource,
  spec: string,
  target: string,
  id: string | undefined,
  pkg?: PluginPackage,
) {
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (id) return id
  const hit = pkg ?? (await readPluginPackage(target))
  if (typeof hit.json.name !== "string" || !hit.json.name.trim()) {
    throw new TypeError(`Plugin package ${hit.pkg} is missing name`)
  }
  return hit.json.name.trim()
}
