import { describe, expect, it } from "vitest";
import { decodeSplat, encodeSplat, SPLAT_RECORD_BYTES } from "./index";

describe("splat-codec", () => {
  it("round-trips position and color exactly through encode/decode", () => {
    const positions = [1.5, -2.25, 3.75, -0.5, 0, 10.125];
    const colors = [255, 0, 128, 10, 200, 30];

    const buffer = encodeSplat({ positions, colors, scale: 0.05 });
    const decoded = decodeSplat(buffer);

    expect(decoded.count).toBe(2);
    expect(Array.from(decoded.positions)).toEqual(positions);
    expect(Array.from(decoded.colors)).toEqual([
      255, 0, 128, 255, 10, 200, 30, 255,
    ]);
  });

  it("broadcasts isotropic scale and identity rotation when no per-point overrides are given", () => {
    const buffer = encodeSplat({
      positions: [0, 0, 0],
      colors: [1, 2, 3],
      scale: 0.02,
    });
    const decoded = decodeSplat(buffer);

    const f32 = Math.fround(0.02);
    expect(Array.from(decoded.scales)).toEqual([f32, f32, f32]);
    expect(Array.from(decoded.rotations)).toEqual([128, 128, 128, 255]);
    expect(decoded.colors[3]).toBe(255);
  });

  it("honors per-point scales, rotations, and alphas when provided", () => {
    const buffer = encodeSplat({
      positions: [0, 0, 0, 1, 1, 1],
      colors: [10, 20, 30, 40, 50, 60],
      scale: 0.02,
      scales: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      rotations: [1, 2, 3, 4, 5, 6, 7, 8],
      alphas: [64, 192],
    });
    const decoded = decodeSplat(buffer);

    expect(Array.from(decoded.scales)).toEqual(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(Math.fround)
    );
    expect(Array.from(decoded.rotations)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(decoded.colors[3]).toBe(64);
    expect(decoded.colors[7]).toBe(192);
  });

  it("rejects a buffer whose length is not a multiple of the record size", () => {
    const malformed = new Uint8Array(SPLAT_RECORD_BYTES + 1);
    expect(() => decodeSplat(malformed)).toThrow();
  });

  it("accepts a Uint8Array view as well as an ArrayBuffer", () => {
    const buffer = encodeSplat({
      positions: [0, 0, 0],
      colors: [255, 255, 255],
      scale: 0.01,
    });
    const view = new Uint8Array(buffer);
    expect(decodeSplat(view).count).toBe(1);
  });
});
