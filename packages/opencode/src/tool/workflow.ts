import z from "zod"
import { Tool } from "./tool"
import { SessionID } from "@/session/schema"

const model = z.string().regex(/^[^/]+\/[^/]+$/)

const schedule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("once"),
    at: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("interval"),
    everyMs: z.number().int().positive(),
    startAt: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1),
  }),
])

const action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    prompt: z.string().trim().min(1),
    agent: z.string().optional(),
    model: model.optional(),
    variant: z.string().optional(),
  }),
  z.object({
    type: z.literal("command"),
    command: z.string().trim().min(1),
    arguments: z.string().optional(),
    agent: z.string().optional(),
    model: model.optional(),
    variant: z.string().optional(),
  }),
  z.object({
    type: z.literal("shell"),
    script: z.string().trim().min(1),
    agent: z.string().optional(),
    model: model.optional(),
  }),
])

const create = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  sessionID: SessionID.zod.optional(),
  enabled: z.boolean().optional(),
  schedule: schedule,
  action,
})

function text(input: {
  id: string
  name: string
  status: string
  enabled: boolean
  runCount: number
  lastError?: string
  time: { nextRun?: number }
}) {
  const lines = [
    `workflow_id: ${input.id}`,
    `name: ${input.name}`,
    `status: ${input.status}`,
    `enabled: ${input.enabled}`,
    `runs: ${input.runCount}`,
  ]
  if (input.time.nextRun) lines.push(`next_run: ${input.time.nextRun}`)
  if (input.lastError) lines.push(`last_error: ${input.lastError}`)
  return lines.join("\n")
}

export const WorkflowListTool = Tool.define("workflow_list", {
  description: "List durable workflows available for the current project.",
  parameters: z.object({}),
  async execute() {
    const { Workflow } = await import("@/workflow")
    const items = await Workflow.list()
    return {
      title: "Workflows",
      metadata: {
        count: items.length,
      },
      output: items.length ? items.map(text).join("\n\n") : "No workflows found.",
    }
  },
})

export const WorkflowCreateTool = Tool.define("workflow_create", {
  description: "Create a durable workflow that can run prompts, commands, or shell actions on a schedule.",
  parameters: create,
  async execute(input, ctx) {
    await ctx.ask({
      permission: "workflow_create",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        name: input.name,
      },
    })
    const { Workflow } = await import("@/workflow")
    const item = await Workflow.create(input)
    return {
      title: item.name,
      metadata: {
        workflowId: item.id,
      },
      output: text(item),
    }
  },
})

export const WorkflowTriggerTool = Tool.define("workflow_trigger", {
  description: "Run an existing workflow immediately.",
  parameters: z.object({
    workflow_id: z.string(),
  }),
  async execute(input, ctx) {
    await ctx.ask({
      permission: "workflow_trigger",
      patterns: [input.workflow_id],
      always: ["*"],
      metadata: {},
    })
    const { Workflow } = await import("@/workflow")
    const item = await Workflow.trigger(input.workflow_id)
    return {
      title: item.name,
      metadata: {
        workflowId: item.id,
      },
      output: text(item),
    }
  },
})

export const WorkflowDeleteTool = Tool.define("workflow_delete", {
  description: "Delete an existing workflow.",
  parameters: z.object({
    workflow_id: z.string(),
  }),
  async execute(input, ctx) {
    await ctx.ask({
      permission: "workflow_delete",
      patterns: [input.workflow_id],
      always: ["*"],
      metadata: {},
    })
    const { Workflow } = await import("@/workflow")
    await Workflow.remove(input.workflow_id)
    return {
      title: "Workflow deleted",
      metadata: {
        workflowId: input.workflow_id,
      },
      output: `deleted: true\nworkflow_id: ${input.workflow_id}`,
    }
  },
})
