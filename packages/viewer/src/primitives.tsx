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
  depthTest = true,
}: {
  bounds: Bounds;
  visible: boolean;
  color?: string;
  opacity?: number;
  depthTest?: boolean;
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
        depthTest={depthTest}
        depthWrite={false}
      />
    </lineSegments>
  );
}

export interface SceneShapeOverlayItem {
  readonly id: string;
  readonly label?: string;
  readonly kind?: "room" | "corridor" | "alcove";
  readonly bounds: Bounds;
  readonly confidence?: number;
}

function shapeOverlayColor(kind?: SceneShapeOverlayItem["kind"]): string {
  switch (kind) {
    case "corridor":
      return "#4fd1ff";
    case "alcove":
      return "#ffb24d";
    default:
      return "#33f0d1";
  }
}

function SceneShapeOverlayVolume({
  shape,
  floorY,
}: {
  shape: SceneShapeOverlayItem;
  floorY: number;
}) {
  const color = shapeOverlayColor(shape.kind);
  const width = Math.max(0.001, shape.bounds.max.x - shape.bounds.min.x);
  const depth = Math.max(0.001, shape.bounds.max.z - shape.bounds.min.z);
  const centerX = (shape.bounds.min.x + shape.bounds.max.x) / 2;
  const centerZ = (shape.bounds.min.z + shape.bounds.max.z) / 2;
  const fillOpacity =
    shape.kind === "corridor" ? 0.075 : shape.kind === "alcove" ? 0.09 : 0.08;

  return (
    <group renderOrder={18}>
      <mesh
        position={[centerX, floorY + 0.024, centerZ]}
        rotation-x={-Math.PI / 2}
        renderOrder={18}
      >
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={fillOpacity}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <BoundsFrame
        bounds={shape.bounds}
        visible
        color={color}
        opacity={0.58}
        depthTest={false}
      />
    </group>
  );
}

/** Transparent floor/bounds overlays for inferred room-like shapes. */
export function SceneShapeOverlays({
  shapes,
  visible,
  floorY = 0,
}: {
  shapes: readonly SceneShapeOverlayItem[];
  visible: boolean;
  floorY?: number;
}) {
  if (!visible || shapes.length === 0) return null;

  return (
    <group>
      {shapes.slice(0, 8).map((shape) => (
        <SceneShapeOverlayVolume key={shape.id} shape={shape} floorY={floorY} />
      ))}
    </group>
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
