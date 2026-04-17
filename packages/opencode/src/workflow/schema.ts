import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const WorkflowID = Schema.String.pipe(
  Schema.brand("WorkflowID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("workflow", id)),
    zod: Identifier.schema("workflow").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type WorkflowID = Schema.Schema.Type<typeof WorkflowID>
