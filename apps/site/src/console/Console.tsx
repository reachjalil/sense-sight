import {
  DEFAULT_INTERIOR_VISIBILITY_TUNING,
  DEFAULT_TRAINED_RENDER_PROFILE,
  TRAINED_RENDER_PROFILE_OPTIONS,
  TRAINED_RENDER_PROFILES,
  applyInteriorVisibilityProfile,
  inferSceneShapesFromPoints,
  trainedSplatFilename,
  type InteriorVisibilityTuning,
  type RenderLayers,
  type RenderPreset,
  type SceneShapeAnalysis,
  type TrainedPreviewMode,
  type TrainedRenderProfile,
  type TrainedRenderProfileId,
} from "@sense-sight/render-contracts";
import {
  decodeSplat,
  SPLAT_RECORD_BYTES,
  type DecodedSplat,
} from "@sense-sight/splat-codec";
import {
  SOURCE_REGISTRY,
  type FrameStreamSource,
  type ReplayHello,
  type ReplaySourceEntry,
} from "@sense-sight/replay-protocol";
import type { Bounds, Vec3 } from "@sense-sight/world-schema";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunPodCapacitySummary } from "../lib/runpod-capacity";
import { fetchPresetAssets } from "../live/asset-loader";
import {
  ControlPanel,
  type LiveGenerationQuality,
  type LoadStatus,
  type SensorEvidenceSummary,
} from "../live/ControlPanel";
import {
  appendGaussians,
  appendPoints,
  getRevealedGaussians,
  getRevealedPoints,
  initCloud,
  initSplat,
  resetCloud,
  resetSplat,
} from "../live/live-cloud";
import { createReplaySource } from "../live/replay-source";
import {
  CAMERA_VIEW_LABELS,
  type CameraViewId,
  type CameraViewRequest,
  type RobotPose,
  type TrainedSplatAsset,
  Viewer,
  type ViewerRenderMode,
} from "../live/Viewer";
import { SourcePicker } from "./SourcePicker";

const DEFAULT_LAYERS: RenderLayers = {
  pointcloud: true,
  trajectory: true,
  splat: true,
  grid: true,
  annotations: false,
};

const PHOTOREAL_LAYERS: RenderLayers = {
  pointcloud: false,
  trajectory: false,
  splat: true,
  grid: false,
  annotations: false,
};

const DEMO_PRESET: RenderPreset = {
  label: "Corridor demo",
  description: "Default console preview preset.",
  base: "corridor-demo",
  pointSize: 0.05,
  tone: "Live preview",
  coordinateFrame: "training-frame",
};

const TRAINED_ITERATIONS = 30000;
const DEFAULT_RENDER_PROFILE_ID: TrainedRenderProfileId = "photoreal";
const DEFAULT_TRAINED_PREVIEW_MODE: TrainedPreviewMode = "splat";
const DEFAULT_LIVE_QUALITY: LiveGenerationQuality = "research";
const RUNPOD_POLL_INTERVAL_MS = 2000;
const RUNPOD_REQUEST_TIMEOUT_MS = 15_000;
const RUNPOD_ARTIFACT_TIMEOUT_MS = 60_000;
const RUNPOD_QUEUE_TIMEOUT_MS = 10 * 60_000;
const RUNPOD_TOTAL_TIMEOUT_MS = 25 * 60_000;
const RUNPOD_INACTIVE_CANCEL_GRACE_MS = 30_000;
const RUNPOD_GPUS_PER_SESSION = 1;

const RENDER_MODE_LABEL: Record<ViewerRenderMode, string> = {
  empty: "No scene",
  fallback: "Point fallback",
  points: "Dot preview",
  seed: "Seed cloud",
  spark: "Spark 3DGS",
  stream: "Live stream",
};

type ConsolePhase = "picker" | "selected" | "live";
type LiveStartMode = "gpu" | "pretrained";

type RunPodJobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

interface RunPodWorkerOutput {
  readonly status: "completed" | "failed";
  readonly artifact: {
    readonly mode: "return" | "r2";
    readonly splatBase64?: string;
    readonly splatUri?: string;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly metrics?: {
    readonly primitiveCount?: number;
    readonly trainSeconds?: number;
  };
  readonly stage?: {
    readonly current: string;
    readonly fraction: number;
    readonly message?: string;
  };
  readonly error: string | null;
}

interface RunPodStatusResponse {
  readonly id: string;
  readonly status: RunPodJobStatus;
  readonly output?: RunPodWorkerOutput;
  readonly error?: string;
}

interface RunPodHealthResponse {
  readonly ok?: boolean;
  readonly capacity?: RunPodCapacitySummary | null;
}

interface RunPodSubmittedJob {
  readonly id: string;
  readonly status: RunPodJobStatus;
  readonly shard?: {
    readonly index: number;
    readonly count: number;
    readonly keyframeStart: number;
    readonly keyframeEnd: number;
  };
  readonly submapId?: string;
}

interface ActiveRunPodJob {
  readonly id: string;
  readonly shardIndex: number;
  readonly shardCount: number;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function runPodStatusLabel(status: RunPodJobStatus): string {
  switch (status) {
    case "IN_QUEUE":
      return "Queued on RunPod GPU";
    case "IN_PROGRESS":
      return "Training splat on RunPod GPU";
    case "COMPLETED":
      return "RunPod splat ready";
    case "FAILED":
      return "RunPod training failed";
    case "CANCELLED":
      return "RunPod training cancelled";
    case "TIMED_OUT":
      return "RunPod training timed out";
    default:
      return "RunPod status pending";
  }
}

function formatRunPodElapsed(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function waitForRunPodPoll(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, RUNPOD_POLL_INTERVAL_MS);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const outerSignal = init.signal;
  const abortForOuterSignal = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) {
    abortForOuterSignal();
  } else {
    outerSignal?.addEventListener("abort", abortForOuterSignal, {
      once: true,
    });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !outerSignal?.aborted) {
      throw new Error(
        `RunPod request timed out after ${formatRunPodElapsed(timeoutMs)}.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener("abort", abortForOuterSignal);
  }
}

function runPodQueueLabel(capacity: RunPodCapacitySummary): string {
  if (capacity.queuedSessionCount > 0) {
    return `${capacity.queuedSessionCount} waiting`;
  }
  if (capacity.availableSessionSlots > 0) {
    return `${capacity.availableSessionSlots} slot${
      capacity.availableSessionSlots === 1 ? "" : "s"
    } open`;
  }
  return "Warming";
}

function applyRenderProfileOverrides(
  profile: TrainedRenderProfile,
  overrides: Partial<TrainedRenderProfile>
): TrainedRenderProfile {
  if (Object.keys(overrides).length === 0) return profile;
  return {
    ...profile,
    ...overrides,
    label: `${profile.label} custom`,
  };
}

function liveProfileForBase(
  profile: TrainedRenderProfile
): TrainedRenderProfile {
  return {
    ...profile,
    label: `${profile.label} live`,
    radiusDefault: Math.min(profile.radiusDefault, 0.72),
    radiusMin: Math.min(profile.radiusMin, 0.12),
    radiusMax: Math.min(profile.radiusMax, 1.15),
    radiusStep: Math.min(profile.radiusStep, 0.025),
    minAlpha: Math.min(profile.minAlpha, 5 / 255),
    maxPixelRadius: Math.min(profile.maxPixelRadius, 112),
    maxStdDev: Math.min(profile.maxStdDev, Math.sqrt(8)),
    focalAdjustment: Math.min(profile.focalAdjustment, 1.08),
    falloff: Math.min(profile.falloff, 0.98),
    opacity: Math.min(profile.opacity, 0.96),
    fallbackMinAlpha: Math.min(profile.fallbackMinAlpha, 8 / 255),
    fallbackMinScale: Math.min(profile.fallbackMinScale, 0.0002),
    fallbackMaxScale: Math.min(profile.fallbackMaxScale, 0.012),
    fallbackMaxScreenSize: Math.min(profile.fallbackMaxScreenSize, 12),
    fallbackAlphaPower: Math.max(profile.fallbackAlphaPower, 1.25),
    fallbackColorGain: Math.max(profile.fallbackColorGain, 1.08),
    fallbackOpacity: Math.min(profile.fallbackOpacity, 0.92),
  };
}

function parseTimestampSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface KeyframeDoc {
  readonly index: number;
  readonly position: Vec3;
  readonly headingRad: number;
  readonly imageRel?: string;
}

interface FusionKeyframeDoc extends KeyframeDoc {
  readonly submapId: string;
  readonly timestamp?: string;
}

interface FusionKeyframesDoc {
  readonly keyframes: FusionKeyframeDoc[];
}

interface SensorFusionReportDoc {
  readonly sensorInventory?: {
    readonly sensors?: Array<{
      readonly sensorId: string;
      readonly modality: string;
      readonly usedByMapper?: boolean;
    }>;
  };
  readonly unifiedTimeline?: {
    readonly streamCount?: number;
  };
  readonly pose?: {
    readonly poseCoverage?: number;
    readonly pathLengthM?: number;
    readonly relativeOdomAgreement?: {
      readonly translationStepErrorM?: {
        readonly median?: number;
      };
    };
  };
  readonly depth?: {
    readonly validRatio?: {
      readonly mean?: number;
    };
  };
  readonly motionSensors?: {
    readonly d400Gyro?: { readonly rateHz?: number };
    readonly t265Gyro?: { readonly rateHz?: number };
  };
}

interface SensorTimelineDoc {
  readonly streams?: Array<{
    readonly sensorId: string;
    readonly modality: string;
    readonly usedByMapper?: boolean;
    readonly window?: { readonly rateHz?: number };
    readonly full?: { readonly rateHz?: number };
  }>;
}

interface FusionManifestItem {
  readonly id: string;
  readonly base: string;
  readonly splatFile: string;
  readonly gaussianCount?: number;
  readonly sourceBounds: Bounds;
  readonly targetBounds?: Bounds;
}

interface FusionManifest {
  readonly coordinateFrame?: TrainedSplatAsset["coordinateFrame"];
  readonly items: readonly FusionManifestItem[];
}

interface TrainedSplatManifest {
  readonly splatFile: string;
  readonly coordinateFrame?: TrainedSplatAsset["coordinateFrame"];
  readonly gaussianCount?: number;
  readonly bounds: Bounds;
}

function boundsFromHello(hello: ReplayHello): Bounds {
  return { min: hello.bounds.min, max: hello.bounds.max };
}

function sensorEvidenceFromDocs(
  report: SensorFusionReportDoc | null,
  timeline: SensorTimelineDoc | null
): SensorEvidenceSummary | null {
  if (!report && !timeline) return null;
  const sensors = report?.sensorInventory?.sensors ?? [];
  const streams = timeline?.streams ?? [];
  return {
    sensorCount: sensors.length || undefined,
    mappedSensorCount:
      sensors.filter((sensor) => sensor.usedByMapper).length || undefined,
    streamCount: report?.unifiedTimeline?.streamCount ?? streams.length,
    poseCoverage: report?.pose?.poseCoverage,
    depthValidMean: report?.depth?.validRatio?.mean,
    pathLengthM: report?.pose?.pathLengthM,
    imuRateHz:
      report?.motionSensors?.d400Gyro?.rateHz ??
      report?.motionSensors?.t265Gyro?.rateHz,
    odomStepErrorM:
      report?.pose?.relativeOdomAgreement?.translationStepErrorM?.median,
    streams: streams.map((stream) => ({
      sensorId: stream.sensorId,
      modality: stream.modality,
      rateHz: stream.window?.rateHz ?? stream.full?.rateHz,
      usedByMapper: stream.usedByMapper,
    })),
  };
}

async function fetchOptionalJson<T>(
  url: string,
  signal: AbortSignal
): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return res.json() as Promise<T>;
}

function groupFusionTrajectory(
  keyframes: readonly FusionKeyframeDoc[]
): readonly (readonly Vec3[])[] {
  const groups = new Map<string, Vec3[]>();
  for (const keyframe of keyframes) {
    const points = groups.get(keyframe.submapId) ?? [];
    points.push(keyframe.position);
    groups.set(keyframe.submapId, points);
  }
  return [...groups.values()];
}

function nearestFusionPose(
  frameIndex: number,
  keyframes: readonly FusionKeyframeDoc[],
  progress?: number,
  timestamp?: string
): RobotPose | null {
  if (keyframes.length === 0) return null;
  const frameTimestamp = parseTimestampSeconds(timestamp);
  if (frameTimestamp !== null) {
    let nearestByTime = keyframes[0];
    let nearestTimeDistance = Math.abs(
      frameTimestamp - (parseTimestampSeconds(nearestByTime.timestamp) ?? 0)
    );
    for (let i = 1; i < keyframes.length; i += 1) {
      const candidate = keyframes[i];
      const candidateTimestamp = parseTimestampSeconds(candidate.timestamp);
      if (candidateTimestamp === null) continue;
      const distance = Math.abs(frameTimestamp - candidateTimestamp);
      if (distance < nearestTimeDistance) {
        nearestByTime = candidate;
        nearestTimeDistance = distance;
      }
    }
    return {
      position: nearestByTime.position,
      headingRad: nearestByTime.headingRad,
    };
  }

  const firstIndex = keyframes[0].index;
  const lastIndex = keyframes[keyframes.length - 1].index;
  const usesDatasetIndices = frameIndex < firstIndex && progress !== undefined;
  const comparableIndex = usesDatasetIndices
    ? firstIndex + progress * Math.max(1, lastIndex - firstIndex)
    : frameIndex;
  let nearest = keyframes[0];
  let nearestDistance = Math.abs(comparableIndex - nearest.index);
  for (let i = 1; i < keyframes.length; i += 1) {
    const candidate = keyframes[i];
    const distance = Math.abs(comparableIndex - candidate.index);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { position: nearest.position, headingRad: nearest.headingRad };
}

export function Console() {
  const [phase, setPhase] = useState<ConsolePhase>("picker");
  const [sources, setSources] =
    useState<readonly ReplaySourceEntry[]>(SOURCE_REGISTRY);
  const [selected, setSelected] = useState<ReplaySourceEntry | null>(null);

  const [layers, setLayers] = useState<RenderLayers>(DEFAULT_LAYERS);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Orbit camera");
  const [cameraView, setCameraView] = useState<CameraViewRequest>({
    id: "orbit",
    version: 0,
  });
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [renderMode, setRenderMode] = useState<ViewerRenderMode>("empty");
  const [worldBounds, setWorldBounds] = useState<Bounds | null>(null);
  const [seedPositions, setSeedPositions] = useState<Float32Array | null>(null);
  const [seedColors, setSeedColors] = useState<Float32Array | null>(null);
  const [sceneShapeAnalysis, setSceneShapeAnalysis] =
    useState<SceneShapeAnalysis | null>(null);
  const [interiorVisibility, setInteriorVisibility] =
    useState<InteriorVisibilityTuning>(DEFAULT_INTERIOR_VISIBILITY_TUNING);
  const [renderProfileId, setRenderProfileId] =
    useState<TrainedRenderProfileId>(DEFAULT_RENDER_PROFILE_ID);
  const [trainedPreviewMode, setTrainedPreviewMode] =
    useState<TrainedPreviewMode>(DEFAULT_TRAINED_PREVIEW_MODE);
  const [renderProfileOverrides, setRenderProfileOverrides] = useState<
    Partial<TrainedRenderProfile>
  >({});
  const [pointCount, setPointCount] = useState(0);
  const [trajectoryPoints, setTrajectoryPoints] = useState<readonly Vec3[]>([]);
  const [trajectorySegments, setTrajectorySegments] = useState<
    readonly (readonly Vec3[])[] | null
  >(null);
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);
  const [sensorEvidence, setSensorEvidence] =
    useState<SensorEvidenceSummary | null>(null);
  const [trainedSplat, setTrainedSplat] = useState<TrainedSplatAsset | null>(
    null
  );
  const [gaussianCount, setGaussianCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- Live streaming state ---
  const [isLive, setIsLive] = useState(false);
  const [isPreloadingLive, setIsPreloadingLive] = useState(false);
  const [liveStartMode, setLiveStartMode] = useState<LiveStartMode | null>(
    null
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cameraImageUrl, setCameraImageUrl] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [runPodStatus, setRunPodStatus] = useState<string | null>(null);
  const [runPodCapacity, setRunPodCapacity] =
    useState<RunPodCapacitySummary | null>(null);
  const [liveQualityPreset, setLiveQualityPreset] =
    useState<LiveGenerationQuality>(DEFAULT_LIVE_QUALITY);

  const sourceRef = useRef<FrameStreamSource | null>(null);
  const previewControllerRef = useRef<AbortController | null>(null);
  const helloRef = useRef<ReplayHello | null>(null);
  const fusionKeyframesRef = useRef<readonly FusionKeyframeDoc[]>([]);
  const runPodAbortRef = useRef<AbortController | null>(null);
  const activeRunPodJobsRef = useRef<Map<string, ActiveRunPodJob>>(new Map());
  const runPodGaussianCountRef = useRef(0);
  const splatRef = useRef<DecodedSplat | null>(null);
  const splatCursorRef = useRef(0);
  const useStreamedSplatRef = useRef(false);
  // Photoreal (OpenSplat-trained) splat for the live view, rendered via Spark.
  // When present it replaces the dotty point-init streamed splat.
  const [liveTrainedSplats, setLiveTrainedSplats] = useState<
    readonly TrainedSplatAsset[] | null
  >(null);
  const liveTrainedUrlsRef = useRef<string[]>([]);

  // Static preview assets (idle/selected state): keep the corridor-demo Spark
  // splat path working so the picker → idle viewer shows a real scene.
  useEffect(() => {
    const controller = new AbortController();
    const splatFileName = trainedSplatFilename(TRAINED_ITERATIONS, "viewer");
    setLoadStatus("loading");
    setLoadError(null);

    fetchPresetAssets(DEMO_PRESET.base, splatFileName, controller.signal)
      .then((assets) => {
        if (controller.signal.aborted) return;
        setWorldBounds(assets.world.bounds);
        setSeedPositions(assets.positions);
        const colors = new Float32Array(assets.colors.length);
        for (let i = 0; i < assets.colors.length; i += 1) {
          colors[i] = assets.colors[i] / 255;
        }
        setSeedColors(colors);
        setPointCount(
          assets.world.primitiveCount ?? assets.positions.length / 3
        );
        if (assets.trainedSplat) {
          setGaussianCount(
            Math.floor(assets.trainedSplat.byteLength / SPLAT_RECORD_BYTES)
          );
          const blobUrl = URL.createObjectURL(
            new Blob([assets.trainedSplat], {
              type: "application/octet-stream",
            })
          );
          setTrainedSplat({
            url: blobUrl,
            fileBytes: assets.trainedSplat,
            fileName: splatFileName,
            sourceBounds: assets.world.bounds,
            coordinateFrame: DEMO_PRESET.coordinateFrame,
          });
        }
        setLoadStatus("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadStatus("failed");
        setLoadError(
          err instanceof Error ? err.message : "Preset assets unavailable"
        );
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (trainedSplat) URL.revokeObjectURL(trainedSplat.url);
    };
  }, [trainedSplat]);

  useEffect(() => {
    if (!seedPositions || !worldBounds) {
      setSceneShapeAnalysis(null);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setSceneShapeAnalysis(
        inferSceneShapesFromPoints(seedPositions, worldBounds)
      );
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [seedPositions, worldBounds]);

  const cancelActiveRunPodJobs = useCallback(
    async (
      reason: string,
      options: { keepalive?: boolean; silent?: boolean } = {}
    ) => {
      const jobs = Array.from(activeRunPodJobsRef.current.values());
      if (jobs.length === 0) return;
      activeRunPodJobsRef.current.clear();
      if (!options.silent) {
        setRunPodStatus(
          `Cancelling ${jobs.length} unfinished RunPod GPU shard${
            jobs.length === 1 ? "" : "s"
          }`
        );
      }

      await Promise.allSettled(
        jobs.map(async (job) => {
          const url = `/api/runpod/cancel/${job.id}`;
          const body = JSON.stringify({ reason });
          if (options.keepalive && navigator.sendBeacon) {
            const accepted = navigator.sendBeacon(
              url,
              new Blob([body], { type: "application/json" })
            );
            if (accepted) return;
          }
          await fetchWithTimeout(
            url,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              keepalive: options.keepalive,
            },
            RUNPOD_REQUEST_TIMEOUT_MS
          );
        })
      );
    },
    []
  );

  const refreshRunPodCapacity = useCallback(
    async (signal?: AbortSignal): Promise<RunPodCapacitySummary | null> => {
      try {
        const res = await fetchWithTimeout(
          "/api/runpod/health",
          {
            cache: "no-store",
            signal,
          },
          RUNPOD_REQUEST_TIMEOUT_MS
        );
        const payload = (await res
          .json()
          .catch(() => null)) as RunPodHealthResponse | null;
        if (!res.ok || !payload?.ok || !payload.capacity) return null;
        setRunPodCapacity(payload.capacity);
        return payload.capacity;
      } catch {
        if (!signal?.aborted) setRunPodCapacity(null);
        return null;
      }
    },
    []
  );

  const teardownSource = useCallback(() => {
    runPodAbortRef.current?.abort();
    runPodAbortRef.current = null;
    void cancelActiveRunPodJobs("Live reconstruction stopped", {
      silent: true,
    });
    sourceRef.current?.dispose();
    sourceRef.current = null;
    helloRef.current = null;
    fusionKeyframesRef.current = [];
    runPodGaussianCountRef.current = 0;
    splatRef.current = null;
    splatCursorRef.current = 0;
    useStreamedSplatRef.current = false;
    resetCloud();
    resetSplat();
    for (const url of liveTrainedUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    liveTrainedUrlsRef.current = [];
    setLiveTrainedSplats(null);
    setTrajectorySegments(null);
    setRunPodStatus(null);
    setLiveStartMode(null);
  }, [cancelActiveRunPodJobs]);

  // Dispose the live source on unmount.
  useEffect(() => teardownSource, [teardownSource]);

  useEffect(
    () => () => {
      previewControllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (phase === "picker") {
      setRunPodCapacity(null);
      return;
    }

    const controller = new AbortController();
    const poll = () => {
      void refreshRunPodCapacity(controller.signal);
    };
    poll();
    const interval = window.setInterval(poll, isPreloadingLive ? 3000 : 10_000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [phase, isPreloadingLive, refreshRunPodCapacity]);

  useEffect(() => {
    let inactiveTimer: number | undefined;
    const clearInactiveTimer = () => {
      if (inactiveTimer === undefined) return;
      window.clearTimeout(inactiveTimer);
      inactiveTimer = undefined;
    };
    const cancelForInactiveBrowser = (
      reason: string,
      options: { keepalive?: boolean; updateUi?: boolean } = {}
    ) => {
      if (activeRunPodJobsRef.current.size === 0) return;
      runPodAbortRef.current?.abort();
      void cancelActiveRunPodJobs(reason, {
        keepalive: options.keepalive,
        silent: options.keepalive,
      });
      if (options.updateUi) {
        setLiveError(
          "Live reconstruction preload was cancelled because the browser became inactive."
        );
        setIsPreloadingLive(false);
        setLiveStartMode(null);
        setLoadStatus(seedPositions && seedColors ? "ready" : "failed");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (activeRunPodJobsRef.current.size === 0) return;
        setRunPodStatus(
          `Browser inactive; cancelling RunPod preload in ${formatRunPodElapsed(
            RUNPOD_INACTIVE_CANCEL_GRACE_MS
          )}`
        );
        clearInactiveTimer();
        inactiveTimer = window.setTimeout(() => {
          cancelForInactiveBrowser("Browser inactive during live preload", {
            keepalive: true,
            updateUi: true,
          });
        }, RUNPOD_INACTIVE_CANCEL_GRACE_MS);
        return;
      }
      clearInactiveTimer();
    };
    const onPageExit = () => {
      clearInactiveTimer();
      cancelForInactiveBrowser("Browser closed during live preload", {
        keepalive: true,
      });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageExit);
    window.addEventListener("beforeunload", onPageExit);

    return () => {
      clearInactiveTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageExit);
      window.removeEventListener("beforeunload", onPageExit);
    };
  }, [cancelActiveRunPodJobs, seedColors, seedPositions]);

  const loadSourcePreview = useCallback(async (entry: ReplaySourceEntry) => {
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    const presetBase = entry.presetPath ?? `/presets/${entry.id}`;

    try {
      const [worldRes, keyframesRes, sensorReport, sensorTimeline] =
        await Promise.all([
          fetch(`${presetBase}/world.json`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`${presetBase}/keyframes.json`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetchOptionalJson<SensorFusionReportDoc>(
            `${presetBase}/sensor_fusion_report.json`,
            controller.signal
          ),
          fetchOptionalJson<SensorTimelineDoc>(
            `${presetBase}/sensor_timeline.json`,
            controller.signal
          ),
        ]);

      if (controller.signal.aborted) return;
      if (worldRes.ok) {
        const world = (await worldRes.json()) as { bounds?: Bounds };
        if (world.bounds) setWorldBounds(world.bounds);
      }
      if (keyframesRes.ok) {
        const keyframes = (await keyframesRes.json()) as KeyframeDoc[];
        const points = keyframes.map((keyframe) => keyframe.position);
        setTrajectoryPoints(points);
        setTrajectorySegments(null);
        const first = keyframes[0];
        if (first) {
          setRobotPose({
            position: first.position,
            headingRad: first.headingRad,
          });
          if (first.imageRel) {
            setCameraImageUrl(`${presetBase}/${first.imageRel}`);
          }
        }
      }
      setSensorEvidence(sensorEvidenceFromDocs(sensorReport, sensorTimeline));
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      console.warn("[console] source preview load failed:", err);
    }
  }, []);

  const handleSelect = (entry: ReplaySourceEntry) => {
    setSelected(entry);
    setPhase("selected");
    setLiveError(null);
    setRunPodStatus(null);
    setCameraImageUrl(null);
    setRobotPose(null);
    setTrajectorySegments(null);
    setLayers(DEFAULT_LAYERS);
    void loadSourcePreview(entry);
  };

  const handleAddSource = (entry: ReplaySourceEntry) => {
    setSources((current) => [...current, entry]);
  };

  const backToPicker = () => {
    previewControllerRef.current?.abort();
    teardownSource();
    setIsLive(false);
    setIsPreloadingLive(false);
    setPlaying(false);
    setProgress(0);
    setCameraImageUrl(null);
    setTrajectoryPoints([]);
    setTrajectorySegments(null);
    setRobotPose(null);
    setSensorEvidence(null);
    setPhase("picker");
    setSelected(null);
  };

  const revealSplatTo = useCallback((target: number) => {
    const splat = splatRef.current;
    if (!splat) return;
    const cursor = splatCursorRef.current;
    const clampedTarget = Math.min(target, splat.count);
    if (clampedTarget <= cursor) return;
    const n = clampedTarget - cursor;
    const positions = Array.from(
      splat.positions.subarray(cursor * 3, clampedTarget * 3)
    );
    const scales = Array.from(
      splat.scales.subarray(cursor * 3, clampedTarget * 3)
    );
    const rotations: number[] = new Array(n * 4);
    const colorsRGBA = Array.from(
      splat.colors.subarray(cursor * 4, clampedTarget * 4)
    );
    const opacities: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const src = (cursor + i) * 4;
      rotations[i * 4] = (splat.rotations[src] - 128) / 128;
      rotations[i * 4 + 1] = (splat.rotations[src + 1] - 128) / 128;
      rotations[i * 4 + 2] = (splat.rotations[src + 2] - 128) / 128;
      rotations[i * 4 + 3] = (splat.rotations[src + 3] - 128) / 128;
      opacities[i] = splat.colors[src + 3] / 255;
    }
    appendGaussians(positions, scales, rotations, colorsRGBA, opacities);
    splatCursorRef.current = clampedTarget;
  }, []);

  const trainLiveSplatOnRunPod = useCallback(
    async (
      entry: ReplaySourceEntry,
      hello: ReplayHello,
      signal: AbortSignal
    ): Promise<boolean> => {
      setRunPodStatus("Submitting parallel RunPod GPU shards");
      const startRes = await fetchWithTimeout(
        "/api/runpod/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceId: entry.id,
            sequence: entry.id,
            keyframeCount: hello.keyframeCount,
            shardCount: RUNPOD_GPUS_PER_SESSION,
            overlapKeyframes: 4,
            qualityPreset: liveQualityPreset,
          }),
          signal,
        },
        RUNPOD_REQUEST_TIMEOUT_MS
      );
      const startPayload = (await startRes.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        job?: RunPodSubmittedJob;
        jobs?: RunPodSubmittedJob[];
        capacity?: RunPodCapacitySummary | null;
      } | null;
      const submittedJobs =
        startPayload?.jobs ?? (startPayload?.job ? [startPayload.job] : []);
      if (!startRes.ok || !startPayload?.ok || submittedJobs.length === 0) {
        throw new Error(
          startPayload?.message ||
            `RunPod submission failed (${startRes.status})`
        );
      }
      if (startPayload.capacity) setRunPodCapacity(startPayload.capacity);
      for (const job of submittedJobs) {
        activeRunPodJobsRef.current.set(job.id, {
          id: job.id,
          shardIndex: job.shard?.index ?? 0,
          shardCount: job.shard?.count ?? submittedJobs.length,
        });
      }

      let completed = 0;
      const startedAt = Date.now();
      const settledJobIds = new Set<string>();
      const capacityLabel = startPayload.capacity
        ? ` · warm ${startPayload.capacity.warmedGpuCount}/${startPayload.capacity.targetWarmGpuCount} GPUs · queue ${runPodQueueLabel(
            startPayload.capacity
          )}`
        : "";
      setRunPodStatus(
        `Queued for ${submittedJobs.length} RunPod GPUs${capacityLabel}`
      );

      const cancelIncompleteRunPodJobs = async (reason: string) => {
        const incompleteJobs = submittedJobs.filter(
          (job) => !settledJobIds.has(job.id)
        );
        if (incompleteJobs.length === 0) return;
        await cancelActiveRunPodJobs(reason);
      };

      const pollJob = async (job: RunPodSubmittedJob): Promise<boolean> => {
        const jobStartedAt = Date.now();
        const shardLabel = `shard ${(job.shard?.index ?? 0) + 1}/${
          job.shard?.count ?? submittedJobs.length
        }`;
        for (;;) {
          const shouldPoll = await waitForRunPodPoll(signal);
          if (!shouldPoll || signal.aborted) return false;

          let statusRes: Response;
          try {
            statusRes = await fetchWithTimeout(
              `/api/runpod/status/${job.id}`,
              {
                cache: "no-store",
                signal,
              },
              RUNPOD_REQUEST_TIMEOUT_MS
            );
          } catch (error) {
            if (signal.aborted) return false;
            throw error;
          }
          const statusPayload = (await statusRes.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
            status?: RunPodStatusResponse;
          } | null;
          if (!statusRes.ok || !statusPayload?.ok || !statusPayload.status) {
            throw new Error(
              statusPayload?.message ||
                `RunPod status lookup failed (${statusRes.status})`
            );
          }

          const status = statusPayload.status;
          const elapsedMs = Date.now() - startedAt;
          const jobElapsedMs = Date.now() - jobStartedAt;
          if (
            status.status === "IN_QUEUE" &&
            jobElapsedMs > RUNPOD_QUEUE_TIMEOUT_MS
          ) {
            throw new Error(
              `RunPod ${shardLabel} stayed queued for ${formatRunPodElapsed(
                jobElapsedMs
              )}; stopping the preload instead of waiting forever.`
            );
          }
          if (jobElapsedMs > RUNPOD_TOTAL_TIMEOUT_MS) {
            throw new Error(
              `RunPod ${shardLabel} exceeded the ${formatRunPodElapsed(
                RUNPOD_TOTAL_TIMEOUT_MS
              )} preload limit.`
            );
          }
          const stage = status.output?.stage;
          const stageMessage = stage?.message ?? stage?.current;
          const stageSuffix = stageMessage ? ` · ${stageMessage}` : "";
          const capacity = await refreshRunPodCapacity(signal);
          const queueSuffix = capacity
            ? ` · warm ${capacity.warmedGpuCount}/${capacity.targetWarmGpuCount} GPUs · queue ${runPodQueueLabel(
                capacity
              )}`
            : "";
          setRunPodStatus(
            `RunPod GPU swarm: ${completed}/${
              submittedJobs.length
            } ready · ${runPodStatusLabel(
              status.status
            )} · ${formatRunPodElapsed(
              elapsedMs
            )} elapsed${stageSuffix}${queueSuffix}`
          );

          if (status.status === "COMPLETED") {
            const output = status.output;
            if (output?.status !== "completed") {
              throw new Error(
                output?.error || "RunPod job completed without a splat."
              );
            }

            let buf: ArrayBuffer;
            let fileName = `runpod-shard-${(job.shard?.index ?? 0) + 1}.splat`;
            if (output.artifact.splatBase64) {
              buf = base64ToArrayBuffer(output.artifact.splatBase64);
            } else if (output.artifact.splatUri) {
              const splatRes = await fetchWithTimeout(
                output.artifact.splatUri,
                {
                  cache: "no-store",
                  signal,
                },
                RUNPOD_ARTIFACT_TIMEOUT_MS
              );
              if (!splatRes.ok) {
                throw new Error(
                  `RunPod artifact fetch failed (${splatRes.status})`
                );
              }
              buf = await splatRes.arrayBuffer();
              fileName = output.artifact.splatUri.split("/").pop() || fileName;
            } else {
              throw new Error("RunPod worker did not return a splat artifact.");
            }

            if (signal.aborted) return false;
            const blobUrl = URL.createObjectURL(
              new Blob([buf], { type: "application/octet-stream" })
            );
            liveTrainedUrlsRef.current.push(blobUrl);
            const nextAsset: TrainedSplatAsset = {
              id: job.submapId ?? `runpod-live-${job.id}`,
              url: blobUrl,
              fileBytes: buf,
              fileName,
              sourceBounds: boundsFromHello(hello),
              coordinateFrame: "training-frame",
            };
            const shardGaussianCount =
              output.metrics?.primitiveCount ??
              Math.floor(buf.byteLength / SPLAT_RECORD_BYTES);
            runPodGaussianCountRef.current += shardGaussianCount;
            setLiveTrainedSplats((current) => {
              return [...(current ?? []), nextAsset];
            });
            setGaussianCount(runPodGaussianCountRef.current);
            completed += 1;
            settledJobIds.add(job.id);
            activeRunPodJobsRef.current.delete(job.id);
            setRunPodStatus(
              `RunPod GPU swarm: ${completed}/${submittedJobs.length} shards rendered`
            );
            return true;
          }

          if (
            status.status === "FAILED" ||
            status.status === "CANCELLED" ||
            status.status === "TIMED_OUT"
          ) {
            settledJobIds.add(job.id);
            activeRunPodJobsRef.current.delete(job.id);
            throw new Error(status.error || runPodStatusLabel(status.status));
          }
        }
      };

      const results = await Promise.allSettled(submittedJobs.map(pollJob));
      const failed = results.filter(
        (result) => result.status === "rejected"
      ).length;
      const firstError = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )?.reason;
      if (signal.aborted) {
        await cancelIncompleteRunPodJobs("Live reconstruction preload aborted");
        return false;
      }
      if (completed > 0) {
        await cancelIncompleteRunPodJobs(
          "Live reconstruction finished enough shards"
        );
        setRunPodStatus(
          `RunPod GPU swarm complete: ${completed}/${submittedJobs.length} shards rendered`
        );
        return true;
      }
      await cancelIncompleteRunPodJobs("Live reconstruction preload failed");
      throw new Error(
        firstError instanceof Error
          ? firstError.message
          : failed > 0
            ? "All RunPod GPU shards failed."
            : "RunPod GPU swarm produced no splats."
      );
    },
    [cancelActiveRunPodJobs, liveQualityPreset, refreshRunPodCapacity]
  );

  const loadPublishedTrainedSplats = useCallback(
    async (
      src: FrameStreamSource,
      presetBase: string,
      signal: AbortSignal
    ): Promise<boolean> => {
      setRunPodStatus("Loading pre-trained OpenSplat demo");

      try {
        const fusionRes = await fetch(`${presetBase}/fusion_manifest.json`, {
          cache: "no-store",
          signal,
        });
        if (fusionRes.ok) {
          const fusion = (await fusionRes.json()) as FusionManifest;
          if (signal.aborted || sourceRef.current !== src) return false;
          const items: TrainedSplatAsset[] = fusion.items.map((item) => ({
            id: item.id,
            url: `${presetBase}/${item.base}/${item.splatFile}`,
            fileName: item.splatFile,
            sourceBounds: item.sourceBounds,
            targetBounds: item.targetBounds,
            coordinateFrame: fusion.coordinateFrame ?? "normalized",
          }));
          if (items.length > 0) {
            setLiveTrainedSplats(items);
            setGaussianCount(
              fusion.items.reduce(
                (sum, item) => sum + (item.gaussianCount ?? 0),
                0
              )
            );
            setRunPodStatus("Pre-trained OpenSplat fusion loaded");
            return true;
          }
        }
      } catch (err: unknown) {
        if (signal.aborted) return false;
        console.warn("[console] fusion splat load failed:", err);
      }

      try {
        const metaRes = await fetch(`${presetBase}/trained.json`, {
          cache: "no-store",
          signal,
        });
        if (!metaRes.ok) return false;
        const meta = (await metaRes.json()) as TrainedSplatManifest;
        const splatRes = await fetch(`${presetBase}/${meta.splatFile}`, {
          cache: "no-store",
          signal,
        });
        if (!splatRes.ok) return false;
        const buf = await splatRes.arrayBuffer();
        if (signal.aborted || sourceRef.current !== src) return false;

        const blobUrl = URL.createObjectURL(
          new Blob([buf], { type: "application/octet-stream" })
        );
        liveTrainedUrlsRef.current.push(blobUrl);
        setLiveTrainedSplats([
          {
            id: "trained",
            url: blobUrl,
            fileBytes: buf,
            fileName: meta.splatFile,
            sourceBounds: meta.bounds,
            coordinateFrame: meta.coordinateFrame ?? "normalized",
          },
        ]);
        setGaussianCount(
          meta.gaussianCount ?? Math.floor(buf.byteLength / SPLAT_RECORD_BYTES)
        );
        setRunPodStatus("Pre-trained OpenSplat demo loaded");
        return true;
      } catch (err: unknown) {
        if (signal.aborted) return false;
        console.warn("[console] trained splat load failed:", err);
      }

      return false;
    },
    []
  );

  const goLive = async (mode: LiveStartMode = "pretrained") => {
    if (!selected || isPreloadingLive) return;
    setLiveError(null);
    setIsPreloadingLive(true);
    setLoadStatus("loading");
    teardownSource();
    setLiveStartMode(mode);
    setRunPodStatus(
      mode === "pretrained" ? "Loading pre-trained demo reconstruction" : null
    );

    const src = createReplaySource(selected);
    sourceRef.current = src;

    let hello: ReplayHello;
    try {
      hello = await src.hello();
    } catch (err: unknown) {
      setLiveError(
        err instanceof Error ? err.message : "Failed to load replay source"
      );
      teardownSource();
      setIsPreloadingLive(false);
      setLiveStartMode(null);
      setLoadStatus(hasScene ? "ready" : "failed");
      return;
    }
    if (sourceRef.current !== src) {
      setIsPreloadingLive(false);
      setLiveStartMode(null);
      return;
    } // superseded
    helloRef.current = hello;
    const runPodController = new AbortController();
    runPodAbortRef.current = runPodController;

    setWorldBounds(boundsFromHello(hello));
    resetCloud();
    initCloud(hello.pointTotal);
    setPointCount(0);

    useStreamedSplatRef.current = false;
    for (const url of liveTrainedUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    liveTrainedUrlsRef.current = [];
    setLiveTrainedSplats(null);
    const presetBase = selected.presetPath ?? `/presets/${selected.id}`;
    let usedTrained = false;

    if (mode === "pretrained") {
      usedTrained = await loadPublishedTrainedSplats(
        src,
        presetBase,
        runPodController.signal
      );
      if (!usedTrained) {
        if (runPodController.signal.aborted || sourceRef.current !== src) {
          setIsPreloadingLive(false);
          setLiveStartMode(null);
          return;
        }
        setLiveError(
          "Pre-trained demo assets are unavailable for this source."
        );
        teardownSource();
        setIsPreloadingLive(false);
        setLiveStartMode(null);
        setLoadStatus(hasScene ? "ready" : "failed");
        return;
      }
    } else {
      try {
        const rendered = await trainLiveSplatOnRunPod(
          selected,
          hello,
          runPodController.signal
        );
        usedTrained = rendered && sourceRef.current === src;
        if (!usedTrained) {
          setIsPreloadingLive(false);
          setLiveStartMode(null);
          return;
        }
      } catch (err: unknown) {
        if (runPodController.signal.aborted) return;
        console.warn("[console] RunPod live splat failed:", err);
        setRunPodStatus("RunPod unavailable; loading pre-trained demo");
        usedTrained = await loadPublishedTrainedSplats(
          src,
          presetBase,
          runPodController.signal
        );
        if (!usedTrained) {
          if (runPodController.signal.aborted || sourceRef.current !== src) {
            setIsPreloadingLive(false);
            setLiveStartMode(null);
            return;
          }
          const message =
            err instanceof Error ? err.message : "RunPod GPU rendering failed.";
          setLiveError(`${message} Pre-trained demo assets were unavailable.`);
          teardownSource();
          setIsPreloadingLive(false);
          setLiveStartMode(null);
          setLoadStatus(hasScene ? "ready" : "failed");
          return;
        }
      }
    }

    if (!usedTrained && hello.splatUrl && hello.splatCount !== undefined) {
      try {
        const res = await fetch(hello.splatUrl);
        if (!res.ok) throw new Error(`scene.splat ${res.status}`);
        const buf = await res.arrayBuffer();
        if (sourceRef.current !== src) {
          setIsPreloadingLive(false);
          return;
        }
        splatRef.current = decodeSplat(buf);
        splatCursorRef.current = 0;
        resetSplat();
        initSplat(hello.splatCount);
        setGaussianCount(hello.splatCount);
        useStreamedSplatRef.current = true;
        revealSplatTo(hello.splatCount);
      } catch (err: unknown) {
        console.warn("[console] splat decode failed:", err);
        splatRef.current = null;
      }
    }

    if (usedTrained) {
      setLayers(PHOTOREAL_LAYERS);
      setAutoOrbit(false);
      setCameraView((current) => ({
        id: "orbit",
        version: current.version + 1,
      }));
    }

    try {
      const fusionKeyframesRes = await fetch(
        `${presetBase}/fusion_keyframes.json`,
        { cache: "no-store" }
      );
      if (sourceRef.current !== src) {
        setIsPreloadingLive(false);
        return;
      }
      if (fusionKeyframesRes.ok) {
        const fusionKeyframesDoc =
          (await fusionKeyframesRes.json()) as FusionKeyframesDoc;
        fusionKeyframesRef.current = fusionKeyframesDoc.keyframes;
        setTrajectoryPoints(
          fusionKeyframesDoc.keyframes.map((keyframe) => keyframe.position)
        );
        setTrajectorySegments(
          groupFusionTrajectory(fusionKeyframesDoc.keyframes)
        );
        const firstFusionPose = nearestFusionPose(
          hello.keyframeCount > 0 ? 0 : 0,
          fusionKeyframesDoc.keyframes
        );
        if (firstFusionPose) setRobotPose(firstFusionPose);
      }
    } catch (err: unknown) {
      console.warn("[console] fusion keyframes load failed:", err);
    }

    const unsubscribe = src.subscribe((msg) => {
      if (sourceRef.current !== src) return;
      switch (msg.type) {
        case "frame": {
          appendPoints(msg.frame.points.xyz, msg.frame.points.rgb);
          setPointCount(getRevealedPoints());
          setProgress(msg.frame.progress);
          setRobotPose(
            nearestFusionPose(msg.frame.index, fusionKeyframesRef.current) ?? {
              position: msg.frame.position,
              headingRad: msg.frame.headingRad,
            }
          );
          if (msg.frame.imageUrl) setCameraImageUrl(msg.frame.imageUrl);
          if (useStreamedSplatRef.current && helloRef.current?.splatCount) {
            revealSplatTo(helloRef.current.splatCount);
          }
          break;
        }
        case "reset": {
          const h = helloRef.current;
          if (!h) break;
          resetCloud();
          initCloud(h.pointTotal);
          if (useStreamedSplatRef.current) {
            resetSplat();
            if (h.splatCount !== undefined) initSplat(h.splatCount);
            splatCursorRef.current = 0;
          }
          setPointCount(0);
          break;
        }
        case "telemetry": {
          setPlaying(msg.snapshot.playing);
          setProgress(msg.snapshot.progress);
          setRobotPose(
            nearestFusionPose(
              msg.snapshot.index,
              fusionKeyframesRef.current
            ) ?? {
              position: msg.snapshot.position,
              headingRad: msg.snapshot.headingRad,
            }
          );
          break;
        }
        default:
          break;
      }
    });

    // Keep the unsubscribe tied to the source's lifetime.
    const baseDispose = src.dispose.bind(src);
    src.dispose = () => {
      unsubscribe();
      baseDispose();
    };

    setIsLive(true);
    setIsPreloadingLive(false);
    setLiveStartMode(null);
    setLoadStatus("ready");
    setPhase("live");
    setProgress(0);
    setCameraImageUrl(null);
    src.play();
    setPlaying(true);
  };

  const toggleLayer = (key: keyof RenderLayers) =>
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  const handleRenderProfileIdChange = (id: TrainedRenderProfileId) => {
    setRenderProfileId(id);
    setRenderProfileOverrides({});
    if (id === "photoreal") {
      setLayers((current) => ({
        ...current,
        pointcloud: false,
        splat: true,
      }));
    }
    if (id === "holographic") {
      setLayers((current) => ({
        ...current,
        pointcloud: false,
        splat: true,
        grid: false,
      }));
    }
  };
  const handleRenderProfileChange = (patch: Partial<TrainedRenderProfile>) => {
    setRenderProfileOverrides((current) => ({ ...current, ...patch }));
  };
  const requestCameraView = (id: CameraViewId) =>
    setCameraView((current) => ({ id, version: current.version + 1 }));

  // --- Transport handlers ---
  const handlePlayPause = () => {
    const src = sourceRef.current;
    if (!src) return;
    if (playing) {
      src.pause();
      setPlaying(false);
    } else {
      src.play();
      setPlaying(true);
    }
  };
  const handleSpeed = (next: number) => {
    setSpeed(next);
    sourceRef.current?.setSpeed(next);
  };
  const handleSeek = (fraction: number) => {
    const hello = helloRef.current;
    const src = sourceRef.current;
    if (!hello || !src) return;
    const frameIndex = Math.min(
      hello.keyframeCount - 1,
      Math.max(0, Math.floor(fraction * hello.keyframeCount))
    );
    setProgress(fraction);
    src.seek(frameIndex);
  };
  const handleLoop = (next: boolean) => {
    setLoop(next);
    sourceRef.current?.setLoop(next);
  };

  const selectedTrainedRenderProfile =
    TRAINED_RENDER_PROFILES[renderProfileId] ??
    DEMO_PRESET.trainedRender ??
    DEFAULT_TRAINED_RENDER_PROFILE;
  const baseTrainedRenderProfile = applyRenderProfileOverrides(
    isLive
      ? liveProfileForBase(selectedTrainedRenderProfile)
      : selectedTrainedRenderProfile,
    renderProfileOverrides
  );
  const activeTrainedRenderProfile = applyInteriorVisibilityProfile(
    baseTrainedRenderProfile,
    interiorVisibility
  );

  const hasScene = seedPositions !== null && seedColors !== null;
  const liveGaussianLabel = new Intl.NumberFormat("en-US").format(
    isLive && !liveTrainedSplats ? getRevealedGaussians() : gaussianCount
  );
  const livePointLabel = new Intl.NumberFormat("en-US").format(pointCount);
  const sequenceLabel = selected?.label ?? DEMO_PRESET.label;
  const pctLabel = `${Math.round(progress * 100)}%`;

  if (phase === "picker") {
    return (
      <div className="cn-console-shell">
        <header className="cn-appbar">
          <div className="cn-appbar-brand">
            <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
              <circle
                cx="13"
                cy="13"
                r="10"
                fill="none"
                stroke="#33f0d1"
                strokeWidth="1.4"
              />
              <circle cx="13" cy="13" r="3.4" fill="#33f0d1" />
            </svg>
            <div>
              SenseSight
              <small>Console</small>
            </div>
          </div>
        </header>
        <div className="cn-console cn-console--picker">
          <SourcePicker
            sources={sources}
            onSelect={handleSelect}
            onAddSource={handleAddSource}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cn-console-shell">
      <header className="cn-appbar">
        <div className="cn-appbar-brand">
          <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
            <circle
              cx="13"
              cy="13"
              r="10"
              fill="none"
              stroke="#33f0d1"
              strokeWidth="1.4"
            />
            <circle cx="13" cy="13" r="3.4" fill="#33f0d1" />
          </svg>
          <div>
            SenseSight
            <small>Console</small>
          </div>
        </div>

        <div
          className="cn-appbar-tools"
          role="toolbar"
          aria-label="Viewport controls"
        >
          <button
            type="button"
            className="cn-appbar-back"
            onClick={backToPicker}
            title="Back to sources"
          >
            ← Sources
          </button>
          <fieldset className="cn-viewer-tabs">
            <legend className="sr-only">Camera view</legend>
            {(Object.keys(CAMERA_VIEW_LABELS) as CameraViewId[]).map(
              (id, index) => (
                <button
                  key={id}
                  type="button"
                  className={cameraView.id === id ? "active" : ""}
                  aria-pressed={cameraView.id === id}
                  aria-keyshortcuts={`${index + 1}`}
                  title={`Camera ${index + 1}`}
                  onClick={() => {
                    setAutoOrbit(false);
                    requestCameraView(id);
                  }}
                >
                  {CAMERA_VIEW_LABELS[id]}
                </button>
              )
            )}
          </fieldset>
          <fieldset className="cn-viewer-actions">
            <legend className="sr-only">Camera actions</legend>
            <button
              type="button"
              className={autoOrbit ? "active" : ""}
              aria-pressed={autoOrbit}
              aria-keyshortcuts="A"
              title="Follow orbit"
              onClick={() => setAutoOrbit((enabled) => !enabled)}
            >
              Follow
            </button>
            <button
              type="button"
              aria-keyshortcuts="F R"
              title="Fit scene"
              onClick={() => {
                setAutoOrbit(false);
                requestCameraView("orbit");
              }}
            >
              Fit
            </button>
          </fieldset>
        </div>

        <div
          className="cn-appbar-status"
          role="status"
          aria-label="Console status"
        >
          <span className="cn-status-chip">
            <span
              className={`status-dot ${
                isLive
                  ? "online pulse"
                  : isPreloadingLive
                    ? "degraded pulse"
                    : "offline"
              }`}
            />
            {isLive ? "Live" : isPreloadingLive ? "Preloading" : "Idle"}
          </span>
          <span className="cn-status-chip">
            {RENDER_MODE_LABEL[renderMode]}
          </span>
          <span className="cn-status-chip">{cameraStatus}</span>
        </div>
      </header>

      <div className="cn-console">
        <div className="cn-viewer">
          {hasScene ? (
            <>
              <Viewer
                autoOrbit={autoOrbit}
                cameraView={cameraView}
                layers={layers}
                trainedPreviewMode={trainedPreviewMode}
                trainedRenderProfile={activeTrainedRenderProfile}
                worldBounds={worldBounds}
                seedPositions={seedPositions}
                seedColors={seedColors}
                trajectoryPoints={trajectoryPoints}
                trajectorySegments={trajectorySegments ?? undefined}
                robotPose={robotPose}
                trainedSplat={isLive ? null : trainedSplat}
                trainedSplats={isLive ? liveTrainedSplats : null}
                sceneShapes={sceneShapeAnalysis?.shapes ?? []}
                showInteriorShapes={interiorVisibility.enabled}
                isStreamingLive={isLive}
                onAutoOrbitChange={setAutoOrbit}
                onCameraStatusChange={setCameraStatus}
                onCameraViewChange={requestCameraView}
                onRenderModeChange={setRenderMode}
              />
              <div className="cn-viewer-overlay">
                <div className="cn-viewer-readout">
                  <span>{sequenceLabel}</span>
                  <span>{livePointLabel} pts</span>
                  <span>{liveGaussianLabel} gs</span>
                  {isLive && <span>{pctLabel}</span>}
                </div>
                <div className="cn-viewer-status">
                  <span className="cn-viewer-status__item">
                    {RENDER_MODE_LABEL[renderMode]}
                  </span>
                  <span className="cn-viewer-status__item">{cameraStatus}</span>
                </div>
              </div>

              {(isLive || cameraImageUrl) && (
                <fieldset className="cn-camera-pip">
                  <legend className="sr-only">Robot camera feed</legend>
                  <div className="cn-camera-pip__head">
                    <span className="cn-live-badge">
                      {isLive ? "● LIVE" : "PREVIEW"}
                    </span>
                    <span className="cn-camera-pip__seq">{sequenceLabel}</span>
                  </div>
                  {cameraImageUrl ? (
                    <img
                      className="cn-camera-pip__img"
                      src={cameraImageUrl}
                      alt="Robot camera frame"
                    />
                  ) : (
                    <div className="cn-camera-pip__placeholder">
                      Awaiting first frame…
                    </div>
                  )}
                </fieldset>
              )}

              {phase === "selected" && !isLive && (
                <div className="cn-golive-overlay">
                  <div
                    className={`cn-golive-card${
                      isPreloadingLive ? " cn-golive-card--loading" : ""
                    }`}
                    aria-busy={isPreloadingLive}
                  >
                    <p className="eyebrow mono">{selected?.kind ?? "replay"}</p>
                    <h2>{selected?.label}</h2>
                    {isPreloadingLive ? (
                      <div className="cn-preload-callout" role="status">
                        <span
                          className="cn-preload-spinner"
                          aria-hidden="true"
                        />
                        <div>
                          <strong>Preloading live reconstruction</strong>
                          <span>
                            {runPodStatus ??
                              "Loading the replay source, camera frames, and trained splat before the live screen opens."}
                          </span>
                          {runPodCapacity && (
                            <div className="cn-preload-queue">
                              <span>
                                Warm pool {runPodCapacity.warmedGpuCount}/
                                {runPodCapacity.targetWarmGpuCount} GPUs
                              </span>
                              <span>
                                {runPodCapacity.gpusPerSession} GPUs per user
                              </span>
                              <span>
                                Queue {runPodQueueLabel(runPodCapacity)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      selected?.description && <p>{selected.description}</p>
                    )}
                    {liveError && <p className="cn-error mono">{liveError}</p>}
                    <div className="cn-golive-actions">
                      <button
                        type="button"
                        className="cn-btn cn-btn--primary cn-golive-btn"
                        disabled={isPreloadingLive}
                        onClick={() => void goLive("pretrained")}
                      >
                        {isPreloadingLive
                          ? liveStartMode === "pretrained"
                            ? "Demo loading…"
                            : "Preloading…"
                          : "● Go Live"}
                      </button>
                      <button
                        type="button"
                        className="cn-btn cn-golive-fallback-btn"
                        disabled={isPreloadingLive}
                        title="Rebuild the reconstruction on RunPod GPU"
                        onClick={() => void goLive("gpu")}
                      >
                        {liveStartMode === "gpu"
                          ? "Preloading GPU…"
                          : "GPU rebuild"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="cn-empty-state">
              <div className="cn-empty-panel">
                <p className="eyebrow mono">SenseSight Console</p>
                <h1>
                  {loadError ? "Preset assets not published" : "Loading scene…"}
                </h1>
                <p>
                  {loadError
                    ? "Publish a preset under apps/site/public/presets/ to preview a reconstruction."
                    : "Fetching the seed cloud and trained splat for the configured preset."}
                </p>
                {loadError && <p className="mono">{loadError}</p>}
              </div>
            </div>
          )}
        </div>
        <ControlPanel
          layers={layers}
          onToggleLayer={toggleLayer}
          loadStatus={loadStatus}
          preset={DEMO_PRESET}
          trainedRenderProfile={activeTrainedRenderProfile}
          baseTrainedRenderProfile={baseTrainedRenderProfile}
          renderProfileOptions={TRAINED_RENDER_PROFILE_OPTIONS}
          renderProfileId={renderProfileId}
          onRenderProfileIdChange={handleRenderProfileIdChange}
          trainedPreviewMode={trainedPreviewMode}
          onTrainedPreviewModeChange={setTrainedPreviewMode}
          onTrainedRenderProfileChange={handleRenderProfileChange}
          onResetTrainedRenderProfile={() => setRenderProfileOverrides({})}
          interiorVisibility={interiorVisibility}
          onInteriorVisibilityChange={setInteriorVisibility}
          sceneShapeAnalysis={sceneShapeAnalysis}
          pointCount={isLive ? getRevealedPoints() : pointCount}
          gaussianCount={gaussianCount}
          isLive={isLive}
          playing={playing}
          speed={speed}
          loop={loop}
          progress={progress}
          onPlayPause={handlePlayPause}
          onSpeed={handleSpeed}
          onSeek={handleSeek}
          onLoop={handleLoop}
          liveQualityPreset={liveQualityPreset}
          onLiveQualityPresetChange={setLiveQualityPreset}
          sensorEvidence={sensorEvidence}
          runPodStatus={runPodStatus}
          runPodCapacity={runPodCapacity}
        />
      </div>
    </div>
  );
}
