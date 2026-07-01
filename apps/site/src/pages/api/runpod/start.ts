import {
  planShards,
  RunPodClient,
  type QualityPreset,
  type WorkerInput,
} from "@sense-sight/runpod-orchestrator";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { COOKIE_NAME, verifySession } from "../../../lib/demo-session";
import {
  configuredGpusPerSession,
  configuredWarmGpuPool,
  parsePositiveInt,
  summarizeRunPodCapacity,
} from "../../../lib/runpod-capacity";

export const prerender = false;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function configuredQualityPreset(value: string | undefined): QualityPreset {
  return value === "balanced" || value === "research" ? value : "preview";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const session = await verifySession(cookies.get(COOKIE_NAME)?.value);
  if (!session && !import.meta.env.DEV) {
    return json(
      { ok: false, message: "Portal session required." },
      { status: 401 }
    );
  }

  if (!env.RUNPOD_API_KEY || !env.RUNPOD_ENDPOINT_ID) {
    return json(
      {
        ok: false,
        message: "RunPod endpoint is not configured.",
        configured: {
          runpodApiKey: Boolean(env.RUNPOD_API_KEY),
          runpodEndpointId: Boolean(env.RUNPOD_ENDPOINT_ID),
        },
      },
      { status: 503 }
    );
  }
  const endpointId = env.RUNPOD_ENDPOINT_ID;

  const hasR2Bundle = Boolean(
    env.RUNPOD_BUNDLE_URI && env.RUNPOD_BUNDLE_SHA256
  );
  const hasVolumeBundle = Boolean(
    env.RUNPOD_BUNDLE_VOLUME_PATH && env.RUNPOD_BUNDLE_SHA256
  );
  if (!hasR2Bundle && !hasVolumeBundle) {
    return json(
      {
        ok: false,
        message:
          "RunPod bundle is not configured. Set RUNPOD_BUNDLE_URI or RUNPOD_BUNDLE_VOLUME_PATH plus RUNPOD_BUNDLE_SHA256.",
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    sourceId?: string;
    sequence?: string;
    keyframeCount?: number;
    shardCount?: number;
    overlapKeyframes?: number;
    qualityPreset?: string;
    trainSteps?: number;
    seedPointLimit?: number;
  };
  const sequence = body.sequence || body.sourceId || "corridor1-2";
  const keyframeCount =
    typeof body.keyframeCount === "number" && body.keyframeCount > 0
      ? Math.floor(body.keyframeCount)
      : 180;
  const qualityPreset = configuredQualityPreset(
    body.qualityPreset ?? env.RUNPOD_QUALITY_PRESET
  );
  const trainSteps = parsePositiveInt(
    body.trainSteps ?? env.RUNPOD_TRAIN_STEPS,
    qualityPreset === "preview"
      ? 300
      : qualityPreset === "balanced"
        ? 3000
        : 9000
  );
  const seedPointLimit = parsePositiveInt(
    body.seedPointLimit,
    qualityPreset === "preview"
      ? 80_000
      : qualityPreset === "balanced"
        ? 160_000
        : 240_000
  );
  const targetWarmGpuCount = configuredWarmGpuPool(env.RUNPOD_WARM_GPU_POOL);
  const gpusPerSession = configuredGpusPerSession(
    env.RUNPOD_GPUS_PER_SESSION,
    targetWarmGpuCount
  );
  const shardCount = clamp(
    Math.floor(
      body.shardCount ??
        parsePositiveInt(
          env.RUNPOD_PARALLEL_SHARDS,
          Math.min(gpusPerSession, 3)
        )
    ),
    1,
    gpusPerSession
  );
  const overlapKeyframes = clamp(Math.floor(body.overlapKeyframes ?? 4), 0, 12);
  const plannedShards = planShards(keyframeCount, shardCount, overlapKeyframes);
  const now = Date.now();

  const makeInput = (shard: (typeof plannedShards)[number]): WorkerInput => ({
    jobType: "online_update",
    schemaVersion: "1.0.0",
    worldId: sequence,
    sequence,
    submapId: `${sequence}-live-${now}-shard-${shard.index + 1}`,
    bundle: hasR2Bundle
      ? {
          mode: "r2",
          uri: env.RUNPOD_BUNDLE_URI,
          sha256: env.RUNPOD_BUNDLE_SHA256 as string,
        }
      : {
          mode: "volume",
          volumePath: env.RUNPOD_BUNDLE_VOLUME_PATH,
          sha256: env.RUNPOD_BUNDLE_SHA256 as string,
        },
    shard: {
      index: shard.index,
      count: shardCount,
      strategy: "contiguous_overlap",
      keyframeStart: shard.keyframeStart,
      keyframeEnd: shard.keyframeEnd,
      overlapKeyframes: shard.overlapKeyframes,
    },
    train: {
      steps: trainSteps,
      initScale: 0.01,
      prune: 0.005,
      qualityPreset,
      seedPointLimit,
      shDegree: qualityPreset === "preview" ? 0 : 3,
      densify: qualityPreset !== "preview",
      scaleRegQuantile: 0.99,
    },
    output: env.RUNPOD_OUTPUT_PREFIX_URI
      ? { mode: "r2", prefixUri: env.RUNPOD_OUTPUT_PREFIX_URI }
      : { mode: "return" },
    provenance: {
      imageTag: env.RUNPOD_WORKER_IMAGE_TAG || "runpod-worker",
      poseGraphVersion: sequence,
      calibrationVersion: "site-console",
    },
  });

  try {
    const client = new RunPodClient({ apiKey: env.RUNPOD_API_KEY });
    const jobs = await Promise.all(
      plannedShards.map(async (shard) => {
        const input = makeInput(shard);
        const job = await client.runEndpoint(endpointId, input, {
          policy: { ttl: 900_000, executionTimeout: 1_800_000 },
        });
        return {
          ...job,
          shard: {
            index: shard.index,
            count: shardCount,
            keyframeStart: shard.keyframeStart,
            keyframeEnd: shard.keyframeEnd,
          },
          submapId: input.submapId,
        };
      })
    );
    const health = await client.endpointHealth(endpointId).catch(() => null);
    return json({
      ok: true,
      endpointId,
      job: jobs[0],
      jobs,
      capacity: health
        ? summarizeRunPodCapacity(health, targetWarmGpuCount, gpusPerSession)
        : null,
      input: {
        worldId: sequence,
        sequence,
        shardCount,
        qualityPreset,
        steps: trainSteps,
        seedPointLimit,
        targetWarmGpuCount,
        gpusPerSession,
        outputMode: env.RUNPOD_OUTPUT_PREFIX_URI ? "r2" : "return",
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "RunPod job submission failed.",
      },
      { status: 502 }
    );
  }
};
