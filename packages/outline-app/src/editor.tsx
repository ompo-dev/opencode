/// <reference path="./editorjs-checklist.d.ts" />

import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { outlineEmpty, type OutlineMark, type OutlineNode } from "@opencode-ai/outline-core"
import Checklist from "@editorjs/checklist"
import Code from "@editorjs/code"
import Delimiter from "@editorjs/delimiter"
import EditorJS, { type OutputData } from "@editorjs/editorjs"
import Header from "@editorjs/header"
import List from "@editorjs/list"
import Quote from "@editorjs/quote"
import Table from "@editorjs/table"
import { For, onCleanup, onMount } from "solid-js"
import "./outline.css"

type Attr = Record<string, string | number | boolean | null>

type Item = string | { content?: string; items?: Item[] }

const acts = [
  {
    id: "text",
    label: "Text",
    type: "paragraph",
    data: { text: "" },
  },
  {
    id: "h1",
    label: "H1",
    type: "header",
    data: { level: 1, text: "" },
  },
  {
    id: "h2",
    label: "H2",
    type: "header",
    data: { level: 2, text: "" },
  },
  {
    id: "list",
    label: "List",
    type: "list",
    data: { style: "unordered", items: [""] },
  },
  {
    id: "todo",
    label: "Todo",
    type: "checklist",
    data: {
      items: [{ text: "", checked: false }],
    },
  },
  {
    id: "quote",
    label: "Quote",
    type: "quote",
    data: { text: "", caption: "" },
  },
  {
    id: "code",
    label: "Code",
    type: "code",
    data: { code: "" },
  },
  {
    id: "line",
    label: "Line",
    type: "delimiter",
    data: {},
  },
  {
    id: "table",
    label: "Table",
    type: "table",
    data: {
      withHeadings: false,
      content: [
        ["", ""],
        ["", ""],
      ],
    },
  },
] satisfies {
  id: string
  label: string
  type: string
  data: Record<string, unknown>
}[]

const esc = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const wrap = (value: string, marks?: OutlineMark[]) => {
  if (!marks || marks.length === 0) return esc(value)
  return marks.reduce((text, mark) => {
    if (mark.type === "strong") return `<strong>${text}</strong>`
    if (mark.type === "em") return `<em>${text}</em>`
    if (mark.type === "strike") return `<s>${text}</s>`
    if (mark.type === "code") return `<code>${text}</code>`
    if (mark.type !== "link") return text
    const href = mark.attrs?.href
    if (typeof href !== "string" || !href) return text
    return `<a href="${esc(href)}">${text}</a>`
  }, esc(value))
}

const plain = (node?: OutlineNode): string => {
  if (!node) return ""
  if (node.text) return node.text
  if (!node.content?.length) return ""
  return node.content.map(plain).join(" ").replace(/\s+/g, " ").trim()
}

const rich = (node?: OutlineNode): string => {
  if (!node) return ""
  if (node.type === "hard_break") return "<br>"
  if (node.text !== undefined) return wrap(node.text, node.marks)
  if (!node.content?.length) return ""
  return node.content.map(rich).join("")
}

const para = (node?: OutlineNode) => {
  if (!node?.content?.length) return ""
  return node.content
    .filter((item) => item.type === "paragraph")
    .map(rich)
    .filter(Boolean)
    .join("<br>")
}

const list = (node: OutlineNode): Item => {
  const content = node.content ?? []
  const text = content
    .filter((item) => item.type === "paragraph")
    .map(rich)
    .join("<br>")
  const child = content.find((item) => item.type === "bullet_list" || item.type === "ordered_list")
  if (!child) return text || " "
  return {
    content: text || " ",
    items: (child.content ?? []).filter((item) => item.type === "list_item").map(list),
  }
}

const rows = (node: OutlineNode) =>
  (node.content ?? [])
    .filter((item) => item.type === "table_row")
    .map((row) =>
      (row.content ?? [])
        .filter((cell) => cell.type === "table_cell" || cell.type === "table_header")
        .map((cell) => plain(cell)),
    )

const blocks = (node?: OutlineNode): OutputData["blocks"] => {
  const content = node?.type === "doc" ? (node.content ?? []) : node ? [node] : []
  if (content.length === 0) {
    return [
      {
        type: "paragraph",
        data: { text: "" },
      },
    ]
  }

  return content.flatMap((item) => {
    if (item.type === "paragraph") return [{ type: "paragraph", data: { text: rich(item) } }]
    if (item.type === "heading") {
      const raw = item.attrs?.level
      const level = raw === 1 || raw === 3 ? raw : 2
      return [{ type: "header", data: { level, text: rich(item) } }]
    }
    if (item.type === "bullet_list" || item.type === "ordered_list") {
      const style = item.type === "ordered_list" ? "ordered" : "unordered"
      return [
        {
          type: "list",
          data: {
            style,
            items: (item.content ?? []).filter((part) => part.type === "list_item").map(list),
          },
        },
      ]
    }
    if (item.type === "checklist") {
      return [
        {
          type: "checklist",
          data: {
            items: (item.content ?? [])
              .filter((part) => part.type === "checklist_item")
              .map((part) => ({
                text: para(part),
                checked: part.attrs?.checked === true,
              })),
          },
        },
      ]
    }
    if (item.type === "blockquote" || item.type === "callout") {
      return [
        {
          type: "quote",
          data: {
            text: para(item),
            caption: item.type === "callout" ? "Callout" : "",
          },
        },
      ]
    }
    if (item.type === "code_block") {
      return [
        {
          type: "code",
          data: { code: plain(item) },
        },
      ]
    }
    if (item.type === "horizontal_rule") return [{ type: "delimiter", data: {} }]
    if (item.type === "table") {
      const content = rows(item)
      return [
        {
          type: "table",
          data: {
            withHeadings: false,
            content: content.length ? content : [[""]],
          },
        },
      ]
    }

    return [
      {
        type: "paragraph",
        data: { text: rich(item) || esc(plain(item)) },
      },
    ]
  })
}

const mark = (item: HTMLElement): OutlineMark | undefined => {
  const tag = item.tagName.toLowerCase()
  if (tag === "b" || tag === "strong") return { type: "strong" }
  if (tag === "i" || tag === "em") return { type: "em" }
  if (tag === "s" || tag === "strike" || tag === "del") return { type: "strike" }
  if (tag === "code") return { type: "code" }
  if (tag !== "a") return
  const href = item.getAttribute("href")
  if (!href) return { type: "link" }
  return {
    type: "link",
    attrs: { href },
  }
}

const walk = (item: Node, marks: OutlineMark[]): OutlineNode[] => {
  if (item.nodeType === Node.TEXT_NODE) {
    const text = item.textContent ?? ""
    if (!text) return []
    if (marks.length === 0) return [{ type: "text", text }]
    return [{ type: "text", text, marks }]
  }
  if (!(item instanceof HTMLElement)) return []
  if (item.tagName.toLowerCase() === "br") return [{ type: "text", text: "\n" }]
  const next = mark(item)
  const state = next ? [...marks, next] : marks
  return Array.from(item.childNodes).flatMap((child) => walk(child, state))
}

const parse = (html: string, type: string, attrs?: Attr): OutlineNode => {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild
  const content = root ? Array.from(root.childNodes).flatMap((item) => walk(item, [])) : []
  if (content.length === 0) {
    if (attrs) return { type, attrs }
    return { type }
  }
  if (attrs) return { type, attrs, content }
  return { type, content }
}

const items = (value: unknown): Item[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Item => typeof item === "string" || (!!item && typeof item === "object"))
}

const entry = (item: Item, type: "bullet_list" | "ordered_list"): OutlineNode => {
  if (typeof item === "string") {
    return {
      type: "list_item",
      content: [parse(item, "paragraph")],
    }
  }

  const content = [parse(item.content ?? "", "paragraph")]
  const list = items(item.items)
  if (list.length) {
    content.push({
      type,
      content: list.map((child) => entry(child, type)),
    })
  }

  return {
    type: "list_item",
    content,
  }
}

const block = (item: OutputData["blocks"][number]): OutlineNode => {
  const data = item.data as Record<string, unknown>

  if (item.type === "header") {
    const raw = data.level
    const level = raw === 1 || raw === 3 ? raw : 2
    return parse(typeof data.text === "string" ? data.text : "", "heading", { level })
  }

  if (item.type === "list") {
    const style = data.style === "ordered" ? "ordered_list" : "bullet_list"
    const list = items(data.items)
    return {
      type: style,
      content: list.length
        ? list.map((value) => entry(value, style))
        : [{ type: "list_item", content: [{ type: "paragraph" }] }],
    }
  }

  if (item.type === "checklist") {
    const items = Array.isArray(data.items) ? data.items : []
    return {
      type: "checklist",
      content: items.map((value) => {
        if (typeof value === "string") {
          return {
            type: "checklist_item",
            attrs: { checked: false },
            content: [parse(value, "paragraph")],
          } satisfies OutlineNode
        }

        const text =
          !!value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : ""
        const checked = !!value && typeof value === "object" && "checked" in value && value.checked === true
        return {
          type: "checklist_item",
          attrs: { checked },
          content: [parse(text, "paragraph")],
        } satisfies OutlineNode
      }),
    }
  }

  if (item.type === "quote") {
    const text = typeof data.text === "string" ? data.text : ""
    const caption = typeof data.caption === "string" ? data.caption : ""
    const content = [parse(text, "paragraph")]
    if (caption.trim()) content.push(parse(caption, "paragraph"))
    return {
      type: "blockquote",
      content,
    }
  }

  if (item.type === "code") {
    const code = typeof data.code === "string" ? data.code : ""
    if (!code) return { type: "code_block" }
    return {
      type: "code_block",
      content: [{ type: "text", text: code }],
    }
  }

  if (item.type === "delimiter") return { type: "horizontal_rule" }

  if (item.type === "table") {
    const rows = Array.isArray(data.content) ? data.content : []
    return {
      type: "table",
      content: rows.map((row) => ({
        type: "table_row",
        content: (Array.isArray(row) ? row : []).map((cell) => ({
          type: "table_cell",
          content: [parse(typeof cell === "string" ? cell : "", "paragraph")],
        })),
      })),
    }
  }

  return parse(typeof data.text === "string" ? data.text : "", "paragraph")
}

const node = (value?: OutputData): OutlineNode => {
  const blocks = value?.blocks ?? []
  const content = blocks.map(block).filter((item) => item.type !== "paragraph" || item.content || item.text)
  if (content.length === 0) return outlineEmpty()
  return {
    type: "doc",
    content,
  }
}

export function OutlineEditor(props: { value?: OutlineNode; onChange: (value: OutlineNode) => void }) {
  let el: HTMLDivElement | undefined
  let view: EditorJS | undefined

  const run = (fn: (ed: EditorJS) => void) => {
    const ed = view
    if (!ed) return
    void ed.isReady.then(() => {
      fn(ed)
      ed.caret.focus()
    })
  }

  const add = (type: string, data: Record<string, unknown>) => {
    run((ed) => {
      ed.blocks.insert(type, data, undefined, undefined, true)
    })
  }

  const clear = () => {
    const ed = view
    if (!ed) return
    void ed.isReady
      .then(() =>
        ed.blocks.render({
          blocks: [{ type: "paragraph", data: { text: "" } }],
        }),
      )
      .then(() => {
        ed.caret.setToFirstBlock("start")
      })
  }

  const tools = {
    header: {
      class: Header,
      inlineToolbar: true,
      config: {
        levels: [1, 2, 3],
        defaultLevel: 2,
      },
    },
    list: {
      class: List,
      inlineToolbar: true,
    },
    checklist: {
      class: Checklist,
      inlineToolbar: true,
    },
    quote: {
      class: Quote,
      inlineToolbar: true,
    },
    code: {
      class: Code,
    },
    delimiter: {
      class: Delimiter,
    },
    table: {
      class: Table,
      inlineToolbar: true,
      config: {
        rows: 2,
        cols: 2,
        withHeadings: false,
      },
    },
  } as Record<string, unknown>

  onMount(() => {
    if (!el) return

    view = new EditorJS({
      holder: el,
      autofocus: true,
      minHeight: 220,
      placeholder: "Type / to choose a block",
      inlineToolbar: true,
      data: { blocks: blocks(props.value) },
      tools,
      async onChange() {
        const editor = view
        if (!editor) return
        await editor.isReady
        const data = await editor.save()
        props.onChange(node(data))
      },
    } as never)
  })

  onCleanup(() => {
    const editor = view
    view = undefined
    if (!editor) return
    void editor.isReady.then(() => editor.destroy()).catch(() => {})
  })

  return (
    <div class="h-full min-h-0 flex flex-col rounded-lg border border-border-weak-base bg-background-base">
      <div data-component="outline-editor" class="min-h-0 flex-1  px-3 py-2">
        <div ref={el} />
      </div>
    </div>
  )
}
