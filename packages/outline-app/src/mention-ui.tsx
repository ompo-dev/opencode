import { fileIconHref, FileIcon } from "@opencode-ai/ui/file-icon"
import { iconMarkup, Icon } from "@opencode-ai/ui/icon"
import type { JSX } from "solid-js"
import type { OutlineMention } from "./mentions"

type Scope = "global" | "project"

export type MentionSpot = {
  left: number
  top: number
  width: number
  max: number
}

export type MentionValue =
  | {
      kind: "path"
      label: string
      path: string
    }
  | {
      kind: "collection"
      label: string
      scope: Scope
      title: string
      collectionID?: string
    }
  | {
      kind: "note"
      label: string
      scope: Scope
      title: string
      documentID?: string
    }

const plain = (text: string) => text.replace(/\u200B/g, "")

const idx = (node: Node) => {
  const up = node.parentNode as Node | null
  if (!up) return -1
  return Array.from(up.childNodes).indexOf(node as ChildNode)
}

const tone = (item: MentionValue) => {
  if (item.kind === "path") {
    return {
      fill: "var(--background-stronger)",
      line: "transparent",
      icon: "",
    }
  }
  if (item.kind === "collection") {
    return {
      fill: "rgba(245, 158, 11, 0.12)",
      line: "rgba(245, 158, 11, 0.28)",
      icon: "#d97706",
    }
  }
  return {
    fill: "rgba(16, 185, 129, 0.12)",
    line: "rgba(16, 185, 129, 0.28)",
    icon: "#059669",
  }
}

const glyph = (item: MentionValue) => {
  if (item.kind === "path") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
    svg.setAttribute("data-component", "file-icon")
    svg.setAttribute("class", "size-4 shrink-0")
    use.setAttribute("href", fileIconHref(item.path, item.path.endsWith("/") ? "directory" : "file"))
    svg.appendChild(use)
    return svg
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  const wrap = document.createElement("span")
  wrap.className = "flex size-4 shrink-0 items-center justify-center"
  wrap.style.color = tone(item).icon
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("fill", "none")
  svg.setAttribute("class", "size-4")
  svg.innerHTML = iconMarkup(item.kind === "collection" ? "folder" : "task")
  wrap.appendChild(svg)
  return wrap
}

export const mentionSpot = (root: HTMLElement, host: HTMLElement): MentionSpot | undefined => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(true)
  const mark = document.createElement("span")
  mark.textContent = "\u200b"
  mark.style.position = "relative"
  mark.style.display = "inline-block"
  mark.style.width = "1px"
  mark.style.height = "1em"
  mark.style.pointerEvents = "none"
  range.insertNode(mark)
  const rect = mark.getBoundingClientRect()
  range.setStartAfter(mark)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  mark.remove()
  const box = host.getBoundingClientRect()
  const width = Math.min(416, Math.max(240, box.width))
  const left = Math.min(Math.max(8, rect.left - 10), Math.max(8, window.innerWidth - width - 8))
  const top = Math.min(rect.bottom + 28, Math.max(8, window.innerHeight - 120))
  return {
    left,
    top,
    width,
    max: Math.max(120, window.innerHeight - top - 8),
  }
}

export const mentionBackspace = (root: HTMLElement) => {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !root.contains(range.startContainer)) return false

  let node: Node | null = range.startContainer
  let off = range.startOffset

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = plain(node.textContent ?? "").slice(0, off)
      if (text.includes("\n") || text.includes("\r")) return false
      if (text.trim().length > 0) return false
      const up = node.parentNode as Node | null
      if (!up) return false
      off = idx(node)
      node = up
      continue
    }

    if (!(node instanceof HTMLElement)) return false
    if (node !== root && node.dataset.mention === "true") {
      const next = range.cloneRange()
      next.setStartBefore(node)
      next.deleteContents()
      selection.removeAllRanges()
      selection.addRange(next)
      return true
    }
    if (node.tagName === "BR") return false
    if (off > 0) {
      const child = node.childNodes[off - 1] as Node | undefined
      if (!child) return false
      node = child
      off = child.nodeType === Node.TEXT_NODE ? (child.textContent ?? "").length : child.childNodes.length
      continue
    }
    if (node === root) return false
    const up = node.parentNode as Node | null
    if (!up) return false
    off = idx(node)
    node = up
  }

  return false
}

export const mentionNode = (item: MentionValue) => {
  const node = document.createElement("span")
  const text = document.createElement("span")
  node.setAttribute("contenteditable", "false")
  node.setAttribute("data-mention", "true")
  node.className =
    "inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-12-regular text-text-strong align-baseline shadow-xs-border"
  node.style.backgroundColor = tone(item).fill
  node.style.borderColor = tone(item).line
  node.setAttribute("data-mention-kind", item.kind)
  node.setAttribute("data-label", item.label)
  text.className = "truncate"
  text.textContent = item.label
  node.appendChild(glyph(item))
  node.appendChild(text)
  if (item.kind === "path") {
    node.setAttribute("data-path", item.path)
    return node
  }
  node.setAttribute("data-scope", item.scope)
  node.setAttribute("data-title", item.title)
  if (item.kind === "collection" && item.collectionID) {
    node.setAttribute("data-collection-id", item.collectionID)
  }
  if (item.kind === "note" && item.documentID) {
    node.setAttribute("data-document-id", item.documentID)
  }
  return node
}

export const mentionHTML = (item: MentionValue) => mentionNode(item).outerHTML

export const mentionHead = (item: OutlineMention | MentionValue) => (item.kind === "path" ? item.path : item.title)

export const mentionMeta = (item: OutlineMention | MentionValue) => {
  if (item.kind === "path") return ""
  return `${item.scope === "project" ? "Project" : "Global"} ${item.kind === "collection" ? "Collection" : "Note"}`
}

export function MentionGlyph(props: { item: OutlineMention | MentionValue; class?: string }) {
  return props.item.kind === "path" ? (
    <FileIcon
      node={{ path: props.item.path, type: props.item.path.endsWith("/") ? "directory" : "file" }}
      class={props.class ?? "size-4 shrink-0"}
    />
  ) : (
    <span
      class={`flex size-4 shrink-0 items-center justify-center ${props.class ?? ""}`}
      style={{ color: tone(props.item).icon } satisfies JSX.CSSProperties}
    >
      <Icon name={props.item.kind === "collection" ? "folder" : "task"} size="small" />
    </span>
  )
}
