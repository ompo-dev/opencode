export type OutlineScope = "global" | "project"

export type OutlineMark = {
  type: string
  attrs?: Record<string, string | number | boolean | null>
}

export type OutlineNode = {
  type: string
  text?: string
  attrs?: Record<string, string | number | boolean | null>
  marks?: OutlineMark[]
  content?: OutlineNode[]
}

export type OutlineSpace = {
  kind: OutlineScope
  key: string
  title: string
  project_id?: string
  worktree?: string
  time: {
    created: number
    updated: number
  }
}

export type OutlineCollectionMeta = {
  id: string
  space_key: string
  title: string
  description?: string
  index: number
  archived?: number
  time: {
    created: number
    updated: number
  }
}

export type OutlineDocumentMeta = {
  id: string
  space_key: string
  collection_id: string
  parent_document_id?: string
  title: string
  index: number
  text: string
  archived?: number
  time: {
    created: number
    updated: number
  }
}

export type OutlineTreeNode = {
  id: string
  title: string
  collection_id: string
  parent_document_id?: string
  index: number
  children: OutlineTreeNode[]
}

export type OutlineSearchHit = {
  id: string
  title: string
  plain_text: string
  breadcrumbs: string[]
  collection_id: string
  parent_document_id?: string
}

export type OutlineDocument = {
  meta: OutlineDocumentMeta
  content: OutlineNode
}

export type OutlineCollection = OutlineCollectionMeta & {
  tree: OutlineTreeNode[]
  count: number
}

export type OutlineSpaceSnapshot = {
  space: OutlineSpace
  collections: OutlineCollection[]
}

export type OutlineWorkspaceSnapshot = {
  global: OutlineSpaceSnapshot
  project: OutlineSpaceSnapshot
}

export type OutlineWorkspaceContext = {
  project_id?: string
  project_name?: string
  worktree: string
}

export function outlineEmpty(): OutlineNode {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  }
}

export function outlineText(node?: OutlineNode): string {
  if (!node) return ""
  if (node.text) return node.text
  if (!node.content?.length) return ""
  return node.content.map(outlineText).join(" ")
}

export function outlineTitle(node?: OutlineNode, fallback = "Untitled") {
  const value = outlineText(node)
    .replace(/\s+/g, " ")
    .trim()
  if (!value) return fallback
  return value.slice(0, 120)
}
