import { EOL } from "os"
import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Plugin } from "../../plugin"

const ChannelListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list plugin-defined channels",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const reg = await Plugin.registry()
        const list = Object.values(reg.channels).toSorted((a, b) => a.id.localeCompare(b.id))
        for (const item of list) {
          process.stdout.write(`${item.id} (${item.plugin})` + EOL)
          if (item.description) process.stdout.write(`  ${item.description}` + EOL)
        }
      },
    })
  },
})

const ChannelShowCommand = cmd({
  command: "show <name>",
  describe: "show details for a plugin-defined channel",
  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      describe: "channel id",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const reg = await Plugin.registry()
        const name = String(args.name ?? "").trim()
        const item = reg.channels[name]
        if (!item) {
          process.stderr.write(`Unknown channel: ${name}` + EOL)
          process.exitCode = 1
          return
        }
        process.stdout.write(`${item.id}` + EOL)
        process.stdout.write(`plugin: ${item.plugin}` + EOL)
        if (item.name) process.stdout.write(`name: ${item.name}` + EOL)
        if (item.description) process.stdout.write(`description: ${item.description}` + EOL)
        if (item.path) process.stdout.write(`path: ${item.path}` + EOL)
        if (item.prompt) process.stdout.write(`prompt: ${item.prompt}` + EOL)
        if (typeof item.enabled === "boolean") process.stdout.write(`enabled: ${item.enabled}` + EOL)
      },
    })
  },
})

export const ChannelCommand = cmd({
  command: "channel",
  describe: "inspect plugin-defined runtime channels",
  builder: (yargs) => yargs.command(ChannelListCommand).command(ChannelShowCommand).demandCommand(),
  async handler() {},
})
