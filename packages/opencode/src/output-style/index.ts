import z from "zod"
import path from "path"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Plugin } from "@/plugin"
import { resolvePluginAsset } from "@/plugin/shared"
import { Glob } from "@/util/glob"
import { Effect, Layer, ServiceMap } from "effect"

const EXPLANATORY = [
  "Explain important implementation choices while you work.",
  "Keep explanations short, concrete, and tied to this codebase.",
  "Stay focused on finishing the task rather than turning every response into a tutorial.",
].join("\n")

const LEARNING = [
  "Optimize for teaching through execution.",
  "When a change is large or involves important decisions, invite the user to contribute a small focused piece when that would help them learn.",
  "Keep the main task moving and avoid turning routine work into homework.",
].join("\n")

export namespace OutputStyle {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string(),
      prompt: z.string(),
      source: z.enum(["builtin", "plugin", "config"]),
      plugin: z.string().optional(),
      keepCodingInstructions: z.boolean().optional(),
      forceForPlugin: z.boolean().optional(),
      location: z.string().optional(),
    })
    .meta({
      ref: "OutputStyle",
    })
  export type Info = z.infer<typeof Info>

  type State = {
    styles: Record<string, Info>
  }

  export interface Interface {
    readonly all: () => Effect.Effect<Info[]>
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly active: () => Effect.Effect<Info | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/OutputStyle") {}

  function builtins(): Record<string, Info> {
    return {
      default: {
        name: "default",
        description: "Default opencode response style.",
        prompt: "",
        source: "builtin" as const,
      },
      Explanatory: {
        name: "Explanatory",
        description: "Adds short educational explanations about implementation choices.",
        prompt: EXPLANATORY,
        source: "builtin" as const,
        keepCodingInstructions: true,
      },
      Learning: {
        name: "Learning",
        description: "Balances task completion with small collaborative learning prompts.",
        prompt: LEARNING,
        source: "builtin" as const,
        keepCodingInstructions: true,
      },
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("OutputStyle.state")(function* () {
          const styles = builtins()
          const dirs = yield* config.directories()
          const reg = yield* plugin.registry()

          for (const dir of dirs) {
            const files = Glob.scanSync("{output-style,output-styles}/**/*.md", {
              cwd: dir,
              absolute: true,
              dot: true,
              symlink: true,
            })
            for (const file of files) {
              const md = yield* Effect.promise(() => ConfigMarkdown.parse(file)).pipe(
                Effect.catch(() => Effect.succeed(undefined)),
              )
              if (!md) continue
              const name = (typeof md.data.name === "string" && md.data.name.trim()) || path.basename(file, ".md")
              styles[name] = {
                name,
                description:
                  (typeof md.data.description === "string" && md.data.description.trim()) ||
                  `Custom ${name} output style.`,
                prompt: md.content.trim(),
                source: "config",
                location: file,
              }
            }
          }

          for (const [id, item] of Object.entries(reg.outputStyles)) {
            const file = item.path ? resolvePluginAsset(item.spec, item.path, item.dir) : undefined
            const prompt =
              item.prompt ??
              (file
                ? (yield* Effect.promise(() => ConfigMarkdown.parse(file).then((md) => md.content.trim())).pipe(
                    Effect.catch(() => Effect.succeed("")),
                  ))
                : "")

            const name = item.name?.trim() || id
            styles[name] = {
              name,
              description: item.description ?? `Output style from ${item.plugin} plugin.`,
              prompt,
              source: "plugin",
              plugin: item.plugin,
              keepCodingInstructions:
                typeof item.keepCodingInstructions === "boolean" ? item.keepCodingInstructions : undefined,
              forceForPlugin: item.forceForPlugin === true,
              location: file,
            }
          }

          return { styles }
        }),
      )

      const all = Effect.fn("OutputStyle.all")(function* () {
        const s = yield* InstanceState.get(state)
        return Object.values(s.styles).toSorted((a, b) => a.name.localeCompare(b.name))
      })

      const get = Effect.fn("OutputStyle.get")(function* (name: string) {
        const s = yield* InstanceState.get(state)
        return s.styles[name]
      })

      const active = Effect.fn("OutputStyle.active")(function* () {
        const s = yield* InstanceState.get(state)
        const forced = Object.values(s.styles)
          .filter((item) => item.source === "plugin" && item.forceForPlugin)
          .toSorted((a, b) => a.name.localeCompare(b.name))[0]
        if (forced) return forced

        const cfg = yield* config.get()
        const name = cfg.output_style ?? "default"
        if (name === "default") return
        return s.styles[name]
      })

      return Service.of({ all, get, active })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Plugin.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function all() {
    return runPromise((svc) => svc.all())
  }

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function active() {
    return runPromise((svc) => svc.active())
  }
}
