export const SENSE_SIGHT_DOMAIN = "sensesight.live";

export const SENSE_SIGHT_NARRATIVE =
  "See what the robot sees. Understand what it knows. Decide what it should do.";

export type SensorKind =
  | "rgb"
  | "depth"
  | "lidar"
  | "imu"
  | "odometry"
  | "pose"
  | "robot-state";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type DecisionState =
  | "pending"
  | "approved"
  | "denied"
  | "modified"
  | "expired";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface SpatialPose {
  readonly position: Vector3;
  readonly orientation: Quaternion;
  readonly frameId: string;
}

export interface SensorObservation {
  readonly id: string;
  readonly missionId: string;
  readonly robotId: string;
  readonly sensor: SensorKind;
  readonly capturedAt: string;
  readonly pose?: SpatialPose;
  readonly uri?: string;
  readonly confidence?: number;
}

export interface SpatialRisk {
  readonly id: string;
  readonly label: string;
  readonly level: RiskLevel;
  readonly confidence: number;
  readonly frameId: string;
}

export interface OperatorDecision {
  readonly id: string;
  readonly requestId: string;
  readonly state: DecisionState;
  readonly operatorId: string;
  readonly decidedAt: string;
  readonly rationale?: string;
}

export type MissionEventType =
  | "observation.ingested"
  | "risk.detected"
  | "request.created"
  | "decision.approved"
  | "decision.denied"
  | "decision.modified";

export interface MissionActor {
  readonly id: string;
  readonly kind: "robot" | "human" | "system";
}

export interface MissionEvent {
  readonly id: string;
  readonly missionId: string;
  readonly occurredAt: string;
  readonly type: MissionEventType;
  readonly actor: MissionActor;
  readonly summary: string;
  readonly riskLevel?: RiskLevel;
}

export type MissionEventInput = Omit<MissionEvent, "id"> & {
  readonly id?: string;
};

export function createMissionEvent(input: MissionEventInput): MissionEvent {
  return {
    ...input,
    id: input.id ?? `${input.missionId}:${input.type}:${input.occurredAt}`,
  };
}

export function rankSpatialRisks(risks: readonly SpatialRisk[]): SpatialRisk[] {
  return [...risks].sort((left, right) => {
    const severityDelta =
      riskSeverityScore(right.level) - riskSeverityScore(left.level);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.confidence - left.confidence;
  });
}

function riskSeverityScore(level: RiskLevel): number {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}
