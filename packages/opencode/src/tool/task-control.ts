import z from "zod"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Tool } from "./tool"

function text(parts: MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

export function snapshot(messages: MessageV2.WithParts[], status: SessionStatus.Info) {
  const last = [...messages].reverse().find((item) => item.info.role === "assistant")
  return {
    status,
    text: last ? text(last.parts) : "",
    agent: last?.info.agent,
    messageID: last?.info.id,
    error:
      last?.info.role === "assistant" && last.info.error && "data" in last.info.error && last.info.error.data
        ? String(last.info.error.data.message ?? "")
        : "",
  }
}

function fmt(input: ReturnType<typeof snapshot>, timedOut = false) {
  const lines = [
    `status: ${input.status.type}`,
    ...(input.agent ? [`agent: ${input.agent}`] : []),
    ...(input.messageID ? [`message_id: ${input.messageID}`] : []),
    ...(timedOut ? ["timed_out: true"] : []),
    ...(input.error ? ["", "<task_error>", input.error, "</task_error>"] : []),
    ...(input.text ? ["", "<task_result>", input.text, "</task_result>"] : []),
  ]
  return lines.join("\n")
}

const statusArgs = z.object({
  task_id: z.string().describe("The task session id returned by the task tool"),
})

const waitArgs = statusArgs.extend({
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(600000)
    .optional()
    .describe("Maximum time to wait before returning"),
  poll_ms: z
    .number()
    .int()
    .positive()
    .max(60000)
    .optional()
    .describe("Polling interval while waiting"),
})

const messageArgs = statusArgs.extend({
  prompt: z.string().describe("Follow-up work to send to the existing task"),
  agent: z.string().optional().describe("Override agent for the follow-up"),
  model: z.string().optional().describe("Override model in provider/model format"),
  variant: z.string().optional().describe("Optional provider-specific variant"),
})

async function read(taskID: string) {
  const sessionID = SessionID.make(taskID)
  const [session, messages, status] = await Promise.all([
    Session.get(sessionID),
    Session.messages({ sessionID }),
    SessionStatus.get(sessionID),
  ])
  return {
    session,
    ...snapshot(messages, status),
  }
}

export const TaskStatusTool = Tool.define("task_status", {
  description: "Inspect the latest status and assistant result for an existing task session.",
  parameters: statusArgs,
  async execute(input) {
    const data = await read(input.task_id)
    return {
      title: data.session.title,
      metadata: {
        sessionId: data.session.id,
        status: data.status.type,
      },
      output: fmt(data),
    }
  },
})

export const TaskWaitTool = Tool.define("task_wait", {
  description: "Wait for an existing task session to become idle and return its latest assistant result.",
  parameters: waitArgs,
  async execute(input) {
    const timeout = input.timeout_ms ?? 30000
    const poll = input.poll_ms ?? 1000
    const end = Date.now() + timeout
    let data = await read(input.task_id)

    while (data.status.type !== "idle" && Date.now() < end) {
      await Bun.sleep(Math.min(poll, Math.max(1, end - Date.now())))
      data = await read(input.task_id)
    }

    const timedOut = data.status.type !== "idle"
    return {
      title: data.session.title,
      metadata: {
        sessionId: data.session.id,
        status: data.status.type,
        timedOut,
      },
      output: fmt(data, timedOut),
    }
  },
})

export const TaskMessageTool = Tool.defineEffect(
  "task_message",
  Effect.gen(function* () {
    return {
      description: "Queue a follow-up prompt into an existing task session without waiting for it to finish.",
      parameters: messageArgs,
      async execute(input: z.infer<typeof messageArgs>, ctx) {
        await ctx.ask({
          permission: "task_message",
          patterns: [input.task_id],
          always: ["*"],
          metadata: {
            task_id: input.task_id,
          },
        })

        const model = input.model ? Provider.parseModel(input.model) : undefined
        const parts = await SessionPrompt.resolvePromptParts(input.prompt)
        void SessionPrompt.prompt({
          sessionID: SessionID.make(input.task_id),
          agent: input.agent,
          model,
          variant: input.variant,
          parts,
        }).catch(() => undefined)

        const data = await read(input.task_id)
        return {
          title: data.session.title,
          metadata: {
            sessionId: data.session.id,
            status: data.status.type,
            queued: true,
          },
          output: [`queued: true`, fmt(data)].join("\n"),
        }
      },
    }
  }),
)
