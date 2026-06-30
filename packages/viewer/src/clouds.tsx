import { decodeSplat } from "@sense-sight/splat-codec";
import type { CloudBuffers, SplatBuffers } from "@sense-sight/stream-buffers";
import { useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useSplatSprite } from "./sprite";

/** A static colored point cloud rendered as soft splats. */
export function SplatPointCloud({
  positions,
  colors,
  visible,
  revealCount,
  size = 0.075,
  opacity = 0.95,
}: {
  positions: Float32Array;
  colors: Float32Array;
  visible: boolean;
  /** Render only the first N points (progressive reconstruction). */
  revealCount?: number;
  size?: number;
  opacity?: number;
}) {
  const sprite = useSplatSprite();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [positions, colors]);

  const total = positions.length / 3;
  useEffect(() => {
    geometry.setDrawRange(0, revealCount ?? total);
  }, [geometry, revealCount, total]);

  return (
    <points geometry={geometry} visible={visible} frustumCulled={false}>
      <pointsMaterial
        size={size}
        sizeAttenuation
        vertexColors
        map={sprite}
        alphaMap={sprite}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </points>
  );
}

/**
 * A streamed/incremental point cloud bound to externally-owned
 * `@sense-sight/stream-buffers` `CloudBuffers` (e.g. a reconstruction buffer
 * that grows as frames arrive). The caller owns the arrays; this component
 * advances the draw range to `revealedPoints` and flags the attributes dirty
 * on each `cloudVersion` bump — no reallocation.
 */
export function StreamedPointCloud({
  buffers,
  visible,
  revealedPoints,
  cloudVersion,
  size = 0.05,
  opacity = 0.95,
}: {
  buffers: CloudBuffers | null;
  visible: boolean;
  revealedPoints: number;
  cloudVersion: number;
  size?: number;
  opacity?: number;
}) {
  const sprite = useSplatSprite();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (buffers) {
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(buffers.positions, 3)
      );
      g.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 3));
    }
    return g;
  }, [buffers]);

  useEffect(() => {
    const position = geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    const color = geometry.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (!position || !color) return;
    geometry.setDrawRange(0, revealedPoints);
    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [geometry, revealedPoints, cloudVersion]);

  if (!buffers || revealedPoints <= 0) return null;

  return (
    <points geometry={geometry} visible={visible} frustumCulled={false}>
      <pointsMaterial
        size={size}
        sizeAttenuation
        vertexColors
        map={sprite}
        alphaMap={sprite}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </points>
  );
}

const trainedSplatVertexShader = `
attribute vec4 splatColor;
attribute float splatSize;
varying vec4 vSplatColor;
uniform float sizeMultiplier;
uniform float viewportHeight;
uniform float maxScreenSize;

void main() {
  vSplatColor = splatColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vec3 mx = vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]);
  vec3 my = vec3(modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2]);
  vec3 mz = vec3(modelMatrix[2][0], modelMatrix[2][1], modelMatrix[2][2]);
  float modelScale = max(max(length(mx), length(my)), length(mz));
  float worldRadius = splatSize * modelScale * sizeMultiplier;
  float perspective = projectionMatrix[1][1] * viewportHeight / max(0.2, -mvPosition.z);
  gl_PointSize = clamp(worldRadius * perspective, 0.75, maxScreenSize);
}
`;

const trainedSplatFragmentShader = `
varying vec4 vSplatColor;
uniform float opacity;
uniform float alphaPower;
uniform float colorGain;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float radius = dot(centered, centered) * 4.0;
  float gaussian = exp(-radius * 5.4);
  if (gaussian < 0.035) discard;
  float alpha = pow(vSplatColor.a, alphaPower) * gaussian * opacity;
  if (alpha < 0.01) discard;
  vec3 color = clamp(vSplatColor.rgb * colorGain, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

const streamedTrainedSplatVertexShader = `
attribute vec3 splatScale;
attribute vec4 splatRotation;
attribute vec4 splatColor;
attribute float splatOpacity;
varying vec4 vSplatColor;
uniform float sizeMultiplier;
uniform float viewportHeight;
uniform float maxScreenSize;

void main() {
  vSplatColor = vec4(splatColor.rgb, splatOpacity);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vec3 mx = vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2]);
  vec3 my = vec3(modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2]);
  vec3 mz = vec3(modelMatrix[2][0], modelMatrix[2][1], modelMatrix[2][2]);
  float modelScale = max(max(length(mx), length(my)), length(mz));
  float splatSize = max(max(abs(splatScale.x), abs(splatScale.y)), abs(splatScale.z));
  float worldRadius = splatSize * modelScale * sizeMultiplier;
  float perspective = projectionMatrix[1][1] * viewportHeight / max(0.2, -mvPosition.z);
  gl_PointSize = clamp(worldRadius * perspective, 0.75, maxScreenSize);
}
`;

const streamedTrainedSplatFragmentShader = `
varying vec4 vSplatColor;
uniform float opacity;
uniform float alphaPower;
uniform float colorGain;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float radius = dot(centered, centered) * 4.0;
  float gaussian = exp(-radius * 5.4);
  if (gaussian < 0.035) discard;
  float alpha = pow(vSplatColor.a, alphaPower) * gaussian * opacity;
  if (alpha < 0.01) discard;
  vec3 color = clamp(vSplatColor.rgb * colorGain, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Renders a LIVE/incrementally-growing trained Gaussian splat cloud bound to
 * externally-owned `@sense-sight/stream-buffers` `SplatBuffers` (e.g. a
 * streaming training session that grows as Gaussians are optimized). Mirrors
 * `StreamedPointCloud`'s pattern of binding buffers directly as
 * BufferAttributes and advancing the draw range on each
 * `[revealedGaussians, gaussianVersion]` change — no reallocation. Reuses
 * `TrainedSplatCloud`'s soft-Gaussian-sprite shader approach, adapted to read
 * scale/rotation/opacity from per-vertex attributes instead of values baked
 * into geometry at load time. `splatRotation` is currently passed through for
 * future anisotropic rendering and is not yet used by the shader.
 */
export function StreamedTrainedSplatCloud({
  buffers,
  visible,
  revealedGaussians,
  gaussianVersion,
  size = 1,
  maxScreenSize = 28,
  alphaPower = 1.35,
  colorGain = 1,
  opacity = 0.86,
}: {
  buffers: SplatBuffers | null;
  visible: boolean;
  revealedGaussians: number;
  gaussianVersion: number;
  size?: number;
  maxScreenSize?: number;
  alphaPower?: number;
  colorGain?: number;
  opacity?: number;
}) {
  const viewportHeight = useThree((state) => state.size.height);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (buffers) {
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(buffers.positions, 3)
      );
      g.setAttribute(
        "splatScale",
        new THREE.BufferAttribute(buffers.scales, 3)
      );
      g.setAttribute(
        "splatRotation",
        new THREE.BufferAttribute(buffers.rotations, 4)
      );
      g.setAttribute(
        "splatColor",
        new THREE.BufferAttribute(buffers.colors, 4, true)
      );
      g.setAttribute(
        "splatOpacity",
        new THREE.BufferAttribute(buffers.opacities, 1)
      );
    }
    return g;
  }, [buffers]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          opacity: { value: opacity },
          sizeMultiplier: { value: size },
          viewportHeight: { value: viewportHeight },
          maxScreenSize: { value: maxScreenSize },
          alphaPower: { value: alphaPower },
          colorGain: { value: colorGain },
        },
        vertexShader: streamedTrainedSplatVertexShader,
        fragmentShader: streamedTrainedSplatFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
      }),
    []
  );

  useEffect(() => {
    material.uniforms.opacity.value = opacity;
    material.uniforms.sizeMultiplier.value = size;
    material.uniforms.viewportHeight.value = viewportHeight;
    material.uniforms.maxScreenSize.value = maxScreenSize;
    material.uniforms.alphaPower.value = alphaPower;
    material.uniforms.colorGain.value = colorGain;
  }, [
    material,
    opacity,
    size,
    viewportHeight,
    maxScreenSize,
    alphaPower,
    colorGain,
  ]);

  useEffect(() => {
    const position = geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    const scale = geometry.getAttribute("splatScale") as
      | THREE.BufferAttribute
      | undefined;
    const rotation = geometry.getAttribute("splatRotation") as
      | THREE.BufferAttribute
      | undefined;
    const color = geometry.getAttribute("splatColor") as
      | THREE.BufferAttribute
      | undefined;
    const splatOpacity = geometry.getAttribute("splatOpacity") as
      | THREE.BufferAttribute
      | undefined;
    if (!position || !scale || !rotation || !color || !splatOpacity) return;
    geometry.setDrawRange(0, revealedGaussians);
    position.needsUpdate = true;
    scale.needsUpdate = true;
    rotation.needsUpdate = true;
    color.needsUpdate = true;
    splatOpacity.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [geometry, revealedGaussians, gaussianVersion]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!buffers || revealedGaussians <= 0) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      visible={visible}
      frustumCulled={false}
    />
  );
}

/**
 * Renders a trained Gaussian-splat asset (`.splat`) inside the Three.js
 * scene. This is a lightweight local viewer path: it uses trained position,
 * scale, color, and alpha for soft Gaussian sprites, but does not yet
 * rasterize full anisotropic covariance ellipses or perform depth sorting
 * like a native 3DGS viewer. Prefer `SparkTrainedSplatCloud` when
 * `@sparkjsdev/spark` can load the asset; keep this as the fallback path.
 */
export function TrainedSplatCloud({
  url,
  visible,
  size = 1,
  minAlpha = 32,
  minScale = 0.00025,
  maxScale = 0.04,
  maxScreenSize = 28,
  alphaPower = 1.35,
  colorGain = 1,
  opacity = 0.86,
}: {
  url: string;
  visible: boolean;
  size?: number;
  minAlpha?: number;
  minScale?: number;
  maxScale?: number;
  maxScreenSize?: number;
  alphaPower?: number;
  colorGain?: number;
  opacity?: number;
}) {
  const viewportHeight = useThree((state) => state.size.height);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          opacity: { value: opacity },
          sizeMultiplier: { value: size },
          viewportHeight: { value: viewportHeight },
          maxScreenSize: { value: maxScreenSize },
          alphaPower: { value: alphaPower },
          colorGain: { value: colorGain },
        },
        vertexShader: trainedSplatVertexShader,
        fragmentShader: trainedSplatFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`splat ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        const {
          count,
          positions: pos,
          scales,
          colors: rgba,
        } = decodeSplat(buf);
        const splatScale = (index: number) =>
          Math.max(
            Math.abs(scales[index * 3]),
            Math.abs(scales[index * 3 + 1]),
            Math.abs(scales[index * 3 + 2])
          );
        const keepSplat = (index: number) => {
          const alpha = rgba[index * 4 + 3];
          const scale = splatScale(index);
          return alpha >= minAlpha && scale >= minScale && scale <= maxScale;
        };
        let kept = 0;
        for (let i = 0; i < count; i++) {
          if (keepSplat(i)) kept += 1;
        }
        const positions = new Float32Array(kept * 3);
        const colors = new Float32Array(kept * 4);
        const sizes = new Float32Array(kept);
        let next = 0;
        for (let i = 0; i < count; i++) {
          if (!keepSplat(i)) continue;
          positions[next * 3] = pos[i * 3];
          positions[next * 3 + 1] = pos[i * 3 + 1];
          positions[next * 3 + 2] = pos[i * 3 + 2];
          colors[next * 4] = rgba[i * 4] / 255;
          colors[next * 4 + 1] = rgba[i * 4 + 1] / 255;
          colors[next * 4 + 2] = rgba[i * 4 + 2] / 255;
          colors[next * 4 + 3] = rgba[i * 4 + 3] / 255;
          sizes[next] = splatScale(i);
          next += 1;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        g.setAttribute("splatColor", new THREE.BufferAttribute(colors, 4));
        g.setAttribute("splatSize", new THREE.BufferAttribute(sizes, 1));
        g.computeBoundingSphere();
        setGeometry(g);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[viewer] trained splat load failed:", err);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, minAlpha, minScale, maxScale]);

  useEffect(() => {
    material.uniforms.opacity.value = opacity;
    material.uniforms.sizeMultiplier.value = size;
    material.uniforms.viewportHeight.value = viewportHeight;
    material.uniforms.maxScreenSize.value = maxScreenSize;
    material.uniforms.alphaPower.value = alphaPower;
    material.uniforms.colorGain.value = colorGain;
  }, [
    material,
    opacity,
    size,
    viewportHeight,
    maxScreenSize,
    alphaPower,
    colorGain,
  ]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!visible || !geometry) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      visible={visible}
      frustumCulled={false}
    />
  );
}

export interface SparkTrainedSplatCloudProps {
  readonly url: string;
  readonly visible: boolean;
  readonly position?: [number, number, number];
  readonly rotation?: [number, number, number];
  readonly scale?: number | [number, number, number];
  readonly opacity?: number;
  readonly minAlpha?: number;
  readonly maxPixelRadius?: number;
  readonly minPixelRadius?: number;
  readonly maxStdDev?: number;
  readonly focalAdjustment?: number;
  readonly falloff?: number;
  readonly sortRadial?: boolean;
  readonly onReady?: (mesh: SplatMesh) => void;
  readonly onError?: (error: unknown) => void;
}

function applyObjectTransform(
  object: THREE.Object3D,
  {
    position,
    rotation,
    scale,
  }: Pick<SparkTrainedSplatCloudProps, "position" | "rotation" | "scale">
) {
  object.position.fromArray(position ?? [0, 0, 0]);
  object.rotation.fromArray(rotation ?? [0, 0, 0]);
  if (typeof scale === "number") object.scale.setScalar(scale);
  else object.scale.fromArray(scale ?? [1, 1, 1]);
  object.updateMatrixWorld(true);
}

/**
 * Renders a trained Gaussian-splat asset through Spark's native Three.js
 * 3DGS path. Unlike `TrainedSplatCloud`, this preserves per-Gaussian
 * orientation, covariance, opacity, and sorted blending, so it should be the
 * default for photoreal inspection. Keep `TrainedSplatCloud` available as a
 * low-risk fallback for browsers or files Spark cannot load.
 */
export function SparkTrainedSplatCloud({
  url,
  visible,
  position,
  rotation,
  scale,
  opacity = 1,
  minAlpha = 1 / 255,
  maxPixelRadius = 420,
  minPixelRadius = 0,
  maxStdDev = Math.sqrt(8),
  focalAdjustment = 1.35,
  falloff = 1,
  sortRadial = false,
  onReady,
  onError,
}: SparkTrainedSplatCloudProps) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const spark = useMemo(
    () =>
      new SparkRenderer({
        renderer: gl,
        onDirty: invalidate,
        minAlpha,
        maxPixelRadius,
        minPixelRadius,
        maxStdDev,
        focalAdjustment,
        falloff,
        sortRadial,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        preBlurAmount: 0,
        blurAmount: 0,
      }),
    [
      gl,
      invalidate,
      minAlpha,
      maxPixelRadius,
      minPixelRadius,
      maxStdDev,
      focalAdjustment,
      falloff,
      sortRadial,
    ]
  );

  const mesh = useMemo(() => {
    const next = new SplatMesh({ url });
    applyObjectTransform(next, { position, rotation, scale });
    next.visible = false;
    return next;
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    mesh.initialized
      .then((loaded) => {
        if (cancelled) return;
        loaded.opacity = opacity;
        setReady(true);
        onReady?.(loaded);
        invalidate();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        onError?.(error);
        console.warn("[viewer] Spark splat load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [mesh, invalidate, onReady, onError, opacity]);

  useEffect(() => {
    applyObjectTransform(mesh, { position, rotation, scale });
    mesh.opacity = opacity;
    mesh.visible = visible && ready && !failed;
    mesh.needsUpdate = true;
    invalidate();
  }, [
    mesh,
    position,
    rotation,
    scale,
    opacity,
    visible,
    ready,
    failed,
    invalidate,
  ]);

  useEffect(() => {
    spark.minAlpha = minAlpha;
    spark.maxPixelRadius = maxPixelRadius;
    spark.minPixelRadius = minPixelRadius;
    spark.maxStdDev = maxStdDev;
    spark.focalAdjustment = focalAdjustment;
    spark.falloff = falloff;
    spark.sortRadial = sortRadial;
    spark.setDirty();
    invalidate();
  }, [
    spark,
    minAlpha,
    maxPixelRadius,
    minPixelRadius,
    maxStdDev,
    focalAdjustment,
    falloff,
    sortRadial,
    invalidate,
  ]);

  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh]
  );

  useEffect(
    () => () => {
      spark.dispose();
    },
    [spark]
  );

  if (failed) return null;

  return (
    <>
      <primitive object={spark} visible={visible} />
      <primitive object={mesh} visible={visible && ready} />
    </>
  );
}
