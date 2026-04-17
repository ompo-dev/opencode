import z from "zod"
import { Tool } from "./tool"

export const SleepTool = Tool.define("sleep", {
  description: "Pause briefly before continuing. Useful for polling external state or waiting on background work.",
  parameters: z.object({
    duration_ms: z
      .number()
      .int()
      .positive()
      .max(600000)
      .describe("How long to sleep in milliseconds"),
  }),
  async execute(input) {
    await Bun.sleep(input.duration_ms)
    return {
      title: "Sleep",
      metadata: {
        duration: input.duration_ms,
      },
      output: `Slept for ${input.duration_ms}ms.`,
    }
  },
})
