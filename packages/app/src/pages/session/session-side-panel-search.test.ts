import { describe, expect, test } from "bun:test"
import type { FindTextResponse } from "@opencode-ai/sdk/v2"
import { flat, group, has, parts, pats, rows, squash, stitch, uniq } from "./session-side-panel-search"

describe("session side panel search helpers", () => {
  test("flattens matches into normalized hits", () => {
    const list: FindTextResponse = [
      {
        path: { text: "src\\foo.ts" },
        lines: { text: "const foo = 1\n" },
        line_number: 7,
        absolute_offset: 10,
        submatches: [{ match: { text: "foo" }, start: 6, end: 9 }],
      },
    ]

    expect(flat(list, (path) => path.replaceAll("\\", "/"))).toEqual([
      {
        path: "src/foo.ts",
        line: "const foo = 1",
        num: 7,
        end: 7,
        subs: [{ start: 6, end: 9 }],
      },
    ])
  })

  test("keeps multiline matches as one hit with a line range", () => {
    const list: FindTextResponse = [
      {
        path: { text: "AGENTS.md" },
        lines: { text: "where possible\n- Avoid using the `any` type\n- Prefer single word names\n" },
        line_number: 10,
        absolute_offset: 10,
        submatches: [{ match: { text: "where possible\n- Avoid using the `any` type" }, start: 0, end: 43 }],
      },
    ]

    expect(flat(list, (path) => path)).toEqual([
      {
        path: "AGENTS.md",
        line: "where possible\n- Avoid using the `any` type\n- Prefer single word names",
        num: 10,
        end: 12,
        subs: [{ start: 0, end: 43 }],
      },
    ])
  })

  test("groups hits by file while preserving order", () => {
    expect(
      group([
        { path: "a.ts", line: "a", num: 1, end: 1, subs: [] },
        { path: "b.ts", line: "b", num: 2, end: 2, subs: [] },
        { path: "a.ts", line: "c", num: 3, end: 3, subs: [] },
      ]),
    ).toEqual([
      {
        path: "a.ts",
        hits: [
          { path: "a.ts", line: "a", num: 1, end: 1, subs: [] },
          { path: "a.ts", line: "c", num: 3, end: 3, subs: [] },
        ],
      },
      {
        path: "b.ts",
        hits: [{ path: "b.ts", line: "b", num: 2, end: 2, subs: [] }],
      },
    ])
  })

  test("splits a line into highlighted fragments", () => {
    expect(parts("const issue = find(issue)", [{ start: 6, end: 11 }, { start: 19, end: 24 }])).toEqual([
      { text: "const ", hit: false },
      { text: "issue", hit: true },
      { text: " = find(", hit: false },
      { text: "issue", hit: true },
      { text: ")", hit: false },
    ])
  })

  test("keeps pasted multiline text as one pattern", () => {
    expect(
      pats("`try`/`catch` where possible\n- Avoid using the `any` type\n- Use Bun APIs when possible, like `Bun.file()`"),
    ).toEqual(["`try`/`catch` where possible\n- Avoid using the `any` type\n- Use Bun APIs when possible, like `Bun.file()`"])
  })

  test("splits pasted multiline text into trimmed rows for block matching", () => {
    expect(
      rows(
        " single word names by default for new locals, params, and helper functions.\n- Multi-word names are allowed only when a single word would be unclear or ambiguous.\n- Do not introduce new came",
      ),
    ).toEqual([
      "single word names by default for new locals, params, and helper functions.",
      "- Multi-word names are allowed only when a single word would be unclear or ambiguous.",
      "- Do not introduce new came",
    ])
  })

  test("squashes pasted multiline text for a single-line input", () => {
    expect(
      squash(" where possible\n- Avoid using the `any` type\n- Use Bun APIs when possible, like `Bun.file()`\n"),
    ).toBe('where possible - Avoid using the `any` type - Use Bun APIs when possible, like `Bun.file()`')
  })

  test("keeps only contiguous multiline blocks that contain the pasted text as one substring", () => {
    const query =
      " single word names by default for new locals, params, and helper functions.\n- Multi-word names are allowed only when a single word would be unclear or ambiguous.\n- Do not introduce new came"

    expect(
      [
        "- Use single word names by default for new locals, params, and helper functions.\n- Multi-word names are allowed only when a single word would be unclear or ambiguous.\n- Do not introduce new camelCase compounds when a short single-word alternative is clear.",
        '"single word names by default for new locals, params, and helper functions.",\n"- Multi-word names are allowed only when a single word would be unclear or ambiguous.",\n"- Do not introduce new came",',
      ].filter((text) => has(text, query)),
    ).toEqual([
      "- Use single word names by default for new locals, params, and helper functions.\n- Multi-word names are allowed only when a single word would be unclear or ambiguous.\n- Do not introduce new camelCase compounds when a short single-word alternative is clear.",
    ])
  })

  test("matches pasted blocks even when the source contains blank lines and the last line is truncated", () => {
    expect(
      has(
        '```ts\n// Good\nconst table = sqliteTable("session", {\n  id: text().primaryKey(),\n  project_id: text().notNull(),\n  created_at: integer().notNull(),\n})\n```\n\n## Testing\n\n- Avoid mocks as much as possible\n- Test actual implementation, do not duplicate logic into tests\n- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.\n\n## Type Checking\n\n- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.',
        '```ts\n// Good\nconst table = sqliteTable("session", {\n  id: text().primaryKey(),\n  project_id: text().notNull(),\n  created_at: integer().notNull(),\n})\n```\n\n## Testing\n\n- Avoid mocks as much as possible\n- Test actual implementation, do not duplicate logic into tests\n- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.\n\n## Type Checking\n\n- Always run `bun typecheck` from package dire',
      ),
    ).toBe(true)
  })

  test("stitches multiline rows only when they are contiguous in the same file", () => {
    expect(
      stitch([
        [{ path: "AGENTS.md", line: "- Use single word names by default for new locals, params, and helper functions.", num: 27, end: 27, subs: [{ start: 6, end: 79 }] }],
        [{ path: "AGENTS.md", line: "- Multi-word names are allowed only when a single word would be unclear or ambiguous.", num: 28, end: 28, subs: [{ start: 0, end: 84 }] }],
        [
          { path: "AGENTS.md", line: "- Do not introduce new camelCase compounds when a short single-word alternative is clear.", num: 29, end: 29, subs: [{ start: 0, end: 22 }] },
          { path: "other.md", line: "- Do not introduce new camelCase compounds when a short single-word alternative is clear.", num: 29, end: 29, subs: [{ start: 0, end: 22 }] },
        ],
      ]),
    ).toEqual([
      {
        path: "AGENTS.md",
        line:
          "- Use single word names by default for new locals, params, and helper functions.\n- Multi-word names are allowed only when a single word would be unclear or ambiguous.\n- Do not introduce new camelCase compounds when a short single-word alternative is clear.",
        num: 27,
        end: 29,
        subs: [
          { start: 6, end: 79 },
          { start: 81, end: 165 },
          { start: 167, end: 189 },
        ],
      },
    ])
  })

  test("merges duplicate hits on the same line", () => {
    expect(
      uniq([
        { path: "a.ts", line: "try/catch", num: 1, end: 1, subs: [{ start: 0, end: 3 }] },
        { path: "a.ts", line: "try/catch", num: 1, end: 1, subs: [{ start: 4, end: 9 }] },
      ]),
    ).toEqual([
      {
        path: "a.ts",
        line: "try/catch",
        num: 1,
        end: 1,
        subs: [
          { start: 0, end: 3 },
          { start: 4, end: 9 },
        ],
      },
    ])
  })
})
