import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { OutlineNode } from "@opencode-ai/outline-core"
import { createOutlinePlugin, OutlineRoutes } from "./index.js"

type Meta = { id: string }

type Doc = {
  meta: Meta
}

type Col = {
  id: string
}

type Tree = {
  id: string
  children: Tree[]
}

type Snap = {
  project: {
    collections: Array<{
      id: string
      tree: Tree[]
    }>
  }
}

type Def = {
  execute(args: unknown, ctx: unknown): Promise<string>
}

const dirs: string[] = []

const body = (text: string): OutlineNode => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }],
    },
  ],
})

const tmp = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outline-server-"))
  dirs.push(dir)
  return dir
}

const run = async <T>(tool: Record<string, Def>, name: string, args: Record<string, unknown>) => {
  const item = tool[name]
  if (!item) throw new Error(`Tool not found: ${name}`)
  return JSON.parse(await item.execute(args, {})) as T
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("outline server", () => {
  it("moves a note to root via plugin tool when parent_document_id is null", async () => {
    const root = await tmp()
    const plugin = createOutlinePlugin(root)
    const hooks = await plugin({
      project: { id: "proj_1", name: "Demo" },
      worktree: "C:/demo",
      directory: "C:/demo",
    } as never)
    if (!hooks.tool) throw new Error("Tools not available")

    const col = await run<Col>(hooks.tool, "outline_collection_create", {
      scope: "project",
      title: "Docs",
    })
    const parent = await run<Doc>(hooks.tool, "outline_document_create", {
      scope: "project",
      collection_id: col.id,
      title: "Parent",
      content: body("parent"),
    })
    const child = await run<Doc>(hooks.tool, "outline_document_create", {
      scope: "project",
      collection_id: col.id,
      parent_document_id: parent.meta.id,
      title: "Child",
      content: body("child"),
    })

    await run(hooks.tool, "outline_document_move", {
      scope: "project",
      document_id: child.meta.id,
      parent_document_id: null,
    })

    const snap = await run<Snap>(hooks.tool, "outline_workspace_snapshot", {})
    const item = snap.project.collections.find((x) => x.id === col.id)
    if (!item) throw new Error("Collection missing from snapshot")

    expect(item.tree.some((x) => x.id === child.meta.id)).toBe(true)
    expect(item.tree.find((x) => x.id === parent.meta.id)?.children.some((x) => x.id === child.meta.id)).toBe(false)
  })

  it("moves a note to root via HTTP route when parent_document_id is null", async () => {
    const root = await tmp()
    const app = OutlineRoutes(() => ({
      root,
      ctx: {
        project_id: "proj_2",
        project_name: "Demo 2",
        worktree: "C:/demo-2",
      },
    }))

    const call = async <T>(url: string, init?: RequestInit) => {
      const res = await app.request(url, init)
      expect(res.status).toBeLessThan(400)
      return (await res.json()) as T
    }

    const col = await call<Col>("/collection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", title: "Docs" }),
    })
    const parent = await call<Doc>("/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        collection_id: col.id,
        title: "Parent",
        content: body("parent"),
      }),
    })
    const child = await call<Doc>("/document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        collection_id: col.id,
        parent_document_id: parent.meta.id,
        title: "Child",
        content: body("child"),
      }),
    })

    await call(`/document/${child.meta.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        parent_document_id: null,
      }),
    })

    const snap = await call<Snap>("/workspace")
    const item = snap.project.collections.find((x) => x.id === col.id)
    if (!item) throw new Error("Collection missing from snapshot")

    expect(item.tree.some((x) => x.id === child.meta.id)).toBe(true)
    expect(item.tree.find((x) => x.id === parent.meta.id)?.children.some((x) => x.id === child.meta.id)).toBe(false)
  })
})
