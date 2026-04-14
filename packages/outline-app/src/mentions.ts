import type { OutlineScope } from "@opencode-ai/outline-core"

export type OutlineMention =
  | {
      kind: "path"
      key: string
      label: string
      path: string
    }
  | {
      kind: "collection"
      key: string
      label: string
      scope: OutlineScope
      collectionID: string
      title: string
      breadcrumbs: string[]
    }
  | {
      kind: "note"
      key: string
      label: string
      scope: OutlineScope
      documentID: string
      title: string
      breadcrumbs: string[]
    }
