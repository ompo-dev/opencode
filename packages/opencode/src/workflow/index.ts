import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ProjectID } from "@/project/schema"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"
import { Database, and, asc, eq, isNull, lt, lte, or } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkflowID } from "./schema"
import { WorkflowTable } from "./workflow.sql"

const log = Log.create({ service: "workflow" })
const POLL = 5_000
const LEASE = 60 * 60 * 1_000
const LIMIT = 8

type Row = typeof WorkflowTable.$inferSelect

type Field = {
  any: boolean
  set: Set<number>
}

type Cron = {
  minute: Field
  hour: Field
  day: Field
  month: Field
  week: Field
}

const cache = new Map<string, Cron>()

function num(input: string, min: number, max: number) {
  const value = Number.parseInt(input, 10)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid cron field value: ${input}`)
  }
  return value
}

function span(input: string, min: number, max: number) {
  const [head, tail = "1"] = input.split("/")
  const step = num(tail, 1, max - min + 1)
  const set = new Set<number>()
  const add = (start: number, end: number) => {
    for (let i = start; i <= end; i += step) set.add(i)
  }

  if (head === "*") {
    add(min, max)
    return { any: true, set }
  }

  for (const part of head.split(",")) {
    const [a, b] = part.split("-")
    if (b === undefined) {
      set.add(num(a, min, max))
      continue
    }
    const start = num(a, min, max)
    const end = num(b, min, max)
    if (end < start) throw new Error(`Invalid cron range: ${part}`)
    add(start, end)
  }

  return { any: false, set }
}

function cron(expr: string) {
  const hit = cache.get(expr)
  if (hit) return hit
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`)
  const rule = {
    minute: span(parts[0], 0, 59),
    hour: span(parts[1], 0, 23),
    day: span(parts[2], 1, 31),
    month: span(parts[3], 1, 12),
    week: span(parts[4], 0, 6),
  }
  cache.set(expr, rule)
  return rule
}

function matches(rule: Cron, date: Date) {
  if (!rule.minute.set.has(date.getMinutes())) return false
  if (!rule.hour.set.has(date.getHours())) return false
  if (!rule.month.set.has(date.getMonth() + 1)) return false
  const day = rule.day.set.has(date.getDate())
  const week = rule.week.set.has(date.getDay())
  if (rule.day.any && rule.week.any) return true
  if (rule.day.any) return week
  if (rule.week.any) return day
  return day || week
}

function nextCron(expr: string, from: number) {
  const rule = cron(expr)
  const date = new Date(from)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(rule, date)) return date.getTime()
    date.setMinutes(date.getMinutes() + 1)
  }
  return undefined
}

function nextTime(schedule: Workflow.Schedule, from: number, created: number) {
  if (schedule.type === "manual") return undefined
  if (schedule.type === "once") return schedule.at > from ? schedule.at : undefined
  if (schedule.type === "interval") {
    const start = schedule.startAt ?? created
    if (start > from) return start
    const step = Math.floor((from - start) / schedule.everyMs) + 1
    return start + step * schedule.everyMs
  }
  return nextCron(schedule.expression, from)
}

function rowStatus(row: Row, now = Date.now()): Workflow.Info["status"] {
  if (!row.enabled) return "paused"
  if (row.claim_until && row.claim_until > now) return "running"
  return "idle"
}

function toInfo(row: Row) {
  return Workflow.Info.parse({
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    lastSessionID: row.last_session_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    status: rowStatus(row),
    schedule: row.schedule,
    action: row.action,
    runCount: row.run_count,
    lastError: row.last_error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      nextRun: row.time_next_run ?? undefined,
      lastRun: row.time_last_run ?? undefined,
      lastSuccess: row.time_last_success ?? undefined,
      lastError: row.time_last_error ?? undefined,
      claimed: row.time_claimed ?? undefined,
      claimUntil: row.claim_until ?? undefined,
    },
  })
}

function sort(items: Workflow.Info[]) {
  return items.toSorted((a, b) => {
    const left = a.time.nextRun ?? Number.MAX_SAFE_INTEGER
    const right = b.time.nextRun ?? Number.MAX_SAFE_INTEGER
    if (left !== right) return left - right
    return a.name.localeCompare(b.name)
  })
}

function owner() {
  return `${process.pid}:${Instance.directory}`
}

function poll() {
  return Instance.state(
    () => {
      const timer = setInterval(
        Instance.bind(() => {
          Workflow.tick().catch((err) => log.error("workflow tick failed", { err }))
        }),
        POLL,
      )
      timer.unref?.()
      return { timer }
    },
    async (state) => {
      clearInterval(state.timer)
    },
  )
}

async function one(id: WorkflowID) {
  const row = Database.use((db) =>
    db
      .select()
      .from(WorkflowTable)
      .where(and(eq(WorkflowTable.id, id), eq(WorkflowTable.project_id, Instance.project.id)))
      .get(),
  )
  if (!row) throw new Error(`Workflow not found: ${id}`)
  return toInfo(row)
}

function stale(now: number) {
  return or(isNull(WorkflowTable.claim_until), lt(WorkflowTable.claim_until, now))
}

async function run(item: Row) {
  const sessionID: SessionID =
    item.session_id ??
    (await Session.create({
      title: `${item.name} (workflow)`,
    }).then((session) => session.id))

  const action = Workflow.Action.parse(item.action)
  if (action.type === "prompt") {
    const parts = await SessionPrompt.resolvePromptParts(action.prompt)
    await SessionPrompt.prompt({
      sessionID,
      parts,
      agent: action.agent,
      model: action.model ? Provider.parseModel(action.model) : undefined,
      variant: action.variant,
    })
  }
  if (action.type === "command") {
    await SessionPrompt.command({
      sessionID,
      command: action.command,
      arguments: action.arguments ?? "",
      agent: action.agent,
      model: action.model,
      variant: action.variant,
    })
  }
  if (action.type === "shell") {
    await SessionPrompt.shell({
      sessionID,
      command: action.script,
      agent: action.agent ?? "build",
      model: action.model ? Provider.parseModel(action.model) : undefined,
    })
  }
  return sessionID
}

function claimDue(now: number) {
  const pid = owner()
  return Database.transaction(
    () => {
      const rows = Database.use((db) =>
        db
          .select()
          .from(WorkflowTable)
          .where(
            and(
              eq(WorkflowTable.project_id, Instance.project.id),
              eq(WorkflowTable.enabled, true),
              lte(WorkflowTable.time_next_run, now),
              stale(now),
            ),
          )
          .orderBy(asc(WorkflowTable.time_next_run), asc(WorkflowTable.name))
          .limit(LIMIT)
          .all(),
      )

      return rows.flatMap((row) => {
        Database.use((db) =>
          db
            .update(WorkflowTable)
            .set({
              claim_owner: pid,
              time_claimed: now,
              claim_until: now + LEASE,
            })
            .where(and(eq(WorkflowTable.id, row.id), stale(now)))
            .run(),
        )
        return [
          {
            ...row,
            claim_owner: pid,
            time_claimed: now,
            claim_until: now + LEASE,
          },
        ]
      })
    },
    { behavior: "immediate" },
  )
}

function claim(id: WorkflowID, now: number) {
  const pid = owner()
  return Database.transaction(
    () => {
      const row = Database.use((db) =>
        db
          .select()
          .from(WorkflowTable)
          .where(and(eq(WorkflowTable.id, id), eq(WorkflowTable.project_id, Instance.project.id)))
          .get(),
      )
      if (!row) throw new Error(`Workflow not found: ${id}`)
      Database.use((db) =>
        db
          .update(WorkflowTable)
          .set({
            claim_owner: pid,
            time_claimed: now,
            claim_until: now + LEASE,
          })
          .where(and(eq(WorkflowTable.id, row.id), stale(now)))
          .run(),
      )
      if (row.claim_until && row.claim_until > now) {
        throw new Error(`Workflow is already running: ${id}`)
      }
      return {
        ...row,
        claim_owner: pid,
        time_claimed: now,
        claim_until: now + LEASE,
      }
    },
    { behavior: "immediate" },
  )
}

async function complete(input: { row: Row; sessionID?: SessionID; error?: string }) {
  const now = Date.now()
  const schedule = Workflow.Schedule.parse(input.row.schedule)
  const nextRun = nextTime(schedule, now, input.row.time_created)

  Database.use((db) =>
    db
      .update(WorkflowTable)
      .set({
        last_session_id: input.sessionID ?? input.row.last_session_id ?? null,
        run_count: input.row.run_count + 1,
        time_last_run: now,
        time_last_success: input.error ? input.row.time_last_success ?? null : now,
        time_last_error: input.error ? now : null,
        last_error: input.error ?? null,
        time_next_run: nextRun ?? null,
        claim_owner: null,
        time_claimed: null,
        claim_until: null,
      })
      .where(eq(WorkflowTable.id, input.row.id))
      .run(),
  )

  const info = await one(input.row.id)
  await Bus.publish(Workflow.Event.Updated, info)
  await Bus.publish(Workflow.Event.Run, {
    workflowID: info.id,
    sessionID: input.sessionID,
    status: input.error ? "failed" : "success",
    error: input.error,
  })
  return info
}

async function execute(row: Row) {
  const info = await one(row.id)
  await Bus.publish(Workflow.Event.Run, {
    workflowID: info.id,
    status: "running",
  })

  try {
    return await run(row).then((sessionID) => complete({ row, sessionID }))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error("workflow execution failed", { workflowID: row.id, error })
    return complete({ row, error })
  }
}

function scoped() {
  return eq(WorkflowTable.project_id, Instance.project.id)
}

export namespace Workflow {
  const model = z.string().regex(/^[^/]+\/[^/]+$/).meta({ ref: "WorkflowModel" })

  export const Schedule = z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("manual") }),
      z.object({
        type: z.literal("once"),
        at: z.number().int().positive(),
      }),
      z.object({
        type: z.literal("interval"),
        everyMs: z.number().int().positive(),
        startAt: z.number().int().positive().optional(),
      }),
      z.object({
        type: z.literal("cron"),
        expression: z.string().trim().min(1),
      }),
    ])
    .meta({ ref: "WorkflowSchedule" })
  export type Schedule = z.infer<typeof Schedule>

  export const Action = z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("prompt"),
        prompt: z.string().trim().min(1),
        agent: z.string().optional(),
        model: model.optional(),
        variant: z.string().optional(),
      }),
      z.object({
        type: z.literal("command"),
        command: z.string().trim().min(1),
        arguments: z.string().optional(),
        agent: z.string().optional(),
        model: model.optional(),
        variant: z.string().optional(),
      }),
      z.object({
        type: z.literal("shell"),
        script: z.string().trim().min(1),
        agent: z.string().optional(),
        model: model.optional(),
      }),
    ])
    .meta({ ref: "WorkflowAction" })
  export type Action = z.infer<typeof Action>

  export const Info = z
    .object({
      id: WorkflowID.zod,
      projectID: ProjectID.zod,
      sessionID: SessionID.zod.optional(),
      lastSessionID: SessionID.zod.optional(),
      name: z.string(),
      description: z.string().optional(),
      enabled: z.boolean(),
      status: z.enum(["idle", "running", "paused"]),
      schedule: Schedule,
      action: Action,
      runCount: z.number().int().nonnegative(),
      lastError: z.string().optional(),
      time: z.object({
        created: z.number().int(),
        updated: z.number().int(),
        nextRun: z.number().int().optional(),
        lastRun: z.number().int().optional(),
        lastSuccess: z.number().int().optional(),
        lastError: z.number().int().optional(),
        claimed: z.number().int().optional(),
        claimUntil: z.number().int().optional(),
      }),
    })
    .meta({ ref: "Workflow" })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      sessionID: SessionID.zod.optional(),
      enabled: z.boolean().optional(),
      schedule: Schedule,
      action: Action,
    })
    .meta({ ref: "WorkflowCreateInput" })
  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z
    .object({
      id: WorkflowID.zod,
      name: z.string().trim().min(1).optional(),
      description: z.string().trim().nullable().optional(),
      sessionID: SessionID.zod.nullable().optional(),
      enabled: z.boolean().optional(),
      schedule: Schedule.optional(),
      action: Action.optional(),
    })
    .meta({ ref: "WorkflowUpdateInput" })
  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Updated: BusEvent.define("workflow.updated", Info),
    Run: BusEvent.define(
      "workflow.run",
      z.object({
        workflowID: WorkflowID.zod,
        sessionID: SessionID.zod.optional(),
        status: z.enum(["running", "success", "failed"]),
        error: z.string().optional(),
      }),
    ),
  }

  export function init() {
    poll()()
  }

  export async function list() {
    const rows = Database.use((db) =>
      db.select().from(WorkflowTable).where(scoped()).orderBy(asc(WorkflowTable.name)).all(),
    )
    return sort(rows.map(toInfo))
  }

  export async function get(id: string) {
    return one(WorkflowID.make(id))
  }

  export async function create(input: z.input<typeof CreateInput>) {
    const created = CreateInput.parse(input)
    const now = Date.now()
    const id = WorkflowID.ascending()
    const enabled = created.enabled ?? true
    Database.use((db) =>
      db
        .insert(WorkflowTable)
        .values({
          id,
          project_id: Instance.project.id,
          session_id: created.sessionID ?? null,
          last_session_id: null,
          name: created.name,
          description: created.description ?? null,
          enabled,
          schedule: created.schedule,
          action: created.action,
          run_count: 0,
          time_next_run: enabled ? (nextTime(created.schedule, now - 1, now) ?? null) : null,
          time_last_run: null,
          time_last_success: null,
          time_last_error: null,
          last_error: null,
          claim_owner: null,
          time_claimed: null,
          claim_until: null,
        })
        .run(),
    )
    const info = await one(id)
    await Bus.publish(Event.Updated, info)
    return info
  }

  export async function update(input: z.input<typeof UpdateInput>) {
    const change = UpdateInput.parse(input)
    const now = Date.now()
    const row = Database.use((db) =>
      db.select().from(WorkflowTable).where(and(eq(WorkflowTable.id, WorkflowID.make(change.id)), scoped())).get(),
    )
    if (!row) throw new Error(`Workflow not found: ${change.id}`)

    const enabled = change.enabled ?? row.enabled
    const schedule = change.schedule ?? Schedule.parse(row.schedule)

    Database.use((db) =>
      db
        .update(WorkflowTable)
        .set({
          name: change.name ?? row.name,
          description:
            change.description === null ? null : change.description === undefined ? row.description ?? null : change.description,
          session_id:
            change.sessionID === null ? null : change.sessionID === undefined ? row.session_id ?? null : change.sessionID,
          enabled,
          schedule,
          action: change.action ?? Action.parse(row.action),
          time_next_run:
            enabled && (!row.claim_until || row.claim_until <= now) ? (nextTime(schedule, now, row.time_created) ?? null) : row.time_next_run,
          claim_owner: enabled ? row.claim_owner ?? null : null,
          time_claimed: enabled ? row.time_claimed ?? null : null,
          claim_until: enabled ? row.claim_until ?? null : null,
        })
        .where(eq(WorkflowTable.id, change.id))
        .run(),
    )

    const info = await one(WorkflowID.make(change.id))
    await Bus.publish(Event.Updated, info)
    return info
  }

  export async function remove(id: string) {
    const next = WorkflowID.make(id)
    const info = await one(next)
    Database.use((db) => db.delete(WorkflowTable).where(and(eq(WorkflowTable.id, next), scoped())).run())
    await Bus.publish(Event.Updated, {
      ...info,
      enabled: false,
      status: "paused",
    })
    return true
  }

  export async function pause(id: string) {
    return update({ id, enabled: false })
  }

  export async function resume(id: string) {
    return update({ id, enabled: true })
  }

  export async function trigger(id: string) {
    return execute(claim(WorkflowID.make(id), Date.now()))
  }

  export async function tick() {
    for (const row of claimDue(Date.now())) {
      await execute(row)
    }
  }
}
