import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import {
  AssetInput,
  AssetOutput,
  CancelInput,
  EnsureInput,
  ReferenceInput,
  ReferenceOutput,
  Status,
  SynthesizeInput,
  SynthesizeOutput,
  TranscribeInput,
  TranscribeOutput,
} from "@opencode-ai/voice/schema"
import { errors } from "../error"
import { Voice } from "@/voice"

export const GlobalVoiceRoutes = () =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get voice runtime status",
        description: "Retrieve the current local voice runtime status, paths, configuration, and readiness.",
        operationId: "global.voice.status",
        responses: {
          200: {
            description: "Voice status",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Voice.status())
      },
    )
    .post(
      "/ensure",
      describeRoute({
        summary: "Ensure voice runtime",
        description: "Install and initialize the local voice runtime, Python environment, ffmpeg, and models for one or all voice engines.",
        operationId: "global.voice.ensure",
        responses: {
          200: {
            description: "Voice status",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", EnsureInput),
      async (c) => {
        return c.json(await Voice.ensure(c.req.valid("json")))
      },
    )
    .post(
      "/cancel",
      describeRoute({
        summary: "Cancel voice install",
        description: "Cancel the current voice installation, warmup, or preload task.",
        operationId: "global.voice.cancel",
        responses: {
          200: {
            description: "Voice status",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CancelInput),
      async (c) => {
        return c.json(await Voice.cancel(c.req.valid("json")))
      },
    )
    .post(
      "/asset",
      describeRoute({
        summary: "Load reference asset",
        description: "Read a local reference audio file and return it as a data URL for playback in the app.",
        operationId: "global.voice.asset",
        responses: {
          200: {
            description: "Voice asset payload",
            content: {
              "application/json": {
                schema: resolver(AssetOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AssetInput),
      async (c) => {
        return c.json(await Voice.asset(c.req.valid("json")))
      },
    )
    .post(
      "/reference",
      describeRoute({
        summary: "Store reference audio",
        description: "Persist a reference voice clip for OmniVoice presets and optionally auto-transcribe it.",
        operationId: "global.voice.reference",
        responses: {
          200: {
            description: "Stored reference audio",
            content: {
              "application/json": {
                schema: resolver(ReferenceOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ReferenceInput),
      async (c) => {
        return c.json(await Voice.reference(c.req.valid("json")))
      },
    )
    .post(
      "/transcribe",
      describeRoute({
        summary: "Transcribe audio",
        description: "Transcribe a short audio clip with WhisperX and return aligned timestamps.",
        operationId: "global.voice.transcribe",
        responses: {
          200: {
            description: "Transcription result",
            content: {
              "application/json": {
                schema: resolver(TranscribeOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", TranscribeInput),
      async (c) => {
        return c.json(await Voice.transcribe(c.req.valid("json")))
      },
    )
    .post(
      "/synthesize",
      describeRoute({
        summary: "Synthesize speech",
        description: "Generate speech from text with OmniVoice and return a WAV data URL payload.",
        operationId: "global.voice.synthesize",
        responses: {
          200: {
            description: "Synthesis result",
            content: {
              "application/json": {
                schema: resolver(SynthesizeOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", SynthesizeInput),
      async (c) => {
        return c.json(await Voice.synthesize(c.req.valid("json")))
      },
    )
