import type { Bounds, Vec3 } from "@sense-sight/world-schema";
import { Grid, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
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
  floorY,
}: {
  points: readonly Vec3[];
  visible: boolean;
  color?: string;
  floorY?: number;
}) {
  if (!visible || points.length < 2) return null;
  return (
    <Line
      points={points.map(
        (p) =>
          [p.x, (floorY === undefined ? p.y : floorY) + 0.06, p.z] as [
            number,
            number,
            number,
          ]
      )}
      color={color}
      lineWidth={2.4}
      transparent
      opacity={0.92}
    />
  );
}

/** Pulsing marker for the robot pose inside a streamed/replayed world. */
export function RobotMarker({
  position,
  headingRad,
  floorY = 0,
  color = "#33f0d1",
  visible = true,
}: {
  position: Vec3;
  headingRad: number;
  floorY?: number;
  color?: string;
  visible?: boolean;
}) {
  const ring = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ring.current) return;
    const t = state.clock.elapsedTime;
    const pulse = Math.sin(t * 2.2);
    ring.current.scale.setScalar(1 + pulse * 0.18);
    const material = ring.current.material as THREE.Material;
    material.opacity = 0.5 - pulse * 0.22;
  });

  if (!visible) return null;

  return (
    <group
      position={[position.x, floorY, position.z]}
      rotation-y={headingRad}
      renderOrder={20}
    >
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.45, 0.62, 36]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.4}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position-y={0.32}>
        <cylinderGeometry args={[0.28, 0.32, 0.62, 20]} />
        <meshStandardMaterial
          color="#0e1a22"
          emissive={color}
          emissiveIntensity={0.18}
          metalness={0.4}
          roughness={0.5}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.32, 0.42]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.16, 0.34, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.9}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position-y={0.78}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
