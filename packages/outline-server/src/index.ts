import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { createOutlineService } from "@opencode-ai/outline-core/server"
import { outlineEmpty, outlineTitle, type OutlineNode, type OutlineWorkspaceContext } from "@opencode-ai/outline-core"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import z from "zod"

const scope = z.enum(["global", "project"])
const attr = z.union([z.string(), z.number(), z.boolean(), z.null()])

const mark = z
  .object({
    type: z.string(),
    attrs: z.record(z.string(), attr).optional(),
  })
  .meta({
    ref: "OutlineMark",
  })

const node: z.ZodType<OutlineNode> = z
  .lazy(() =>
    z.object({
      type: z.string(),
      text: z.string().optional(),
      attrs: z.record(z.string(), attr).optional(),
      marks: z.array(mark).optional(),
      content: z.array(node).optional(),
    }),
  )
  .meta({
    ref: "OutlineNode",
  })

const body = node.default(outlineEmpty()).meta({
  ref: "OutlineDocumentContent",
})

const collectionCreate = z.object({
  scope,
  title: z.string(),
  description: z.string().optional(),
})

const collectionUpdate = z.object({
  scope,
  title: z.string().optional(),
  description: z.string().optional(),
})

const collectionArchive = z.object({
  scope,
  archived: z.boolean().optional(),
})

const documentCreate = z
  .object({
    scope,
    collection_id: z.string(),
    parent_document_id: z.string().optional(),
    title: z.string().optional(),
    content: body.optional(),
  })
  .meta({
    ref: "OutlineDocumentCreate",
  })

const documentUpdate = z
  .object({
    scope,
    title: z.string().optional(),
    content: body.optional(),
  })
  .meta({
    ref: "OutlineDocumentUpdate",
  })

const documentMove = z.object({
  scope,
  collection_id: z.string().optional(),
  parent_document_id: z.string().nullable().optional(),
  index: z.number().int().min(0).optional(),
})

const documentArchive = z.object({
  scope,
  archived: z.boolean().optional(),
})

const noteUpsert = z
  .object({
    scope: scope.optional(),
    document_id: z.string().optional(),
    collection_id: z.string().optional(),
    parent_document_id: z.string().optional(),
    title: z.string().optional(),
    content: body.optional(),
  })
  .meta({
    ref: "OutlineNoteUpsert",
  })

const searchInput = z.object({
  scope,
  query: z.string().default(""),
})

const make = (root: string, ctx: OutlineWorkspaceContext) =>
  createOutlineService({
    root,
    ctx,
  })

const json = (value: unknown) => JSON.stringify(value, null, 2)

const ctx = (input: PluginInput): OutlineWorkspaceContext => ({
  project_id: input.project.id,
  project_name: (input.project as { name?: string }).name,
  worktree: input.worktree,
})

export function createOutlinePlugin(root: string): Plugin {
  return async (input) => {
    const svc = make(root, ctx(input))

    return {
      tool: {
        outline_collection_list: tool({
          description: "List Outline collections for the current global or project space.",
          args: {
            scope,
          },
          async execute(args) {
            return json(await svc.collection_list(args.scope))
          },
        }),
        outline_collection_create: tool({
          description: "Create a new Outline collection in the current global or project space.",
          args: collectionCreate.shape,
          async execute(args) {
            return json(await svc.collection_create(args))
          },
        }),
        outline_collection_update: tool({
          description: "Update the title or description of an Outline collection.",
          args: {
            collection_id: z.string(),
            ...collectionUpdate.shape,
          },
          async execute(args) {
            return json(await svc.collection_update(args))
          },
        }),
        outline_collection_archive: tool({
          description: "Archive or unarchive an Outline collection.",
          args: {
            collection_id: z.string(),
            ...collectionArchive.shape,
          },
          async execute(args) {
            return json(await svc.collection_archive(args))
          },
        }),
        outline_collection_delete: tool({
          description: "Delete an Outline collection and every document inside it.",
          args: {
            scope,
            collection_id: z.string(),
          },
          async execute(args) {
            return json(await svc.collection_delete(args))
          },
        }),
        outline_document_list: tool({
          description: "List Outline documents in the current global or project space.",
          args: {
            scope,
            collection_id: z.string().optional(),
          },
          async execute(args) {
            return json(await svc.document_list(args.scope, args.collection_id))
          },
        }),
        outline_document_get: tool({
          description: "Get a single Outline document with ProseMirror JSON content.",
          args: {
            scope,
            document_id: z.string(),
          },
          async execute(args) {
            return json(await svc.document_get(args.scope, args.document_id))
          },
        }),
        outline_document_create: tool({
          description: "Create a new Outline document in a collection.",
          args: documentCreate.shape,
          async execute(args) {
            return json(await svc.document_create(args))
          },
        }),
        outline_document_update: tool({
          description: "Update an Outline document title or ProseMirror JSON content.",
          args: {
            document_id: z.string(),
            ...documentUpdate.shape,
          },
          async execute(args) {
            return json(await svc.document_update(args))
          },
        }),
        outline_document_move: tool({
          description: "Move an Outline document to another parent or collection.",
          args: {
            document_id: z.string(),
            ...documentMove.shape,
          },
          async execute(args) {
            return json(await svc.document_move(args))
          },
        }),
        outline_document_archive: tool({
          description: "Archive or unarchive an Outline document.",
          args: {
            document_id: z.string(),
            ...documentArchive.shape,
          },
          async execute(args) {
            return json(await svc.document_archive(args))
          },
        }),
        outline_document_delete: tool({
          description: "Delete an Outline document and its nested children.",
          args: {
            scope,
            document_id: z.string(),
          },
          async execute(args) {
            return json(await svc.document_delete(args))
          },
        }),
        outline_search: tool({
          description: "Search Outline documents by title, content or breadcrumbs.",
          args: searchInput.shape,
          async execute(args) {
            return json(await svc.search(args))
          },
        }),
        outline_note_upsert: tool({
          description: "Create or update an Outline note in the current workspace.",
          args: noteUpsert.shape,
          async execute(args) {
            const next = {
              ...args,
              title: args.title || outlineTitle(args.content, "Untitled"),
            }
            return json(await svc.note_upsert(next))
          },
        }),
        outline_workspace_snapshot: tool({
          description: "Get the full Outline workspace snapshot for the current global and project spaces.",
          args: {},
          async execute() {
            return json(await svc.snapshot())
          },
        }),
      },
    }
  }
}

export function OutlineRoutes(input: () => { root: string; ctx: OutlineWorkspaceContext }) {
  const svc = () => make(input().root, input().ctx)

  return new Hono()
    .get(
      "/workspace",
      describeRoute({
        summary: "Get Outline workspace snapshot",
        operationId: "outline.workspace",
        responses: {
          200: {
            description: "Outline workspace snapshot",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => c.json(await svc().snapshot()),
    )
    .get(
      "/document/:documentID",
      describeRoute({
        summary: "Get Outline document",
        operationId: "outline.document.get",
        responses: {
          200: {
            description: "Outline document",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          documentID: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          scope,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(await svc().document_get(query.scope, params.documentID))
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search Outline documents",
        operationId: "outline.search",
        responses: {
          200: {
            description: "Search hits",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator("query", searchInput),
      async (c) => c.json(await svc().search(c.req.valid("query"))),
    )
    .post("/collection", validator("json", collectionCreate), async (c) =>
      c.json(await svc().collection_create(c.req.valid("json"))),
    )
    .patch(
      "/collection/:collectionID",
      validator(
        "param",
        z.object({
          collectionID: z.string(),
        }),
      ),
      validator("json", collectionUpdate),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await svc().collection_update({ ...body, collection_id: params.collectionID }))
      },
    )
    .post(
      "/collection/:collectionID/archive",
      validator(
        "param",
        z.object({
          collectionID: z.string(),
        }),
      ),
      validator("json", collectionArchive),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await svc().collection_archive({ ...body, collection_id: params.collectionID }))
      },
    )
    .delete(
      "/collection/:collectionID",
      validator(
        "param",
        z.object({
          collectionID: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          scope,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(await svc().collection_delete({ scope: query.scope, collection_id: params.collectionID }))
      },
    )
    .post("/document", validator("json", documentCreate), async (c) =>
      c.json(await svc().document_create(c.req.valid("json"))),
    )
    .patch(
      "/document/:documentID",
      validator(
        "param",
        z.object({
          documentID: z.string(),
        }),
      ),
      validator("json", documentUpdate),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await svc().document_update({ ...body, document_id: params.documentID }))
      },
    )
    .post(
      "/document/:documentID/move",
      validator(
        "param",
        z.object({
          documentID: z.string(),
        }),
      ),
      validator("json", documentMove),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(
          await svc().document_move({
            ...body,
            document_id: params.documentID,
          }),
        )
      },
    )
    .post(
      "/document/:documentID/archive",
      validator(
        "param",
        z.object({
          documentID: z.string(),
        }),
      ),
      validator("json", documentArchive),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await svc().document_archive({ ...body, document_id: params.documentID }))
      },
    )
    .delete(
      "/document/:documentID",
      validator(
        "param",
        z.object({
          documentID: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          scope,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const query = c.req.valid("query")
        return c.json(await svc().document_delete({ scope: query.scope, document_id: params.documentID }))
      },
    )
}
