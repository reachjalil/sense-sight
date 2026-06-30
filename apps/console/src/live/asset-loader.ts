/**
 * Fetches one preset's world-generation assets from this app's own
 * public/presets/{name}/ directory. Filenames follow
 * @sense-sight/render-contracts' ASSET_FILENAMES contract so a future
 * publishing pipeline can drop assets in without coordinating with this app.
 */

import { ASSET_FILENAMES } from "@sense-sight/render-contracts";
import type { Bounds } from "@sense-sight/world-schema";

export interface WorldDoc {
  readonly sceneName: string;
  readonly bounds: Bounds;
  readonly primitiveCount?: number;
}

export interface PresetAssets {
  world: WorldDoc;
  positions: Float32Array;
  colors: Uint8Array;
  trainedSplat: ArrayBuffer | null;
  trainingDiagnostics: Record<string, unknown> | null;
}

const DEFAULT_BASE_PATH = "/presets";

function presetBase(
  name: string,
  basePath: string = DEFAULT_BASE_PATH
): string {
  return `${basePath}/${name}`;
}

async function fetchOptionalJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T | null> {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return res.json() as Promise<T>;
}

async function fetchOptionalArrayBuffer(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer | null> {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return res.arrayBuffer();
}

/** Fetch a preset's world.json (required for bounds/layout metadata). */
export async function fetchWorldDoc(
  presetName: string,
  signal?: AbortSignal,
  basePath?: string
): Promise<WorldDoc> {
  const base = presetBase(presetName, basePath);
  const res = await fetch(`${base}/${ASSET_FILENAMES.world}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return res.json() as Promise<WorldDoc>;
}

/** Fetch a preset's points_xyz.f32 seed-cloud positions. */
export async function fetchPointsXyz(
  presetName: string,
  signal?: AbortSignal,
  basePath?: string
): Promise<Float32Array> {
  const base = presetBase(presetName, basePath);
  const res = await fetch(`${base}/${ASSET_FILENAMES.pointsXyz}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return new Float32Array(await res.arrayBuffer());
}

/** Fetch a preset's points_rgb.u8 seed-cloud colors. */
export async function fetchPointsRgb(
  presetName: string,
  signal?: AbortSignal,
  basePath?: string
): Promise<Uint8Array> {
  const base = presetBase(presetName, basePath);
  const res = await fetch(`${base}/${ASSET_FILENAMES.pointsRgb}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch a preset's trained-*.splat asset, if published. Returns null on 404. */
export async function fetchTrainedSplat(
  presetName: string,
  splatFilename: string,
  signal?: AbortSignal,
  basePath?: string
): Promise<ArrayBuffer | null> {
  const base = presetBase(presetName, basePath);
  return fetchOptionalArrayBuffer(`${base}/${splatFilename}`, signal);
}

/** Fetch a preset's training_diagnostics.json, if published. Returns null on 404. */
export async function fetchTrainingDiagnostics(
  presetName: string,
  signal?: AbortSignal,
  basePath?: string
): Promise<Record<string, unknown> | null> {
  const base = presetBase(presetName, basePath);
  return fetchOptionalJson<Record<string, unknown>>(
    `${base}/${ASSET_FILENAMES.trainingDiagnostics}`,
    signal
  );
}

/**
 * Fetch everything the console needs for one preset: world doc, seed-cloud
 * buffers, an optional trained `.splat` (by filename), and optional
 * diagnostics.
 */
export async function fetchPresetAssets(
  presetName: string,
  trainedSplatFilename: string | null,
  signal?: AbortSignal,
  basePath?: string
): Promise<PresetAssets> {
  const [world, positions, colors, trainedSplat, trainingDiagnostics] =
    await Promise.all([
      fetchWorldDoc(presetName, signal, basePath),
      fetchPointsXyz(presetName, signal, basePath),
      fetchPointsRgb(presetName, signal, basePath),
      trainedSplatFilename
        ? fetchTrainedSplat(presetName, trainedSplatFilename, signal, basePath)
        : Promise.resolve(null),
      fetchTrainingDiagnostics(presetName, signal, basePath),
    ]);
  return { world, positions, colors, trainedSplat, trainingDiagnostics };
}
