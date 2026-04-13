import { OutlinePanel as Panel, type OutlinePanelApi } from "@opencode-ai/outline-app"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"

export function OutlinePanel(props: {
  width: number
}) {
  const platform = usePlatform()
  const sdk = useSDK()
  const server = useServer()

  const auth = () => {
    const current = server.current
    const http = current?.http
    const headers = new Headers()
    if (!http?.password) return headers
    headers.set("Authorization", `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`)
    return headers
  }

  const call = async (method: string, route: string, init?: { query?: Record<string, string>; body?: unknown }) => {
    const url = new URL(route, sdk.url)
    if (init?.query) {
      for (const [key, value] of Object.entries(init.query)) {
        url.searchParams.set(key, value)
      }
    }
    const res = await (platform.fetch ?? fetch)(url, {
      method,
      headers: (() => {
        const headers = auth()
        headers.set("content-type", "application/json")
        headers.set("x-opencode-directory", encodeURIComponent(sdk.directory))
        return headers
      })(),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }

  const api: OutlinePanelApi = {
    snapshot: () => call("GET", "/outline/workspace"),
    document_get: (input) =>
      call("GET", `/outline/document/${encodeURIComponent(input.document_id)}`, {
        query: { scope: input.scope },
      }),
    collection_create: (input) => call("POST", "/outline/collection", { body: input }),
    collection_update: (input) =>
      call("PATCH", `/outline/collection/${encodeURIComponent(input.collection_id)}`, { body: input }),
    collection_archive: (input) =>
      call("POST", `/outline/collection/${encodeURIComponent(input.collection_id)}/archive`, { body: input }),
    collection_delete: (input) =>
      call("DELETE", `/outline/collection/${encodeURIComponent(input.collection_id)}`, {
        query: { scope: input.scope },
      }),
    document_create: (input) => call("POST", "/outline/document", { body: input }),
    document_update: (input) =>
      call("PATCH", `/outline/document/${encodeURIComponent(input.document_id)}`, { body: input }),
    document_move: (input) =>
      call("POST", `/outline/document/${encodeURIComponent(input.document_id)}/move`, { body: input }),
    document_archive: (input) =>
      call("POST", `/outline/document/${encodeURIComponent(input.document_id)}/archive`, { body: input }),
    document_delete: (input) =>
      call("DELETE", `/outline/document/${encodeURIComponent(input.document_id)}`, {
        query: { scope: input.scope },
      }),
    search: (input) =>
      call("GET", "/outline/search", {
        query: {
          scope: input.scope,
          query: input.query,
        },
      }),
  }

  return <Panel api={api} width={props.width} />
}
