import { PlanEnterTool, PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { KanbanTool } from "./kanban"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskDescription, TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillDescription, SkillTool } from "./skill"
import { SleepTool } from "./sleep"
import { TaskMessageTool, TaskStatusTool, TaskWaitTool } from "./task-control"
import { Tool } from "./tool"
import { Config } from "../config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { McpAuthTool, McpListResourcesTool, McpReadResourceTool } from "./mcp"
import { WorkflowCreateTool, WorkflowDeleteTool, WorkflowListTool, WorkflowTriggerTool } from "./workflow"
import { SendMessageTool } from "./send-message"
import { TeamListTool } from "./team"
import { PowerShellTool } from "./powershell"
import { ToolSearchTool } from "./search"
import { Glob } from "../util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Env } from "../env"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "../filesystem"
import { Agent } from "../agent/agent"
import { MCP } from "../mcp"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type TaskDef = Tool.InferDef<typeof TaskTool>
  type ReadDef = Tool.InferDef<typeof ReadTool>

  type State = {
    custom: Tool.Def[]
    builtin: Tool.Def[]
    task: TaskDef
    read: ReadDef
  }

  export interface Interface {
    readonly ids: () => Effect.Effect<string[]>
    readonly all: () => Effect.Effect<Tool.Def[]>
    readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
    readonly tools: (model: {
      providerID: ProviderID
      modelID: ModelID
      agent: Agent.Info
    }) => Effect.Effect<Tool.Def[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Config.Service
    | Plugin.Service
    | Question.Service
    | Todo.Service
    | Agent.Service
    | MCP.Service
    | LSP.Service
    | FileTime.Service
    | Instruction.Service
    | AppFileSystem.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service

      const task = yield* TaskTool
      const read = yield* ReadTool
      const question = yield* QuestionTool
      const todo = yield* TodoWriteTool
      const mcpAuth = yield* McpAuthTool
      const mcpListResources = yield* McpListResourcesTool
      const mcpReadResource = yield* McpReadResourceTool
      const taskMessage = yield* TaskMessageTool
      const workflowList = WorkflowListTool
      const workflowCreate = WorkflowCreateTool
      const workflowTrigger = WorkflowTriggerTool
      const workflowDelete = WorkflowDeleteTool
      const sendMessage = SendMessageTool
      const teamList = TeamListTool
      const powershell = PowerShellTool
      const toolSearch = ToolSearchTool

      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* (ctx) {
          const custom: Tool.Def[] = []

          function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
            return {
              id,
              parameters: z.object(def.args),
              description: def.description,
              execute: async (args, toolCtx) => {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = await def.execute(args as any, pluginCtx)
                const out = await Truncate.output(result, {}, await Agent.get(toolCtx.agent))
                return {
                  title: "",
                  output: out.truncated ? out.content : result,
                  metadata: {
                    truncated: out.truncated,
                    outputPath: out.truncated ? out.outputPath : undefined,
                  },
                }
              },
            }
          }

          const dirs = yield* config.directories()
          const matches = dirs.flatMap((dir) =>
            Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
          )
          if (matches.length) yield* config.waitForDependencies()
          for (const match of matches) {
            const namespace = path.basename(match, path.extname(match))
            const mod = yield* Effect.promise(
              () => import(process.platform === "win32" ? match : pathToFileURL(match).href),
            )
            for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
              custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
            }
          }

          const plugins = yield* plugin.list()
          for (const p of plugins) {
            for (const [id, def] of Object.entries(p.tool ?? {})) {
              custom.push(fromPlugin(id, def))
            }
          }

          const cfg = yield* config.get()
          const questionEnabled =
            ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

          const tool = yield* Effect.all({
            invalid: Tool.init(InvalidTool),
            bash: Tool.init(BashTool),
            read: Tool.init(read),
            glob: Tool.init(GlobTool),
            grep: Tool.init(GrepTool),
            edit: Tool.init(EditTool),
            write: Tool.init(WriteTool),
            task: Tool.init(task),
            fetch: Tool.init(WebFetchTool),
            todo: Tool.init(todo),
            kanban: Tool.init(KanbanTool),
            search: Tool.init(WebSearchTool),
            code: Tool.init(CodeSearchTool),
            skill: Tool.init(SkillTool),
            patch: Tool.init(ApplyPatchTool),
            sleep: Tool.init(SleepTool),
            question: Tool.init(question),
            lsp: Tool.init(LspTool),
            planEnter: Tool.init(PlanEnterTool),
            planExit: Tool.init(PlanExitTool),
            mcpAuth: Tool.init(mcpAuth),
            mcpListResources: Tool.init(mcpListResources),
            mcpReadResource: Tool.init(mcpReadResource),
            taskStatus: Tool.init(TaskStatusTool),
            taskWait: Tool.init(TaskWaitTool),
            taskMessage: Tool.init(taskMessage),
            workflowList: Tool.init(workflowList),
            workflowCreate: Tool.init(workflowCreate),
            workflowTrigger: Tool.init(workflowTrigger),
            workflowDelete: Tool.init(workflowDelete),
            sendMessage: Tool.init(sendMessage),
            teamList: Tool.init(teamList),
            powershell: Tool.init(powershell),
            toolSearch: Tool.init(toolSearch),
          })

          return {
            custom,
            builtin: [
              tool.invalid,
              ...(questionEnabled ? [tool.question] : []),
              tool.bash,
              tool.read,
              tool.glob,
              tool.grep,
              tool.edit,
              tool.write,
              tool.task,
              tool.fetch,
              tool.todo,
              tool.kanban,
              tool.search,
              tool.code,
              tool.skill,
              tool.patch,
              tool.sleep,
              tool.mcpListResources,
              tool.mcpReadResource,
              tool.mcpAuth,
              tool.taskStatus,
              tool.taskWait,
              tool.taskMessage,
              tool.workflowList,
              tool.workflowCreate,
              tool.workflowTrigger,
              tool.workflowDelete,
              tool.sendMessage,
              tool.teamList,
              tool.toolSearch,
              ...(process.platform === "win32" ? [tool.powershell] : []),
              ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
              ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli"
                ? [tool.planEnter, tool.planExit]
                : []),
            ],
            task: tool.task,
            read: tool.read,
          }
        }),
      )

      const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
        const s = yield* InstanceState.get(state)
        return [...s.builtin, ...s.custom] as Tool.Def[]
      })

      const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
        return (yield* all()).map((tool) => tool.id)
      })

      const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
        const filtered = (yield* all()).filter((tool) => {
          if (tool.id === CodeSearchTool.id || tool.id === WebSearchTool.id) {
            return input.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
          }

          const usePatch =
            !!Env.get("OPENCODE_E2E_LLM_URL") ||
            (input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4"))
          if (tool.id === ApplyPatchTool.id) return usePatch
          if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

          return true
        })

        return yield* Effect.forEach(
          filtered,
          Effect.fnUntraced(function* (tool: Tool.Def) {
            using _ = log.time(tool.id)
            const output = {
              description: tool.description,
              parameters: tool.parameters,
            }
            yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
            return {
              id: tool.id,
              description: [
                output.description,
                tool.id === TaskTool.id ? yield* TaskDescription(input.agent) : undefined,
                tool.id === SkillTool.id ? yield* SkillDescription(input.agent) : undefined,
              ]
                .filter(Boolean)
                .join("\n"),
              parameters: output.parameters,
              execute: tool.execute,
              formatValidationError: tool.formatValidationError,
            }
          }),
          { concurrency: "unbounded" },
        )
      })

      const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
        const s = yield* InstanceState.get(state)
        return { task: s.task, read: s.read }
      })

      return Service.of({ ids, all, named, tools })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Config.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Question.defaultLayer),
        Layer.provide(Todo.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(MCP.defaultLayer),
        Layer.provide(LSP.defaultLayer),
        Layer.provide(FileTime.defaultLayer),
        Layer.provide(Instruction.defaultLayer),
        Layer.provide(AppFileSystem.defaultLayer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function all() {
    return runPromise((svc) => svc.all())
  }

  export async function tools(input: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
  }): Promise<(Tool.Def & { id: string })[]> {
    return runPromise((svc) => svc.tools(input))
  }
}
