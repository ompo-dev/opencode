import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { mentions } from "@/utils/outline-mentions"
import { BoardView } from "./board-view"

type Hit = {
  id: string
  title: string
  breadcrumbs: string[]
}

const fail = (err: unknown, fallback: string) => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return fallback
}

export default function BoardPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const platform = usePlatform()
  const server = useServer()
  const sdk = useSDK()
  const sync = useSync()
  const name = createMemo(() => sync.project?.name || getFilename(sync.data.path.directory))
  let load = false

  const auth = () => {
    const current = server.current?.http
    const headers = new Headers()
    if (!current?.password) return headers
    headers.set("Authorization", `Basic ${btoa(`${current.username ?? "opencode"}:${current.password}`)}`)
    return headers
  }

  const notes = (scope: "project" | "global", query: string) => {
    const url = new URL("/outline/search", sdk.url)
    url.searchParams.set("scope", scope)
    url.searchParams.set("query", query)
    return (platform.fetch ?? fetch)(url, {
      headers: (() => {
        const headers = auth()
        headers.set("content-type", "application/json")
        headers.set("x-opencode-directory", encodeURIComponent(sdk.directory))
        return headers
      })(),
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) =>
        Array.isArray(data)
          ? data.flatMap((item) => {
              if (!item || typeof item !== "object") return []
              const id = "id" in item && typeof item.id === "string" ? item.id : undefined
              const title = "title" in item && typeof item.title === "string" ? item.title : undefined
              const breadcrumbs =
                "breadcrumbs" in item && Array.isArray(item.breadcrumbs)
                  ? item.breadcrumbs.filter((row: unknown): row is string => typeof row === "string")
                  : []
              if (!id || !title) return []
              return [{ id, title, breadcrumbs } satisfies Hit]
            })
          : [],
      )
      .catch(() => [] as Hit[])
  }

  const workspace = () =>
    (platform.fetch ?? fetch)(new URL("/outline/workspace", sdk.url), {
      headers: (() => {
        const headers = auth()
        headers.set("content-type", "application/json")
        headers.set("x-opencode-directory", encodeURIComponent(sdk.directory))
        return headers
      })(),
    }).then((res) => (res.ok ? res.json() : { global: { collections: [] }, project: { collections: [] } }))

  const paths = (query: string) =>
    sdk.client.find.files({ query, dirs: "true", limit: query ? 8 : 6 }).then(
      (x) => x.data ?? [],
      () => [],
    )

  const findMentions = (query: string) =>
    mentions({
      query,
      workspace,
      search: notes,
      paths,
    })

  createEffect(() => {
    if (!sync.ready || sync.data.kanban || load) return
    load = true
    void sdk.client.kanban
      .get()
      .then((x) => {
        if (!x.data) return
        sync.set("kanban", x.data)
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("board.toast.failed"),
          description: fail(err, language.t("common.requestFailed")),
        })
      })
      .finally(() => {
        load = false
      })
  })

  return (
    <BoardView
      ready={() => sync.ready}
      board={() => sync.data.kanban}
      title={() => language.t("board.project.title", { project: name() })}
      description={() => language.t("board.project.description", { project: name() })}
      hint={() => language.t("board.chat")}
      findMentions={findMentions}
      actions={[
        {
          label: language.t("command.session.new"),
          icon: "new-session",
          onClick: () => navigate(`/${base64Encode(sync.data.path.directory)}/session`),
        },
      ]}
      save={(ops) =>
        sdk.client.kanban.update({ operations: ops }).then((x) => {
          if (x.data) sync.set("kanban", x.data)
          return x.data
        })
      }
    />
  )
}
