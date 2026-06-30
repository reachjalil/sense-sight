import { describe, expect, it } from "vitest";
import {
  createMissionEvent,
  rankSpatialRisks,
  SENSE_SIGHT_DOMAIN,
} from "./index";

describe("SenseSight core contracts", () => {
  it("keeps the public domain explicit", () => {
    expect(SENSE_SIGHT_DOMAIN).toBe("sensesight.live");
  });

  it("creates deterministic mission event ids when one is not provided", () => {
    const event = createMissionEvent({
      missionId: "mission-001",
      occurredAt: "2026-06-30T12:00:00.000Z",
      type: "decision.approved",
      actor: { id: "operator-001", kind: "human" },
      summary: "Approved low-risk route adjustment.",
    });

    expect(event.id).toBe(
      "mission-001:decision.approved:2026-06-30T12:00:00.000Z"
    );
  });

  it("ranks risks by severity and confidence", () => {
    const ranked = rankSpatialRisks([
      {
        id: "glare",
        label: "glare",
        level: "medium",
        confidence: 0.93,
        frameId: "map",
      },
      {
        id: "blocked-corridor",
        label: "blocked corridor",
        level: "high",
        confidence: 0.72,
        frameId: "map",
      },
      {
        id: "stale-depth",
        label: "stale depth",
        level: "medium",
        confidence: 0.99,
        frameId: "map",
      },
    ]);

    expect(ranked.map((risk) => risk.id)).toEqual([
      "blocked-corridor",
      "stale-depth",
      "glare",
    ]);
  });
});
