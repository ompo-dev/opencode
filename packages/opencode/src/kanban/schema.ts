import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const ColumnID = Schema.String.pipe(
  Schema.brand("ColumnID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("column", id)),
    zod: Identifier.schema("column").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type ColumnID = Schema.Schema.Type<typeof ColumnID>

export const CardID = Schema.String.pipe(
  Schema.brand("CardID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("card", id)),
    zod: Identifier.schema("card").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type CardID = Schema.Schema.Type<typeof CardID>

export const TagID = Schema.String.pipe(
  Schema.brand("TagID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("tag", id)),
    zod: Identifier.schema("tag").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type TagID = Schema.Schema.Type<typeof TagID>
