import { Effect } from "effect"
import z from "zod"
import { MCP } from "@/mcp"
import { Tool } from "./tool"

const ListParameters = z.object({
  client: z.string().optional().describe("Optional MCP client/server name to filter resources by"),
})

export const McpListResourcesTool = Tool.defineEffect(
  "mcp_list_resources",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description:
        "List resources exposed by connected MCP servers. Use this before reading a specific MCP resource.",
      parameters: ListParameters,
      async execute(params: z.infer<typeof ListParameters>) {
        const list = await Effect.runPromise(mcp.resources())
        const rows = Object.values(list)
          .filter((item) => !params.client || item.client === params.client)
          .sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name))

        return {
          title: params.client ? `MCP resources for ${params.client}` : "MCP resources",
          output:
            rows.length === 0
              ? "No MCP resources are currently available."
              : [
                  "<mcp_resources>",
                  ...rows.flatMap((item) => [
                    "  <resource>",
                    `    <client>${item.client}</client>`,
                    `    <name>${item.name}</name>`,
                    `    <uri>${item.uri}</uri>`,
                    item.description ? `    <description>${item.description}</description>` : "",
                    item.mimeType ? `    <mime>${item.mimeType}</mime>` : "",
                    "  </resource>",
                  ]),
                  "</mcp_resources>",
                ]
                  .filter(Boolean)
                  .join("\n"),
          metadata: {},
        }
      },
    }
  }),
)

const ReadParameters = z.object({
  client: z.string().describe("MCP client/server name"),
  uri: z.string().describe("Resource URI returned by mcp_list_resources"),
})

export const McpReadResourceTool = Tool.defineEffect(
  "mcp_read_resource",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description:
        "Read a specific resource from a connected MCP server by client name and URI.",
      parameters: ReadParameters,
      async execute(params: z.infer<typeof ReadParameters>) {
        const result = await Effect.runPromise(mcp.readResource(params.client, params.uri))
        if (!result) {
          return {
            title: "MCP resource not found",
            output: `No MCP resource could be read from ${params.client} at ${params.uri}.`,
            metadata: {},
          }
        }

        return {
          title: `MCP resource: ${params.uri}`,
          output: [
            `<mcp_resource client="${params.client}" uri="${params.uri}">`,
            JSON.stringify(result, null, 2),
            "</mcp_resource>",
          ].join("\n"),
          metadata: {},
        }
      },
    }
  }),
)

const AuthParameters = z.object({
  name: z.string().describe("MCP server name"),
  action: z.enum(["status", "authenticate", "logout"]).describe("Authentication action to perform"),
})

export const McpAuthTool = Tool.defineEffect(
  "mcp_auth",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description:
        "Check authentication status, authenticate, or remove stored credentials for an MCP server.",
      parameters: AuthParameters,
      async execute(params: z.infer<typeof AuthParameters>, ctx) {
        if (params.action !== "status") {
          await ctx.ask({
            permission: "mcp_auth",
            patterns: [params.name],
            always: ["*"],
            metadata: {
              action: params.action,
              name: params.name,
            },
          })
        }

        if (params.action === "status") {
          const status = await Effect.runPromise(mcp.getAuthStatus(params.name))
          return {
            title: `MCP auth status: ${params.name}`,
            output: `<mcp_auth_status name="${params.name}">${status}</mcp_auth_status>`,
            metadata: {},
          }
        }

        if (params.action === "logout") {
          await Effect.runPromise(mcp.removeAuth(params.name))
          return {
            title: `Removed MCP auth: ${params.name}`,
            output: `Stored MCP credentials removed for ${params.name}.`,
            metadata: {},
          }
        }

        const status = await Effect.runPromise(mcp.authenticate(params.name))
        return {
          title: `MCP auth result: ${params.name}`,
          output: `<mcp_auth_result name="${params.name}">${JSON.stringify(status)}</mcp_auth_result>`,
          metadata: {},
        }
      },
    }
  }),
)
