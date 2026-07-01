import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  DEFAULT_TRAINED_RENDER_PROFILE,
  type CoordinateFrame,
  type InferredSceneShape,
  type RenderLayers,
  type TrainedRenderProfile,
} from "@sense-sight/render-contracts";
import {
  BoundsFrame,
  FloorGrid,
  RobotMarker,
  SceneShapeOverlays,
  SparkTrainedSplatCloud,
  SplatPointCloud,
  StreamedTrainedSplatCloud,
  TrajectoryLine,
  TrainedSplatCloud,
} from "@sense-sight/viewer";
import type { Bounds, Vec3 } from "@sense-sight/world-schema";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import {
  getCloudBuffers,
  getRevealedGaussians,
  getRevealedPoints,
  getSplatBuffers,
  getSplatVersion,
} from "./live-cloud";

const BG = "#070c11";

export type CameraViewId = "orbit" | "top" | "sensor" | "inspect";

export interface CameraViewRequest {
  id: CameraViewId;
  version: number;
}

export const CAMERA_VIEW_LABELS: Record<CameraViewId, string> = {
  orbit: "Orbit",
  top: "Top",
  sensor: "Sensor",
  inspect: "Inspect",
};

export type ViewerRenderMode =
  | "seed"
  | "spark"
  | "fallback"
  | "stream"
  | "empty";

interface OrbitLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  maxDistance: number;
  maxPolarAngle: number;
  minDistance: number;
  minPolarAngle: number;
  target: THREE.Vector3;
  update: () => void;
}

interface CameraPose {
  fov: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface RobotPose {
  position: Vec3;
  headingRad: number;
}

function centerOf(bounds: Bounds): [number, number, number] {
  return [
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  ];
}

function sizeOf(bounds: Bounds): [number, number, number] {
  return [
    Math.max(0.001, bounds.max.x - bounds.min.x),
    Math.max(0.001, bounds.max.y - bounds.min.y),
    Math.max(0.001, bounds.max.z - bounds.min.z),
  ];
}

function spanOf(bounds: Bounds | null): number {
  if (!bounds) return 8;
  return Math.max(...sizeOf(bounds), 3);
}

function unionBounds(bounds: readonly Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;
  return bounds.reduce<Bounds>(
    (acc, bounds) => ({
      min: {
        x: Math.min(acc.min.x, bounds.min.x),
        y: Math.min(acc.min.y, bounds.min.y),
        z: Math.min(acc.min.z, bounds.min.z),
      },
      max: {
        x: Math.max(acc.max.x, bounds.max.x),
        y: Math.max(acc.max.y, bounds.max.y),
        z: Math.max(acc.max.z, bounds.max.z),
      },
    }),
    bounds[0]
  );
}

function cameraTargetOf(bounds: Bounds | null): [number, number, number] {
  if (!bounds) return [0, 0, 0];
  const center = centerOf(bounds);
  return [
    center[0],
    bounds.min.y + Math.max(0.35, (bounds.max.y - bounds.min.y) * 0.38),
    center[2],
  ];
}

function cameraPoseForView(
  id: CameraViewId,
  bounds: Bounds | null,
  useTrainedEnvironment = false
): CameraPose {
  if (id === "orbit" && bounds && useTrainedEnvironment) {
    return trainedSplatEnvironmentPose(bounds);
  }

  const target = new THREE.Vector3(...cameraTargetOf(bounds));
  const span = spanOf(bounds);
  const yFloor = bounds?.min.y ?? 0;

  switch (id) {
    case "top":
      return {
        fov: 42,
        position: new THREE.Vector3(target.x, yFloor + span * 1.85, target.z),
        target: new THREE.Vector3(target.x, yFloor, target.z + 0.001),
      };
    case "sensor":
      return {
        fov: 56,
        position: new THREE.Vector3(
          target.x - span * 0.42,
          yFloor + span * 0.2,
          target.z + span * 0.86
        ),
        target: new THREE.Vector3(
          target.x + span * 0.08,
          yFloor + span * 0.16,
          target.z - span * 0.18
        ),
      };
    case "inspect":
      return {
        fov: 46,
        position: new THREE.Vector3(
          target.x + span * 0.84,
          yFloor + span * 0.48,
          target.z + span * 0.5
        ),
        target,
      };
    default:
      return {
        fov: 50,
        position: new THREE.Vector3(
          target.x + span * 0.72,
          yFloor + span * 0.62,
          target.z + span * 1.06
        ),
        target,
      };
  }
}

function trainedSplatEnvironmentPose(bounds: Bounds): CameraPose {
  const boundsCenter = centerOf(bounds);
  const size = sizeOf(bounds);
  const longAxis = size[2] >= size[0] ? "z" : "x";
  const longSpan = longAxis === "z" ? size[2] : size[0];
  const entryMargin = Math.min(0.85, Math.max(0.28, longSpan * 0.025));
  const lookDepth = Math.min(4.6, Math.max(2.4, longSpan * 0.18));
  const eyeY = Math.min(
    bounds.max.y - 0.28,
    Math.max(bounds.min.y + 1.12, boundsCenter[1])
  );
  const targetY = Math.min(
    bounds.max.y - 0.55,
    Math.max(bounds.min.y + 1, eyeY)
  );

  if (longAxis === "x") {
    return {
      fov: 68,
      position: new THREE.Vector3(
        bounds.max.x + entryMargin,
        eyeY,
        boundsCenter[2]
      ),
      target: new THREE.Vector3(
        bounds.max.x - lookDepth,
        targetY,
        boundsCenter[2]
      ),
    };
  }

  return {
    fov: 68,
    position: new THREE.Vector3(
      boundsCenter[0],
      eyeY,
      bounds.max.z + entryMargin
    ),
    target: new THREE.Vector3(
      boundsCenter[0],
      targetY,
      bounds.max.z - lookDepth
    ),
  };
}

function robotTargetOf(
  robotPose: RobotPose | null | undefined,
  worldBounds: Bounds | null
): THREE.Vector3 | null {
  if (!robotPose) return null;
  return new THREE.Vector3(
    robotPose.position.x,
    (worldBounds?.min.y ?? 0) + 0.5,
    robotPose.position.z
  );
}

function robotForwardOf(headingRad: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(headingRad), 0, Math.cos(headingRad));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2;
}

/** The `normalized` frame's orientation correction: swap Y/Z to match the viewer's +Y-up convention. */
function orientNormalizedPoint(point: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  return { x: point.x, y: -point.z, z: point.y };
}

function orientNormalizedBounds(bounds: Bounds): Bounds {
  const xs = [bounds.min.x, bounds.max.x];
  const ys = [bounds.min.y, bounds.max.y];
  const zs = [bounds.min.z, bounds.max.z];
  const points = xs.flatMap((x) =>
    ys.flatMap((y) => zs.map((z) => orientNormalizedPoint({ x, y, z })))
  );
  return {
    min: {
      x: Math.min(...points.map((p) => p.x)),
      y: Math.min(...points.map((p) => p.y)),
      z: Math.min(...points.map((p) => p.z)),
    },
    max: {
      x: Math.max(...points.map((p) => p.x)),
      y: Math.max(...points.map((p) => p.y)),
      z: Math.max(...points.map((p) => p.z)),
    },
  };
}

/** Fit `source` bounds inside `targetBounds`, centered and scaled to 86% of available span. */
function fitBounds(
  source: Bounds,
  targetBounds: Bounds
): { position: [number, number, number]; scale: number } {
  const sourceCenter = centerOf(source);
  const targetCenter = centerOf(targetBounds);
  const sourceSize = sizeOf(source);
  const targetSize = sizeOf(targetBounds);
  const scale =
    Math.min(
      targetSize[0] / sourceSize[0],
      targetSize[1] / sourceSize[1],
      targetSize[2] / sourceSize[2]
    ) * 0.86;
  return {
    position: [
      targetCenter[0] - sourceCenter[0] * scale,
      targetBounds.min.y - source.min.y * scale + 0.03,
      targetCenter[2] - sourceCenter[2] * scale,
    ],
    scale,
  };
}

function ViewerCameraController({
  autoOrbit,
  cameraView,
  robotPose,
  trainedEnvironment,
  worldBounds,
  onAutoOrbitChange,
  onCameraStatusChange,
  onCameraViewChange,
}: {
  autoOrbit: boolean;
  cameraView: CameraViewRequest;
  robotPose?: RobotPose | null;
  trainedEnvironment: boolean;
  worldBounds: Bounds | null;
  onAutoOrbitChange?: (enabled: boolean) => void;
  onCameraStatusChange?: (status: string) => void;
  onCameraViewChange?: (id: CameraViewId) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls as unknown as OrbitLike | null
  );
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const tween = useRef<{
    duration: number;
    elapsed: number;
    fromFov: number;
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toFov: number;
    toPosition: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null>(null);
  const handledView = useRef<{
    boundsKey: string;
    id: CameraViewId;
    trainedEnvironment: boolean;
    version: number;
  } | null>(null);
  const reducedMotion = useRef(false);
  const orbitOffset = useRef(new THREE.Vector3());
  const orbitSpherical = useRef(new THREE.Spherical());
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const panOffset = useRef(new THREE.Vector3());
  const followAngle = useRef(0);
  const followTarget = useRef(new THREE.Vector3());
  const followPosition = useRef(new THREE.Vector3());
  const perspectiveCamera =
    camera instanceof THREE.PerspectiveCamera ? camera : null;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotion.current = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!controls) return;
    controls.autoRotate = false;
    if (autoOrbit) {
      followTarget.current.copy(
        robotTargetOf(robotPose, worldBounds) ??
          new THREE.Vector3(...cameraTargetOf(worldBounds))
      );
      orbitOffset.current.copy(camera.position).sub(followTarget.current);
      followAngle.current = Math.atan2(
        orbitOffset.current.z,
        orbitOffset.current.x
      );
      onCameraStatusChange?.(robotPose ? "Robot follow" : "Follow orbit");
    }
    invalidate();
  }, [
    autoOrbit,
    camera,
    controls,
    invalidate,
    onCameraStatusChange,
    robotPose,
    worldBounds,
  ]);

  useEffect(() => {
    if (!controls || !perspectiveCamera) return;
    const boundsKey = worldBounds
      ? [
          worldBounds.min.x,
          worldBounds.min.y,
          worldBounds.min.z,
          worldBounds.max.x,
          worldBounds.max.y,
          worldBounds.max.z,
        ]
          .map((value) => value.toFixed(3))
          .join(":")
      : "none";
    if (
      handledView.current?.id === cameraView.id &&
      handledView.current.version === cameraView.version &&
      handledView.current.boundsKey === boundsKey &&
      handledView.current.trainedEnvironment === trainedEnvironment
    ) {
      return;
    }
    handledView.current = {
      boundsKey,
      id: cameraView.id,
      trainedEnvironment,
      version: cameraView.version,
    };

    const nextPose = cameraPoseForView(
      cameraView.id,
      worldBounds,
      trainedEnvironment
    );
    onCameraStatusChange?.(`${CAMERA_VIEW_LABELS[cameraView.id]} camera`);

    if (reducedMotion.current) {
      perspectiveCamera.position.copy(nextPose.position);
      perspectiveCamera.fov = nextPose.fov;
      perspectiveCamera.updateProjectionMatrix();
      controls.target.copy(nextPose.target);
      controls.update();
      invalidate();
      return;
    }

    tween.current = {
      duration: 0.64,
      elapsed: 0,
      fromFov: perspectiveCamera.fov,
      fromPosition: perspectiveCamera.position.clone(),
      fromTarget: controls.target.clone(),
      toFov: nextPose.fov,
      toPosition: nextPose.position,
      toTarget: nextPose.target,
    };
    invalidate();
  }, [
    cameraView,
    controls,
    invalidate,
    onCameraStatusChange,
    perspectiveCamera,
    trainedEnvironment,
    worldBounds,
  ]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Interactive 3D reconstruction viewer");

    const stopAutoOrbit = () => onAutoOrbitChange?.(false);
    const setManualStatus = (status: string) => {
      onCameraStatusChange?.(status);
      invalidate();
    };
    const orbitBy = (thetaDelta: number, phiDelta: number) => {
      if (!controls) return;
      tween.current = null;
      stopAutoOrbit();
      orbitOffset.current.copy(camera.position).sub(controls.target);
      orbitSpherical.current.setFromVector3(orbitOffset.current);
      orbitSpherical.current.theta += thetaDelta;
      orbitSpherical.current.phi = clamp(
        orbitSpherical.current.phi + phiDelta,
        controls.minPolarAngle,
        controls.maxPolarAngle
      );
      orbitSpherical.current.makeSafe();
      orbitOffset.current.setFromSpherical(orbitSpherical.current);
      camera.position.copy(controls.target).add(orbitOffset.current);
      controls.update();
      setManualStatus("Manual orbit");
    };
    const panBy = (rightAmount: number, forwardAmount: number) => {
      if (!controls) return;
      tween.current = null;
      stopAutoOrbit();
      camera.getWorldDirection(forward.current);
      forward.current.y = 0;
      forward.current.normalize();
      right.current.setFromMatrixColumn(camera.matrixWorld, 0);
      right.current.y = 0;
      right.current.normalize();

      const distance = camera.position.distanceTo(controls.target);
      const panScale = Math.max(0.04, distance * 0.035);
      panOffset.current
        .copy(right.current)
        .multiplyScalar(rightAmount * panScale)
        .addScaledVector(forward.current, forwardAmount * panScale);
      camera.position.add(panOffset.current);
      controls.target.add(panOffset.current);
      controls.update();
      setManualStatus("Manual pan");
    };
    const zoomBy = (scale: number) => {
      if (!controls) return;
      tween.current = null;
      stopAutoOrbit();
      orbitOffset.current.copy(camera.position).sub(controls.target);
      orbitOffset.current.setLength(
        clamp(
          orbitOffset.current.length() * scale,
          controls.minDistance,
          controls.maxDistance
        )
      );
      camera.position.copy(controls.target).add(orbitOffset.current);
      controls.update();
      setManualStatus("Manual zoom");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const numberView = {
        "1": "orbit",
        "2": "top",
        "3": "sensor",
        "4": "inspect",
      }[key] as CameraViewId | undefined;

      if (numberView) {
        event.preventDefault();
        onAutoOrbitChange?.(false);
        onCameraViewChange?.(numberView);
        return;
      }

      switch (key) {
        case "f":
        case "r":
          event.preventDefault();
          onAutoOrbitChange?.(false);
          onCameraViewChange?.("orbit");
          return;
        case "a":
          event.preventDefault();
          onAutoOrbitChange?.(!autoOrbit);
          return;
        case "arrowleft":
          event.preventDefault();
          orbitBy(0.12, 0);
          return;
        case "arrowright":
          event.preventDefault();
          orbitBy(-0.12, 0);
          return;
        case "arrowup":
          event.preventDefault();
          orbitBy(0, -0.08);
          return;
        case "arrowdown":
          event.preventDefault();
          orbitBy(0, 0.08);
          return;
        case "w":
          event.preventDefault();
          panBy(0, 1);
          return;
        case "s":
          event.preventDefault();
          panBy(0, -1);
          return;
        case "d":
          event.preventDefault();
          panBy(1, 0);
          return;
        case "q":
          event.preventDefault();
          panBy(-1, 0);
          return;
        case "+":
        case "=":
          event.preventDefault();
          zoomBy(0.88);
          return;
        case "-":
        case "_":
          event.preventDefault();
          zoomBy(1.12);
          return;
        default:
          return;
      }
    };

    canvas.addEventListener("pointerdown", stopAutoOrbit);
    canvas.addEventListener("keydown", handleKeyDown);
    return () => {
      canvas.removeEventListener("pointerdown", stopAutoOrbit);
      canvas.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    autoOrbit,
    camera,
    controls,
    gl,
    invalidate,
    onAutoOrbitChange,
    onCameraStatusChange,
    onCameraViewChange,
  ]);

  useFrame((_, delta) => {
    if (autoOrbit && controls && perspectiveCamera && !reducedMotion.current) {
      const span = spanOf(worldBounds);
      const yFloor = worldBounds?.min.y ?? 0;
      const robotTarget = robotTargetOf(robotPose, worldBounds);
      const target = robotTarget
        ? followTarget.current.copy(robotTarget)
        : followTarget.current.fromArray(cameraTargetOf(worldBounds));
      const radius = clamp(
        perspectiveCamera.position.distanceTo(controls.target),
        Math.max(2.4, span * 0.24),
        Math.max(5.5, span * 0.48)
      );
      const currentRobotTarget = robotTarget;
      if (robotPose && currentRobotTarget) {
        const forward = robotForwardOf(robotPose.headingRad);
        const followDistance = clamp(span * 0.18, 3.2, 6.5);
        const lookAhead = clamp(span * 0.22, 5, 10);
        const eyeY = yFloor + clamp(span * 0.065, 1.15, 1.65);
        const targetY = yFloor + clamp(span * 0.06, 1.05, 1.45);
        target
          .copy(currentRobotTarget)
          .addScaledVector(forward, lookAhead)
          .setY(targetY);
        followPosition.current
          .copy(currentRobotTarget)
          .addScaledVector(forward, -followDistance)
          .setY(eyeY);
      } else {
        followAngle.current += delta * 0.22;
        followPosition.current.set(
          target.x + Math.cos(followAngle.current) * radius,
          yFloor + span * (0.45 + Math.sin(followAngle.current * 1.35) * 0.045),
          target.z + Math.sin(followAngle.current) * radius
        );
      }
      const targetEase = 1 - Math.exp(-delta * 4.2);
      const cameraEase = 1 - Math.exp(-delta * 1.55);
      controls.target.lerp(target, targetEase);
      perspectiveCamera.position.lerp(followPosition.current, cameraEase);
      perspectiveCamera.fov = THREE.MathUtils.lerp(
        perspectiveCamera.fov,
        robotPose ? 52 : 48,
        targetEase
      );
      perspectiveCamera.updateProjectionMatrix();
      controls.update();
      onCameraStatusChange?.(robotPose ? "Robot follow" : "Follow orbit");
      invalidate();
    }
    const animation = tween.current;
    if (!animation || !controls || !perspectiveCamera) return;
    animation.elapsed = Math.min(animation.duration, animation.elapsed + delta);
    const progress = animation.elapsed / animation.duration;
    const eased = easeInOutCubic(progress);

    perspectiveCamera.position.lerpVectors(
      animation.fromPosition,
      animation.toPosition,
      eased
    );
    perspectiveCamera.fov = THREE.MathUtils.lerp(
      animation.fromFov,
      animation.toFov,
      eased
    );
    perspectiveCamera.updateProjectionMatrix();
    controls.target.lerpVectors(
      animation.fromTarget,
      animation.toTarget,
      eased
    );
    controls.update();
    invalidate();

    if (progress >= 1) tween.current = null;
  });

  return null;
}

export interface TrainedSplatAsset {
  id?: string;
  /** Object URL (or any fetchable URL) for the `.splat` bytes. */
  url: string;
  /** Original artifact bytes, used by Spark when object URLs hide the file type. */
  fileBytes?: ArrayBuffer | Uint8Array;
  /** Original artifact filename, used by Spark loaders for format-specific paths. */
  fileName?: string;
  /** Bounds of the splat's own coordinate space, used by the `normalized` fit. */
  sourceBounds: Bounds;
  /** Optional world-frame bounds to fit into, used by fused submap layers. */
  targetBounds?: Bounds;
  coordinateFrame: CoordinateFrame;
}

interface TrainedSplatTransform {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

interface TrainedLayerItem {
  asset: TrainedSplatAsset;
  key: string;
  transform: TrainedSplatTransform;
}

export interface ViewerProps {
  autoOrbit: boolean;
  cameraView: CameraViewRequest;
  layers: RenderLayers;
  trainedRenderProfile?: TrainedRenderProfile;
  worldBounds: Bounds | null;
  seedPositions: Float32Array | null;
  seedColors: Float32Array | null;
  trajectoryPoints?: readonly Vec3[];
  trajectorySegments?: readonly (readonly Vec3[])[];
  robotPose?: RobotPose | null;
  trainedSplat: TrainedSplatAsset | null;
  trainedSplats?: readonly TrainedSplatAsset[] | null;
  sceneShapes?: readonly InferredSceneShape[];
  showInteriorShapes?: boolean;
  /** Gate the live StreamedTrainedSplatCloud render path behind an explicit flag. */
  isStreamingLive: boolean;
  onAutoOrbitChange?: (enabled: boolean) => void;
  onCameraStatusChange?: (status: string) => void;
  onCameraViewChange?: (id: CameraViewId) => void;
  onRenderModeChange?: (mode: ViewerRenderMode) => void;
}

export function Viewer({
  autoOrbit,
  cameraView,
  layers,
  trainedRenderProfile = DEFAULT_TRAINED_RENDER_PROFILE,
  worldBounds,
  seedPositions,
  seedColors,
  trajectoryPoints = [],
  trajectorySegments,
  robotPose,
  trainedSplat,
  trainedSplats,
  sceneShapes = [],
  showInteriorShapes = false,
  isStreamingLive,
  onAutoOrbitChange,
  onCameraStatusChange,
  onCameraViewChange,
  onRenderModeChange,
}: ViewerProps) {
  const [sparkFailed, setSparkFailed] = useState(false);
  // Live stream buffers are owned outside React; poll their revealed/version
  // counters on a rAF loop so StreamedTrainedSplatCloud repaints as gaussians
  // arrive without re-rendering the whole app on every incoming frame.
  const [, forceSplatTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!isStreamingLive) return;
    let raf: number;
    const tick = () => {
      forceSplatTick();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isStreamingLive]);

  useEffect(() => {
    setSparkFailed(false);
  }, [trainedSplat]);

  const activeTrainedSplats = useMemo(
    () => trainedSplats ?? (trainedSplat ? [trainedSplat] : []),
    [trainedSplat, trainedSplats]
  );
  const hasTrainedSplats = activeTrainedSplats.length > 0;
  const trainedLayerItems = useMemo<TrainedLayerItem[]>(() => {
    const items: TrainedLayerItem[] = [];
    for (let index = 0; index < activeTrainedSplats.length; index += 1) {
      const asset = activeTrainedSplats[index];
      if (!worldBounds) return [];
      if (asset.coordinateFrame === "training-frame") {
        items.push({
          asset,
          key: asset.id ?? asset.url ?? `trained-${index}`,
          transform: {
            scale: [-1, 1, 1],
          },
        });
        continue;
      }
      if (asset.coordinateFrame === "normalized") {
        const orientedSource = orientNormalizedBounds(asset.sourceBounds);
        const fit = fitBounds(
          orientedSource,
          asset.targetBounds ?? worldBounds
        );
        items.push({
          asset,
          key: asset.id ?? asset.url ?? `trained-${index}`,
          transform: {
            position: fit.position,
            rotation: [Math.PI / 2, 0, 0],
            scale: fit.scale,
          },
        });
      }
    }
    return items;
  }, [activeTrainedSplats, worldBounds]);
  const trainedTargetBounds = useMemo(
    () =>
      unionBounds(
        activeTrainedSplats
          .map((asset) => asset.targetBounds)
          .filter((bounds): bounds is Bounds => Boolean(bounds))
      ),
    [activeTrainedSplats]
  );
  const dominantShapeBounds =
    showInteriorShapes && sceneShapes.length > 0
      ? sceneShapes[0]?.bounds
      : null;
  const cameraBounds =
    dominantShapeBounds ?? trainedTargetBounds ?? worldBounds;

  const span = spanOf(cameraBounds);
  const worldSpan = spanOf(worldBounds ?? cameraBounds);
  const trainedEnvironment = hasTrainedSplats && layers.splat;
  const initialPose = cameraPoseForView(
    cameraView.id,
    cameraBounds,
    trainedEnvironment
  );
  const cameraPosition = initialPose.position.toArray() as [
    number,
    number,
    number,
  ];
  const target = initialPose.target.toArray() as [number, number, number];
  const gridSize = clamp(worldSpan * 1.8, 16, 96);
  const cameraFar = Math.max(200, Math.max(span, worldSpan) * 18);
  const cloudBuffers = isStreamingLive ? getCloudBuffers() : null;
  const splatBuffers = isStreamingLive ? getSplatBuffers() : null;

  useEffect(() => {
    if (hasTrainedSplats && layers.splat) {
      onRenderModeChange?.(sparkFailed ? "fallback" : "spark");
      return;
    }
    if (isStreamingLive && layers.splat) {
      onRenderModeChange?.("stream");
      return;
    }
    onRenderModeChange?.(seedPositions ? "seed" : "empty");
  }, [
    isStreamingLive,
    layers.splat,
    onRenderModeChange,
    seedPositions,
    sparkFailed,
    hasTrainedSplats,
  ]);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: cameraPosition,
        fov: initialPose.fov,
        near: 0.05,
        far: cameraFar,
      }}
      gl={{
        antialias: false,
        powerPreference: "high-performance",
      }}
      performance={{ min: 0.5 }}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 28, 80]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#8ccbd0", "#070c11", 0.52]} />
      <directionalLight position={[8, 12, 7]} intensity={0.75} />
      <FloorGrid
        visible={layers.grid}
        y={worldBounds?.min.y ?? 0}
        size={gridSize}
        divisions={Math.max(12, Math.round(gridSize))}
      />
      {worldBounds && (
        <BoundsFrame bounds={worldBounds} visible={layers.annotations} />
      )}
      <SceneShapeOverlays
        shapes={sceneShapes}
        visible={
          sceneShapes.length > 0 && (showInteriorShapes || layers.annotations)
        }
        floorY={worldBounds?.min.y ?? 0}
      />

      {!isStreamingLive && seedPositions && seedColors && (
        <SplatPointCloud
          positions={seedPositions}
          colors={seedColors}
          visible={layers.pointcloud}
          size={0.05}
          opacity={0.92}
        />
      )}

      {isStreamingLive && cloudBuffers && (
        // Live seed points growing incrementally from a streaming source,
        // bound directly to live-cloud.ts's externally-owned buffers.
        <SplatPointCloud
          positions={cloudBuffers.positions}
          colors={cloudBuffers.colors}
          visible={layers.pointcloud}
          revealCount={getRevealedPoints()}
          size={0.05}
          opacity={0.92}
        />
      )}

      {layers.splat &&
        !sparkFailed &&
        trainedLayerItems.map(({ asset, key, transform }) => (
          <SparkTrainedSplatCloud
            key={key}
            url={asset.url}
            fileBytes={asset.fileBytes}
            fileName={asset.fileName}
            visible
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            opacity={trainedRenderProfile.opacity}
            minAlpha={trainedRenderProfile.minAlpha}
            maxPixelRadius={trainedRenderProfile.maxPixelRadius}
            minPixelRadius={0}
            maxStdDev={
              trainedRenderProfile.maxStdDev *
              trainedRenderProfile.radiusDefault
            }
            focalAdjustment={trainedRenderProfile.focalAdjustment}
            falloff={trainedRenderProfile.falloff}
            sortRadial={trainedRenderProfile.sortRadial}
            onReady={() => onRenderModeChange?.("spark")}
            onError={() => {
              setSparkFailed(true);
              onRenderModeChange?.("fallback");
            }}
          />
        ))}

      {layers.splat &&
        sparkFailed &&
        trainedLayerItems.map(({ asset, key, transform }) => (
          <TrainedSplatCloud
            key={key}
            url={asset.url}
            visible
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            size={trainedRenderProfile.radiusDefault}
            minAlpha={trainedRenderProfile.fallbackMinAlpha * 255}
            maxScreenSize={trainedRenderProfile.fallbackMaxScreenSize}
            alphaPower={trainedRenderProfile.fallbackAlphaPower}
            colorGain={trainedRenderProfile.fallbackColorGain}
            opacity={trainedRenderProfile.fallbackOpacity}
          />
        ))}

      {isStreamingLive && layers.splat && !hasTrainedSplats && (
        <StreamedTrainedSplatCloud
          buffers={splatBuffers}
          visible={layers.splat}
          revealedGaussians={getRevealedGaussians()}
          gaussianVersion={getSplatVersion()}
          size={trainedRenderProfile.fallbackMinScale}
          maxScreenSize={trainedRenderProfile.fallbackMaxScreenSize}
          alphaPower={trainedRenderProfile.fallbackAlphaPower}
          colorGain={trainedRenderProfile.fallbackColorGain}
          opacity={trainedRenderProfile.fallbackOpacity}
        />
      )}

      {(trajectorySegments ?? [trajectoryPoints]).map((points, index) => (
        <TrajectoryLine
          key={`trajectory-${index}`}
          points={points}
          visible={layers.trajectory}
          floorY={worldBounds?.min.y ?? 0}
        />
      ))}
      {robotPose && (
        <RobotMarker
          position={robotPose.position}
          headingRad={robotPose.headingRad}
          floorY={worldBounds?.min.y ?? 0}
          visible={layers.trajectory}
        />
      )}

      <ViewerCameraController
        autoOrbit={autoOrbit}
        cameraView={cameraView}
        robotPose={robotPose}
        trainedEnvironment={trainedEnvironment}
        worldBounds={cameraBounds}
        onAutoOrbitChange={onAutoOrbitChange}
        onCameraStatusChange={onCameraStatusChange}
        onCameraViewChange={onCameraViewChange}
      />
      <OrbitControls
        makeDefault
        enableDamping
        enablePan
        enableZoom
        dampingFactor={0.08}
        onStart={() => {
          onAutoOrbitChange?.(false);
          onCameraStatusChange?.("Manual orbit");
        }}
        screenSpacePanning={false}
        target={target}
        minDistance={Math.max(0.35, span * 0.08)}
        maxDistance={Math.max(24, span * 8)}
        maxPolarAngle={Math.PI / 2.03}
        minPolarAngle={0.04}
      />
    </Canvas>
  );
}
