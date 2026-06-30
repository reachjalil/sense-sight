import { useMemo } from "react";
import * as THREE from "three";

/** A radial-gradient stop: [offset 0..1, css color]. */
export type GradientStop = readonly [offset: number, color: string];

/**
 * Default falloff: a dense, opaque core with a quick falloff so points read
 * as defined splats sitting on surfaces rather than broad bokeh halos that
 * make a sparse cloud look like diffuse fog.
 */
export const DEFAULT_SPLAT_STOPS: readonly GradientStop[] = [
  [0, "rgba(255,255,255,1)"],
  [0.32, "rgba(255,255,255,0.92)"],
  [0.6, "rgba(255,255,255,0.3)"],
  [1, "rgba(255,255,255,0)"],
];

/** Softer falloff (broader halo) for first-person / sparse previews. */
export const SOFT_SPLAT_STOPS: readonly GradientStop[] = [
  [0, "rgba(255,255,255,1)"],
  [0.45, "rgba(255,255,255,0.5)"],
  [1, "rgba(255,255,255,0)"],
];

/** Builds a soft round sprite texture so points read as fuzzy splats. */
export function createSplatSprite(
  stops: readonly GradientStop[] = DEFAULT_SPLAT_STOPS
): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Memoized splat sprite for use inside R3F components. */
export function useSplatSprite(
  stops: readonly GradientStop[] = DEFAULT_SPLAT_STOPS
): THREE.Texture {
  return useMemo(() => createSplatSprite(stops), [stops]);
}
