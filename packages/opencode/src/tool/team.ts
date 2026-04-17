import z from "zod"
import { Tool } from "./tool"
import { Agent } from "@/agent/agent"

export const TeamListTool = Tool.define("team_list", {
  description: "List available agent roles that can be used for tasks and follow-up work.",
  parameters: z.object({}),
  async execute() {
    const items = await Agent.list()
    return {
      title: "Agents",
      metadata: {
        count: items.length,
      },
      output: items.map((item) => `- ${item.name}: ${item.description ?? "No description"}`).join("\n"),
    }
  },
})
