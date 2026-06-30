/**
 * Module singleton holding the console's streamed reconstruction buffers.
 *
 * The buffer mechanics live in @sense-sight/stream-buffers; this module just
 * owns one instance of each stream (seed point cloud + trained Gaussian
 * splat) and re-exports their operations so the rest of the app imports a
 * flat, app-local API instead of threading stream instances through props.
 */

import {
  type CloudBuffers,
  createCloudStream,
  createSplatStream,
  type SplatBuffers,
} from "@sense-sight/stream-buffers";

export type { CloudBuffers, SplatBuffers };

const cloud = createCloudStream();

export const initCloud = cloud.initCloud;
export const appendPoints = cloud.appendPoints;
export const getCloudBuffers = cloud.getBuffers;
export const getRevealedPoints = cloud.getRevealed;
export const resetCloud = cloud.resetCloud;

const splat = createSplatStream();

export const initSplat = splat.initSplat;
export const appendGaussians = splat.appendGaussians;
export const getSplatBuffers = splat.getBuffers;
export const getRevealedGaussians = splat.getRevealed;
export const getSplatVersion = splat.getVersion;
export const resetSplat = splat.resetSplat;
