import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { TextField } from "@opencode-ai/ui/text-field"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { OutlineEditor } from "./editor"
import type { OutlineMention } from "./mentions"
import type {
  OutlineCollection,
  OutlineDocument,
  OutlineNode,
  OutlineScope,
  OutlineSearchHit,
  OutlineTreeNode,
  OutlineWorkspaceSnapshot,
} from "@opencode-ai/outline-core"

export type OutlinePanelApi = {
  snapshot: () => Promise<OutlineWorkspaceSnapshot>
  document_get: (input: { scope: OutlineScope; document_id: string }) => Promise<OutlineDocument>
  collection_create: (input: { scope: OutlineScope; title: string; description?: string }) => Promise<unknown>
  collection_update: (input: {
    scope: OutlineScope
    collection_id: string
    title?: string
    description?: string
  }) => Promise<unknown>
  collection_archive: (input: { scope: OutlineScope; collection_id: string; archived?: boolean }) => Promise<unknown>
  collection_delete: (input: { scope: OutlineScope; collection_id: string }) => Promise<unknown>
  document_create: (input: {
    scope: OutlineScope
    collection_id: string
    parent_document_id?: string
    title?: string
    content?: OutlineNode
  }) => Promise<OutlineDocument>
  document_update: (input: {
    scope: OutlineScope
    document_id: string
    title?: string
    content?: OutlineNode
  }) => Promise<OutlineDocument>
  document_move: (input: {
    scope: OutlineScope
    document_id: string
    collection_id?: string
    parent_document_id?: string | null
    index?: number
  }) => Promise<unknown>
  document_archive: (input: { scope: OutlineScope; document_id: string; archived?: boolean }) => Promise<unknown>
  document_delete: (input: { scope: OutlineScope; document_id: string }) => Promise<unknown>
  search: (input: { scope: OutlineScope; query: string }) => Promise<OutlineSearchHit[]>
  mentions: (query: string) => Promise<OutlineMention[]>
}

type Picked = {
  scope: OutlineScope
  document_id: string
}

const flat = (item: OutlineTreeNode): OutlineTreeNode[] => [item, ...item.children.flatMap(flat)]

const first = (snap: OutlineWorkspaceSnapshot): Picked | undefined => {
  const project = snap.project.collections.flatMap((item) => item.tree.flatMap(flat))
  if (project[0]) return { scope: "project", document_id: project[0].id }
  const global = snap.global.collections.flatMap((item) => item.tree.flatMap(flat))
  if (global[0]) return { scope: "global", document_id: global[0].id }
}

const findCollection = (snap: OutlineWorkspaceSnapshot | undefined, scope: OutlineScope, document_id: string) => {
  const list = scope === "global" ? snap?.global.collections : snap?.project.collections
  return list?.find((item) => item.tree.flatMap(flat).some((node) => node.id === document_id))
}

export function OutlinePanel(props: { api: OutlinePanelApi; width: number }) {
  const [snap, setSnap] = createSignal<OutlineWorkspaceSnapshot>()
  const [doc, setDoc] = createSignal<OutlineDocument>()
  const [pick, setPick] = createSignal<Picked>()
  const [query, setQuery] = createSignal("")
  const [hits, setHits] = createSignal<OutlineSearchHit[]>([])
  const [tree, setTree] = createSignal(true)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [err, setErr] = createSignal<string>()
  const [cols, setCols] = createSignal(new Set<string>())
  const [docs, setDocs] = createSignal(new Set<string>())
  const dialog = useDialog()
  const compact = createMemo(() => props.width < 560)
  const currentCollection = createMemo(() => {
    const item = pick()
    if (!item) return
    return findCollection(snap(), item.scope, item.document_id)
  })

  const key = (scope: OutlineScope, id: string) => `${scope}:${id}`

  const colOpen = (scope: OutlineScope, id: string) => !cols().has(key(scope, id))

  const docOpen = (scope: OutlineScope, id: string) => !docs().has(key(scope, id))

  const toggleCol = (scope: OutlineScope, id: string) => {
    const item = key(scope, id)
    setCols((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  const toggleDoc = (scope: OutlineScope, id: string) => {
    const item = key(scope, id)
    setDocs((prev) => {
      const next = new Set(prev)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const load = async (next?: Picked) => {
    setLoading(true)
    setErr(undefined)
    const data = await props.api.snapshot()
    setSnap(data)
    const item = next ?? pick() ?? first(data)
    setPick(item)
    if (!item) {
      setDoc(undefined)
      setLoading(false)
      return
    }
    setDoc(await props.api.document_get(item))
    setLoading(false)
  }

  const open = async (item: Picked) => {
    setErr(undefined)
    setPick(item)
    setDoc(await props.api.document_get(item))
    if (compact()) setTree(false)
  }

  const refresh = async () => {
    const data = await props.api.snapshot()
    setSnap(data)
  }

  const save = (title: string, content: OutlineNode) => {
    const item = pick()
    if (!item) return
    if (saveTimer) clearTimeout(saveTimer)
    setSaving(true)
    saveTimer = setTimeout(() => {
      void props.api
        .document_update({
          scope: item.scope,
          document_id: item.document_id,
          title,
          content,
        })
        .then((value) => {
          setDoc(value)
          return refresh()
        })
        .catch((cause: unknown) => setErr(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false))
    }, 500)
  }

  const makeCollection = async (scope: OutlineScope) => {
    await props.api.collection_create({
      scope,
      title: "Untitled Collection",
    })
    await refresh()
  }

  const makeDocument = async (scope: OutlineScope, collection_id?: string, parent_document_id?: string) => {
    const col =
      collection_id || (scope === "global" ? snap()?.global.collections[0]?.id : snap()?.project.collections[0]?.id)
    if (!col) {
      await makeCollection(scope)
      return makeDocument(
        scope,
        scope === "global" ? snap()?.global.collections[0]?.id : snap()?.project.collections[0]?.id,
      )
    }
    const value = await props.api.document_create({
      scope,
      collection_id: col,
      parent_document_id,
      title: "Untitled",
    })
    await load({
      scope,
      document_id: value.meta.id,
    })
  }

  const fail = (cause: unknown) => {
    setErr(cause instanceof Error ? cause.message : String(cause))
  }

  const renameCollection = (scope: OutlineScope, item: OutlineCollection, title: string) => {
    const next = title.trim()
    if (!next || next === item.title) return
    return props.api
      .collection_update({
        scope,
        collection_id: item.id,
        title: next,
      })
      .then(refresh)
      .catch(fail)
  }

  const renameDocument = (scope: OutlineScope, document_id: string, title: string) => {
    const next = title.trim()
    if (!next) return
    return props.api
      .document_update({
        scope,
        document_id,
        title: next,
      })
      .then((value) => {
        setDoc((prev) => {
          if (!prev || prev.meta.id !== document_id) return prev
          return {
            ...prev,
            meta: value.meta,
          }
        })
        return refresh()
      })
      .catch(fail)
  }

  const archiveCollection = async (scope: OutlineScope, item: OutlineCollection) => {
    await props.api.collection_archive({
      scope,
      collection_id: item.id,
    })
    await refresh()
  }

  const dropCollection = async (scope: OutlineScope, item: OutlineCollection) => {
    await props.api.collection_delete({
      scope,
      collection_id: item.id,
    })
    const current = pick()
    const opened =
      current && current.scope === scope && item.tree.flatMap(flat).some((node) => node.id === current.document_id)
    if (!opened) {
      await refresh()
      return
    }
    setDoc(undefined)
    setPick(undefined)
    await load()
  }

  const archiveDocument = async () => {
    const item = pick()
    if (!item) return
    await props.api.document_archive({
      scope: item.scope,
      document_id: item.document_id,
    })
    setDoc(undefined)
    setPick(undefined)
    await load()
  }

  const dropDocument = async (scope: OutlineScope, document_id: string) => {
    await props.api.document_delete({
      scope,
      document_id,
    })
    const current = pick()
    const opened = current && current.scope === scope && current.document_id === document_id
    if (!opened) {
      await refresh()
      return
    }
    setDoc(undefined)
    setPick(undefined)
    await load()
  }

  const confirmCollectionDelete = (scope: OutlineScope, item: OutlineCollection) => {
    dialog.show(() => <DialogDeleteCollection scope={scope} item={item} />)
  }

  const confirmDocumentDelete = (scope: OutlineScope, document_id: string, title: string) => {
    dialog.show(() => <DialogDeleteDocument scope={scope} document_id={document_id} title={title} />)
  }

  const confirmCurrentDocumentDelete = () => {
    const item = pick()
    if (!item) return
    confirmDocumentDelete(item.scope, item.document_id, doc()?.meta.title || "Untitled")
  }

  const clearSearch = () => {
    setQuery("")
    setHits([])
  }

  const openHit = (document_id: string) => {
    const scope = pick()?.scope ?? "project"
    void open({ scope, document_id }).then(clearSearch).catch(fail)
  }

  function DialogDeleteCollection(props: { scope: OutlineScope; item: OutlineCollection }) {
    return (
      <Dialog title="Delete collection" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">Delete "{props.item.title}" and all notes inside it?</span>
            <Show when={props.item.count > 0}>
              <span class="text-12-regular text-text-weak">
                This collection has {props.item.count} {props.item.count === 1 ? "note" : "notes"}. This action cannot
                be undone.
              </span>
            </Show>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                void dropCollection(props.scope, props.item)
                  .then(() => dialog.close())
                  .catch(fail)
              }}
            >
              Delete collection
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogDeleteDocument(props: { scope: OutlineScope; document_id: string; title: string }) {
    return (
      <Dialog title="Delete note" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">Delete "{props.title}"?</span>
            <span class="text-12-regular text-text-weak">This action cannot be undone.</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                void dropDocument(props.scope, props.document_id)
                  .then(() => dialog.close())
                  .catch(fail)
              }}
            >
              Delete note
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  createEffect(() => {
    const value = query().trim()
    const item = pick()
    if (searchTimer) clearTimeout(searchTimer)
    if (!value || !item) {
      setHits([])
      return
    }
    searchTimer = setTimeout(() => {
      void props.api
        .search({
          scope: item.scope,
          query: value,
        })
        .then(setHits)
    }, 200)
  })

  createEffect(() => {
    if (!compact()) setTree(true)
  })

  onMount(() => {
    void load()
  })

  onCleanup(() => {
    if (searchTimer) clearTimeout(searchTimer)
    if (saveTimer) clearTimeout(saveTimer)
  })

  return (
    <div class="size-full min-w-0 bg-background-base text-text-strong">
      <div class="flex h-full min-w-0">
        <Show when={!compact() || tree()}>
          <div class="flex h-full w-[260px] shrink-0 flex-col border-r border-border-weaker-base bg-background-base">
            <div class="border-b border-border-weaker-base p-3">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-12-medium uppercase tracking-[0.16em] text-text-weaker">Outline</div>
                <Button variant="ghost" class="h-7 px-2" onClick={refresh}>
                  Refresh
                </Button>
              </div>
              <TextField
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search notes"
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    clearSearch()
                    return
                  }
                  if (event.key !== "Enter") return
                  const item = hits()[0]
                  if (!item) return
                  event.preventDefault()
                  openHit(item.id)
                }}
              />
            </div>
            <div class="relative min-h-0 flex-1 overflow-hidden">
              <div class="h-full overflow-auto p-2">
                <SpaceTree
                  title="Global"
                  scope="global"
                  list={() => snap()?.global.collections ?? []}
                  pick={pick}
                  onOpen={open}
                  onAddCollection={makeCollection}
                  onAddDocument={makeDocument}
                  onRenameCollection={renameCollection}
                  onRenameDocument={renameDocument}
                  onArchiveCollection={archiveCollection}
                  onDeleteCollection={confirmCollectionDelete}
                  onDeleteDocument={confirmDocumentDelete}
                  colOpen={colOpen}
                  toggleCol={toggleCol}
                  docOpen={docOpen}
                  toggleDoc={toggleDoc}
                />
                <SpaceTree
                  title="Current Project"
                  scope="project"
                  list={() => snap()?.project.collections ?? []}
                  pick={pick}
                  onOpen={open}
                  onAddCollection={makeCollection}
                  onAddDocument={makeDocument}
                  onRenameCollection={renameCollection}
                  onRenameDocument={renameDocument}
                  onArchiveCollection={archiveCollection}
                  onDeleteCollection={confirmCollectionDelete}
                  onDeleteDocument={confirmDocumentDelete}
                  colOpen={colOpen}
                  toggleCol={toggleCol}
                  docOpen={docOpen}
                  toggleDoc={toggleDoc}
                />
              </div>
              <Show when={query().trim().length > 0}>
                <div class="absolute inset-0 z-20 border-t border-border-weaker-base bg-background-base/95 backdrop-blur-sm">
                  <div class="flex h-full flex-col p-2">
                    <div class="mb-2 flex items-center justify-between px-1">
                      <div class="text-11-medium uppercase tracking-[0.14em] text-text-weaker">Search Notes</div>
                      <IconButton
                        icon="close"
                        variant="ghost"
                        class="size-7"
                        onClick={clearSearch}
                        aria-label="Close search"
                      />
                    </div>
                    <div class="min-h-0 overflow-auto rounded-lg border border-border-weak-base bg-surface-panel p-1">
                      <Switch>
                        <Match when={hits().length > 0}>
                          <div class="flex flex-col gap-1">
                            <For each={hits()}>
                              {(item) => (
                                <button
                                  type="button"
                                  class="rounded-md px-2 py-1.5 text-left hover:bg-surface-raised-base"
                                  onClick={() => openHit(item.id)}
                                >
                                  <div class="text-12-medium text-text-strong">{item.title}</div>
                                  <div class="text-11-regular text-text-weak truncate">
                                    {item.breadcrumbs.join(" / ")}
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </Match>
                        <Match when={true}>
                          <div class="px-2 py-3 text-12-regular text-text-weak">
                            No notes found for "{query().trim()}"
                          </div>
                        </Match>
                      </Switch>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <div class="min-w-0 flex-1">
          <Switch>
            <Match when={loading()}>
              <div class="flex h-full items-center justify-center text-text-weak">Loading Outline...</div>
            </Match>
            <Match when={doc()}>
              {(value) => (
                <div class="flex h-full min-w-0 flex-col">
                  <div class="border-b border-border-weaker-base p-3">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <Show when={compact()}>
                          <IconButton
                            icon="chevron-left"
                            variant="ghost"
                            class="size-7"
                            onClick={() => setTree(true)}
                            aria-label="Back"
                          />
                        </Show>
                        <div>
                          <div class="text-12-medium text-text-weaker">
                            {pick()?.scope === "global" ? "Global" : "Current Project"}
                          </div>
                          <div class="text-11-regular text-text-weaker">{currentCollection()?.title}</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          class="h-8 px-2"
                          onClick={() => makeDocument(pick()!.scope, currentCollection()?.id, value().meta.id)}
                        >
                          Child
                        </Button>
                        <IconButton
                          icon="archive"
                          variant="ghost"
                          class="size-8"
                          onClick={archiveDocument}
                          aria-label="Archive"
                        />
                        <IconButton
                          icon="trash"
                          variant="ghost"
                          class="size-8"
                          onClick={confirmCurrentDocumentDelete}
                          aria-label="Delete"
                        />
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <TextField
                        value={value().meta.title}
                        onInput={(event) => {
                          const title = event.currentTarget.value
                          const content = doc()?.content || value().content
                          setDoc((prev) => (prev ? { ...prev, meta: { ...prev.meta, title } } : prev))
                          save(title, content)
                        }}
                        class="text-16-medium"
                        placeholder="Note title"
                      />
                      <div class="min-w-[72px] text-right text-11-regular text-text-weaker">
                        {saving() ? "Saving..." : "Saved"}
                      </div>
                    </div>
                  </div>
                  <div class="min-h-0 flex-1 overflow-hidden p-3">
                    <Show when={err()}>
                      {(item) => <div class="mb-2 text-12-regular text-text-danger">{item()}</div>}
                    </Show>
                    <Show when={doc()?.meta.id} keyed>
                      {(_) => (
                        <OutlineEditor
                          value={doc()?.content}
                          mentions={props.api.mentions}
                          onChange={(content) => {
                            const title = doc()?.meta.title || value().meta.title
                            setDoc((prev) => (prev ? { ...prev, content } : prev))
                            save(title, content)
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              )}
            </Match>
            <Match when={true}>
              <div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <div class="text-15-medium text-text-strong">No note selected</div>
                <div class="max-w-[320px] text-12-regular text-text-weak">
                  Create a collection and start writing project or global notes inside OpenCode.
                </div>
                <div class="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => makeCollection("project")}>
                    New Project Collection
                  </Button>
                  <Button variant="ghost" onClick={() => makeCollection("global")}>
                    New Global Collection
                  </Button>
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}

function SpaceTree(props: {
  title: string
  scope: OutlineScope
  list: () => OutlineCollection[]
  pick: () => Picked | undefined
  onOpen: (input: Picked) => Promise<void>
  onAddCollection: (scope: OutlineScope) => Promise<void>
  onAddDocument: (scope: OutlineScope, collection_id?: string, parent_document_id?: string) => Promise<void>
  onRenameCollection: (scope: OutlineScope, item: OutlineCollection, title: string) => Promise<void> | void
  onRenameDocument: (scope: OutlineScope, document_id: string, title: string) => Promise<void> | void
  onArchiveCollection: (scope: OutlineScope, item: OutlineCollection) => Promise<void>
  onDeleteCollection: (scope: OutlineScope, item: OutlineCollection) => Promise<void> | void
  onDeleteDocument: (scope: OutlineScope, document_id: string, title: string) => Promise<void> | void
  colOpen: (scope: OutlineScope, id: string) => boolean
  toggleCol: (scope: OutlineScope, id: string) => void
  docOpen: (scope: OutlineScope, id: string) => boolean
  toggleDoc: (scope: OutlineScope, id: string) => void
}) {
  return (
    <div class="mb-4">
      <div class="mb-2 flex items-center justify-between px-1">
        <div class="text-11-medium uppercase tracking-[0.14em] text-text-weaker">{props.title}</div>
        <IconButton
          icon="plus-small"
          variant="ghost"
          class="size-7"
          onClick={() => props.onAddCollection(props.scope)}
          aria-label={`Add ${props.title} collection`}
        />
      </div>
      <div class="flex flex-col gap-1">
        <For each={props.list()}>
          {(item) => {
            const [edit, setEdit] = createSignal(false)
            const [name, setName] = createSignal(item.title)
            let input: HTMLInputElement | undefined

            const open = () => {
              setName(item.title)
              setEdit(true)
              requestAnimationFrame(() => {
                input?.focus()
                input?.select()
              })
            }

            const save = () => {
              if (!edit()) return
              const next = name().trim()
              setEdit(false)
              if (!next || next === item.title) {
                setName(item.title)
                return
              }
              void props.onRenameCollection(props.scope, item, next)
            }

            const opened = () => props.colOpen(props.scope, item.id)

            return (
              <>
                <div class="group relative mb-1 flex items-center">
                  <Show
                    when={edit()}
                    fallback={
                      <div
                        role="button"
                        tabIndex={0}
                        class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-raised-base"
                        onClick={() => props.toggleCol(props.scope, item.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          props.toggleCol(props.scope, item.id)
                        }}
                        onDblClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          open()
                        }}
                      >
                        <Icon name={opened() ? "folder-open" : "folder"} size="small" />
                        <span class="truncate text-12-medium">{item.title}</span>
                      </div>
                    }
                  >
                    <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2 py-1">
                      <Icon name={opened() ? "folder-open" : "folder"} size="small" />
                      <InlineInput
                        ref={input}
                        value={name()}
                        class="w-full bg-transparent text-12-medium text-text-strong outline-none"
                        onInput={(event) => setName(event.currentTarget.value)}
                        onBlur={save}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            save()
                            return
                          }
                          if (event.key !== "Escape") return
                          event.preventDefault()
                          setName(item.title)
                          setEdit(false)
                        }}
                      />
                    </div>
                  </Show>
                  <div class="absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      class="size-7"
                      onClick={() => props.onAddDocument(props.scope, item.id)}
                      aria-label="Add note"
                    />
                    <IconButton
                      icon="archive"
                      variant="ghost"
                      class="size-7"
                      onClick={() => props.onArchiveCollection(props.scope, item)}
                      aria-label="Archive collection"
                    />
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      class="size-7"
                      onClick={() => props.onDeleteCollection(props.scope, item)}
                      aria-label="Delete collection"
                    />
                  </div>
                </div>
                <Show when={opened()}>
                  <div class="space-y-0.5">
                    <For each={item.tree}>
                      {(node) => (
                        <DocTree
                          item={node}
                          level={0}
                          scope={props.scope}
                          pick={props.pick}
                          onOpen={props.onOpen}
                          onAddDocument={props.onAddDocument}
                          onRenameDocument={props.onRenameDocument}
                          onDeleteDocument={props.onDeleteDocument}
                          docOpen={props.docOpen}
                          toggleDoc={props.toggleDoc}
                        />
                      )}
                    </For>
                    <Show when={item.tree.length === 0}>
                      <button
                        type="button"
                        class="w-full rounded-md px-2 py-1.5 text-left text-12-regular text-text-weak hover:bg-surface-raised-base"
                        onClick={() => props.onAddDocument(props.scope, item.id)}
                      >
                        Create the first note
                      </button>
                    </Show>
                  </div>
                </Show>
              </>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function DocTree(props: {
  item: OutlineTreeNode
  level: number
  scope: OutlineScope
  pick: () => Picked | undefined
  onOpen: (input: Picked) => Promise<void>
  onAddDocument: (scope: OutlineScope, collection_id?: string, parent_document_id?: string) => Promise<void>
  onRenameDocument: (scope: OutlineScope, document_id: string, title: string) => Promise<void> | void
  onDeleteDocument: (scope: OutlineScope, document_id: string, title: string) => Promise<void> | void
  docOpen: (scope: OutlineScope, id: string) => boolean
  toggleDoc: (scope: OutlineScope, id: string) => void
}) {
  const active = () => props.pick()?.document_id === props.item.id && props.pick()?.scope === props.scope
  const opened = () => props.docOpen(props.scope, props.item.id)
  const has = () => props.item.children.length > 0
  const [edit, setEdit] = createSignal(false)
  const [name, setName] = createSignal(props.item.title)
  let input: HTMLInputElement | undefined

  const open = () => {
    setName(props.item.title)
    setEdit(true)
    requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }

  const save = () => {
    if (!edit()) return
    const next = name().trim()
    setEdit(false)
    if (!next || next === props.item.title) {
      setName(props.item.title)
      return
    }
    void props.onRenameDocument(props.scope, props.item.id, next)
  }

  return (
    <div>
      <div class="group relative flex items-center">
        <Show
          when={edit()}
          fallback={
            <div
              role="button"
              tabIndex={0}
              class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-raised-base"
              classList={{ "bg-surface-raised-base": active() }}
              style={{ "padding-left": `${8 + props.level * 14}px` }}
              onClick={() => props.onOpen({ scope: props.scope, document_id: props.item.id })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                void props.onOpen({ scope: props.scope, document_id: props.item.id })
              }}
              onDblClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                open()
              }}
            >
              <Show when={has()} fallback={<span class="size-5 shrink-0" />}>
                <button
                  type="button"
                  class="size-5 shrink-0 rounded hover:bg-surface-raised-base"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    props.toggleDoc(props.scope, props.item.id)
                  }}
                  aria-label={opened() ? "Collapse note" : "Expand note"}
                >
                  <Icon name={opened() ? "chevron-down" : "chevron-right"} size="small" />
                </button>
              </Show>
              <Icon name="task" size="small" />
              <span class="truncate text-12-regular">{props.item.title}</span>
            </div>
          }
        >
          <div
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2 py-1"
            style={{ "margin-left": `${8 + props.level * 14}px` }}
          >
            <Show when={has()} fallback={<span class="size-5 shrink-0" />}>
              <button
                type="button"
                class="size-5 shrink-0 rounded hover:bg-surface-raised-base"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  props.toggleDoc(props.scope, props.item.id)
                }}
                aria-label={opened() ? "Collapse note" : "Expand note"}
              >
                <Icon name={opened() ? "chevron-down" : "chevron-right"} size="small" />
              </button>
            </Show>
            <Icon name="task" size="small" />
            <InlineInput
              ref={input}
              value={name()}
              class="w-full bg-transparent text-12-regular text-text-strong outline-none"
              onInput={(event) => setName(event.currentTarget.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  save()
                  return
                }
                if (event.key !== "Escape") return
                event.preventDefault()
                setName(props.item.title)
                setEdit(false)
              }}
            />
          </div>
        </Show>
        <div class="absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
          <IconButton
            icon="plus-small"
            variant="ghost"
            class="size-7"
            onClick={() => props.onAddDocument(props.scope, props.item.collection_id, props.item.id)}
            aria-label="Add child note"
          />
          <IconButton
            icon="trash"
            variant="ghost"
            class="size-7"
            onClick={() => props.onDeleteDocument(props.scope, props.item.id, props.item.title)}
            aria-label="Delete note"
          />
        </div>
      </div>
      <Show when={!has() || opened()}>
        <For each={props.item.children}>
          {(item) => (
            <DocTree
              item={item}
              level={props.level + 1}
              scope={props.scope}
              pick={props.pick}
              onOpen={props.onOpen}
              onAddDocument={props.onAddDocument}
              onRenameDocument={props.onRenameDocument}
              onDeleteDocument={props.onDeleteDocument}
              docOpen={props.docOpen}
              toggleDoc={props.toggleDoc}
            />
          )}
        </For>
      </Show>
    </div>
  )
}
