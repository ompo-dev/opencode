import * as prompts from "@clack/prompts"
import { applyEdits, modify } from "jsonc-parser"
import path from "path"
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { OutputStyle } from "../../output-style"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"

async function cfg(base: string, global = false) {
  const list = [path.join(base, "opencode.json"), path.join(base, "opencode.jsonc")]
  if (!global) {
    list.push(path.join(base, ".opencode", "opencode.json"), path.join(base, ".opencode", "opencode.jsonc"))
  }
  for (const file of list) {
    if (await Filesystem.exists(file)) return file
  }
  return list[0]
}

async function patch(file: string, name: string) {
  const text = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : "{}"
  const next = applyEdits(
    text,
    modify(text, ["output_style"], name, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    }),
  )
  await Filesystem.write(file, next)
}

const OutputStyleListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list available output styles",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const [list, active] = await Promise.all([OutputStyle.all(), OutputStyle.active()])
        for (const item of list) {
          const mark = active?.name === item.name || (!active && item.name === "default") ? "*" : " "
          process.stdout.write(`${mark} ${item.name} (${item.source})` + EOL)
          if (item.description) process.stdout.write(`  ${item.description}` + EOL)
        }
      },
    })
  },
})

const OutputStyleCurrentCommand = cmd({
  command: "current",
  describe: "show the active output style",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const active = await OutputStyle.active()
        process.stdout.write((active?.name ?? "default") + EOL)
      },
    })
  },
})

const OutputStyleSetCommand = cmd({
  command: "set [name]",
  describe: "set the active output style in config",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "output style name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "write to global config",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Set output style")

        const list = await OutputStyle.all()
        const name =
          typeof args.name === "string" && args.name.trim()
            ? args.name.trim()
            : await prompts.select({
                message: "Select output style",
                options: list.map((item) => ({
                  label: item.name,
                  value: item.name,
                  hint: item.description,
                })),
              })

        if (prompts.isCancel(name)) throw new UI.CancelledError()
        if (!list.some((item) => item.name === name)) {
          prompts.log.error(`Unknown output style: ${name}`)
          prompts.outro("Done")
          process.exitCode = 1
          return
        }

        const file = Boolean(args.global)
          ? await cfg(Global.Path.config, true)
          : Instance.project.vcs === "git"
            ? await cfg(Instance.worktree)
            : await cfg(Global.Path.config, true)

        await patch(file, name)
        prompts.log.success(`Set output style to ${name}`)
        prompts.log.info(file)
        prompts.outro("Done")
      },
    })
  },
})

export const OutputStyleCommand = cmd({
  command: "output-style",
  aliases: ["outputstyle"],
  describe: "manage response output styles",
  builder: (yargs) =>
    yargs.command(OutputStyleListCommand).command(OutputStyleCurrentCommand).command(OutputStyleSetCommand).demandCommand(),
  async handler() {},
})
