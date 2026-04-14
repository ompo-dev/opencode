import DESCRIPTION from "./kanbanwrite.txt"
import { Tool } from "./tool"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Global } from "@/global"
import { Kanban } from "@/kanban/kanban"
import { Instance } from "@/project/instance"
import { createOutlineService } from "@opencode-ai/outline-core/server"
import { outlineText } from "@opencode-ai/outline-core"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import z from "zod"

type Tree = { title: string; children: Tree[] }

const tree = (input: Tree[], depth = 0): string[] =>
  input.flatMap((item) => [`${"  ".repeat(depth)}- ${item.title}`, ...tree(item.children, depth + 1)])

const tag = z.union([
  z.string().trim().min(1),
  z.object({
    name: z.string().trim().min(1),
    color: Kanban.Color.nullable().optional(),
  }),
])

const parameters = z.object({
  scope: Kanban.Scope.optional().default("project").describe("Which board to modify: project or global"),
  operations: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("create_column"),
          name: z.string().trim().min(1),
          color: Kanban.Color.optional(),
          position: z.number().int().nonnegative().optional(),
        }),
        z.object({
          type: z.literal("rename_column"),
          column: z.string().trim().min(1),
          name: z.string().trim().min(1),
        }),
        z
          .object({
            type: z.literal("update_column"),
            column: z.string().trim().min(1),
            name: z.string().trim().min(1).optional(),
            color: Kanban.Color.nullable().optional(),
          })
          .refine((input) => input.name !== undefined || input.color !== undefined, {
            message: "Expected name or color",
          }),
        z.object({
          type: z.literal("move_column"),
          column: z.string().trim().min(1),
          position: z.number().int().nonnegative(),
        }),
        z.object({
          type: z.literal("delete_column"),
          column: z.string().trim().min(1),
          target_column: z.string().trim().min(1).optional(),
        }),
        z.object({
          type: z.literal("create_card"),
          column: z.string().trim().min(1),
          title: z.string().trim().min(1),
          description: z.string().optional(),
          color: Kanban.Color.optional(),
          tags: z.array(tag).optional(),
          position: z.number().int().nonnegative().optional(),
        }),
        z
          .object({
            type: z.literal("update_card"),
            card: z.string().trim().min(1),
            title: z.string().trim().min(1).optional(),
            description: z.string().optional(),
            color: Kanban.Color.nullable().optional(),
            tags: z.array(tag).optional(),
          })
          .refine(
            (input) =>
              input.title !== undefined ||
              input.description !== undefined ||
              input.color !== undefined ||
              input.tags !== undefined,
            {
              message: "Expected title, description, color, or tags",
            },
          ),
        z.object({
          type: z.literal("move_card"),
          card: z.string().trim().min(1),
          column: z.string().trim().min(1),
          position: z.number().int().nonnegative().optional(),
        }),
        z.object({
          type: z.literal("delete_card"),
          card: z.string().trim().min(1),
        }),
      ]),
    )
    .min(1)
    .describe("The changes to apply to the kanban board"),
})

type Metadata = {
  board: Kanban.Info
}

type Params = z.infer<typeof parameters>
type TagInput = z.infer<typeof tag>

const mention = /(^|[\s([{"'])@(\S+)/g

const norm = (value: string) => value.trim().toLowerCase()

const absolute = (value: string) => (path.isAbsolute(value) ? value : path.resolve(Instance.directory, value))

const findColumn = (board: Kanban.Info, value: string) => {
  const query = norm(value)
  const exact = board.columns.filter((column) => column.id === value || norm(column.name) === query)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) throw new Error(`Column is ambiguous: ${value}`)
  throw new Error(`Column not found: ${value}`)
}

const findCard = (board: Kanban.Info, value: string) => {
  const query = norm(value)
  const exact = board.columns.flatMap((column) =>
    column.cards.filter((card) => card.id === value || norm(card.title) === query).map((card) => ({ card, column })),
  )
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) throw new Error(`Card is ambiguous: ${value}`)
  throw new Error(`Card not found: ${value}`)
}

const cleanTags = (input?: TagInput[], base?: Kanban.Card) => {
  if (!input) return undefined
  const seen = new Set<string>()
  return input.flatMap((item) => {
    const name = (typeof item === "string" ? item : item.name).trim()
    if (!name) return []
    const key = norm(name)
    if (seen.has(key)) return []
    seen.add(key)
    const prev = base?.tags.find((tag) => norm(tag.name) === key)
    return [
      {
        ...(prev?.id ? { id: prev.id } : {}),
        name,
        color: typeof item === "string" ? prev?.color : item.color === null ? undefined : (item.color ?? prev?.color),
      },
    ]
  })
}

const pathRefs = (value?: string) => {
  if (!value) return [] as Kanban.Ref[]
  return Array.from(value.matchAll(mention)).flatMap((item) => {
    const head = item[1]?.length ?? 0
    const raw = item[2] ?? ""
    const path = raw.replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    const full = absolute(path)
    if (!existsSync(full)) return []
    const label = `@${path}`
    const start = (item.index ?? 0) + head
    return [
      {
        kind: "path" as const,
        label,
        start,
        end: start + label.length,
        path,
      },
    ]
  })
}

const attachments = async (board: Kanban.Info) => {
  const refs = board.columns.flatMap((column) =>
    column.cards.flatMap((card) => [...card.titleRefs, ...card.descriptionRefs]),
  )
  const seen = new Set<string>()
  const outline = createOutlineService({
    root: Global.Path.data,
    ctx: {
      project_id: Instance.project.id,
      project_name: Instance.project.name,
      worktree: Instance.worktree,
    },
  })

  return (
    await Promise.all(
      refs.map(async (ref) => {
        if (ref.kind === "path") {
          const full = absolute(ref.path)
          const url = pathToFileURL(full).href
          if (seen.has(url) || !existsSync(full)) return []
          seen.add(url)
          return [
            {
              type: "file" as const,
              mime: "text/plain",
              url,
              filename: ref.path,
            },
          ]
        }

        if (ref.kind === "collection") {
          const key = `collection:${ref.scope}:${ref.collectionID}`
          if (seen.has(key)) return []
          seen.add(key)
          const snap = await outline.snapshot().catch(() => undefined)
          const list = ref.scope === "global" ? snap?.global.collections : snap?.project.collections
          const col = list?.find((item) => item.id === ref.collectionID)
          if (!col) return []
          const text = [`# ${col.title}`, ...(col.description ? ["", col.description] : []), "", ...tree(col.tree)].join("\n")
          return [
            {
              type: "file" as const,
              mime: "text/plain",
              url: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
              filename: `outline-${ref.scope}-${col.title}.md`,
            },
          ]
        }

        const key = `note:${ref.scope}:${ref.documentID}`
        if (seen.has(key)) return []
        seen.add(key)
        const doc = await outline.document_get(ref.scope, ref.documentID).catch(() => undefined)
        if (!doc) return []
        const text = `# ${doc.meta.title}\n\n${outlineText(doc.content)}`
        return [
          {
            type: "file" as const,
            mime: "text/plain",
            url: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
            filename: `outline-${ref.scope}-${doc.meta.title}.md`,
          },
        ]
      }),
    )
  ).flat()
}

const resolve = (board: Kanban.Info, operation: Params["operations"][number]): Kanban.Operation => {
  switch (operation.type) {
    case "create_column":
      return {
        type: "column.create",
        name: operation.name,
        color: operation.color,
        position: operation.position,
      }
    case "rename_column":
      return {
        type: "column.update",
        columnID: findColumn(board, operation.column).id,
        name: operation.name,
      }
    case "update_column":
      return {
        type: "column.update",
        columnID: findColumn(board, operation.column).id,
        name: operation.name,
        color: operation.color,
      }
    case "move_column":
      return {
        type: "column.move",
        columnID: findColumn(board, operation.column).id,
        position: operation.position,
      }
    case "delete_column": {
      const next = operation.target_column ? findColumn(board, operation.target_column).id : undefined
      return {
        type: "column.delete",
        columnID: findColumn(board, operation.column).id,
        targetColumnID: next,
      }
    }
    case "create_card":
      return {
        type: "card.create",
        columnID: findColumn(board, operation.column).id,
        title: operation.title,
        titleRefs: pathRefs(operation.title),
        description: operation.description,
        descriptionRefs: pathRefs(operation.description),
        color: operation.color,
        tags: cleanTags(operation.tags),
        position: operation.position,
      }
    case "update_card": {
      const next = findCard(board, operation.card)
      return {
        type: "card.update",
        cardID: next.card.id,
        title: operation.title,
        titleRefs: operation.title === undefined ? undefined : pathRefs(operation.title),
        description: operation.description,
        descriptionRefs: operation.description === undefined ? undefined : pathRefs(operation.description),
        color: operation.color,
        tags: cleanTags(operation.tags, next.card),
      }
    }
    case "move_card": {
      const next = findColumn(board, operation.column)
      return {
        type: "card.move",
        cardID: findCard(board, operation.card).card.id,
        columnID: next.id,
        position: operation.position ?? next.cards.length,
      }
    }
    case "delete_card":
      return {
        type: "card.delete",
        cardID: findCard(board, operation.card).card.id,
      }
  }
}

export const KanbanTool = Tool.define<typeof parameters, Metadata>("kanbanwrite", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "kanbanwrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        scope: params.scope,
      },
    })

    const scope = params.scope === "global" ? Kanban.global() : Kanban.project(Instance.project.id)
    let board = await Kanban.get(scope)

    for (const operation of params.operations) {
      board = await Kanban.update({
        ...scope,
        operations: [resolve(board, operation)],
      })
    }

    if (params.scope === "global") {
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Kanban.Event.Updated.type,
          properties: board,
        },
      })
    } else {
      await Bus.publish(Kanban.Event.Updated, board)
    }

    return {
      title: `${params.scope === "global" ? "Global" : "Project"} kanban updated`,
      output: JSON.stringify(board, null, 2),
      attachments: await attachments(board),
      metadata: {
        board,
      },
    }
  },
})
