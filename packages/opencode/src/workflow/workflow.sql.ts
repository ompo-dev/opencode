import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import type { WorkflowID } from "./schema"

export const WorkflowTable = sqliteTable(
  "workflow",
  {
    id: text().$type<WorkflowID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID | null>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    last_session_id: text().$type<SessionID | null>(),
    name: text().notNull(),
    description: text(),
    enabled: integer({ mode: "boolean" }).notNull().$default(() => true),
    schedule: text({ mode: "json" }).notNull(),
    action: text({ mode: "json" }).notNull(),
    run_count: integer().notNull().$default(() => 0),
    time_next_run: integer(),
    time_last_run: integer(),
    time_last_success: integer(),
    time_last_error: integer(),
    last_error: text(),
    claim_owner: text(),
    time_claimed: integer(),
    claim_until: integer(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_project_idx").on(table.project_id),
    index("workflow_project_enabled_next_idx").on(table.project_id, table.enabled, table.time_next_run),
    index("workflow_project_claim_idx").on(table.project_id, table.claim_until),
  ],
)
