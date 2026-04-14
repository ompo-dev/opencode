import { outlineEmpty, type OutlineNode } from "@opencode-ai/outline-app"
import type { KanbanRef, KanbanScope } from "@opencode-ai/sdk/v2/client"

const PREFIX = "oc:outline:"

const text = (value?: string) =>
  value
    ?.split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({
      type: "paragraph",
      content: [{ type: "text", text: item }],
    })) ?? []

const move = (refs: KanbanRef[], offset: number) =>
  refs.map((item) => ({
    ...item,
    start: item.start + offset,
    end: item.end + offset,
  }))

const ref = (node: OutlineNode) => {
  const mark = node.marks?.find((item) => item.type === "mention")
  const attrs = mark?.attrs
  const kind = typeof attrs?.kind === "string" ? attrs.kind : undefined
  const label = node.text?.trim()
  if (!kind || !label) return
  if (kind === "path" && typeof attrs?.path === "string") {
    return { kind, label, start: 0, end: label.length, path: attrs.path } satisfies KanbanRef
  }
  if (
    kind === "collection" &&
    typeof attrs?.scope === "string" &&
    typeof attrs?.collectionID === "string" &&
    typeof attrs?.title === "string"
  ) {
    return {
      kind,
      label,
      start: 0,
      end: label.length,
      scope: attrs.scope as KanbanScope,
      collectionID: attrs.collectionID,
      title: attrs.title,
    } satisfies KanbanRef
  }
  if (
    kind === "note" &&
    typeof attrs?.scope === "string" &&
    typeof attrs?.documentID === "string" &&
    typeof attrs?.title === "string"
  ) {
    return {
      kind,
      label,
      start: 0,
      end: label.length,
      scope: attrs.scope as KanbanScope,
      documentID: attrs.documentID,
      title: attrs.title,
    } satisfies KanbanRef
  }
}

const flat = (node?: OutlineNode): { text: string; refs: KanbanRef[] } => {
  if (!node) return { text: "", refs: [] }
  if (node.text !== undefined) {
    const next = ref(node)
    return {
      text: node.text,
      refs: next ? [next] : [],
    }
  }
  if (!node.content?.length) return { text: "", refs: [] }

  return node.content.reduce(
    (acc, item) => {
      const next = flat(item)
      if (!next.text) return acc
      const gap = acc.text ? 1 : 0
      return {
        text: acc.text ? `${acc.text} ${next.text}` : next.text,
        refs: [...acc.refs, ...move(next.refs, acc.text.length + gap)],
      }
    },
    { text: "", refs: [] as KanbanRef[] },
  )
}

export const parseCardDescription = (value?: string): OutlineNode => {
  if (!value) return outlineEmpty()
  if (value.startsWith(PREFIX)) {
    try {
      return JSON.parse(value.slice(PREFIX.length)) as OutlineNode
    } catch {}
  }
  const content = text(value)
  if (content.length === 0) return outlineEmpty()
  return {
    type: "doc",
    content,
  }
}

export const formatCardDescription = (value?: OutlineNode) => {
  const next = value?.content?.length ? value : outlineEmpty()
  const plain = flat(next).text.trim()
  if (!plain) return undefined
  return `${PREFIX}${JSON.stringify(next)}`
}

export const refsFromCardDescription = (value?: OutlineNode) => flat(value).refs

export const textFromCardDescription = (value?: string) => flat(parseCardDescription(value)).text
