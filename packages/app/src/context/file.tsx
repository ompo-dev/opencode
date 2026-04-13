import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { createPathHelpers } from "./file/path"
import { merge, score, terms } from "./file/search"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

function editable(content: FileState["content"]) {
  return content?.type === "text" && !content.encoding
}

function solid(content: FileState["content"]) {
  if (!content) return
  if (content.type !== "text" && content.type !== "binary") return
  if (typeof content.content !== "string") return
  return content
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: (dir) => sdk.client.file.list({ path: dir }).then((x) => x.data ?? []),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      const next = new Set(keep)
      for (const [key, value] of Object.entries(store.file)) {
        if (value.draft === undefined) continue
        next.add(key)
      }

      evictContentLru(next, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      inflight.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.error = undefined
          draft.content = content
          if (content?.type === "text" && !content.encoding && draft.draft === content.content) {
            draft.draft = undefined
            return
          }
          if (content?.type === "text" && !content.encoding) return
          draft.draft = undefined
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.saving = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      if (!current?.loaded) setLoading(file)

      const promise = sdk.client.file
        .read({ path: file })
        .then((x) => {
          if (scope() !== directory) return
          const content = solid(x.data)
          if (!content) throw new Error("Invalid file response")
          setLoaded(file, content)

          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (scope() !== directory) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const search = (query: string, dirs: "true" | "false", limit = 10) =>
      sdk.client.find.files({ query, dirs, limit }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )

    const text = (query: string, limit = 200) => {
      const list = terms(query)
      if (list.length === 0) return Promise.resolve([] as string[])

      return Promise.all(
        list.map((pattern) =>
          sdk.client.find.text({ pattern, fixed: true }).then(
            (x) => (x.data ?? []).map((item) => path.normalize(item.path.text)),
            () => [],
          ),
        ),
      ).then((results) => score(results, limit))
    }

    const blend = (query: string, limit = 200) =>
      Promise.all([search(query, "true", limit), text(query, limit)]).then((results) => merge(results, limit))

    const stop = sdk.event.listen((e) => {
      invalidateFromWatcher(e.details, {
        normalize: path.normalize,
        hasFile: (file) => Boolean(store.file[file]),
        isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
        loadFile: (file) => {
          void load(file, { force: true })
        },
        node: tree.node,
        isDirLoaded: tree.isLoaded,
        refreshDir: (dir) => {
          void tree.listDir(dir, { force: true })
        },
      })
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    const value = (input: string) =>
      withPath(input, (file) => {
        const state = store.file[file]
        return state?.draft ?? state?.content?.content ?? ""
      })

    const dirty = (input: string) =>
      withPath(input, (file) => {
        const state = store.file[file]
        const content = state?.content
        if (content?.type !== "text" || content.encoding) return false
        if (state?.draft === undefined) return false
        return state.draft !== content.content
      })

    const saving = (input: string) => withPath(input, (file) => store.file[file]?.saving ?? false)

    const setDraft = (input: string, value: string) =>
      withPath(input, (file) => {
        const state = store.file[file]
        if (!editable(state?.content)) return
        setStore(
          "file",
          file,
          produce((draft) => {
            if (draft.content?.content === value) {
              draft.draft = undefined
              return
            }
            draft.draft = value
          }),
        )
      })

    const save = (input: string) =>
      withPath(input, async (file) => {
        const state = store.file[file]
        if (state?.saving) return
        const base = state?.content
        if (base?.type !== "text" || base.encoding) return
        const content = state.draft ?? base.content
        if (content === base.content && state.draft === undefined) return

        setStore(
          "file",
          file,
          produce((draft) => {
            draft.saving = true
            draft.error = undefined
          }),
        )

        try {
          const result = solid(
            (
              await sdk.client.file.write({
                directory: scope(),
                path: file,
                content,
              })
            ).data,
          )
          if (!result) throw new Error("Invalid file response")
          setLoaded(file, result)
          touchFileContent(file, approxBytes(result))
          evictContent(new Set([file]))

          setStore(
            "file",
            file,
            produce((draft) => {
              draft.saving = false
            }),
          )
        } catch (error) {
          const message = errorMessage(error, language.t("error.chain.unknown"))
          setStore(
            "file",
            file,
            produce((draft) => {
              draft.saving = false
              draft.error = message
            }),
          )
          showToast({
            variant: "error",
            title: language.t("common.save"),
            description: message,
          })
        }
      })

    function withPath<T>(input: string, action: (file: string) => T) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get,
      load,
      value,
      dirty,
      saving,
      setDraft,
      save,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string, limit?: number) => search(query, "false", limit),
      searchFilesAndDirectories: (query: string, limit?: number) => search(query, "true", limit),
      searchTree: (query: string, limit?: number) => blend(query, limit),
    }
  },
})
