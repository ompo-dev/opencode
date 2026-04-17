import z from "zod"
import { Tool } from "./tool"

export const ToolSearchTool = Tool.define("tool_search", {
  description: "Search available tools by id or description.",
  parameters: z.object({
    query: z.string().optional().describe("Optional case-insensitive search query"),
  }),
  async execute(input) {
    const { ToolRegistry } = await import("./registry")
    const items = await ToolRegistry.all()
    const query = input.query?.trim().toLowerCase()
    const list = query
      ? items.filter((item) => item.id.toLowerCase().includes(query) || item.description.toLowerCase().includes(query))
      : items
    return {
      title: "Tools",
      metadata: {
        count: list.length,
      },
      output: list.map((item) => `- ${item.id}: ${item.description.split("\n")[0]}`).join("\n"),
    }
  },
})
