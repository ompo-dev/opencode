import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { ulid } from "ulid"
import {
  outlineEmpty,
  outlineTitle,
  type OutlineCollectionMeta,
  type OutlineDocument,
  type OutlineDocumentMeta,
  type OutlineNode,
  type OutlineScope,
  type OutlineSearchHit,
  type OutlineSpace,
  type OutlineSpaceSnapshot,
  type OutlineTreeNode,
  type OutlineWorkspaceContext,
  type OutlineWorkspaceSnapshot,
} from "./index.js"

type Ref = {
  kind: OutlineScope
  key: string
  title: string
  project_id?: string
  worktree?: string
}

type FileRef = {
  root: string
  space: string
  collections: string
  documents: string
  index: string
}

type Args = {
  root: string
  ctx: OutlineWorkspaceContext
}

type CollectionInput = {
  scope: OutlineScope
  title: string
  description?: string
}

type CollectionUpdate = {
  scope: OutlineScope
  collection_id: string
  title?: string
  description?: string
}

type CollectionDelete = {
  scope: OutlineScope
  collection_id: string
}

type ArchiveCollection = {
  scope: OutlineScope
  collection_id: string
  archived?: boolean
}

type DocumentCreate = {
  scope: OutlineScope
  collection_id: string
  parent_document_id?: string
  title?: string
  content?: OutlineNode
}

type DocumentUpdate = {
  scope: OutlineScope
  document_id: string
  title?: string
  content?: OutlineNode
}

type DocumentMove = {
  scope: OutlineScope
  document_id: string
  collection_id?: string
  parent_document_id?: string | null
  index?: number
}

type DocumentDelete = {
  scope: OutlineScope
  document_id: string
}

type ArchiveDocument = {
  scope: OutlineScope
  document_id: string
  archived?: boolean
}

type SearchInput = {
  scope: OutlineScope
  query: string
}

type NoteUpsert = {
  scope?: OutlineScope
  document_id?: string
  collection_id?: string
  parent_document_id?: string
  title?: string
  content?: OutlineNode
}

const now = () => Date.now()

const sortCollections = (input: OutlineCollectionMeta[]) =>
  [...input].sort((a, b) => a.index - b.index || a.time.created - b.time.created || a.id.localeCompare(b.id))

const sortDocs = (input: OutlineDocumentMeta[]) =>
  [...input].sort((a, b) => a.index - b.index || a.time.created - b.time.created || a.id.localeCompare(b.id))

const clean = (value: string, fallback: string) => {
  const next = value.trim().replace(/\s+/g, " ")
  if (!next) return fallback
  return next
}

const projectKey = (ctx: OutlineWorkspaceContext) =>
  ctx.project_id || createHash("sha256").update(ctx.worktree).digest("hex").slice(0, 16)

const ref = (ctx: OutlineWorkspaceContext, scope: OutlineScope): Ref =>
  scope === "global"
    ? {
        kind: "global",
        key: "global",
        title: "Global",
      }
    : {
        kind: "project",
        key: projectKey(ctx),
        title: ctx.project_name || path.basename(ctx.worktree) || "Current Project",
        project_id: ctx.project_id,
        worktree: ctx.worktree,
      }

const files = (root: string, item: Ref): FileRef => {
  const space =
    item.kind === "global"
      ? path.join(root, "spaces", "global")
      : path.join(root, "spaces", "project", item.key)
  return {
    root,
    space,
    collections: path.join(space, "collections"),
    documents: path.join(space, "documents"),
    index: path.join(space, "index"),
  }
}

const read = async <T>(file: string, fallback: T): Promise<T> => {
  if (!existsSync(file)) return fallback
  return (await Bun.file(file).json()) as T
}

const write = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}

const collect = (node?: OutlineNode): string[] => {
  if (!node) return []
  const head = node.text ? [node.text] : []
  if (!node.content?.length) return head
  return [...head, ...node.content.flatMap(collect)]
}

const plain = (node?: OutlineNode) =>
  collect(node)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

const metaFile = (dir: FileRef, id: string) => path.join(dir.collections, id, "meta.json")
const treeFile = (dir: FileRef, id: string) => path.join(dir.collections, id, "tree.json")
const docMetaFile = (dir: FileRef, id: string) => path.join(dir.documents, id, "meta.json")
const docBodyFile = (dir: FileRef, id: string) => path.join(dir.documents, id, "content.pm.json")
const spaceFile = (dir: FileRef) => path.join(dir.space, "space.json")
const searchFile = (dir: FileRef) => path.join(dir.index, "search.json")

const tree = (docs: OutlineDocumentMeta[]) => {
  const map = new Map<string, OutlineTreeNode>()
  const root: OutlineTreeNode[] = []

  for (const doc of sortDocs(docs)) {
    map.set(doc.id, {
      id: doc.id,
      title: doc.title,
      collection_id: doc.collection_id,
      parent_document_id: doc.parent_document_id,
      index: doc.index,
      children: [],
    })
  }

  for (const node of map.values()) {
    const parent = node.parent_document_id ? map.get(node.parent_document_id) : undefined
    if (!parent || parent.collection_id !== node.collection_id) {
      root.push(node)
      continue
    }
    parent.children.push(node)
  }

  const sort = (input: OutlineTreeNode[]) => {
    input.sort((a, b) => a.index - b.index || a.title.localeCompare(b.title))
    input.forEach((item) => sort(item.children))
  }

  sort(root)
  return root
}

const crumbs = (docs: Map<string, OutlineDocumentMeta>, item: OutlineDocumentMeta) => {
  const out = [item.title]
  let cur = item.parent_document_id ? docs.get(item.parent_document_id) : undefined
  while (cur) {
    out.unshift(cur.title)
    cur = cur.parent_document_id ? docs.get(cur.parent_document_id) : undefined
  }
  return out
}

export function createOutlineService(args: Args) {
  const root = path.join(args.root, "plugins", "outline")

  const ensure = async (scope: OutlineScope) => {
    const item = ref(args.ctx, scope)
    const dir = files(root, item)
    const time = now()
    const current = await read<OutlineSpace | undefined>(spaceFile(dir), undefined)
    const next: OutlineSpace = current
      ? {
          ...current,
          title: item.title,
          project_id: item.project_id,
          worktree: item.worktree,
          time: {
            created: current.time.created,
            updated: time,
          },
        }
      : {
          kind: item.kind,
          key: item.key,
          title: item.title,
          project_id: item.project_id,
          worktree: item.worktree,
          time: {
            created: time,
            updated: time,
          },
        }

    await Promise.all([
      mkdir(dir.collections, { recursive: true }),
      mkdir(dir.documents, { recursive: true }),
      mkdir(dir.index, { recursive: true }),
      write(spaceFile(dir), next),
    ])

    return { item, dir, space: next }
  }

  const collections = async (scope: OutlineScope) => {
    const { dir } = await ensure(scope)
    if (!existsSync(dir.collections)) return []
    const ids: string[] = await readdir(dir.collections)
    const items = await Promise.all(ids.map((id) => read<OutlineCollectionMeta | undefined>(metaFile(dir, id), undefined)))
    return sortCollections(items.filter((item): item is OutlineCollectionMeta => !!item))
  }

  const docs = async (scope: OutlineScope) => {
    const { dir } = await ensure(scope)
    if (!existsSync(dir.documents)) return []
    const ids: string[] = await readdir(dir.documents)
    const items = await Promise.all(ids.map((id) => read<OutlineDocumentMeta | undefined>(docMetaFile(dir, id), undefined)))
    return sortDocs(items.filter((item): item is OutlineDocumentMeta => !!item))
  }

  const content = async (scope: OutlineScope, document_id: string) => {
    const { dir } = await ensure(scope)
    return read<OutlineNode>(docBodyFile(dir, document_id), outlineEmpty())
  }

  const activeCollections = async (scope: OutlineScope) => (await collections(scope)).filter((item) => !item.archived)
  const activeDocs = async (scope: OutlineScope) => (await docs(scope)).filter((item) => !item.archived)

  const sync = async (scope: OutlineScope) => {
    const { dir, space } = await ensure(scope)
    const cs = await activeCollections(scope)
    const ds = await activeDocs(scope)
    const by = new Map(cs.map((item) => [item.id, [] as OutlineDocumentMeta[]]))

    for (const doc of ds) {
      const list = by.get(doc.collection_id)
      if (!list) continue
      list.push(doc)
    }

    const all = new Map(ds.map((item) => [item.id, item]))
    const hits = ds.map((item) => ({
      id: item.id,
      title: item.title,
      plain_text: item.text,
      breadcrumbs: crumbs(all, item),
      collection_id: item.collection_id,
      parent_document_id: item.parent_document_id,
    }))

    await Promise.all([
      ...cs.map((item) => write(treeFile(dir, item.id), tree(by.get(item.id) ?? []))),
      write(searchFile(dir), hits),
      write(spaceFile(dir), {
        ...space,
        time: {
          created: space.time.created,
          updated: now(),
        },
      } satisfies OutlineSpace),
    ])

    return hits
  }

  const snapshotSpace = async (scope: OutlineScope): Promise<OutlineSpaceSnapshot> => {
    const { dir, space } = await ensure(scope)
    const cs = await activeCollections(scope)
    const out = await Promise.all(
      cs.map(async (item) => ({
        ...item,
        tree: await read<OutlineTreeNode[]>(treeFile(dir, item.id), []),
        count: (await activeDocs(scope)).filter((doc) => doc.collection_id === item.id).length,
      })),
    )
    return {
      space,
      collections: out,
    }
  }

  const nextCollectionIndex = async (scope: OutlineScope) => {
    const cs = await collections(scope)
    const top = cs.at(-1)
    return top ? top.index + 1 : 0
  }

  const nextDocIndex = async (scope: OutlineScope, collection_id: string, parent_document_id?: string) => {
    const ds = await docs(scope)
    const list = ds.filter((item) => item.collection_id === collection_id && item.parent_document_id === parent_document_id)
    const top = list.at(-1)
    return top ? top.index + 1 : 0
  }

  const collection = async (scope: OutlineScope, collection_id: string) =>
    (await collections(scope)).find((item) => item.id === collection_id)

  const document = async (scope: OutlineScope, document_id: string) => (await docs(scope)).find((item) => item.id === document_id)

  return {
    async snapshot(): Promise<OutlineWorkspaceSnapshot> {
      await Promise.all([sync("global"), sync("project")])
      const [global, project] = await Promise.all([snapshotSpace("global"), snapshotSpace("project")])
      return { global, project }
    },
    async collection_list(scope: OutlineScope) {
      await sync(scope)
      return activeCollections(scope)
    },
    async collection_create(input: CollectionInput) {
      const { dir, item } = await ensure(input.scope)
      const id = ulid()
      const time = now()
      const meta: OutlineCollectionMeta = {
        id,
        space_key: item.key,
        title: clean(input.title, "Untitled Collection"),
        description: input.description?.trim() || undefined,
        index: await nextCollectionIndex(input.scope),
        time: {
          created: time,
          updated: time,
        },
      }
      await Promise.all([write(metaFile(dir, id), meta), write(treeFile(dir, id), [])])
      await sync(input.scope)
      return meta
    },
    async collection_update(input: CollectionUpdate) {
      const { dir } = await ensure(input.scope)
      const item = await collection(input.scope, input.collection_id)
      if (!item) throw new Error(`Outline collection not found: ${input.collection_id}`)
      const next: OutlineCollectionMeta = {
        ...item,
        title: input.title ? clean(input.title, item.title) : item.title,
        description: input.description === undefined ? item.description : input.description.trim() || undefined,
        time: {
          created: item.time.created,
          updated: now(),
        },
      }
      await write(metaFile(dir, item.id), next)
      await sync(input.scope)
      return next
    },
    async collection_archive(input: ArchiveCollection) {
      const { dir } = await ensure(input.scope)
      const item = await collection(input.scope, input.collection_id)
      if (!item) throw new Error(`Outline collection not found: ${input.collection_id}`)
      const next: OutlineCollectionMeta = {
        ...item,
        archived: input.archived === false ? undefined : now(),
        time: {
          created: item.time.created,
          updated: now(),
        },
      }
      await write(metaFile(dir, item.id), next)
      await sync(input.scope)
      return next
    },
    async collection_delete(input: CollectionDelete) {
      const { dir } = await ensure(input.scope)
      const item = await collection(input.scope, input.collection_id)
      if (!item) throw new Error(`Outline collection not found: ${input.collection_id}`)
      const ds = await docs(input.scope)
      const ids = ds.filter((doc) => doc.collection_id === item.id).map((doc) => doc.id)
      await Promise.all([
        rm(path.join(dir.collections, item.id), { recursive: true, force: true }),
        ...ids.map((id) => rm(path.join(dir.documents, id), { recursive: true, force: true })),
      ])
      await sync(input.scope)
      return true
    },
    async document_list(scope: OutlineScope, collection_id?: string) {
      const ds = await activeDocs(scope)
      if (!collection_id) return ds
      return ds.filter((item) => item.collection_id === collection_id)
    },
    async document_get(scope: OutlineScope, document_id: string): Promise<OutlineDocument> {
      const item = await document(scope, document_id)
      if (!item) throw new Error(`Outline document not found: ${document_id}`)
      return {
        meta: item,
        content: await content(scope, document_id),
      }
    },
    async document_create(input: DocumentCreate) {
      const { dir, item } = await ensure(input.scope)
      const col = await collection(input.scope, input.collection_id)
      if (!col) throw new Error(`Outline collection not found: ${input.collection_id}`)
      const id = ulid()
      const body = input.content ?? outlineEmpty()
      const text = plain(body)
      const time = now()
      const meta: OutlineDocumentMeta = {
        id,
        space_key: item.key,
        collection_id: input.collection_id,
        parent_document_id: input.parent_document_id,
        title: clean(input.title || outlineTitle(body, "Untitled"), "Untitled"),
        index: await nextDocIndex(input.scope, input.collection_id, input.parent_document_id),
        text,
        time: {
          created: time,
          updated: time,
        },
      }
      await Promise.all([write(docMetaFile(dir, id), meta), write(docBodyFile(dir, id), body)])
      await sync(input.scope)
      return {
        meta,
        content: body,
      }
    },
    async document_update(input: DocumentUpdate) {
      const { dir } = await ensure(input.scope)
      const item = await document(input.scope, input.document_id)
      if (!item) throw new Error(`Outline document not found: ${input.document_id}`)
      const body = input.content ?? (await content(input.scope, input.document_id))
      const next: OutlineDocumentMeta = {
        ...item,
        title: input.title ? clean(input.title, item.title) : item.title,
        text: plain(body),
        time: {
          created: item.time.created,
          updated: now(),
        },
      }
      await Promise.all([write(docMetaFile(dir, item.id), next), write(docBodyFile(dir, item.id), body)])
      await sync(input.scope)
      return {
        meta: next,
        content: body,
      }
    },
    async document_move(input: DocumentMove) {
      const { dir } = await ensure(input.scope)
      const item = await document(input.scope, input.document_id)
      if (!item) throw new Error(`Outline document not found: ${input.document_id}`)
      const collection_id = input.collection_id ?? item.collection_id
      const parent_document_id = input.parent_document_id === undefined ? item.parent_document_id : input.parent_document_id || undefined
      const next: OutlineDocumentMeta = {
        ...item,
        collection_id,
        parent_document_id,
        index:
          input.index ??
          (await nextDocIndex(input.scope, collection_id, parent_document_id)),
        time: {
          created: item.time.created,
          updated: now(),
        },
      }
      await write(docMetaFile(dir, item.id), next)
      await sync(input.scope)
      return next
    },
    async document_archive(input: ArchiveDocument) {
      const { dir } = await ensure(input.scope)
      const item = await document(input.scope, input.document_id)
      if (!item) throw new Error(`Outline document not found: ${input.document_id}`)
      const next: OutlineDocumentMeta = {
        ...item,
        archived: input.archived === false ? undefined : now(),
        time: {
          created: item.time.created,
          updated: now(),
        },
      }
      await write(docMetaFile(dir, item.id), next)
      await sync(input.scope)
      return next
    },
    async document_delete(input: DocumentDelete) {
      const { dir } = await ensure(input.scope)
      const item = await document(input.scope, input.document_id)
      if (!item) throw new Error(`Outline document not found: ${input.document_id}`)
      const ds = await docs(input.scope)
      const ids = new Set<string>([item.id])
      let dirty = true
      while (dirty) {
        dirty = false
        for (const doc of ds) {
          if (!doc.parent_document_id || !ids.has(doc.parent_document_id) || ids.has(doc.id)) continue
          ids.add(doc.id)
          dirty = true
        }
      }
      await Promise.all([...ids].map((id) => rm(path.join(dir.documents, id), { recursive: true, force: true })))
      await sync(input.scope)
      return true
    },
    async search(input: SearchInput): Promise<OutlineSearchHit[]> {
      const { dir } = await ensure(input.scope)
      const list = await read<OutlineSearchHit[]>(searchFile(dir), [])
      const query = input.query.trim().toLowerCase()
      if (!query) return list.slice(0, 50)
      return list
        .filter((item) => {
          const title = item.title.toLowerCase()
          const text = item.plain_text.toLowerCase()
          const crumbs = item.breadcrumbs.join(" ").toLowerCase()
          return title.includes(query) || text.includes(query) || crumbs.includes(query)
        })
        .sort((a, b) => {
          const at = a.title.toLowerCase().includes(query) ? 0 : 1
          const bt = b.title.toLowerCase().includes(query) ? 0 : 1
          if (at !== bt) return at - bt
          return a.title.localeCompare(b.title)
        })
        .slice(0, 50)
    },
    async note_upsert(input: NoteUpsert) {
      const scope = input.scope ?? "project"
      if (input.document_id) {
        return this.document_update({
          scope,
          document_id: input.document_id,
          title: input.title,
          content: input.content,
        })
      }

      const cs = await activeCollections(scope)
      const collection_id = input.collection_id ?? cs[0]?.id
      if (!collection_id) {
        const col = await this.collection_create({
          scope,
          title: "Notes",
        })
        return this.document_create({
          scope,
          collection_id: col.id,
          parent_document_id: input.parent_document_id,
          title: input.title,
          content: input.content,
        })
      }

      const title = clean(input.title || outlineTitle(input.content, "Untitled"), "Untitled")
      const ds = await activeDocs(scope)
      const hit = ds.find(
        (item) =>
          item.collection_id === collection_id &&
          item.parent_document_id === input.parent_document_id &&
          item.title.toLowerCase() === title.toLowerCase(),
      )
      if (!hit) {
        return this.document_create({
          scope,
          collection_id,
          parent_document_id: input.parent_document_id,
          title,
          content: input.content,
        })
      }
      return this.document_update({
        scope,
        document_id: hit.id,
        title,
        content: input.content,
      })
    },
  }
}
