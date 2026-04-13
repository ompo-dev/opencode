import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createOutlineService } from "./server.js"
import type { OutlineNode } from "./index.js"

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

const make = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outline-core-"))
  dirs.push(dir)
  return createOutlineService({
    root: dir,
    ctx: {
      project_id: "proj_1",
      project_name: "Demo",
      worktree: "C:/demo",
    },
  })
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("outline core", () => {
  it("isolates global and project spaces", async () => {
    const svc = await make()
    const global = await svc.collection_create({ scope: "global", title: "Global Docs" })
    const project = await svc.collection_create({ scope: "project", title: "Project Docs" })

    await svc.document_create({
      scope: "global",
      collection_id: global.id,
      title: "Runbook",
      content: body("global note"),
    })
    await svc.document_create({
      scope: "project",
      collection_id: project.id,
      title: "Spec",
      content: body("project note"),
    })

    const snap = await svc.snapshot()

    expect(snap.global.collections).toHaveLength(1)
    expect(snap.project.collections).toHaveLength(1)
    expect(snap.global.collections[0]?.tree[0]?.title).toBe("Runbook")
    expect(snap.project.collections[0]?.tree[0]?.title).toBe("Spec")

    const globalHits = await svc.search({ scope: "global", query: "project" })
    const projectHits = await svc.search({ scope: "project", query: "project" })

    expect(globalHits).toHaveLength(0)
    expect(projectHits).toHaveLength(1)
  })

  it("deletes nested documents recursively and preserves content", async () => {
    const svc = await make()
    const collection = await svc.collection_create({ scope: "project", title: "Docs" })
    const root = await svc.document_create({
      scope: "project",
      collection_id: collection.id,
      title: "Parent",
      content: body("hello parent"),
    })
    const child = await svc.document_create({
      scope: "project",
      collection_id: collection.id,
      parent_document_id: root.meta.id,
      title: "Child",
      content: body("hello child"),
    })
    await svc.document_create({
      scope: "project",
      collection_id: collection.id,
      parent_document_id: child.meta.id,
      title: "Grandchild",
      content: body("hello grandchild"),
    })

    const before = await svc.document_get("project", child.meta.id)
    expect(before.content.content?.[0]?.content?.[0]?.text).toBe("hello child")

    await svc.document_delete({ scope: "project", document_id: root.meta.id })

    expect(await svc.document_list("project", collection.id)).toHaveLength(0)
  })
})
