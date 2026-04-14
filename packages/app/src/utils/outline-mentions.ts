import type { OutlineMention } from "@opencode-ai/outline-app"

type Scope = "global" | "project"

type Workspace = {
  global: { collections: Array<{ id: string; title: string }> }
  project: { collections: Array<{ id: string; title: string }> }
}

const text = (value: string[]) => value.join(" ").trim().toLowerCase()

const score = (query: string, value: string, crumbs: string[]) => {
  if (!query) return 0
  const head = value.toLowerCase()
  if (head.startsWith(query)) return 0
  if (head.includes(query)) return 1
  if (text(crumbs).includes(query)) return 2
  return 3
}

export async function mentions(input: {
  query: string
  workspace: () => Promise<Workspace>
  search: (scope: Scope, query: string) => Promise<Array<{ id: string; title: string; breadcrumbs: string[] }>>
  paths?: (query: string) => Promise<string[]>
}) {
  const query = input.query.trim().toLowerCase()
  const [workspace, project, global, paths] = await Promise.all([
    input.workspace(),
    input.search("project", input.query),
    input.search("global", input.query),
    input.paths ? input.paths(input.query) : Promise.resolve([] as string[]),
  ])

  const collections = [
    ...workspace.project.collections.map((item: { id: string; title: string }) => ({
      kind: "collection" as const,
      key: `collection:project:${item.id}`,
      label: `@${item.title}`,
      scope: "project" as const,
      collectionID: item.id,
      title: item.title,
      breadcrumbs: [item.title],
    })),
    ...workspace.global.collections.map((item: { id: string; title: string }) => ({
      kind: "collection" as const,
      key: `collection:global:${item.id}`,
      label: `@${item.title}`,
      scope: "global" as const,
      collectionID: item.id,
      title: item.title,
      breadcrumbs: [item.title],
    })),
  ]
    .filter((item) => !query || score(query, item.title, item.breadcrumbs) < 3)
    .sort((a, b) => score(query, a.title, a.breadcrumbs) - score(query, b.title, b.breadcrumbs) || a.title.localeCompare(b.title))

  const notes = [
    ...project.map((item: { id: string; title: string; breadcrumbs: string[] }) => ({ ...item, scope: "project" as const })),
    ...global.map((item: { id: string; title: string; breadcrumbs: string[] }) => ({ ...item, scope: "global" as const })),
  ]
    .map((item) => ({
      kind: "note" as const,
      key: `note:${item.scope}:${item.id}`,
      label: `@${item.title}`,
      scope: item.scope,
      documentID: item.id,
      title: item.title,
      breadcrumbs: item.breadcrumbs,
    }))
    .sort((a, b) => score(query, a.title, a.breadcrumbs) - score(query, b.title, b.breadcrumbs) || a.title.localeCompare(b.title))

  return [
    ...paths.map(
      (path: string) =>
        ({
          kind: "path" as const,
          key: `path:${path}`,
          label: `@${path}`,
          path,
        }) satisfies OutlineMention,
    ),
    ...collections,
    ...notes,
  ] satisfies OutlineMention[]
}
