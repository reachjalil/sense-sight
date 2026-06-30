/**
 * Spatial primitives shared by every higher-level type in this package.
 *
 * Coordinate convention: right-handed, metric (meters), +Y up, scalar-last
 * quaternions. Adapters that ingest sensor-native frames are responsible for
 * converting into this convention before anything downstream sees the data.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Axis-aligned bounding box in world space. */
export interface Bounds {
  readonly max: Vec3;
  readonly min: Vec3;
}

/** An ordered polygon on the ground plane (XZ), for footprints and regions. */
export interface Footprint {
  readonly points: ReadonlyArray<readonly [number, number]>;
}

/** Where a pose estimate came from, so a consumer can weigh its reliability. */
export type PoseSource =
  | "slam"
  | "lidar_icp"
  | "wheel_odometry"
  | "imu_fusion"
  | "fused"
  | "manual";

/** A timestamped 6-DoF pose with a confidence consumers can reason over. */
export interface Pose {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  /** ISO-8601 timestamp of the estimate. */
  readonly timestamp: string;
  /** 0..1 estimator confidence. */
  readonly confidence: number;
  readonly source: PoseSource;
}

/** Sensor modalities a robot platform may stream. */
export type SensorType =
  | "rgb"
  | "depth"
  | "lidar"
  | "imu"
  | "wheel_odometry"
  | "joint_state"
  | "thermal";

/** Operational health of a single sensor stream. */
export type SensorStatus = "online" | "degraded" | "offline";

/**
 * A live (or recorded) sensor stream descriptor. `uri` is intentionally
 * opaque so a mock/placeholder source and a real WebRTC, RTSP, or recorded
 * frame manifest can share the same shape.
 */
export interface SensorStream {
  readonly id: string;
  readonly type: SensorType;
  readonly label: string;
  readonly uri: string;
  readonly status: SensorStatus;
  readonly fps?: number;
  /** e.g. "1920x1080" for RGB, "16ch @ 10Hz" for LiDAR. */
  readonly resolution?: string;
  /** Reference into a calibration store; resolved by the sensor pipeline. */
  readonly calibrationId?: string;
  /** ISO-8601 timestamp of the most recent frame seen. */
  readonly lastFrameTs?: string;
  /** Optional one-line note ("rear bumper", "pan-tilt head"). */
  readonly mount?: string;
}
