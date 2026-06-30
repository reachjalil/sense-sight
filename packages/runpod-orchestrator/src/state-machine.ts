import type { WorldModel, WorldPipelineStage } from "@sense-sight/world-schema";

import type { JobStatus } from "./job-types";

/** Maps an orchestrator JobStatus onto the world's reconstructionStatus. */
export function jobStatusToReconstructionStatus(
  status: JobStatus
): WorldModel["reconstructionStatus"] {
  switch (status) {
    case "bundling":
    case "submitted":
      return "queued";
    case "training":
    case "merging":
      return "reconstructing";
    case "published":
      return "ready";
    case "failed":
      return "failed";
  }
}

/** Maps an orchestrator JobStatus onto the closest world-generation pipeline stage. */
export function jobStatusToStage(status: JobStatus): WorldPipelineStage {
  switch (status) {
    case "bundling":
      return "ingest";
    case "submitted":
      return "synchronize";
    case "training":
      return "reconstruction";
    case "merging":
      return "optimization";
    case "published":
      return "export";
    case "failed":
      return "export";
  }
}

/**
 * Legal lifecycle:
 *   bundling -> submitted -> training -> merging -> published
 *   (any status) -> failed
 *
 * Invariant: a failed job must never overwrite a "ready" world's WorldModel.
 * That guard belongs to whatever code applies a JobStatus to a stored
 * WorldModel — it must call isValidTransition(currentJobStatus, "failed")
 * AND separately confirm the target WorldModel.reconstructionStatus is not
 * already "ready" before persisting a failure. This function only validates
 * the job-status transition graph; it does not (and cannot, being pure and
 * world-model-agnostic) inspect a WorldModel itself.
 */
export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  if (to === "failed") {
    return from !== "published" && from !== "failed";
  }

  const forwardEdges: Record<JobStatus, readonly JobStatus[]> = {
    bundling: ["submitted"],
    submitted: ["training"],
    training: ["merging"],
    merging: ["published"],
    published: [],
    failed: [],
  };

  return forwardEdges[from].includes(to);
}
