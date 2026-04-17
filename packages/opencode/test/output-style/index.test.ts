import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { OutputStyle } from "../../src/output-style"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("loads custom output styles from config directories", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const root = path.join(dir, ".opencode", "output-styles")
      await fs.mkdir(root, { recursive: true })
      await Bun.write(
        path.join(root, "concise.md"),
        `---
name: ConciseLocal
description: Local concise style.
---

Keep responses very compact.
`,
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            output_style: "ConciseLocal",
          },
          null,
          2,
        ),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const list = await OutputStyle.all()
      expect(list.some((item) => item.name === "ConciseLocal" && item.source === "config")).toBe(true)
      expect(await OutputStyle.active()).toMatchObject({
        name: "ConciseLocal",
        source: "config",
      })
    },
  })
})
