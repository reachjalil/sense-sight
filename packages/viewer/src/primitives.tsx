import type { Vec3 } from "@sense-sight/world-schema";
import { Grid, Line } from "@react-three/drei";

/** Reference floor grid for orienting a point cloud / splat scene. */
export function FloorGrid({
  visible,
  cellColor = "#1c2630",
  sectionColor = "#3a4b5c",
}: {
  visible: boolean;
  cellColor?: string;
  sectionColor?: string;
}) {
  if (!visible) return null;
  return (
    <Grid
      position={[0, 0.005, 0]}
      args={[48, 36]}
      cellSize={1}
      cellThickness={0.5}
      cellColor={cellColor}
      sectionSize={4}
      sectionThickness={1}
      sectionColor={sectionColor}
      fadeDistance={46}
      fadeStrength={1.4}
      infiniteGrid
    />
  );
}

/** Draws a polyline through a sequence of world-space points, e.g. a sensor's traveled path. */
export function TrajectoryLine({
  points,
  visible,
  color = "#4fd1ff",
}: {
  points: readonly Vec3[];
  visible: boolean;
  color?: string;
}) {
  if (!visible || points.length < 2) return null;
  return (
    <Line
      points={points.map(
        (p) => [p.x, p.y + 0.06, p.z] as [number, number, number]
      )}
      color={color}
      lineWidth={2.4}
      transparent
      opacity={0.92}
    />
  );
}
