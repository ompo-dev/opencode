#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

const openapi = (await Bun.file("./openapi.json").json()) as unknown

const fix = (value: unknown): void => {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach(fix)
    return
  }
  if (typeof value !== "object") return
  const row = value as Record<string, unknown>
  if (row.$ref === "#/components/schemas/__schema0") {
    row.$ref = "#/components/schemas/OutlineNode"
  }
  Object.values(row).forEach(fix)
}

fix(openapi)
await Bun.write("./openapi.json", JSON.stringify(openapi, null, 2))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
