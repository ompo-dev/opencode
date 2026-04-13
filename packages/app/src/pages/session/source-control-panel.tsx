import type { VcsChange, VcsCommit } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { DateTime } from "luxon"
import { createEffect, createMemo, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

function fail(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return fallback
}

function stamp(at: number) {
  const time = DateTime.fromSeconds(at)
  return time.toRelative() ?? time.toFormat("dd LLL yyyy HH:mm")
}

function badge(item: VcsChange) {
  if (item.untracked) return "U"
  if (item.status === "added") return "A"
  if (item.status === "deleted") return "D"
  if (item.status === "unmerged") return "!"
  return "M"
}

function tone(item: VcsChange) {
  if (item.untracked || item.status === "added") return "text-icon-diff-add-base"
  if (item.status === "deleted") return "text-icon-diff-delete-base"
  if (item.status === "unmerged") return "text-icon-critical-base"
  return "text-icon-diff-modified-base"
}

function unique(list: string[]) {
  return [...new Set(list)].filter(Boolean)
}

function Count(props: { value: number }) {
  return (
    <span class="rounded-full bg-background-stronger px-2 py-0.5 text-[10px] font-medium text-text-weak">
      {props.value}
    </span>
  )
}

function Empty(props: { text: string }) {
  return <div class="px-3 py-3 text-12-regular text-text-weak">{props.text}</div>
}

export function SessionSourceControlPanel(props: {
  active: () => boolean
  nogit: () => boolean
  createGit?: JSX.Element
  actions?: JSX.Element
  onChanged: VoidFunction
  onFocusInput: VoidFunction
  onReveal: (path: string) => void
}) {
  const language = useLanguage()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const [store, setStore] = createStore({
    open: {
      staged: true,
      changes: true,
      review: true,
      graph: true,
    },
    message: "",
    changes: [] as VcsChange[],
    history: [] as VcsCommit[],
    loading: false,
    busy: false,
    error: "",
  })

  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const branch = createMemo(() => sync.data.vcs?.branch)
  const base = createMemo(() => sync.data.vcs?.default_branch)
  const staged = createMemo(() => store.changes.filter((item) => item.staged))
  const changed = createMemo(() => store.changes.filter((item) => item.unstaged || item.untracked))
  const reviewFiles = createMemo(() => {
    const list = staged().length > 0 ? staged().map((item) => item.path) : store.changes.map((item) => item.path)
    return unique(list)
  })

  const load = async () => {
    const id = ++seq
    setStore("loading", true)
    setStore("error", "")

    try {
      const [status, history] = await Promise.all([sdk.client.vcs.status(), sdk.client.vcs.history({ limit: 40 })])
      if (id !== seq) return
      setStore("changes", status.data ?? [])
      setStore("history", history.data ?? [])
    } catch (err) {
      if (id !== seq) return
      setStore("error", fail(err, language.t("common.requestFailed")))
    } finally {
      if (id !== seq) return
      setStore("loading", false)
    }
  }

  const refresh = () => {
    if (!props.active()) return
    if (props.nogit()) return
    void load()
  }

  const queue = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      refresh()
    }, 150)
  }

  const add = (input: string[]) => {
    const list = unique(input)
    if (list.length === 0) return

    list.forEach((path) => {
      prompt.context.add({ type: "file", path })
    })
    props.onFocusInput()
    showToast({
      variant: "success",
      title: list.length === 1 ? "Added file to chat" : `Added ${list.length} files to chat`,
    })
  }

  const act = async (kind: "stage" | "unstage" | "discard" | "commit", paths?: string[]) => {
    if (store.busy) return
    setStore("busy", true)

    try {
      if (kind === "commit") {
        const value = store.message.trim()
        if (!value) return
        const result = await sdk.client.vcs.commit({ message: value })
        setStore("message", "")
        showToast({
          variant: "success",
          title: result.data?.short ? `Committed ${result.data.short}` : "Commit created",
        })
      }

      if (kind !== "commit") {
        const result =
          kind === "stage"
            ? await sdk.client.vcs.stage({ paths })
            : kind === "unstage"
              ? await sdk.client.vcs.unstage({ paths })
              : await sdk.client.vcs.discard({ paths })
        setStore("changes", result.data ?? [])
      }

      props.onChanged()
      await load()
    } catch (err) {
      showToast({
        variant: "error",
        title: kind === "commit" ? "Commit failed" : "Git action failed",
        description: fail(err, language.t("common.requestFailed")),
      })
    } finally {
      setStore("busy", false)
    }
  }

  const discard = (paths?: string[]) => {
    const count = paths?.length ?? store.changes.length
    if (count === 0) return
    if (!confirm(count === 1 ? "Discard this change?" : `Discard ${count} changes?`)) return
    void act("discard", paths)
  }

  const review = () => {
    const list = reviewFiles()
    if (list.length === 0) return
    add(list)

    const text = `Review ${staged().length > 0 ? "staged" : "current"} changes and find issues.`
    if (!prompt.dirty()) {
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    }
  }

  createEffect(
    on(
      () => [props.active(), props.nogit(), sdk.directory] as const,
      ([active, nogit]) => {
        if (!active || nogit) return
        void load()
      },
    ),
  )

  const stop = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated" && evt.details.type !== "vcs.branch.updated") return
    queue()
  })

  onCleanup(() => {
    stop()
    if (timer) clearTimeout(timer)
  })

  const fileRow = (item: VcsChange, kind: "staged" | "changed") => (
    <div class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised-base-hover">
      <FileIcon node={{ path: item.path, type: "file" }} class="size-4 shrink-0" />
      <button type="button" class="min-w-0 flex-1 text-left" onClick={() => props.onReveal(item.path)}>
        <div class="truncate text-12-medium text-text-strong">{getFilename(item.path)}</div>
        <Show when={getDirectory(item.path)}>
          {(dir) => <div class="truncate text-[11px] text-text-weak">{dir()}</div>}
        </Show>
      </button>
      <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Show
          when={kind === "staged"}
          fallback={
            <Button
              variant="ghost"
              size="small"
              class="h-6 px-2 text-11-medium"
              onClick={() => void act("stage", [item.path])}
            >
              Stage
            </Button>
          }
        >
          <Button
            variant="ghost"
            size="small"
            class="h-6 px-2 text-11-medium"
            onClick={() => void act("unstage", [item.path])}
          >
            Unstage
          </Button>
        </Show>
        <Show when={kind === "changed"}>
          <Button variant="ghost" size="small" class="h-6 px-2 text-11-medium" onClick={() => discard([item.path])}>
            Discard
          </Button>
        </Show>
        <Button variant="ghost" size="small" class="h-6 px-2 text-11-medium" onClick={() => add([item.path])}>
          Chat
        </Button>
      </div>
      <div class={`w-4 shrink-0 text-right text-12-medium ${tone(item)}`}>{badge(item)}</div>
    </div>
  )

  const section = (input: {
    key: "staged" | "changes" | "review" | "graph"
    title: string
    count?: number
    body: JSX.Element
  }) => (
    <Collapsible
      variant="ghost"
      open={store.open[input.key]}
      onOpenChange={(open) => setStore("open", input.key, open)}
      class="border-b border-border-weaker-base"
    >
      <Collapsible.Trigger class="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-raised-base-hover">
        <div class="flex min-w-0 items-center gap-1.5">
          <Collapsible.Arrow />
          <div class="truncate text-12-medium text-text-strong">{input.title}</div>
        </div>
        <Show when={input.count !== undefined}>{input.count !== undefined ? <Count value={input.count} /> : null}</Show>
      </Collapsible.Trigger>
      <Collapsible.Content>{input.body}</Collapsible.Content>
    </Collapsible>
  )

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background-stronger contain-strict">
      <div class="flex items-center justify-between gap-3 border-b border-border-weaker-base px-3 py-2">
        <div class="min-w-0 flex items-center gap-2">
          <div class="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-panel">
            <Show
              when={store.loading}
              fallback={
                <div class="text-icon-weak">
                  <span class="text-12-medium">{branch() ? "*" : "-"}</span>
                </div>
              }
            >
              <Spinner class="size-3.5" />
            </Show>
          </div>
          <div class="min-w-0">
            <div class="text-14-medium text-text-strong">Source Control</div>
            <div class="truncate text-12-regular text-text-weak">
              {branch() ?? "Detached HEAD"}
              <Show when={base() && base() !== branch()}>{(value) => <span>{` vs ${value()}`}</span>}</Show>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1">{props.actions}</div>
      </div>

      <Show
        when={props.nogit()}
        fallback={
          <div class="min-h-0 flex-1 overflow-auto">
            <div class="border-b border-border-weaker-base px-3 py-3">
              <TextField
                label="Commit message"
                hideLabel
                multiline
                rows={1}
                value={store.message}
                onChange={(value) => setStore("message", value)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
                  if (event.key.toLowerCase() !== "enter") return
                  event.preventDefault()
                  void act("commit")
                }}
                placeholder="Message (Ctrl+Enter to commit)"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                variant="ghost"
                class="text-12-regular"
              />
              <div class="mt-2 flex items-center gap-1.5">
                <div class="flex min-w-0 flex-1 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel">
                  <Button
                    class="h-8 flex-1 rounded-none border-none px-3 shadow-none"
                    disabled={store.busy || staged().length === 0 || !store.message.trim()}
                    onClick={() => void act("commit")}
                  >
                    Commit
                  </Button>
                  <div class="h-4 w-px bg-border-base" />
                  <IconButton
                    icon="chevron-down"
                    variant="ghost"
                    class="size-8 rounded-none border-none"
                    aria-label="Commit actions"
                  />
                </div>
                <Button variant="ghost" size="small" class="h-8 px-2.5" disabled={store.loading} onClick={refresh}>
                  Refresh
                </Button>
              </div>
            </div>

            <Show when={store.error}>
              {(err) => (
                <div class="border-b border-border-danger-base px-3 py-2 text-12-regular text-text-danger-base">
                  {err()}
                </div>
              )}
            </Show>

            {section({
              key: "staged",
              title: "Staged Changes",
              count: staged().length,
              body: (
                <Switch>
                  <Match when={store.loading && store.changes.length === 0}>
                    <Empty text="Loading staged changes..." />
                  </Match>
                  <Match when={staged().length === 0}>
                    <Empty text="No staged changes" />
                  </Match>
                  <Match when={true}>
                    <div class="px-1 pb-2">
                      <For each={staged()}>{(item) => fileRow(item, "staged")}</For>
                    </div>
                  </Match>
                </Switch>
              ),
            })}

            {section({
              key: "changes",
              title: "Changes",
              count: changed().length,
              body: (
                <Switch>
                  <Match when={store.loading && store.changes.length === 0}>
                    <Empty text="Loading changes..." />
                  </Match>
                  <Match when={changed().length === 0}>
                    <Empty text="No working tree changes" />
                  </Match>
                  <Match when={true}>
                    <div class="px-1 pb-2">
                      <For each={changed()}>{(item) => fileRow(item, "changed")}</For>
                    </div>
                  </Match>
                </Switch>
              ),
            })}

            {section({
              key: "review",
              title: "Agent Review",
              body: (
                <div class="px-3 pb-3">
                  <div class="flex min-w-0 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel">
                    <Button
                      class="h-8 flex-1 rounded-none border-none px-3 shadow-none"
                      disabled={store.busy || reviewFiles().length === 0}
                      onClick={review}
                    >
                      Find Issues
                    </Button>
                    <div class="h-4 w-px bg-border-base" />
                    <IconButton
                      icon="chevron-down"
                      variant="ghost"
                      class="size-8 rounded-none border-none"
                      aria-label="Review actions"
                    />
                  </div>
                  <div class="mt-2 text-center text-11-regular text-text-weak">
                    Review {staged().length > 0 ? "staged" : "diffs"} vs. {base() ?? "HEAD"}
                  </div>
                </div>
              ),
            })}

            {section({
              key: "graph",
              title: "Graph",
              body: (
                <Switch>
                  <Match when={store.loading && store.history.length === 0}>
                    <Empty text="Loading history..." />
                  </Match>
                  <Match when={store.history.length === 0}>
                    <Empty text="No commits yet" />
                  </Match>
                  <Match when={true}>
                    <div class="px-3 pb-3">
                      <For each={store.history}>
                        {(item) => (
                          <div class="flex gap-3 py-1.5">
                            <div class="flex w-4 shrink-0 justify-center pt-1">
                              <div class="size-2 rounded-full bg-surface-info-base" />
                            </div>
                            <div class="min-w-0 flex-1">
                              <div class="truncate text-12-medium text-text-strong">{item.subject || item.short}</div>
                              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-weak">
                                <span class="font-mono">{item.short}</span>
                                <span>{stamp(item.at)}</span>
                                <Show when={item.refs[0]}>{(ref) => <span class="truncate">{ref()}</span>}</Show>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Match>
                </Switch>
              ),
            })}
          </div>
        }
      >
        {props.createGit}
      </Show>
    </div>
  )
}
