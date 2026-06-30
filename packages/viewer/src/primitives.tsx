import type { Bounds, Vec3 } from "@sense-sight/world-schema";
import { Grid, Line } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/** Reference floor grid for orienting a point cloud / splat scene. */
export function FloorGrid({
  visible,
  y = 0,
  size = 48,
  divisions = 36,
  cellColor = "#1c2630",
  sectionColor = "#3a4b5c",
}: {
  visible: boolean;
  y?: number;
  size?: number;
  divisions?: number;
  cellColor?: string;
  sectionColor?: string;
}) {
  if (!visible) return null;
  return (
    <Grid
      position={[0, y + 0.005, 0]}
      args={[size, divisions]}
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

/** Wireframe outline for a reconstructed world's bounds. */
export function BoundsFrame({
  bounds,
  visible,
  color = "#33f0d1",
  opacity = 0.42,
}: {
  bounds: Bounds;
  visible: boolean;
  color?: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const { min, max } = bounds;
    const corners = [
      [min.x, min.y, min.z],
      [max.x, min.y, min.z],
      [max.x, min.y, max.z],
      [min.x, min.y, max.z],
      [min.x, max.y, min.z],
      [max.x, max.y, min.z],
      [max.x, max.y, max.z],
      [min.x, max.y, max.z],
    ] as const;
    const edgeIndices = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ] as const;
    const positions = new Float32Array(edgeIndices.length * 2 * 3);
    let offset = 0;

    for (const [start, end] of edgeIndices) {
      for (const index of [start, end]) {
        positions[offset] = corners[index][0];
        positions[offset + 1] = corners[index][1];
        positions[offset + 2] = corners[index][2];
        offset += 3;
      }
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    nextGeometry.computeBoundingSphere();
    return nextGeometry;
  }, [bounds]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!visible) return null;

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </lineSegments>
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
