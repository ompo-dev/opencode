import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Workflow } from "@/workflow"
import { lazy } from "@/util/lazy"

export const WorkflowRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List workflows",
        description: "Get all durable workflows for the current project.",
        operationId: "workflow.list",
        responses: {
          200: {
            description: "Workflow list",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => c.json(await Workflow.list()),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create workflow",
        description: "Create a durable workflow for the current project.",
        operationId: "workflow.create",
        responses: {
          200: {
            description: "Created workflow",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("json", Workflow.CreateInput),
      async (c) => c.json(await Workflow.create(c.req.valid("json"))),
    )
    .get(
      "/:workflowID",
      describeRoute({
        summary: "Get workflow",
        description: "Get a workflow by id.",
        operationId: "workflow.get",
        responses: {
          200: {
            description: "Workflow",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      async (c) => c.json(await Workflow.get(c.req.valid("param").workflowID)),
    )
    .patch(
      "/:workflowID",
      describeRoute({
        summary: "Update workflow",
        description: "Update an existing workflow.",
        operationId: "workflow.update",
        responses: {
          200: {
            description: "Updated workflow",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      validator("json", Workflow.UpdateInput.omit({ id: true })),
      async (c) => c.json(await Workflow.update({ id: c.req.valid("param").workflowID, ...c.req.valid("json") })),
    )
    .delete(
      "/:workflowID",
      describeRoute({
        summary: "Delete workflow",
        description: "Delete a workflow.",
        operationId: "workflow.delete",
        responses: {
          200: {
            description: "Deletion acknowledgement",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      async (c) => c.json(await Workflow.remove(c.req.valid("param").workflowID)),
    )
    .post(
      "/:workflowID/trigger",
      describeRoute({
        summary: "Trigger workflow",
        description: "Run a workflow immediately.",
        operationId: "workflow.trigger",
        responses: {
          200: {
            description: "Workflow after trigger",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      async (c) => c.json(await Workflow.trigger(c.req.valid("param").workflowID)),
    )
    .post(
      "/:workflowID/pause",
      describeRoute({
        summary: "Pause workflow",
        description: "Pause scheduled execution for a workflow.",
        operationId: "workflow.pause",
        responses: {
          200: {
            description: "Paused workflow",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      async (c) => c.json(await Workflow.pause(c.req.valid("param").workflowID)),
    )
    .post(
      "/:workflowID/resume",
      describeRoute({
        summary: "Resume workflow",
        description: "Resume scheduled execution for a workflow.",
        operationId: "workflow.resume",
        responses: {
          200: {
            description: "Resumed workflow",
            content: {
              "application/json": {
                schema: resolver(Workflow.Info),
              },
            },
          },
        },
      }),
      validator("param", z.object({ workflowID: Workflow.UpdateInput.shape.id })),
      async (c) => c.json(await Workflow.resume(c.req.valid("param").workflowID)),
    ),
)
