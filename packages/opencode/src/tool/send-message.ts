import z from "zod"
import { Tool } from "./tool"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"

const args = z.object({
  session_id: SessionID.zod.describe("Target session id"),
  prompt: z.string().describe("Follow-up prompt to queue"),
  agent: z.string().optional().describe("Optional agent override"),
  model: z.string().optional().describe("Optional provider/model override"),
  variant: z.string().optional().describe("Optional model variant"),
})

export const SendMessageTool = Tool.define("send_message", {
  description: "Queue a follow-up message into any existing session without waiting for it to finish.",
  parameters: args,
  async execute(input, ctx) {
    await ctx.ask({
      permission: "send_message",
      patterns: [input.session_id],
      always: ["*"],
      metadata: {},
    })
    const parts = await SessionPrompt.resolvePromptParts(input.prompt)
    void SessionPrompt.prompt({
      sessionID: input.session_id,
      agent: input.agent,
      model: input.model ? Provider.parseModel(input.model) : undefined,
      variant: input.variant,
      parts,
    }).catch(() => undefined)
    return {
      title: "Message queued",
      metadata: {
        sessionId: input.session_id,
        queued: true,
      },
      output: `queued: true\nsession_id: ${input.session_id}`,
    }
  },
})
