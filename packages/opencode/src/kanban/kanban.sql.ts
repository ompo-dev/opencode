import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { ProjectID } from "@/project/schema"
import type { CardID, ColumnID, TagID } from "./schema"

export const KanbanColumnTable = sqliteTable(
  "kanban_column",
  {
    id: text().$type<ColumnID>().primaryKey(),
    scope: text().notNull(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("kanban_column_scope_idx").on(table.scope),
    index("kanban_column_project_idx").on(table.project_id),
    index("kanban_column_scope_position_idx").on(table.scope, table.position),
  ],
)

export const KanbanCardTable = sqliteTable(
  "kanban_card",
  {
    id: text().$type<CardID>().primaryKey(),
    scope: text().notNull(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    column_id: text()
      .$type<ColumnID>()
      .notNull()
      .references(() => KanbanColumnTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    title_refs: text(),
    description: text(),
    description_refs: text(),
    color: text(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("kanban_card_scope_idx").on(table.scope),
    index("kanban_card_project_idx").on(table.project_id),
    index("kanban_card_column_idx").on(table.column_id),
    index("kanban_card_scope_position_idx").on(table.scope, table.position),
  ],
)

export const KanbanTagTable = sqliteTable(
  "kanban_tag",
  {
    id: text().$type<TagID>().primaryKey(),
    scope: text().notNull(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    card_id: text()
      .$type<CardID>()
      .notNull()
      .references(() => KanbanCardTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("kanban_tag_scope_idx").on(table.scope),
    index("kanban_tag_project_idx").on(table.project_id),
    index("kanban_tag_card_idx").on(table.card_id),
    index("kanban_tag_scope_position_idx").on(table.scope, table.position),
  ],
)
