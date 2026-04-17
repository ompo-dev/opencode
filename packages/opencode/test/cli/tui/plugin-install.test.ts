import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("installs plugin without loading it", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "install-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "install.txt")

      await Bun.write(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            name: "demo-install-plugin",
            type: "module",
            exports: {
              "./tui": {
                import: "./install-plugin.ts",
                config: { marker },
              },
            },
          },
          null,
          2,
        ),
      )

      await Bun.write(
        file,
        `export default {
  id: "demo.install",
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "loaded")
  },
}
`,
      )

      return { spec, marker }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const cfg: Awaited<ReturnType<typeof TuiConfig.get>> = {
    plugin: [],
    plugin_origins: undefined,
  }
  const get = spyOn(TuiConfig, "get").mockImplementation(async () => cfg)
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi({
    state: {
      path: {
        state: path.join(tmp.path, "state.json"),
        config: path.join(tmp.path, "tui.json"),
        worktree: tmp.path,
        directory: tmp.path,
      },
    },
  })

  try {
    await TuiPluginRuntime.init(api)
    const out = await TuiPluginRuntime.installPlugin(tmp.extra.spec)
    expect(out).toMatchObject({
      ok: true,
      tui: true,
    })

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    await expect(TuiPluginRuntime.addPlugin(tmp.extra.spec)).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("loaded")
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("resolves marketplace aliases during tui plugin install", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "demo-market")
      const file = path.join(mod, "plugin.ts")
      await fs.mkdir(mod, { recursive: true })
      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify(
          {
            name: "demo-market",
            type: "module",
            exports: {
              "./tui": {
                import: "./plugin.ts",
              },
            },
          },
          null,
          2,
        ),
      )
      await Bun.write(
        file,
        `export default {
  id: "demo.market",
  tui: async () => {},
}
`,
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugins: {
              marketplaces: {
                local: {
                  type: "directory",
                  url: path.join(dir, "mods"),
                },
              },
            },
          },
          null,
          2,
        ),
      )
      return { spec: "local:demo-market" }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const cfg: Awaited<ReturnType<typeof TuiConfig.get>> = {
    plugin: [],
    plugin_origins: undefined,
  }
  const get = spyOn(TuiConfig, "get").mockImplementation(async () => cfg)
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi({
    state: {
      path: {
        state: path.join(tmp.path, "state.json"),
        config: path.join(tmp.path, "tui.json"),
        worktree: tmp.path,
        directory: tmp.path,
      },
    },
  })

  try {
    await TuiPluginRuntime.init(api)
    await expect(TuiPluginRuntime.installPlugin(tmp.extra.spec)).resolves.toMatchObject({
      ok: true,
      tui: true,
    })
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("blocks tui plugin install when policy denies the plugin", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "demo-policy")
      const file = path.join(mod, "plugin.ts")
      await fs.mkdir(mod, { recursive: true })
      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify(
          {
            name: "demo-policy",
            type: "module",
            exports: {
              "./tui": {
                import: "./plugin.ts",
              },
            },
            opencode: {
              id: "demo.policy",
            },
          },
          null,
          2,
        ),
      )
      await Bun.write(
        file,
        `export default {
  id: "demo.policy",
  tui: async () => {},
}
`,
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugins: {
              policy: {
                deny: ["demo.policy"],
              },
            },
          },
          null,
          2,
        ),
      )
      return { spec: mod }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const cfg: Awaited<ReturnType<typeof TuiConfig.get>> = {
    plugin: [],
    plugin_origins: undefined,
  }
  const get = spyOn(TuiConfig, "get").mockImplementation(async () => cfg)
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi({
    state: {
      path: {
        state: path.join(tmp.path, "state.json"),
        config: path.join(tmp.path, "tui.json"),
        worktree: tmp.path,
        directory: tmp.path,
      },
    },
  })

  try {
    await TuiPluginRuntime.init(api)
    await expect(TuiPluginRuntime.installPlugin(tmp.extra.spec)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("denied"),
    })
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
