import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Workflow } from "../../src/workflow"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("workflow", () => {
  test("creates and lists workflows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const item = await Workflow.create({
          name: "nightly review",
          schedule: {
            type: "interval",
            everyMs: 60_000,
          },
          action: {
            type: "prompt",
            prompt: "Review pending changes",
          },
        })

        expect(item.id.startsWith("wfl_")).toBe(true)
        expect(item.status).toBe("idle")

        const items = await Workflow.list()
        expect(items).toHaveLength(1)
        expect(items[0]?.name).toBe("nightly review")
        expect(items[0]?.time.nextRun).toBeDefined()
      },
    })
  })

  test("pauses and resumes workflows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const item = await Workflow.create({
          name: "daily sync",
          schedule: {
            type: "cron",
            expression: "0 9 * * 1-5",
          },
          action: {
            type: "command",
            command: "init",
          },
        })

        const paused = await Workflow.pause(item.id)
        expect(paused.status).toBe("paused")
        expect(paused.enabled).toBe(false)

        const resumed = await Workflow.resume(item.id)
        expect(resumed.status).toBe("idle")
        expect(resumed.enabled).toBe(true)
        expect(resumed.time.nextRun).toBeDefined()
      },
    })
  })

  test("removes workflows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const item = await Workflow.create({
          name: "one shot",
          schedule: {
            type: "once",
            at: Date.now() + 60_000,
          },
          action: {
            type: "shell",
            script: "echo hi",
          },
        })

        expect(await Workflow.remove(item.id)).toBe(true)
        expect(await Workflow.list()).toHaveLength(0)
      },
    })
  })
})
