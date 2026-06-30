import { describe, expect, it } from "vitest";
import { resolveDatasetRoot } from "./index";

describe("resolveDatasetRoot", () => {
  it("prefers SENSESIGHT_DATA_ROOT when set", () => {
    const root = resolveDatasetRoot({
      env: { SENSESIGHT_DATA_ROOT: "/robot-data/openloris-gaussian-splat" },
      repoRoot: "/repo",
    });

    expect(root).toBe("/robot-data/openloris-gaussian-splat");
  });

  it("ignores an empty SENSESIGHT_DATA_ROOT", () => {
    const root = resolveDatasetRoot({
      env: { SENSESIGHT_DATA_ROOT: "" },
      repoRoot: "/repo",
    });

    expect(root).toBe("/repo/data/openloris-gaussian-splat");
  });

  it("falls back to data/<dataset> under the repo root", () => {
    const root = resolveDatasetRoot({ env: {}, repoRoot: "/repo" });

    expect(root).toBe("/repo/data/openloris-gaussian-splat");
  });
});
