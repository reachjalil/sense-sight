export const DEFAULT_RUNPOD_WARM_GPU_POOL = 1;
export const DEFAULT_RUNPOD_GPUS_PER_SESSION = 1;

export interface RunPodEndpointHealthSnapshot {
  readonly jobs: {
    readonly completed: number;
    readonly failed: number;
    readonly inProgress: number;
    readonly inQueue: number;
    readonly retried: number;
  };
  readonly workers: {
    readonly idle: number;
    readonly initializing: number;
    readonly ready: number;
    readonly running: number;
    readonly throttled: number;
    readonly unhealthy: number;
  };
}

export interface RunPodCapacitySummary {
  readonly targetWarmGpuCount: number;
  readonly gpusPerSession: number;
  readonly warmedGpuCount: number;
  readonly availableGpuCount: number;
  readonly activeGpuCount: number;
  readonly warmingGpuCount: number;
  readonly queuedGpuJobCount: number;
  readonly queuedSessionCount: number;
  readonly availableSessionSlots: number;
  readonly poolStatus: "ready" | "warming" | "queued";
}

export function parsePositiveInt(
  value: number | string | undefined,
  fallback: number
): number {
  if (!value) return fallback;
  const parsed =
    typeof value === "number" ? Math.floor(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredWarmGpuPool(value: string | undefined): number {
  return parsePositiveInt(value, DEFAULT_RUNPOD_WARM_GPU_POOL);
}

export function configuredGpusPerSession(
  value: string | undefined,
  warmGpuPool: number
): number {
  return Math.min(
    parsePositiveInt(value, DEFAULT_RUNPOD_GPUS_PER_SESSION),
    warmGpuPool
  );
}

export function summarizeRunPodCapacity(
  health: RunPodEndpointHealthSnapshot,
  targetWarmGpuCount: number,
  gpusPerSession: number
): RunPodCapacitySummary {
  const warmedGpuCount = Math.min(
    targetWarmGpuCount,
    Math.max(health.workers.idle, health.workers.ready, health.workers.running)
  );
  const availableGpuCount = Math.max(
    0,
    Math.min(
      targetWarmGpuCount,
      Math.max(health.workers.idle, health.workers.ready)
    )
  );
  const activeGpuCount = Math.max(
    health.jobs.inProgress,
    health.workers.running
  );
  const queuedGpuJobCount = health.jobs.inQueue;
  const queuedSessionCount = Math.ceil(queuedGpuJobCount / gpusPerSession);
  const warmingGpuCount = Math.min(
    Math.max(0, targetWarmGpuCount - warmedGpuCount),
    health.workers.initializing
  );
  const availableSessionSlots = Math.floor(availableGpuCount / gpusPerSession);

  return {
    targetWarmGpuCount,
    gpusPerSession,
    warmedGpuCount,
    availableGpuCount,
    activeGpuCount,
    warmingGpuCount,
    queuedGpuJobCount,
    queuedSessionCount,
    availableSessionSlots,
    poolStatus:
      queuedGpuJobCount > 0
        ? "queued"
        : warmedGpuCount < targetWarmGpuCount
          ? "warming"
          : "ready",
  };
}
