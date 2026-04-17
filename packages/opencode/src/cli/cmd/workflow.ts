import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Workflow } from "@/workflow"
import { UI } from "../ui"
import { Locale } from "@/util/locale"

function schedule(args: { cron?: string; every?: number; at?: string; manual?: boolean }) {
  const count = [Boolean(args.cron), Boolean(args.every), Boolean(args.at), Boolean(args.manual)].filter(Boolean).length
  if (count !== 1) throw new Error("Specify exactly one schedule: --cron, --every, --at, or --manual")
  if (args.manual) return { type: "manual" as const }
  if (args.every) return { type: "interval" as const, everyMs: args.every }
  if (args.cron) return { type: "cron" as const, expression: args.cron }
  const at = new Date(args.at!).getTime()
  if (!Number.isFinite(at)) throw new Error(`Invalid timestamp: ${args.at}`)
  return { type: "once" as const, at }
}

function action(args: {
  prompt?: string
  command?: string
  shell?: string
  args?: string
  agent?: string
  model?: string
  variant?: string
}) {
  const count = [Boolean(args.prompt), Boolean(args.command), Boolean(args.shell)].filter(Boolean).length
  if (count !== 1) throw new Error("Specify exactly one action: --prompt, --command, or --shell")
  if (args.prompt) {
    return {
      type: "prompt" as const,
      prompt: args.prompt,
      agent: args.agent,
      model: args.model,
      variant: args.variant,
    }
  }
  if (args.command) {
    return {
      type: "command" as const,
      command: args.command,
      arguments: args.args,
      agent: args.agent,
      model: args.model,
      variant: args.variant,
    }
  }
  return {
    type: "shell" as const,
    script: args.shell!,
    agent: args.agent,
    model: args.model,
  }
}

function scheduleText(input: Workflow.Schedule) {
  if (input.type === "manual") return "manual"
  if (input.type === "once") return `once @ ${Locale.todayTimeOrDateTime(input.at)}`
  if (input.type === "interval") return `every ${input.everyMs}ms`
  return `cron ${input.expression}`
}

function actionText(input: Workflow.Action) {
  if (input.type === "prompt") return "prompt"
  if (input.type === "command") return `command:${input.command}`
  return "shell"
}

function line(input: Workflow.Info) {
  return [
    input.id,
    input.status.padEnd(7),
    input.name,
    `[${actionText(input.action)}]`,
    scheduleText(input.schedule),
    input.time.nextRun ? `next ${Locale.todayTimeOrDateTime(input.time.nextRun)}` : "no next run",
  ].join("  ")
}

export const WorkflowCommand = cmd({
  command: "workflow",
  describe: "manage durable workflows",
  builder: (yargs: Argv) =>
    yargs
      .command(WorkflowListCommand)
      .command(WorkflowAddCommand)
      .command(WorkflowRunCommand)
      .command(WorkflowPauseCommand)
      .command(WorkflowResumeCommand)
      .command(WorkflowDeleteCommand)
      .demandCommand(),
  async handler() {},
})

export const WorkflowListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list workflows",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const items = await Workflow.list()
      if (args.json) {
        console.log(JSON.stringify(items, null, 2))
        return
      }
      for (const item of items) UI.println(line(item))
    })
  },
})

export const WorkflowAddCommand = cmd({
  command: "add <name>",
  describe: "create a workflow",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
      })
      .option("description", { type: "string" })
      .option("session-id", { type: "string" })
      .option("agent", { type: "string" })
      .option("model", { type: "string" })
      .option("variant", { type: "string" })
      .option("prompt", { type: "string" })
      .option("command", { type: "string" })
      .option("shell", { type: "string" })
      .option("args", { type: "string" })
      .option("cron", { type: "string" })
      .option("every", { type: "number" })
      .option("at", { type: "string" })
      .option("manual", { type: "boolean", default: false })
      .option("disabled", { type: "boolean", default: false }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const item = await Workflow.create({
        name: args.name,
        description: args.description,
        sessionID: args.sessionId,
        enabled: !args.disabled,
        schedule: schedule(args),
        action: action(args),
      })
      UI.println(line(item))
    })
  },
})

export const WorkflowRunCommand = cmd({
  command: "run <workflowID>",
  aliases: ["trigger"],
  describe: "run a workflow immediately",
  builder: (yargs: Argv) =>
    yargs.positional("workflowID", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      UI.println(line(await Workflow.trigger(args.workflowID)))
    })
  },
})

export const WorkflowPauseCommand = cmd({
  command: "pause <workflowID>",
  describe: "pause a workflow",
  builder: (yargs: Argv) =>
    yargs.positional("workflowID", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      UI.println(line(await Workflow.pause(args.workflowID)))
    })
  },
})

export const WorkflowResumeCommand = cmd({
  command: "resume <workflowID>",
  describe: "resume a workflow",
  builder: (yargs: Argv) =>
    yargs.positional("workflowID", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      UI.println(line(await Workflow.resume(args.workflowID)))
    })
  },
})

export const WorkflowDeleteCommand = cmd({
  command: "delete <workflowID>",
  aliases: ["rm"],
  describe: "delete a workflow",
  builder: (yargs: Argv) =>
    yargs.positional("workflowID", {
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      await Workflow.remove(args.workflowID)
      UI.println(`Deleted workflow ${args.workflowID}`)
    })
  },
})
