import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import { Kanban } from "@/kanban/kanban"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"

const input = z.object({
  operations: z.array(Kanban.Operation).min(1),
})

export const KanbanRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get kanban board",
        description: "Retrieve the kanban board for the current project.",
        operationId: "kanban.get",
        responses: {
          200: {
            description: "Kanban board",
            content: {
              "application/json": {
                schema: resolver(Kanban.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Kanban.get(Kanban.project(Instance.project.id)))
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update kanban board",
        description: "Create, edit, move, or delete kanban columns and cards for the current project.",
        operationId: "kanban.update",
        responses: {
          200: {
            description: "Updated kanban board",
            content: {
              "application/json": {
                schema: resolver(Kanban.Info),
              },
            },
          },
        },
      }),
      validator("json", input),
      async (c) => {
        const board = await Kanban.update({
          ...Kanban.project(Instance.project.id),
          operations: c.req.valid("json").operations,
        })
        await Bus.publish(Kanban.Event.Updated, board)
        return c.json(board)
      },
    ),
)

export const GlobalKanbanRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get global kanban board",
        description: "Retrieve the global kanban board shared across projects.",
        operationId: "global.kanban.get",
        responses: {
          200: {
            description: "Kanban board",
            content: {
              "application/json": {
                schema: resolver(Kanban.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Kanban.get(Kanban.global()))
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update global kanban board",
        description: "Create, edit, move, or delete kanban columns and cards on the global board.",
        operationId: "global.kanban.update",
        responses: {
          200: {
            description: "Updated kanban board",
            content: {
              "application/json": {
                schema: resolver(Kanban.Info),
              },
            },
          },
        },
      }),
      validator("json", input),
      async (c) => {
        const board = await Kanban.update({
          ...Kanban.global(),
          operations: c.req.valid("json").operations,
        })
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Kanban.Event.Updated.type,
            properties: board,
          },
        })
        return c.json(board)
      },
    ),
)
