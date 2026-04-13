export function terms(input: string) {
  const query = input.trim()
  if (!query) return []

  const lines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return [query]
  return [...new Set(lines)].slice(0, 5)
}

export function score(groups: readonly string[][], limit = Number.POSITIVE_INFINITY) {
  const hits = groups.reduce((map, group, i) => {
    const seen = new Set<string>()

    group.forEach((item) => {
      if (seen.has(item)) return
      seen.add(item)

      const prev = map.get(item)
      map.set(item, {
        hits: (prev?.hits ?? 0) + 1,
        order: prev?.order ?? i,
      })
    })

    return map
  }, new Map<string, { hits: number; order: number }>())

  return [...hits.entries()]
    .sort((a, b) => b[1].hits - a[1].hits || a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([item]) => item)
}

export function merge(groups: readonly string[][], limit = Number.POSITIVE_INFINITY) {
  return [...new Set(groups.flat())].slice(0, limit)
}
