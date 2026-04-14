import { BusEvent } from "@/bus/bus-event"
import { ProjectID, type ProjectID as ProjectIDType } from "@/project/schema"
import { Database, and, asc, eq, isNull } from "@/storage/db"
import { KanbanCardTable, KanbanColumnTable, KanbanTagTable } from "./kanban.sql"
import { CardID, ColumnID, TagID } from "./schema"
import z from "zod"

const colors = ["slate", "gray", "blue", "violet", "green", "amber", "orange", "red", "pink", "cyan"] as const

const defaults = [
  { name: "Backlog", color: "slate" as const },
  { name: "Doing", color: "blue" as const },
  { name: "Done", color: "green" as const },
] as const

const scoped = z
  .discriminatedUnion("scope", [
    z.object({
      scope: z.literal("global"),
    }),
    z.object({
      scope: z.literal("project"),
      projectID: ProjectID.zod,
    }),
  ])
  .meta({ ref: "KanbanScopeRef" })

type Scoped = z.infer<typeof scoped>

const refine = <T extends Scoped>(input: T) => input

const trim = (value?: string | null) => {
  const text = value?.trim()
  return text ? text : undefined
}

export namespace Kanban {
  export const Scope = z.enum(["global", "project"]).meta({ ref: "KanbanScope" })
  export type Scope = z.infer<typeof Scope>

  export const Color = z.enum(colors).meta({ ref: "KanbanColor" })
  export type Color = z.infer<typeof Color>

  export const TagInput = z
    .object({
      id: TagID.zod.optional(),
      name: z.string().trim().min(1),
      color: Color.nullable().optional(),
    })
    .meta({ ref: "KanbanTagInput" })
  export type TagInput = z.infer<typeof TagInput>

  export const Tag = z
    .object({
      id: TagID.zod,
      name: z.string(),
      color: Color.optional(),
    })
    .meta({ ref: "KanbanTag" })
  export type Tag = z.infer<typeof Tag>

  export const Ref = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("path"),
        label: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        path: z.string().min(1),
      }),
      z.object({
        kind: z.literal("collection"),
        label: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        scope: Scope,
        collectionID: z.string().min(1),
        title: z.string().min(1),
      }),
      z.object({
        kind: z.literal("note"),
        label: z.string().min(1),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        scope: Scope,
        documentID: z.string().min(1),
        title: z.string().min(1),
      }),
    ])
    .meta({ ref: "KanbanRef" })
  export type Ref = z.infer<typeof Ref>

  export const Card = z
    .object({
      id: CardID.zod,
      columnID: ColumnID.zod,
      title: z.string(),
      titleRefs: z.array(Ref),
      description: z.string().optional(),
      descriptionRefs: z.array(Ref),
      color: Color.optional(),
      tags: z.array(Tag),
      position: z.number().int().nonnegative(),
    })
    .meta({ ref: "KanbanCard" })
  export type Card = z.infer<typeof Card>

  export const Column = z
    .object({
      id: ColumnID.zod,
      name: z.string(),
      color: Color.optional(),
      position: z.number().int().nonnegative(),
      cards: z.array(Card),
    })
    .meta({ ref: "KanbanColumn" })
  export type Column = z.infer<typeof Column>

  export const Info = z
    .object({
      scope: Scope,
      projectID: ProjectID.zod.optional(),
      columns: z.array(Column),
    })
    .meta({ ref: "Kanban" })
  export type Info = z.infer<typeof Info>

  export const Operation = z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("column.create"),
        name: z.string().trim().min(1),
        color: Color.optional(),
        position: z.number().int().nonnegative().optional(),
      }),
      z
        .object({
          type: z.literal("column.update"),
          columnID: ColumnID.zod,
          name: z.string().trim().min(1).optional(),
          color: Color.nullable().optional(),
        })
        .refine((input) => input.name !== undefined || input.color !== undefined, {
          message: "Expected name or color",
        }),
      z.object({
        type: z.literal("column.move"),
        columnID: ColumnID.zod,
        position: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("column.delete"),
        columnID: ColumnID.zod,
        targetColumnID: ColumnID.zod.optional(),
      }),
      z.object({
        type: z.literal("card.create"),
        columnID: ColumnID.zod,
        title: z.string().trim().min(1),
        titleRefs: z.array(Ref).optional(),
        description: z.string().optional(),
        descriptionRefs: z.array(Ref).optional(),
        color: Color.optional(),
        tags: z.array(TagInput).optional(),
        position: z.number().int().nonnegative().optional(),
      }),
      z
        .object({
          type: z.literal("card.update"),
          cardID: CardID.zod,
          title: z.string().trim().min(1).optional(),
          titleRefs: z.array(Ref).optional(),
          description: z.string().optional(),
          descriptionRefs: z.array(Ref).optional(),
          color: Color.nullable().optional(),
          tags: z.array(TagInput).optional(),
        })
        .refine(
          (input) =>
            input.title !== undefined ||
            input.titleRefs !== undefined ||
            input.description !== undefined ||
            input.descriptionRefs !== undefined ||
            input.color !== undefined ||
            input.tags !== undefined,
          {
            message: "Expected title, titleRefs, description, descriptionRefs, color, or tags",
          },
        ),
      z.object({
        type: z.literal("card.move"),
        cardID: CardID.zod,
        columnID: ColumnID.zod,
        position: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("card.delete"),
        cardID: CardID.zod,
      }),
    ])
    .meta({ ref: "KanbanOperation" })
  export type Operation = z.infer<typeof Operation>

  export const Event = {
    Updated: BusEvent.define("kanban.updated", Info),
  }

  const where = <T extends { scope: any; project_id: any }>(table: T, input: Scoped) => {
    if (input.scope === "project") {
      return and(eq(table.scope, input.scope), eq(table.project_id, input.projectID))
    }
    return and(eq(table.scope, input.scope), isNull(table.project_id))
  }

  const clamp = (len: number, value?: number) => {
    if (value === undefined) return len
    if (value < 0) return 0
    if (value > len) return len
    return value
  }

  const tags = (input: Array<{ id?: string; name: string; color?: Color | null | undefined }> = []) => {
    const seen = new Set<string>()
    return input
      .map((tag) => ({
        id: tag.id ? TagID.make(tag.id) : TagID.ascending(),
        name: tag.name.trim(),
        color: tag.color ?? undefined,
      }))
      .filter((tag) => {
        if (!tag.name) return false
        const key = tag.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  const refs = (input: Ref[] = []) => {
    const seen = new Set<string>()
    return input
      .filter((item) => item.label && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .filter((item) => {
        const key =
          item.kind === "path"
            ? `path:${item.path}:${item.start}:${item.end}:${item.label}`
            : item.kind === "collection"
              ? `collection:${item.scope}:${item.collectionID}:${item.start}:${item.end}:${item.label}`
              : `note:${item.scope}:${item.documentID}:${item.start}:${item.end}:${item.label}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  const parse = (value?: string | null) => {
    if (!value) return [] as Ref[]
    try {
      const result = z.array(Ref).safeParse(JSON.parse(value))
      return result.success ? refs(result.data) : []
    } catch {
      return []
    }
  }

  const copy = (board: Info): Info => ({
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({
        ...card,
        titleRefs: card.titleRefs.map((ref) => ({ ...ref })),
        descriptionRefs: card.descriptionRefs.map((ref) => ({ ...ref })),
        tags: card.tags.map((tag) => ({ ...tag })),
      })),
    })),
  })

  const normalize = (board: Info): Info => ({
    ...board,
    columns: board.columns.map((column, position) => ({
      ...column,
      color: column.color ?? undefined,
      position,
      cards: column.cards.map((card, cardPosition) => ({
        ...card,
        columnID: column.id,
        titleRefs: refs(card.titleRefs),
        descriptionRefs: refs(card.descriptionRefs),
        color: card.color ?? undefined,
        tags: tags(card.tags),
        position: cardPosition,
      })),
    })),
  })

  const seed = (input: Scoped): Info =>
    normalize({
      scope: input.scope,
      ...(input.scope === "project" ? { projectID: input.projectID } : {}),
      columns: defaults.map((column, position) => ({
        id: ColumnID.ascending(),
        name: column.name,
        color: column.color,
        position,
        cards: [],
      })),
    })

  const read = (input: Scoped) => {
    const cols = Database.use((db) =>
      db
        .select()
        .from(KanbanColumnTable)
        .where(where(KanbanColumnTable, input))
        .orderBy(asc(KanbanColumnTable.position))
        .all(),
    )
    const cards = Database.use((db) =>
      db
        .select()
        .from(KanbanCardTable)
        .where(where(KanbanCardTable, input))
        .orderBy(asc(KanbanCardTable.position))
        .all(),
    )
    const labels = Database.use((db) =>
      db.select().from(KanbanTagTable).where(where(KanbanTagTable, input)).orderBy(asc(KanbanTagTable.position)).all(),
    )
    const map = new Map(
      cols.map((column) => [
        column.id,
        {
          id: column.id,
          name: column.name,
          color: (column.color as Color | null | undefined) ?? undefined,
          position: column.position,
          cards: [] as Card[],
        },
      ]),
    )
    const byCard = new Map<CardID, Card>()

    for (const card of cards) {
      const next = {
        id: card.id,
        columnID: card.column_id,
        title: card.title,
        titleRefs: parse(card.title_refs),
        description: card.description ?? undefined,
        descriptionRefs: parse(card.description_refs),
        color: (card.color as Color | null | undefined) ?? undefined,
        tags: [] as Tag[],
        position: card.position,
      }
      byCard.set(card.id, next)
      map.get(card.column_id)?.cards.push(next)
    }

    for (const tag of labels) {
      byCard.get(tag.card_id)?.tags.push({
        id: tag.id,
        name: tag.name,
        color: (tag.color as Color | null | undefined) ?? undefined,
      })
    }

    const columns: Column[] = []
    for (const row of cols) {
      const value = map.get(row.id)
      if (value) columns.push(value)
    }

    return normalize({
      scope: input.scope,
      ...(input.scope === "project" ? { projectID: input.projectID } : {}),
      columns,
    })
  }

  const write = (input: Scoped, board: Info) => {
    const next = normalize(board)
    Database.transaction(
      () => {
        Database.use((db) => {
          db.delete(KanbanTagTable).where(where(KanbanTagTable, input)).run()
          db.delete(KanbanCardTable).where(where(KanbanCardTable, input)).run()
          db.delete(KanbanColumnTable).where(where(KanbanColumnTable, input)).run()

          if (next.columns.length > 0) {
            db.insert(KanbanColumnTable)
              .values(
                next.columns.map((column, position) => ({
                  id: column.id,
                  scope: next.scope,
                  project_id: next.projectID,
                  name: column.name,
                  color: column.color ?? null,
                  position,
                })),
              )
              .run()
          }

          const cards = next.columns.flatMap((column) =>
            column.cards.map((card, position) => ({
              id: card.id,
              scope: next.scope,
              project_id: next.projectID,
              column_id: column.id,
              title: card.title,
              title_refs: JSON.stringify(card.titleRefs),
              description: card.description ?? null,
              description_refs: JSON.stringify(card.descriptionRefs),
              color: card.color ?? null,
              position,
            })),
          )

          if (cards.length > 0) {
            db.insert(KanbanCardTable).values(cards).run()
          }

          const labels = next.columns.flatMap((column) =>
            column.cards.flatMap((card) =>
              card.tags.map((tag, position) => ({
                id: tag.id,
                scope: next.scope,
                project_id: next.projectID,
                card_id: card.id,
                name: tag.name,
                color: tag.color ?? null,
                position,
              })),
            ),
          )

          if (labels.length > 0) {
            db.insert(KanbanTagTable).values(labels).run()
          }
        })
      },
      { behavior: "immediate" },
    )
    return next
  }

  const ensure = (input: Scoped) => {
    const board = read(input)
    if (board.columns.length > 0) return board
    return write(input, seed(input))
  }

  const column = (board: Info, columnID: ColumnID) => {
    const index = board.columns.findIndex((item) => item.id === columnID)
    if (index === -1) throw new Error(`Column not found: ${columnID}`)
    return { index, value: board.columns[index] }
  }

  const card = (board: Info, cardID: CardID) => {
    for (const column of board.columns) {
      const index = column.cards.findIndex((item) => item.id === cardID)
      if (index === -1) continue
      return { column, index, value: column.cards[index] }
    }
    throw new Error(`Card not found: ${cardID}`)
  }

  const remove = <T>(list: T[], index: number) => {
    const [value] = list.splice(index, 1)
    return value
  }

  const target = (board: Info, columnID: ColumnID, fallback?: ColumnID) => {
    if (fallback) {
      const next = board.columns.find((item) => item.id === fallback)
      if (next) return next
    }
    const next = board.columns.find((item) => item.id !== columnID)
    if (next) return next
    throw new Error("Cannot delete the only column on the board")
  }

  const applyOne = (board: Info, operation: Operation) => {
    switch (operation.type) {
      case "column.create": {
        board.columns.splice(clamp(board.columns.length, operation.position), 0, {
          id: ColumnID.ascending(),
          name: operation.name.trim(),
          color: operation.color ?? undefined,
          position: 0,
          cards: [],
        })
        return
      }
      case "column.update": {
        const item = column(board, operation.columnID).value
        if (operation.name !== undefined) item.name = operation.name.trim()
        if (operation.color !== undefined) item.color = operation.color ?? undefined
        return
      }
      case "column.move": {
        const entry = column(board, operation.columnID)
        const value = remove(board.columns, entry.index)
        board.columns.splice(clamp(board.columns.length, operation.position), 0, value)
        return
      }
      case "column.delete": {
        if (board.columns.length === 1) {
          throw new Error("Cannot delete the only column on the board")
        }
        const entry = column(board, operation.columnID)
        const value = remove(board.columns, entry.index)
        if (value.cards.length === 0) return
        const next = target(board, value.id, operation.targetColumnID)
        next.cards.push(...value.cards.map((card) => ({ ...card, columnID: next.id })))
        return
      }
      case "card.create": {
        const entry = column(board, operation.columnID)
        entry.value.cards.splice(clamp(entry.value.cards.length, operation.position), 0, {
          id: CardID.ascending(),
          columnID: entry.value.id,
          title: operation.title.trim(),
          titleRefs: refs(operation.titleRefs),
          description: trim(operation.description),
          descriptionRefs: refs(operation.descriptionRefs),
          color: operation.color ?? undefined,
          tags: tags(operation.tags),
          position: 0,
        })
        return
      }
      case "card.update": {
        const entry = card(board, operation.cardID).value
        if (operation.title !== undefined) entry.title = operation.title.trim()
        if (operation.titleRefs !== undefined) entry.titleRefs = refs(operation.titleRefs)
        if (operation.description !== undefined) entry.description = trim(operation.description)
        if (operation.descriptionRefs !== undefined) entry.descriptionRefs = refs(operation.descriptionRefs)
        if (operation.color !== undefined) entry.color = operation.color ?? undefined
        if (operation.tags !== undefined) entry.tags = tags(operation.tags)
        return
      }
      case "card.move": {
        const entry = card(board, operation.cardID)
        const item = remove(entry.column.cards, entry.index)
        const next = column(board, operation.columnID).value
        next.cards.splice(clamp(next.cards.length, operation.position), 0, {
          ...item,
          columnID: next.id,
        })
        return
      }
      case "card.delete": {
        const entry = card(board, operation.cardID)
        remove(entry.column.cards, entry.index)
        return
      }
    }
  }

  export async function get(input: Scoped): Promise<Info> {
    return ensure(refine(input))
  }

  export async function update(input: Scoped & { operations: Operation[] }): Promise<Info> {
    const base = copy(ensure(refine(input)))
    for (const operation of input.operations) {
      applyOne(base, operation)
    }
    return write(input, base)
  }

  export function project(projectID: ProjectIDType) {
    return refine({
      scope: "project" as const,
      projectID,
    })
  }

  export function global() {
    return refine({
      scope: "global" as const,
    })
  }
}
