/**
 * The catalog of replay/live sources the console offers in its source picker.
 * `available` `replay` entries play a recorded dataset back as if it were a
 * live sensor stream; `coming_soon` `live` entries advertise a future
 * capability (e.g. a physical robot) and are not yet connectable.
 */

export interface ReplaySourceEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: "replay" | "live";
  readonly status: "available" | "coming_soon";
  readonly modalities: readonly string[];
  readonly suggestedReplayRateHz?: number;
  /** e.g. "/presets/corridor1-2" */
  readonly presetPath?: string;
  readonly description?: string;
}

export const SOURCE_REGISTRY: readonly ReplaySourceEntry[] = [
  {
    id: "openloris-corridor1-2",
    label: "OpenLORIS · corridor1-2",
    kind: "replay",
    status: "available",
    modalities: ["rgb", "depth"],
    suggestedReplayRateHz: 3,
    presetPath: "/presets/corridor1-2",
    description:
      "Replayed RGB-D + ground-truth pose: a wheeled robot traversing an office corridor.",
  },
  {
    id: "external-robot-stream",
    label: "Connect external robot stream",
    kind: "live",
    status: "coming_soon",
    modalities: ["rgb", "depth", "lidar", "imu"],
    description:
      "Live ROS2 / WebRTC ingestion from a physical robot. Coming soon.",
  },
];
