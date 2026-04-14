import {
  createTextFragment,
  getCursorPosition,
  setCursorPosition,
  setRangeEdge,
} from "@/components/prompt-input/editor-dom"
import { useLanguage } from "@/context/language"
import {
  mentionBackspace,
  MentionGlyph,
  mentionNode,
  mentionSpot,
  type MentionSpot,
  type MentionValue,
  type OutlineMention,
} from "@opencode-ai/outline-app"
import type { KanbanRef, KanbanScope } from "@opencode-ai/sdk/v2/client"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { batch, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"

type Pick = OutlineMention

const key = (item: Pick) => item.key

const trail = (item: Extract<Pick, { kind: "collection" | "note" }>) => item.breadcrumbs.slice(0, -1).join(" / ")

const badge = (item: KanbanRef): MentionValue =>
  item.kind === "path"
    ? {
        kind: item.kind,
        label: item.label,
        path: item.path,
      }
    : item.kind === "collection"
      ? {
          kind: item.kind,
          label: item.label,
          scope: item.scope,
          title: item.title,
          collectionID: item.collectionID,
        }
      : {
          kind: item.kind,
          label: item.label,
          scope: item.scope,
          title: item.title,
          documentID: item.documentID,
        }

const pick = (item: Pick): MentionValue =>
  item.kind === "path"
    ? {
        kind: item.kind,
        label: item.label,
        path: item.path,
      }
    : item.kind === "collection"
      ? {
          kind: item.kind,
          label: item.label,
          scope: item.scope,
          title: item.title,
          collectionID: item.collectionID,
        }
      : {
          kind: item.kind,
          label: item.label,
          scope: item.scope,
          title: item.title,
          documentID: item.documentID,
        }

const refs = (text: string, input: KanbanRef[]) => {
  const list = input
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((item) => item.start >= 0 && item.end > item.start && item.end <= text.length && item.label)
  const out: Array<{ type: "text"; text: string } | { type: "ref"; value: KanbanRef }> = []
  let pos = 0

  for (const item of list) {
    if (item.start < pos) continue
    const head = text.slice(pos, item.start)
    if (head) out.push({ type: "text", text: head })
    out.push({ type: "ref", value: item })
    pos = item.end
  }

  const tail = text.slice(pos)
  if (tail) out.push({ type: "text", text: tail })
  if (out.length > 0) return out
  return [{ type: "text" as const, text }]
}

export function MentionField(props: {
  label: string
  placeholder: string
  text: string
  refs: KanbanRef[]
  findMentions: (query: string) => Promise<Pick[]>
  multiline?: boolean
  autofocus?: boolean
  class?: string
  onChange: (text: string, refs: KanbanRef[]) => void
}) {
  const language = useLanguage()
  let box!: HTMLDivElement
  let editor!: HTMLDivElement
  let task = 0
  let mounted = false

  const [store, setStore] = createStore({
    text: props.text,
    open: false,
    active: "",
    items: [] as Pick[],
    spot: undefined as MentionSpot | undefined,
  })

  const list = createMemo(() => store.items.slice(0, 10))

  const close = () => {
    task += 1
    batch(() => {
      setStore("open", false)
      setStore("active", "")
      setStore("items", [])
      setStore("spot", undefined)
    })
  }

  const place = () => mentionSpot(editor, box)

  const load = (query: string) => {
    const id = ++task
    const text = query.trim()
    return props.findMentions(text).then((items) => {
      if (id !== task) return
      batch(() => {
        setStore("items", items)
        setStore("active", items[0] ? key(items[0]) : "")
        setStore("open", items.length > 0)
        setStore("spot", items[0] ? place() : undefined)
      })
    })
  }

  const pill = (item: KanbanRef) => {
    const node = mentionNode(badge(item))
    node.setAttribute("data-type", item.kind)
    return node
  }

  const render = (text: string, input: KanbanRef[]) => {
    editor.innerHTML = ""
    for (const item of refs(text, input)) {
      if (item.type === "text") {
        editor.appendChild(createTextFragment(item.text))
        continue
      }
      editor.appendChild(pill(item.value))
    }
    const last = editor.lastChild
    if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
      editor.appendChild(document.createTextNode("\u200B"))
    }
  }

  const parse = () => {
    const refs: KanbanRef[] = []
    let pos = 0
    let out = ""
    let buf = ""

    const flush = () => {
      const text = buf.replace(/\r\n?/g, "\n").replace(/\u200B/g, "")
      buf = ""
      if (!text) return
      out += text
      pos += text.length
    }

    const push = (node: HTMLElement) => {
      const label = node.dataset.label ?? node.textContent ?? ""
      if (!label) return
      const start = pos
      out += label
      pos += label.length
      const kind = node.dataset.type ?? node.dataset.mentionKind
      if (kind === "path" && node.dataset.path) {
        refs.push({
          kind: "path",
          label,
          start,
          end: pos,
          path: node.dataset.path,
        })
        return
      }
      if (kind === "collection" && node.dataset.collectionId && node.dataset.scope && node.dataset.title) {
        refs.push({
          kind: "collection",
          label,
          start,
          end: pos,
          scope: node.dataset.scope as KanbanScope,
          collectionID: node.dataset.collectionId,
          title: node.dataset.title,
        })
        return
      }
      if (kind === "note" && node.dataset.documentId && node.dataset.scope && node.dataset.title) {
        refs.push({
          kind: "note",
          label,
          start,
          end: pos,
          scope: node.dataset.scope as KanbanScope,
          documentID: node.dataset.documentId,
          title: node.dataset.title,
        })
      }
    }

    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buf += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      if (el.dataset.type) {
        flush()
        push(el)
        return
      }
      if (el.tagName === "BR") {
        buf += "\n"
        return
      }
      for (const child of Array.from(el.childNodes)) {
        visit(child)
      }
    }

    const nodes = Array.from(editor.childNodes)
    nodes.forEach((node, idx) => {
      const block = node.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((node as HTMLElement).tagName)
      visit(node)
      if (block && idx < nodes.length - 1) buf += "\n"
    })
    flush()
    const text = out
    return { text, refs }
  }

  const sync = () => {
    const next = parse()
    setStore("text", next.text)
    props.onChange(next.text, next.refs)
    const cursor = getCursorPosition(editor)
    const match = next.text.slice(0, cursor).match(/@(\S*)$/)
    if (!match) {
      close()
      return
    }
    setStore("spot", place())
    void load(match[1] ?? "")
  }

  const select = (item: Pick) => {
    const selection = window.getSelection()
    if (!selection) return

    if (selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
      editor.focus()
      setCursorPosition(editor, store.text.length)
    }

    if (selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.startContainer)) return
    const cursor = getCursorPosition(editor)
    const text = parse().text
    const match = text.slice(0, cursor).match(/@(\S*)$/)
    const start = match ? cursor - match[0].length : cursor
    const value: KanbanRef =
      item.kind === "path"
        ? {
            kind: "path",
            label: item.label,
            start,
            end: start + item.label.length,
            path: item.path,
          }
        : item.kind === "collection"
          ? {
              kind: "collection",
              label: item.label,
              start,
              end: start + item.label.length,
              scope: item.scope,
              collectionID: item.collectionID,
              title: item.title,
            }
          : {
              kind: "note",
              label: item.label,
              start,
              end: start + item.label.length,
              scope: item.scope,
              documentID: item.documentID,
              title: item.title,
            }

    if (match) {
      setRangeEdge(editor, range, "start", start)
      setRangeEdge(editor, range, "end", cursor)
    }

    range.deleteContents()
    const gap = document.createTextNode(" ")
    const node = pill(value)
    range.insertNode(gap)
    range.insertNode(node)
    range.setStartAfter(gap)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    close()
    sync()
  }

  const move = (step: 1 | -1) => {
    const items = list()
    if (items.length === 0) return
    const index = Math.max(
      0,
      items.findIndex((item) => key(item) === store.active),
    )
    const next = (index + step + items.length) % items.length
    setStore("active", key(items[next]))
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Backspace" && mentionBackspace(editor)) {
      event.preventDefault()
      sync()
      return
    }

    if (store.open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      move(event.key === "ArrowDown" ? 1 : -1)
      return
    }

    if (store.open && (event.key === "Enter" || event.key === "Tab")) {
      const item = list().find((row) => key(row) === store.active) ?? list()[0]
      if (!item) return
      event.preventDefault()
      select(item)
      return
    }

    if (event.key === "Escape" && store.open) {
      event.preventDefault()
      close()
      return
    }

    if (!props.multiline && event.key === "Enter") {
      event.preventDefault()
    }
  }

  onMount(() => {
    render(props.text, props.refs)
    mounted = true
    const spot = () => {
      if (!store.open) return
      setStore("spot", place())
    }
    window.addEventListener("scroll", spot, true)
    window.addEventListener("resize", spot)
    onCleanup(() => {
      window.removeEventListener("scroll", spot, true)
      window.removeEventListener("resize", spot)
    })
    if (!props.autofocus) return
    requestAnimationFrame(() => {
      editor.focus()
      setCursorPosition(editor, props.text.length)
    })
  })

  onCleanup(() => {
    task += 1
  })

  return (
    <div data-component="input" data-variant="normal" class="relative">
      <label data-slot="input-label">{props.label}</label>
      <div data-slot="input-wrapper" class="relative px-0!">
        <div
          ref={(el) => {
            box = el
          }}
          class="relative flex-1"
        >
          <Show when={!store.text}>
            <div
              class="pointer-events-none absolute left-0 top-0 px-3 text-14-regular text-text-weak"
              classList={{
                "py-[7px]": !props.multiline,
                "py-[7px] whitespace-pre-wrap": !!props.multiline,
              }}
            >
              {props.placeholder}
            </div>
          </Show>
          <div
            ref={(el) => {
              editor = el
            }}
            data-slot="input-input"
            role="textbox"
            aria-multiline={props.multiline ? "true" : "false"}
            aria-label={props.label}
            contenteditable="true"
            spellcheck
            class={props.class}
            classList={{
              "min-h-8 py-[7px]": !props.multiline,
              "min-h-32 max-h-40 overflow-y-auto py-[7px] whitespace-pre-wrap": !!props.multiline,
            }}
            onInput={() => {
              if (!mounted) return
              sync()
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              window.setTimeout(() => close(), 0)
            }}
          />

          <Show when={store.open && list().length > 0}>
            <Portal>
              <div
                class="fixed z-50 overflow-auto rounded-[12px] bg-surface-raised-stronger-non-alpha p-2 shadow-[var(--shadow-lg-border-base)]"
                style={{
                  left: `${store.spot?.left ?? 0}px`,
                  top: `${store.spot?.top ?? 0}px`,
                  width: `${store.spot?.width ?? 320}px`,
                  "max-height": `${store.spot?.max ?? 288}px`,
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <For each={list()}>
                  {(item) => (
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left"
                      classList={{ "bg-surface-raised-base-hover": store.active === key(item) }}
                      onMouseEnter={() => setStore("active", key(item))}
                      onClick={() => select(item)}
                    >
                      <MentionGlyph item={pick(item)} />
                      <div class="min-w-0 flex-1">
                        {item.kind === "path" ? (
                          <div class="flex min-w-0 items-center text-14-regular">
                            <span class="min-w-0 truncate whitespace-nowrap text-text-weak">
                              {getDirectory(item.path)}
                            </span>
                            <Show when={!item.path.endsWith("/")}>
                              <span class="whitespace-nowrap text-text-strong">{getFilename(item.path)}</span>
                            </Show>
                            <Show when={item.path.endsWith("/")}>
                              <span class="whitespace-nowrap text-text-strong">{item.path}</span>
                            </Show>
                          </div>
                        ) : (
                          <div class="min-w-0">
                            <div class="truncate text-14-regular text-text-strong">{item.title}</div>
                            <div class="flex items-center gap-2 text-12-regular text-text-weak">
                              <span>
                                {item.scope === "project"
                                  ? language.t("board.note.project")
                                  : language.t("board.note.global")}
                              </span>
                              <Show when={item.kind === "collection"}>
                                <span>{language.t("board.collection")}</span>
                              </Show>
                              <Show when={item.kind === "note"}>
                                <span>{language.t("board.note")}</span>
                              </Show>
                              <Show when={trail(item)}>
                                <span class="truncate">{trail(item)}</span>
                              </Show>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Portal>
          </Show>
        </div>
      </div>
    </div>
  )
}
