import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { Command } from "../../src/command"
import { Global } from "../../src/global"
import { MCP } from "../../src/mcp"
import { OutputStyle } from "../../src/output-style"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("loads manifest-only plugin contributions into the runtime registry", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const plugin = path.join(dir, "plugin")
      const skill = path.join(plugin, "skills", "checks")
      await fs.mkdir(skill, { recursive: true })
      await Bun.write(
        path.join(skill, "SKILL.md"),
        `---
name: checks
description: Run project checks.
mode: subagent
agent: general
paths:
  - src/**
---

# Checks

Use the project checks.
`,
      )
      await Bun.write(
        path.join(plugin, "index.ts"),
        [
          "export default {",
          "  id: 'acme',",
          "  manifest: {",
          "    commands: {",
          "      audit: {",
          "        template: 'Run audit for $ARGUMENTS',",
          "        description: 'Audit command',",
          "      },",
          "    },",
          "    agents: {",
          "      reviewer: {",
          "        description: 'Plugin reviewer',",
          "        prompt: 'Review carefully.',",
          "        mode: 'subagent',",
          "      },",
          "    },",
          "    skills: {",
          "      checks: {",
          "        path: './skills/checks/SKILL.md',",
          "        mode: 'subagent',",
          "        agent: 'general',",
          "      },",
          "    },",
          "    mcpServers: {",
          "      docs: {",
          "        config: {",
          "          type: 'stdio',",
          "          command: ['echo', 'noop'],",
          "          enabled: false,",
          "        },",
          "      },",
          "    },",
          "    outputStyles: {",
          "      concise: {",
          "        name: 'Concise',",
          "        prompt: 'Answer in a concise plugin-specific style.',",
          "        forceForPlugin: true,",
          "      },",
          "    },",
          "    channels: {",
          "      review: {",
          "        name: 'Review',",
          "        description: 'Review-oriented plugin channel.',",
          "        prompt: 'Prioritize review depth.',",
          "      },",
          "    },",
          "  },",
          "}",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(path.join(plugin, "index.ts")).href],
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
      const reg = await Plugin.registry()
      expect(reg.commands["acme:audit"]).toBeDefined()
      expect(reg.agents["acme:reviewer"]).toBeDefined()
      expect(reg.skills["acme:checks"]).toBeDefined()
      expect(reg.mcpServers["acme:docs"]).toBeDefined()
      expect(reg.outputStyles["acme:concise"]).toBeDefined()
      expect(reg.channels["acme:review"]).toBeDefined()

      const commands = await Command.list()
      expect(commands.find((item) => item.name === "acme:audit")?.source).toBe("plugin")

      const skills = await Skill.all()
      const skill = skills.find((item) => item.name === "acme:checks")
      expect(skill?.source).toBe("plugin")
      expect(skill?.plugin).toBe("acme")
      expect(skill?.mode).toBe("subagent")
      expect(skill?.agent).toBe("general")
      expect(skill?.paths).toEqual(["src/**"])

      const agents = await Agent.list()
      expect(agents.find((item) => item.name === "acme:reviewer")?.description).toBe("Plugin reviewer")

      const status = await MCP.status()
      expect(status["acme:docs"]).toEqual({ status: "disabled" })

      const styles = await OutputStyle.all()
      expect(styles.some((item) => item.name === "Concise" && item.source === "plugin")).toBe(true)
      expect(await OutputStyle.active()).toMatchObject({
        name: "Concise",
        plugin: "acme",
      })
    },
  })
})

test("blocks denied plugins before initialization", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin.ts")
      const mark = path.join(dir, "plugin.json")
      await Bun.write(
        plugin,
        [
          "export default {",
          "  id: 'acme',",
          "  manifest: {",
          "    commands: {",
          "      audit: { template: 'Run audit' },",
          "    },",
          "  },",
          "  server: async (input) => {",
          `    await Bun.write(${JSON.stringify(mark)}, JSON.stringify(input))`,
          "    return {}",
          "  },",
          "}",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(plugin).href],
            plugins: {
              policy: {
                deny: ["acme"],
              },
            },
          },
          null,
          2,
        ),
      )
      return { mark }
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const reg = await Plugin.registry()
      expect(reg.commands["acme:audit"]).toBeUndefined()
      expect(await Bun.file(tmp.extra.mark).exists()).toBe(false)
    },
  })
})

test("skips plugin contributions when a required dependency is missing", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin.ts")
      await Bun.write(
        plugin,
        [
          "export default {",
          "  id: 'acme',",
          "  manifest: {",
          "    dependencies: {",
          "      base: '^2.0.0',",
          "    },",
          "    commands: {",
          "      audit: { template: 'Run audit' },",
          "    },",
          "  },",
          "}",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(plugin).href],
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
      const reg = await Plugin.registry()
      expect(reg.commands["acme:audit"]).toBeUndefined()
      expect(await Command.list()).not.toContainEqual(expect.objectContaining({ name: "acme:audit" }))
    },
  })
})

test("passes dedicated plugin directories into initialized plugins", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin.ts")
      const mark = path.join(dir, "plugin.json")
      await Bun.write(
        plugin,
        [
          "export default {",
          "  id: 'acme',",
          "  server: async (input) => {",
          "    await Bun.write(",
          `      ${JSON.stringify(mark)},`,
          "      JSON.stringify({",
          "        pluginID: input.pluginID,",
          "        pluginSpec: input.pluginSpec,",
          "        dataDir: input.dataDir,",
          "        cacheDir: input.cacheDir,",
          "        configDir: input.configDir,",
          "        stateDir: input.stateDir,",
          "      }),",
          "    )",
          "    return {}",
          "  },",
          "}",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(plugin).href],
            plugins: {
              cache: {
                directory: path.join(dir, "cache"),
                version: "v2",
              },
            },
          },
          null,
          2,
        ),
      )
      return { mark }
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Plugin.list()
      const input = JSON.parse(await Bun.file(tmp.extra.mark).text()) as Record<string, string>
      expect(input.pluginID).toBe("acme")
      expect(input.pluginSpec).toBe(pathToFileURL(path.join(tmp.path, "plugin.ts")).href)
      expect(input.dataDir).toBe(path.join(Global.Path.data, "plugin", "acme"))
      expect(input.cacheDir).toBe(path.join(tmp.path, "cache", "v2", "acme"))
      expect(input.configDir).toContain(path.join("opencode", "plugin", "acme"))
      expect(input.stateDir).toContain(path.join("opencode", "plugin", "acme"))
    },
  })
})
