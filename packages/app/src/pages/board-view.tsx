import type { OutlineMention } from "@opencode-ai/outline-app"
import { OutlineEditor } from "@opencode-ai/outline-app"
import type { Kanban, KanbanCard, KanbanColor, KanbanColumn, KanbanRef, KanbanTag } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createMemo, For, onCleanup, Show, type Accessor, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { MentionField } from "@/components/board/mention-field"
import { useLanguage } from "@/context/language"
import {
  formatCardDescription,
  parseCardDescription,
  refsFromCardDescription,
  textFromCardDescription,
} from "@/utils/board-description"

type TagDraft = {
  id?: string
  name: string
  color?: KanbanColor
}

type Op =
  | {
      type: "column.create"
      name: string
      color?: KanbanColor
      position?: number
    }
  | {
      type: "column.update"
      columnID: string
      name?: string
      color?: KanbanColor | null
    }
  | {
      type: "column.move"
      columnID: string
      position: number
    }
  | {
      type: "column.delete"
      columnID: string
      targetColumnID?: string
    }
  | {
      type: "card.create"
      columnID: string
      title: string
      titleRefs?: KanbanRef[]
      description?: string
      descriptionRefs?: KanbanRef[]
      color?: KanbanColor
      tags?: TagDraft[]
      position?: number
    }
  | {
      type: "card.update"
      cardID: string
      title?: string
      titleRefs?: KanbanRef[]
      description?: string
      descriptionRefs?: KanbanRef[]
      color?: KanbanColor | null
      tags?: TagDraft[]
    }
  | {
      type: "card.move"
      cardID: string
      columnID: string
      position: number
    }
  | {
      type: "card.delete"
      cardID: string
    }

type Act = {
  label: string
  icon?: ComponentProps<typeof Button>["icon"]
  onClick: VoidFunction
}

type Hue = {
  id: KanbanColor
  key: string
  fill: string
  soft: string
  line: string
}

type Point = {
  x: number
  y: number
}

type Size = {
  w: number
  h: number
}

type DragBase = {
  start: Point
  point: Point
  offset: Point
  size: Size
  moved: boolean
}

type Drag =
  | (DragBase & {
      type: "column"
      id: string
    })
  | (DragBase & {
      type: "card"
      id: string
      columnID: string
    })

type Drop =
  | {
      type: "column"
      position: number
    }
  | {
      type: "card"
      columnID: string
      position: number
    }

const hues: Hue[] = [
  {
    id: "slate",
    key: "board.color.slate",
    fill: "#64748b",
    soft: "rgba(100,116,139,0.14)",
    line: "rgba(100,116,139,0.35)",
  },
  {
    id: "gray",
    key: "board.color.gray",
    fill: "#6b7280",
    soft: "rgba(107,114,128,0.14)",
    line: "rgba(107,114,128,0.35)",
  },
  {
    id: "blue",
    key: "board.color.blue",
    fill: "#3b82f6",
    soft: "rgba(59,130,246,0.14)",
    line: "rgba(59,130,246,0.35)",
  },
  {
    id: "violet",
    key: "board.color.violet",
    fill: "#8b5cf6",
    soft: "rgba(139,92,246,0.14)",
    line: "rgba(139,92,246,0.35)",
  },
  {
    id: "green",
    key: "board.color.green",
    fill: "#22c55e",
    soft: "rgba(34,197,94,0.14)",
    line: "rgba(34,197,94,0.35)",
  },
  {
    id: "amber",
    key: "board.color.amber",
    fill: "#f59e0b",
    soft: "rgba(245,158,11,0.14)",
    line: "rgba(245,158,11,0.35)",
  },
  {
    id: "orange",
    key: "board.color.orange",
    fill: "#f97316",
    soft: "rgba(249,115,22,0.14)",
    line: "rgba(249,115,22,0.35)",
  },
  { id: "red", key: "board.color.red", fill: "#ef4444", soft: "rgba(239,68,68,0.14)", line: "rgba(239,68,68,0.35)" },
  {
    id: "pink",
    key: "board.color.pink",
    fill: "#ec4899",
    soft: "rgba(236,72,153,0.14)",
    line: "rgba(236,72,153,0.35)",
  },
  { id: "cyan", key: "board.color.cyan", fill: "#06b6d4", soft: "rgba(6,182,212,0.14)", line: "rgba(6,182,212,0.35)" },
]

const fail = (err: unknown, fallback: string) => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return fallback
}

const tone = (value?: KanbanColor) => (value ? hues.find((item) => item.id === value) : undefined)

const cleanTags = (input: TagDraft[]) => {
  const seen = new Set<string>()
  return input.flatMap((item) => {
    const name = item.name.trim()
    if (!name) return []
    const key = name.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        ...(item.id ? { id: item.id } : {}),
        name,
        color: item.color,
      },
    ]
  })
}

const move = <T,>(list: T[], from: number, to: number) => {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  if (item === undefined) return list
  next.splice(to, 0, item)
  return next
}

const same = (a?: Drop, b?: Drop) => {
  if (!a || !b) return false
  if (a.type !== b.type) return false
  if (a.type === "column" && b.type === "column") return a.position === b.position
  if (a.type === "card" && b.type === "card") return a.columnID === b.columnID && a.position === b.position
  return false
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const cols = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-board-column-id]"))

const cards = (col: HTMLElement) => Array.from(col.querySelectorAll<HTMLElement>("[data-board-card-id]"))

const pickColumn = (root: HTMLElement, x: number) => {
  const list = cols(root)
  if (list.length === 0) return
  const hit = list.find((item) => {
    const box = item.getBoundingClientRect()
    return x >= box.left && x <= box.right
  })
  if (hit) return hit
  return list.reduce((best, item) => {
    if (!best) return item
    const box = item.getBoundingClientRect()
    const prev = best.getBoundingClientRect()
    const a = Math.abs(x - (box.left + box.width / 2))
    const b = Math.abs(x - (prev.left + prev.width / 2))
    return a < b ? item : best
  })
}

const locateColumn = (root: HTMLElement, dragID: string, x: number): Drop => {
  const list = cols(root).filter((item) => item.dataset.boardColumnId !== dragID)
  if (list.length === 0) return { type: "column", position: 0 }
  const index = list.findIndex((item) => {
    const box = item.getBoundingClientRect()
    return x < box.left + box.width / 2
  })
  return {
    type: "column",
    position: index === -1 ? list.length : index,
  }
}

const locateCard = (root: HTMLElement, drag: Drag & { type: "card" }, x: number, y: number): Drop | undefined => {
  const col = pickColumn(root, x)
  const columnID = col?.dataset.boardColumnId
  if (!col || !columnID) return
  const list = cards(col).filter((item) => item.dataset.boardCardId !== drag.id)
  const index = list.findIndex((item) => {
    const box = item.getBoundingClientRect()
    return y < box.top + box.height / 2
  })
  return {
    type: "card",
    columnID,
    position: index === -1 ? list.length : index,
  }
}

const locate = (root: HTMLElement, drag: Drag, point: Point) => {
  if (drag.type === "column") return locateColumn(root, drag.id, point.x)
  return locateCard(root, drag, point.x, point.y)
}

const scrollBoard = (root: HTMLElement, x: number) => {
  const box = root.getBoundingClientRect()
  const edge = 96
  const step = 28
  if (x < box.left + edge) root.scrollBy({ left: -step })
  if (x > box.right - edge) root.scrollBy({ left: step })
}

const scrollColumn = (root: HTMLElement, columnID: string, y: number) => {
  const col = Array.from(root.querySelectorAll<HTMLElement>("[data-board-column-scroll]")).find(
    (item) => item.dataset.boardColumnScroll === columnID,
  )
  if (!col) return
  const box = col.getBoundingClientRect()
  const edge = 72
  const step = 24
  if (y < box.top + edge) col.scrollBy({ top: -step })
  if (y > box.bottom - edge) col.scrollBy({ top: step })
}

const preview = (board: Kanban | undefined, drag?: Drag, over?: Drop) => {
  if (!board || !drag?.moved || !over) return board

  if (drag.type === "column" && over.type === "column") {
    const index = board.columns.findIndex((item) => item.id === drag.id)
    if (index === -1) return board
    const next = index < over.position ? over.position - 1 : over.position
    if (index === next) return board
    return {
      ...board,
      columns: move(board.columns, index, next),
    }
  }

  if (drag.type === "card" && over.type === "card") {
    const list = board.columns.map((col) => ({
      ...col,
      cards: col.cards.slice(),
    }))
    const source = list.find((col) => col.id === drag.columnID)
    const target = list.find((col) => col.id === over.columnID)
    const index = source?.cards.findIndex((item) => item.id === drag.id) ?? -1
    if (!source || !target || index === -1) return board
    const [item] = source.cards.splice(index, 1)
    if (!item) return board
    const next = drag.columnID === over.columnID && index < over.position ? over.position - 1 : over.position
    target.cards.splice(next, 0, {
      ...item,
      columnID: target.id,
    })
    return {
      ...board,
      columns: list,
    }
  }

  return board
}

function ColorPicker(props: {
  t: (key: string, vars?: Record<string, string | number>) => string
  value?: KanbanColor
  compact?: boolean
  set: (value: KanbanColor | undefined) => void
}) {
  return (
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-11-medium transition-colors"
        classList={{
          "border-border-strong bg-background-stronger text-text-strong": !props.value,
          "border-border-weak-base text-text-weak hover:bg-background-stronger": !!props.value,
        }}
        onClick={() => props.set(undefined)}
      >
        {props.t("board.color.none")}
      </button>
      <For each={hues}>
        {(item) => (
          <button
            type="button"
            class="rounded-full border-2 transition-transform hover:scale-105"
            classList={{
              "size-6": !props.compact,
              "size-5": !!props.compact,
              "border-background-base shadow-sm": props.value !== item.id,
              "border-text-strong shadow-md": props.value === item.id,
            }}
            style={{
              "background-color": item.fill,
              "box-shadow": props.value === item.id ? `0 0 0 2px ${item.line}` : undefined,
            }}
            aria-label={props.t(item.key)}
            onClick={() => props.set(item.id)}
          />
        )}
      </For>
    </div>
  )
}

function TagPill(props: { tag: Pick<KanbanTag, "name" | "color">; clear?: VoidFunction }) {
  const mark = createMemo(() => tone(props.tag.color))
  return (
    <span
      class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-11-medium"
      style={{
        "background-color": mark()?.soft,
        "border-color": mark()?.line,
        color: mark()?.fill,
      }}
    >
      <Show when={mark()}>
        {(item) => <span class="size-1.5 rounded-full" style={{ "background-color": item().fill }} />}
      </Show>
      <span class="max-w-[160px] truncate">{props.tag.name}</span>
      <Show when={props.clear}>
        <button type="button" class="rounded-full p-0.5 hover:bg-black/5" onClick={() => props.clear?.()}>
          ×
        </button>
      </Show>
    </span>
  )
}

function CardDialog(
  props: {
    save: (ops: Op[]) => Promise<boolean>
    findMentions: (query: string) => Promise<OutlineMention[]>
  } & ({ card: KanbanCard } | { columnID: string }),
) {
  const language = useLanguage()
  const dialog = useDialog()
  const card = () => ("card" in props ? props.card : undefined)
  const [state, setState] = createStore({
    title: card()?.title ?? "",
    titleRefs: card()?.titleRefs ?? ([] as KanbanRef[]),
    description: card()?.description ?? "",
    descriptionRefs: card()?.descriptionRefs ?? refsFromCardDescription(parseCardDescription(card()?.description)),
    color: card()?.color as KanbanColor | undefined,
    tags: (card()?.tags ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color as KanbanColor | undefined,
    })),
  })

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const title = state.title.trim()
    if (!title) return
    const ops: Op[] =
      "card" in props
        ? [
            {
              type: "card.update",
              cardID: props.card.id,
              title,
              titleRefs: state.titleRefs,
              description: state.description,
              descriptionRefs: state.descriptionRefs,
              color: state.color ?? null,
              tags: cleanTags(state.tags),
            },
          ]
        : [
            {
              type: "card.create",
              columnID: props.columnID,
              title,
              titleRefs: state.titleRefs,
              description: state.description,
              descriptionRefs: state.descriptionRefs,
              color: state.color,
              tags: cleanTags(state.tags),
            },
          ]
    void props.save(ops).then((ok) => {
      if (!ok) return
      dialog.close()
    })
  }

  return (
    <Dialog
      title={language.t(card() ? "board.card.edit" : "board.card.new")}
      class="mx-auto w-full max-w-[640px] h-fit min-h-fit"
    >
      <form class="flex flex-col gap-5 p-6 pt-0" onSubmit={submit}>
        <MentionField
          autofocus
          label={language.t("board.card.title")}
          text={state.title}
          refs={state.titleRefs}
          findMentions={props.findMentions}
          placeholder={language.t("board.card.title.placeholder")}
          onChange={(text, refs) => {
            setState("title", text)
            setState("titleRefs", refs)
          }}
        />
        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-text-weak">{language.t("board.card.description")}</div>
          <OutlineEditor
            value={parseCardDescription(state.description)}
            mentions={props.findMentions}
            onChange={(value) => {
              setState("description", formatCardDescription(value) ?? "")
              setState("descriptionRefs", refsFromCardDescription(value))
            }}
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-text-weak">{language.t("board.card.color")}</div>
          <ColorPicker t={language.t} value={state.color} set={(value) => setState("color", value)} />
        </div>

        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-12-medium text-text-weak">{language.t("board.tags")}</div>
            <Button
              type="button"
              variant="ghost"
              size="small"
              icon="plus-small"
              onClick={() =>
                setState("tags", state.tags.length, {
                  name: "",
                  color: undefined,
                })
              }
            >
              {language.t("board.tag.add")}
            </Button>
          </div>

          <Show
            when={state.tags.length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-border-weak-base px-3 py-3 text-12-regular text-text-weak">
                {language.t("board.tag.empty")}
              </div>
            }
          >
            <div class="flex flex-col gap-3">
              <For each={state.tags}>
                {(tag, idx) => (
                  <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
                    <div class="flex items-start gap-2">
                      <div class="min-w-0 flex-1 flex flex-col gap-3">
                        <TextField
                          hideLabel
                          label={language.t("board.tag.name")}
                          value={tag.name}
                          onChange={(value) => setState("tags", idx(), "name", value)}
                          placeholder={language.t("board.tag.name.placeholder")}
                        />
                        <ColorPicker
                          compact
                          t={language.t}
                          value={tag.color as KanbanColor | undefined}
                          set={(value) => setState("tags", idx(), "color", value)}
                        />
                      </div>
                      <IconButton
                        type="button"
                        icon="trash"
                        variant="ghost"
                        size="small"
                        aria-label={language.t("common.delete")}
                        onClick={() => setState("tags", (list) => list.filter((_, index) => index !== idx()))}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" size="large">
            {language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function ColGap(props: { active: Accessor<boolean> }) {
  return (
    <div class="flex h-full w-4 shrink-0 items-stretch justify-center">
      <div
        class="h-full w-2 rounded-full transition-all duration-150"
        style={{
          "background-color": props.active() ? "rgba(59,130,246,0.18)" : "transparent",
          "box-shadow": props.active() ? "inset 0 0 0 2px #3b82f6" : undefined,
        }}
      />
    </div>
  )
}

function CardGap(props: { active: Accessor<boolean>; empty?: boolean; label?: string }) {
  return (
    <div
      class="shrink-0 rounded-lg transition-all duration-150"
      classList={{
        "min-h-0": !props.empty,
        "min-h-20 border border-dashed border-border-weak-base bg-background-stronger/50": !!props.empty,
      }}
      style={{
        "background-color": props.active() ? "rgba(59,130,246,0.14)" : undefined,
        "box-shadow": props.active() ? "inset 0 0 0 2px #3b82f6" : undefined,
      }}
    >
      <Show when={props.empty}>
        <div class="flex min-h-20 items-center justify-center px-3 text-12-regular text-text-weak">{props.label}</div>
      </Show>
    </div>
  )
}

export function BoardView(props: {
  ready: Accessor<boolean>
  board: Accessor<Kanban | undefined>
  title: Accessor<string>
  description: Accessor<string>
  hint: Accessor<string>
  findMentions: (query: string) => Promise<OutlineMention[]>
  actions?: Act[]
  save: (ops: Op[]) => Promise<Kanban | undefined>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({
    busy: false,
    add: false,
    name: "",
    color: undefined as KanbanColor | undefined,
    edit: undefined as string | undefined,
    rename: "",
    renameColor: undefined as KanbanColor | undefined,
    drag: undefined as Drag | undefined,
    over: undefined as Drop | undefined,
    block: 0,
  })
  let root: HTMLDivElement | undefined
  let stop: VoidFunction | undefined

  const list = createMemo(() => props.board()?.columns ?? [])
  const board = createMemo(() => preview(props.board(), state.drag, state.over))

  const release = () => {
    stop?.()
    stop = undefined
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
  }

  onCleanup(release)

  const run = (ops: Op[]) => {
    if (state.busy) return Promise.resolve(false)
    setState("busy", true)
    return props
      .save(ops)
      .then((next) => !!next)
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("board.toast.failed"),
          description: fail(err, language.t("common.requestFailed")),
        })
        return false
      })
      .finally(() => setState("busy", false))
  }

  const clear = () => {
    batch(() => {
      setState("drag", undefined)
      setState("over", undefined)
    })
  }

  const commit = (drag: Drag, over?: Drop) => {
    if (!drag.moved || !over) return
    setState("block", performance.now())

    if (drag.type === "column" && over.type === "column") {
      const index = list().findIndex((item) => item.id === drag.id)
      if (index === -1) return
      const next = index < over.position ? over.position - 1 : over.position
      if (index === next) return
      void run([{ type: "column.move", columnID: drag.id, position: next }])
      return
    }

    if (drag.type === "card" && over.type === "card") {
      const col = list().find((item) => item.id === drag.columnID)
      const index = col?.cards.findIndex((item) => item.id === drag.id) ?? -1
      if (!col || index === -1) return
      const next = drag.columnID === over.columnID && index < over.position ? over.position - 1 : over.position
      if (drag.columnID === over.columnID && next === index) return
      void run([
        {
          type: "card.move",
          cardID: drag.id,
          columnID: over.columnID,
          position: next,
        },
      ])
    }
  }

  const begin = (
    event: PointerEvent,
    next:
      | Omit<Extract<Drag, { type: "column" }>, keyof DragBase>
      | Omit<Extract<Drag, { type: "card" }>, keyof DragBase>,
  ) => {
    if (state.busy) return
    if (event.button !== 0) return
    release()

    const item = (event.currentTarget as HTMLElement).closest(
      next.type === "column" ? "[data-board-column-id]" : "[data-board-card-id]",
    )
    if (!(item instanceof HTMLElement)) return

    const box = item.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    const drag: Drag = {
      ...next,
      start,
      point: start,
      offset: {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      },
      size: {
        w: box.width,
        h: box.height,
      },
      moved: false,
    }

    batch(() => {
      setState("drag", drag)
      setState("over", undefined)
    })

    const move = (e: PointerEvent) => {
      const current = state.drag
      if (!current) return
      const moved = current.moved || dist(current.start, { x: e.clientX, y: e.clientY }) > 4
      const point = { x: e.clientX, y: e.clientY }
      const next = { ...current, point, moved } as Drag

      if (moved) {
        e.preventDefault()
        document.body.style.userSelect = "none"
        document.body.style.cursor = "grabbing"
      }

      setState("drag", next)
      if (!moved || !root) return

      scrollBoard(root, point.x)
      const over = locate(root, next, point)
      if (next.type === "card") {
        scrollColumn(root, over?.type === "card" ? over.columnID : next.columnID, point.y)
      }
      if (!same(state.over, over)) setState("over", over)
    }

    const end = () => {
      const current = state.drag
      const over = state.over
      release()
      clear()
      if (!current) return
      commit(current, over)
    }

    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", end, { passive: true })
    window.addEventListener("pointercancel", end, { passive: true })
    stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }

  const reset = () => {
    batch(() => {
      setState("add", false)
      setState("name", "")
      setState("color", undefined)
      setState("edit", undefined)
      setState("rename", "")
      setState("renameColor", undefined)
    })
  }

  const rename = (col: KanbanColumn, event: SubmitEvent) => {
    event.preventDefault()
    const name = state.rename.trim()
    if (!name) return
    void run([
      {
        type: "column.update",
        columnID: col.id,
        name,
        color: state.renameColor ?? null,
      },
    ]).then((ok) => {
      if (!ok) return
      batch(() => {
        setState("edit", undefined)
        setState("rename", "")
        setState("renameColor", undefined)
      })
    })
  }

  const add = (event: SubmitEvent) => {
    event.preventDefault()
    const name = state.name.trim()
    if (!name) return
    void run([{ type: "column.create", name, color: state.color }]).then((ok) => {
      if (!ok) return
      batch(() => {
        setState("add", false)
        setState("name", "")
        setState("color", undefined)
      })
    })
  }

  const create = (col: KanbanColumn) => {
    if (state.busy) return
    batch(() => {
      setState("edit", undefined)
      setState("add", false)
    })
    dialog.show(() => <CardDialog columnID={col.id} save={run} findMentions={props.findMentions} />)
  }

  const open = (card: KanbanCard) => {
    if (performance.now() - state.block < 180) return
    dialog.show(() => <CardDialog card={card} save={run} findMentions={props.findMentions} />)
  }

  const dropCol = (col: KanbanColumn) => {
    if (list().length <= 1) return
    const index = list().findIndex((item) => item.id === col.id)
    const next = index > 0 ? list()[index - 1] : list()[index + 1]
    void run([
      {
        type: "column.delete",
        columnID: col.id,
        targetColumnID: next?.id,
      },
    ]).then((ok) => {
      if (!ok) return
      if (state.edit === col.id) reset()
    })
  }

  const erase = (card: KanbanCard) => {
    void run([{ type: "card.delete", cardID: card.id }])
  }

  const colView = (id: string) => props.board()?.columns.find((item) => item.id === id)

  const cardView = (id: string) =>
    props
      .board()
      ?.columns.flatMap((col) => col.cards)
      .find((item) => item.id === id)

  return (
    <div class="flex size-full min-h-0 flex-col bg-background-stronger">
      <div class="shrink-0 border-b border-border-weak-base px-5 py-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex max-w-4xl flex-col gap-2">
            <div class="text-20-medium text-text-strong">{props.title()}</div>
            <div class="text-14-regular text-text-base">{props.description()}</div>
            <div class="text-12-regular text-text-weak">{props.hint()}</div>
          </div>
          <Show when={props.actions?.length}>
            <div class="flex flex-wrap gap-2">
              <For each={props.actions}>
                {(action) => (
                  <Button icon={action.icon} size="large" variant="ghost" onClick={action.onClick}>
                    {action.label}
                  </Button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={props.ready() || list().length > 0}
        fallback={
          <div class="flex flex-1 items-center justify-center p-6 text-14-regular text-text-weak">
            {language.t("common.loading")}
          </div>
        }
      >
        <div
          ref={(el) => {
            root = el
          }}
          class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
          data-board-root
        >
          <div class="flex h-full min-w-max items-start gap-2 p-4">
            <ColGap
              active={() => state.drag?.type === "column" && state.over?.type === "column" && state.over.position === 0}
            />

            <For each={board()?.columns ?? []}>
              {(col, idx) => {
                const mark = createMemo(() => tone(col.color))
                const colHidden = createMemo(
                  () => state.drag?.moved && state.drag.type === "column" && state.drag.id === col.id,
                )

                return (
                  <>
                    <div
                      data-board-column-id={col.id}
                      class="flex h-full max-h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border-weak-base bg-background-base shadow-sm"
                      classList={{ "opacity-0": !!colHidden() }}
                    >
                      <Show when={mark()}>
                        {(item) => <div class="h-1.5 w-full" style={{ "background-color": item().fill }} />}
                      </Show>

                      <div class="shrink-0 border-b border-border-weak-base px-3 py-3">
                        <div class="flex items-start gap-2 justify-center">
                          <div class="min-w-0 flex-1">
                            <Show
                              when={state.edit === col.id}
                              fallback={
                                <button
                                  type="button"
                                  class="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-background-stronger cursor-grab active:cursor-grabbing touch-none"
                                  onPointerDown={(event) => begin(event, { type: "column", id: col.id })}
                                >
                                  <Show when={mark()}>
                                    {(item) => (
                                      <span
                                        class="size-2 shrink-0 rounded-full"
                                        style={{ "background-color": item().fill }}
                                      />
                                    )}
                                  </Show>
                                  <div class="min-w-0 flex-1 truncate text-14-medium text-text-strong">{col.name}</div>
                                  <span class="rounded-full bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                                    {col.cards.length}
                                  </span>
                                </button>
                              }
                            >
                              <form class="flex flex-col gap-3" onSubmit={(event) => rename(col, event)}>
                                <TextField
                                  autofocus
                                  hideLabel
                                  label={language.t("board.column.name")}
                                  value={state.rename}
                                  onChange={(value) => setState("rename", value)}
                                />
                                <ColorPicker
                                  compact
                                  t={language.t}
                                  value={state.renameColor}
                                  set={(value) => setState("renameColor", value)}
                                />
                                <div class="flex justify-end gap-1">
                                  <IconButton
                                    type="submit"
                                    icon="check"
                                    variant="ghost"
                                    size="small"
                                    disabled={state.busy}
                                    aria-label={language.t("common.save")}
                                  />
                                  <IconButton
                                    type="button"
                                    icon="close-small"
                                    variant="ghost"
                                    size="small"
                                    aria-label={language.t("common.cancel")}
                                    onClick={() => {
                                      if (state.busy) return
                                      batch(() => {
                                        setState("edit", undefined)
                                        setState("rename", "")
                                        setState("renameColor", undefined)
                                      })
                                    }}
                                  />
                                </div>
                              </form>
                            </Show>
                          </div>

                          <div class="flex shrink-0 items-center gap-1 h-full">
                            <IconButton
                              icon="plus-small"
                              variant="ghost"
                              size="large"
                              disabled={state.busy}
                              aria-label={language.t("board.card.new")}
                              onClick={() => {
                                create(col)
                              }}
                            />
                            <DropdownMenu>
                              <DropdownMenu.Trigger
                                as={IconButton}
                                icon="dot-grid"
                                variant="ghost"
                                size="large"
                                aria-label={language.t("common.moreOptions")}
                              />
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content>
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      if (state.busy) return
                                      batch(() => {
                                        setState("edit", col.id)
                                        setState("rename", col.name)
                                        setState("renameColor", col.color as KanbanColor | undefined)
                                        setState("add", false)
                                      })
                                    }}
                                  >
                                    <DropdownMenu.ItemLabel>{language.t("board.column.edit")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    disabled={state.busy || list().length <= 1}
                                    onSelect={() => dropCol(col)}
                                  >
                                    <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>

                      <div class="flex-1 min-h-0 overflow-y-auto p-3" data-board-column-scroll={col.id}>
                        <div class="flex flex-col gap-2 justify-start">
                          <Show when={col.cards.length === 0}>
                            <CardGap
                              empty
                              label={language.t("board.card.drop")}
                              active={() =>
                                !!(
                                  state.drag?.moved &&
                                  state.drag.type === "card" &&
                                  state.over?.type === "card" &&
                                  state.over.columnID === col.id &&
                                  state.over.position === 0
                                )
                              }
                            />
                          </Show>

                          <For each={col.cards}>
                            {(card, cardIdx) => {
                              const mark = createMemo(() => tone(card.color))
                              const cardHidden = createMemo(
                                () => state.drag?.moved && state.drag.type === "card" && state.drag.id === card.id,
                              )

                              return (
                                <>
                                  <CardGap
                                    active={() =>
                                      !!(
                                        state.drag?.moved &&
                                        state.drag.type === "card" &&
                                        state.over?.type === "card" &&
                                        state.over.columnID === col.id &&
                                        state.over.position === cardIdx()
                                      )
                                    }
                                  />

                                  <div
                                    data-board-card-id={card.id}
                                    data-board-card-column={col.id}
                                    class="rounded-lg border border-border-weak-base bg-background-stronger shadow-sm transition-colors hover:bg-surface-raised-base-hover"
                                    classList={{ "opacity-0": !!cardHidden() }}
                                    style={{
                                      "border-color": mark()?.line,
                                      "box-shadow": mark() ? `inset 3px 0 0 ${mark()!.fill}` : undefined,
                                    }}
                                  >
                                    <div class="flex items-start gap-2 p-3">
                                      <button
                                        type="button"
                                        class="min-w-0 flex-1 cursor-grab active:cursor-grabbing rounded-md text-left touch-none"
                                        onPointerDown={(event) =>
                                          begin(event, { type: "card", id: card.id, columnID: col.id })
                                        }
                                        onClick={() => open(card)}
                                      >
                                        <div class="flex min-w-0 items-center gap-2">
                                          <Show when={mark()}>
                                            {(row) => (
                                              <span
                                                class="size-2 shrink-0 rounded-full"
                                                style={{ "background-color": row().fill }}
                                              />
                                            )}
                                          </Show>
                                          <div class="min-w-0 flex-1 text-14-medium text-text-strong">{card.title}</div>
                                        </div>
                                        <Show when={textFromCardDescription(card.description)}>
                                          <div class="mt-1 line-clamp-3 whitespace-pre-wrap text-12-regular text-text-weak">
                                            {textFromCardDescription(card.description)}
                                          </div>
                                        </Show>
                                        <Show when={card.tags.length > 0}>
                                          <div class="mt-2 flex flex-wrap gap-1.5">
                                            <For each={card.tags}>{(tag) => <TagPill tag={tag} />}</For>
                                          </div>
                                        </Show>
                                      </button>

                                      <DropdownMenu>
                                        <DropdownMenu.Trigger
                                          as={IconButton}
                                          icon="dot-grid"
                                          variant="ghost"
                                          size="small"
                                          aria-label={language.t("common.moreOptions")}
                                          onClick={(event: MouseEvent) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                          }}
                                        />
                                        <DropdownMenu.Portal>
                                          <DropdownMenu.Content>
                                            <DropdownMenu.Item onSelect={() => open(card)}>
                                              <DropdownMenu.ItemLabel>
                                                {language.t("common.edit")}
                                              </DropdownMenu.ItemLabel>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item disabled={state.busy} onSelect={() => erase(card)}>
                                              <DropdownMenu.ItemLabel>
                                                {language.t("common.delete")}
                                              </DropdownMenu.ItemLabel>
                                            </DropdownMenu.Item>
                                          </DropdownMenu.Content>
                                        </DropdownMenu.Portal>
                                      </DropdownMenu>
                                    </div>
                                  </div>

                                  <Show when={cardIdx() === col.cards.length - 1}>
                                    <CardGap
                                      active={() =>
                                        !!(
                                          state.drag?.moved &&
                                          state.drag.type === "card" &&
                                          state.over?.type === "card" &&
                                          state.over.columnID === col.id &&
                                          state.over.position === col.cards.length
                                        )
                                      }
                                    />
                                  </Show>
                                </>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    </div>

                    <ColGap
                      active={() =>
                        !!(
                          state.drag?.moved &&
                          state.drag.type === "column" &&
                          state.over?.type === "column" &&
                          state.over.position === idx() + 1
                        )
                      }
                    />
                  </>
                )
              }}
            </For>

            <div class="w-[320px] shrink-0">
              <Show
                when={state.add}
                fallback={
                  <Button
                    variant="ghost"
                    icon="plus-small"
                    class="w-full justify-start rounded-xl border border-dashed border-border-weak-base bg-background-base px-4 py-4"
                    disabled={state.busy}
                    onClick={() => {
                      if (state.busy) return
                      batch(() => {
                        setState("add", true)
                        setState("name", "")
                        setState("color", undefined)
                        setState("edit", undefined)
                      })
                    }}
                  >
                    {language.t("board.column.new")}
                  </Button>
                }
              >
                <form class="rounded-xl border border-border-weak-base bg-background-base p-3 shadow-sm" onSubmit={add}>
                  <div class="flex flex-col gap-3">
                    <TextField
                      autofocus
                      hideLabel
                      label={language.t("board.column.name")}
                      value={state.name}
                      onChange={(value) => setState("name", value)}
                      placeholder={language.t("board.column.name.placeholder")}
                    />
                    <ColorPicker compact t={language.t} value={state.color} set={(value) => setState("color", value)} />
                    <div class="flex justify-end gap-1">
                      <IconButton
                        type="submit"
                        icon="check"
                        variant="ghost"
                        size="small"
                        disabled={state.busy}
                        aria-label={language.t("common.save")}
                      />
                      <IconButton
                        type="button"
                        icon="close-small"
                        variant="ghost"
                        size="small"
                        aria-label={language.t("common.cancel")}
                        onClick={() => {
                          if (state.busy) return
                          batch(() => {
                            setState("add", false)
                            setState("name", "")
                            setState("color", undefined)
                          })
                        }}
                      />
                    </div>
                  </div>
                </form>
              </Show>
            </div>
          </div>
        </div>

        <Portal>
          <Show when={state.drag?.moved && state.drag} keyed>
            {(drag) => {
              if (drag.type === "column") {
                const col = colView(drag.id)
                const mark = tone(col?.color)
                if (!col) return null
                return (
                  <div
                    class="pointer-events-none fixed z-[200] overflow-hidden rounded-xl border border-border-weak-base bg-background-base shadow-2xl"
                    style={{
                      left: `${drag.point.x - drag.offset.x}px`,
                      top: `${drag.point.y - drag.offset.y}px`,
                      width: `${drag.size.w}px`,
                      transform: "rotate(0.4deg)",
                    }}
                  >
                    <Show when={mark}>
                      {(row) => <div class="h-1.5 w-full" style={{ "background-color": row().fill }} />}
                    </Show>
                    <div class="p-4">
                      <div class="flex items-center gap-2">
                        <Show when={mark}>
                          {(row) => (
                            <span class="size-2 shrink-0 rounded-full" style={{ "background-color": row().fill }} />
                          )}
                        </Show>
                        <div class="min-w-0 flex-1 truncate text-14-medium text-text-strong">{col.name}</div>
                        <span class="rounded-full bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                          {col.cards.length}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              }

              const card = cardView(drag.id)
              const mark = tone(card?.color)
              if (!card) return null
              return (
                <div
                  class="pointer-events-none fixed z-[200] rounded-lg border border-border-weak-base bg-background-stronger shadow-2xl"
                  style={{
                    left: `${drag.point.x - drag.offset.x}px`,
                    top: `${drag.point.y - drag.offset.y}px`,
                    width: `${drag.size.w}px`,
                    transform: "rotate(0.8deg)",
                    "border-color": mark?.line,
                    "box-shadow": mark ? `0 18px 60px rgba(15,23,42,0.22), inset 3px 0 0 ${mark.fill}` : undefined,
                  }}
                >
                  <div class="p-3">
                    <div class="flex items-center gap-2">
                      <Show when={mark}>
                        {(row) => (
                          <span class="size-2 shrink-0 rounded-full" style={{ "background-color": row().fill }} />
                        )}
                      </Show>
                      <div class="min-w-0 flex-1 text-14-medium text-text-strong">{card.title}</div>
                    </div>
                    <Show when={textFromCardDescription(card.description)}>
                      <div class="mt-1 line-clamp-3 whitespace-pre-wrap text-12-regular text-text-weak">
                        {textFromCardDescription(card.description)}
                      </div>
                    </Show>
                    <Show when={card.tags.length > 0}>
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        <For each={card.tags}>{(tag) => <TagPill tag={tag} />}</For>
                      </div>
                    </Show>
                  </div>
                </div>
              )
            }}
          </Show>
        </Portal>
      </Show>
    </div>
  )
}
