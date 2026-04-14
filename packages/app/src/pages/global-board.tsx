import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
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

export default function GlobalBoardPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const platform = usePlatform()
  const server = useServer()
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  let load = false

  const auth = () => {
    const current = server.current?.http
    const headers = new Headers()
    if (!current?.password) return headers
    headers.set("Authorization", `Basic ${btoa(`${current.username ?? "opencode"}:${current.password}`)}`)
    return headers
  }

  const notes = (scope: "project" | "global", query: string) => {
    if (scope === "project") return Promise.resolve([] as Hit[])
    const url = new URL("/outline/search", sdk.url)
    url.searchParams.set("scope", scope)
    url.searchParams.set("query", query)
    return (platform.fetch ?? fetch)(url, {
      headers: (() => {
        const headers = auth()
        headers.set("content-type", "application/json")
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

  const paths = () => Promise.resolve([] as string[])

  const workspace = () =>
    (platform.fetch ?? fetch)(new URL("/outline/workspace", sdk.url), {
      headers: (() => {
        const headers = auth()
        headers.set("content-type", "application/json")
        return headers
      })(),
    }).then((res) => (res.ok ? res.json() : { global: { collections: [] }, project: { collections: [] } }))

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
    void sdk.client.global.kanban
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
      title={() => language.t("board.global.title")}
      description={() => language.t("board.global.description")}
      hint={() => language.t("board.chat")}
      findMentions={findMentions}
      actions={[
        {
          label: language.t("common.goBack"),
          icon: "chevron-left",
          onClick: () => navigate("/"),
        },
      ]}
      save={(ops) =>
        sdk.client.global.kanban.update({ operations: ops }).then((x) => {
          if (x.data) sync.set("kanban", x.data)
          return x.data
        })
      }
    />
  )
}
