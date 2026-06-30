import { describe, expect, it } from "vitest";
import { createCloudStream, createSplatStream } from "./index";

describe("createCloudStream", () => {
  it("accumulates points across multiple appendPoints calls", () => {
    const stream = createCloudStream();
    stream.initCloud(4);

    const firstRevealed = stream.appendPoints(
      [0, 0, 0, 1, 1, 1],
      [255, 0, 0, 0, 255, 0]
    );
    expect(firstRevealed).toBe(2);

    const secondRevealed = stream.appendPoints([2, 2, 2], [0, 0, 255]);
    expect(secondRevealed).toBe(3);

    const buffers = stream.getBuffers();
    expect(buffers).not.toBeNull();
    expect(Array.from(buffers!.positions)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0, 0,
    ]);
    expect(Array.from(buffers!.colors)).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ]);
    expect(stream.getRevealed()).toBe(3);
  });

  it("silently drops points beyond capacity instead of throwing", () => {
    const stream = createCloudStream();
    stream.initCloud(2);

    expect(() =>
      stream.appendPoints(
        [0, 0, 0, 1, 1, 1, 2, 2, 2],
        [10, 10, 10, 20, 20, 20, 30, 30, 30]
      )
    ).not.toThrow();

    expect(stream.getRevealed()).toBe(2);
    const buffers = stream.getBuffers();
    expect(buffers!.positions.length).toBe(6);
    expect(Array.from(buffers!.positions)).toEqual([0, 0, 0, 1, 1, 1]);

    const furtherRevealed = stream.appendPoints([9, 9, 9], [9, 9, 9]);
    expect(furtherRevealed).toBe(2);
  });

  it("resets buffers and revealed count", () => {
    const stream = createCloudStream();
    stream.initCloud(4);
    stream.appendPoints([1, 1, 1], [1, 1, 1]);

    stream.resetCloud();

    expect(stream.getBuffers()).toBeNull();
    expect(stream.getRevealed()).toBe(0);
  });
});

describe("createSplatStream", () => {
  function gaussian(seed: number) {
    return {
      position: [seed, seed, seed],
      scale: [1, 1, 1],
      rotation: [0, 0, 0, 1],
      colorRGBA: [seed, seed, seed, 255],
      opacity: [0.5],
    };
  }

  it("accumulates gaussians across multiple appendGaussians calls", () => {
    const stream = createSplatStream();
    stream.initSplat(3);

    const a = gaussian(10);
    const b = gaussian(20);
    const firstRevealed = stream.appendGaussians(
      a.position,
      a.scale,
      a.rotation,
      a.colorRGBA,
      a.opacity
    );
    expect(firstRevealed).toBe(1);

    const secondRevealed = stream.appendGaussians(
      b.position,
      b.scale,
      b.rotation,
      b.colorRGBA,
      b.opacity
    );
    expect(secondRevealed).toBe(2);

    const buffers = stream.getBuffers();
    expect(buffers).not.toBeNull();
    expect(Array.from(buffers!.positions)).toEqual([
      10, 10, 10, 20, 20, 20, 0, 0, 0,
    ]);
    expect(Array.from(buffers!.colors)).toEqual([
      10, 10, 10, 255, 20, 20, 20, 255, 0, 0, 0, 0,
    ]);
    expect(Array.from(buffers!.opacities)).toEqual([0.5, 0.5, 0]);
    expect(stream.getRevealed()).toBe(2);
  });

  it("silently drops gaussians beyond capacity instead of throwing", () => {
    const stream = createSplatStream();
    stream.initSplat(1);

    const positions = [0, 0, 0, 1, 1, 1];
    const scales = [1, 1, 1, 1, 1, 1];
    const rotations = [0, 0, 0, 1, 0, 0, 0, 1];
    const colorsRGBA = [255, 0, 0, 255, 0, 255, 0, 255];
    const opacities = [0.5, 0.5];

    expect(() =>
      stream.appendGaussians(
        positions,
        scales,
        rotations,
        colorsRGBA,
        opacities
      )
    ).not.toThrow();

    expect(stream.getRevealed()).toBe(1);
    const buffers = stream.getBuffers();
    expect(buffers!.positions.length).toBe(3);
    expect(Array.from(buffers!.positions)).toEqual([0, 0, 0]);
  });

  it("increments version only on appendGaussians, not on init or no-ops", () => {
    const stream = createSplatStream();
    expect(stream.getVersion()).toBe(0);

    stream.initSplat(5);
    expect(stream.getVersion()).toBe(0);

    const g = gaussian(1);
    stream.appendGaussians(
      g.position,
      g.scale,
      g.rotation,
      g.colorRGBA,
      g.opacity
    );
    expect(stream.getVersion()).toBe(1);

    stream.appendGaussians(
      g.position,
      g.scale,
      g.rotation,
      g.colorRGBA,
      g.opacity
    );
    expect(stream.getVersion()).toBe(2);

    stream.appendGaussians(
      g.position,
      g.scale,
      g.rotation,
      g.colorRGBA,
      g.opacity
    );
    expect(stream.getVersion()).toBe(3);
  });

  it("resets buffers, revealed count, and version", () => {
    const stream = createSplatStream();
    stream.initSplat(2);
    const g = gaussian(1);
    stream.appendGaussians(
      g.position,
      g.scale,
      g.rotation,
      g.colorRGBA,
      g.opacity
    );

    stream.resetSplat();

    expect(stream.getBuffers()).toBeNull();
    expect(stream.getRevealed()).toBe(0);
    expect(stream.getVersion()).toBe(0);
  });
});
