import { describe, expect, it } from "vitest";
import { trainedSplatFilename } from "./index";

describe("trainedSplatFilename", () => {
  it("builds a bare filename when no variant is given", () => {
    expect(trainedSplatFilename(30000)).toBe("trained-30000.splat");
  });

  it("appends the viewer variant suffix", () => {
    expect(trainedSplatFilename(30000, "viewer")).toBe(
      "trained-30000-viewer.splat"
    );
  });

  it("appends the regularized variant suffix", () => {
    expect(trainedSplatFilename(7000, "regularized")).toBe(
      "trained-7000-regularized.splat"
    );
  });

  it("supports arbitrary iteration counts", () => {
    expect(trainedSplatFilename(1)).toBe("trained-1.splat");
    expect(trainedSplatFilename(0)).toBe("trained-0.splat");
  });
});
