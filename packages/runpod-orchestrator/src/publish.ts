import type { WorkerOutputMetrics } from "./job-types";

export interface MergedSplatResult {
  readonly splat: ArrayBuffer;
  readonly metrics: WorkerOutputMetrics;
}

export interface PresetManifest {
  readonly worldJson: object;
  readonly trainingJson: object;
  readonly trainingDiagnosticsJson: object;
}

const VALIDATION_LOSS_MAX = 0.08;
const SCALE_TAIL_MAX = 4.5;

/**
 * Build the viewer-ready preset-folder JSON contract (world.json,
 * training.json, training_diagnostics.json) from a merged shard result. Pure
 * data — no file I/O; the caller decides where/how to write these.
 */
export function buildPresetManifest(
  merged: MergedSplatResult,
  worldId: string
): PresetManifest {
  const { metrics } = merged;
  const updatedAt = new Date().toISOString();

  const worldJson = {
    id: worldId,
    sceneName: worldId,
    reconstructionStatus: "ready",
    primitiveCount: metrics.primitiveCount,
    updatedAt,
  };

  const trainingJson = {
    backend: "runpod-orchestrator",
    // WorkerOutputMetrics does not carry the configured step count, only
    // derived training-time metrics. Filled in by the caller from the
    // WorkerInput.train.steps it submitted.
    iterations: null,
    validationLoss: metrics.validationLoss ?? null,
  };

  const validationLossOk =
    metrics.validationLoss !== undefined
      ? metrics.validationLoss <= VALIDATION_LOSS_MAX
      : null;
  const scaleTailOk = metrics.scaleStats.tailP99OverP50 <= SCALE_TAIL_MAX;

  const trainingDiagnosticsJson = {
    gates: {
      validationLossOk,
      scaleTailOk,
      // Requires the unregularized scale distribution / regularization
      // config, which this package does not have visibility into. Filled in
      // by the caller (the worker/training service) before publish.
      regularizedScaleOk: null,
      // Requires a live viewer-side scale budget check. Filled in by the
      // caller.
      viewerScaleOk: null,
      // Requires the regularized-vs-raw primitive filter pass stats. Filled
      // in by the caller.
      regularizedFilterOk: null,
      // Requires viewer-side primitive filtering stats. Filled in by the
      // caller.
      viewerFilterOk: null,
      // Requires cross-sensor (LiDAR/IMU/odometry) fusion residuals not
      // present in WorkerOutputMetrics. Filled in by the caller.
      sensorFusionOk: null,
      // Requires confirming the exported asset loads in the interactive
      // viewer runtime. Filled in by the caller.
      interactiveAssetOk: null,
    },
    metrics,
  };

  return { worldJson, trainingJson, trainingDiagnosticsJson };
}
