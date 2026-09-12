import { describe, expect, it } from "vitest";
import {
  defaultTimingPoints,
  elapsedMs,
  raceClockMs,
  expectedElapsedMs,
  formatMs,
  formatPace,
  projectedFinishMs,
  summarizeRunningPerformance,
  vsTargetMs,
} from "../../src/domain/timing.ts";

describe("elapsed time and splits", () => {
  it("computes elapsed time from gun to observation", () => {
    expect(elapsedMs(1_000, 1_310_000)).toBe(1_309_000);
  });

  it("does not allow negative elapsed time", () => {
    expect(elapsedMs(5_000, 4_000)).toBe(0);
  });

  it("freezes the race clock at completion instead of running on", () => {
    const gun = 1_000_000;
    const finished = 1_400_000;
    const later = 2_000_000;
    expect(raceClockMs(gun, finished, later, "completed")).toBe(400_000);
    expect(raceClockMs(gun, null, later, "live")).toBe(1_000_000);
  });
});

describe("pace and projection", () => {
  it("computes even-pace expected elapsed at a split", () => {
    // 19:00 target over 5000m, at 1609m
    const expected = expectedElapsedMs(1_140_000, 1609, 5000);
    expect(expected).toBe(Math.round(1_140_000 * (1609 / 5000)));
  });

  it("treats negative vs-target as ahead of pace", () => {
    const ahead = vsTargetMs(300_000, 1_140_000, 1609, 5000);
    expect(ahead).toBeLessThan(0);
  });

  it("projects finish from current pace", () => {
    // 6:00 through 1609m (~5k in ~18:38)
    const projected = projectedFinishMs(360_000, 1609, 5000);
    expect(projected).toBe(Math.round(360_000 * (5000 / 1609)));
  });
});

describe("formatting", () => {
  it("formats millisecond times as m:ss.t", () => {
    expect(formatMs(1_152_000)).toBe("19:12.0");
    expect(formatMs(65_400)).toBe("1:05.4");
  });

  it("formats pace as m:ss", () => {
    expect(formatPace(372)).toBe("6:12");
  });
});

describe("default timing points", () => {
  it("uses mile splits for a 5K", () => {
    const points = defaultTimingPoints(5000);
    expect(points.map((p) => p.name)).toEqual(["Mile 1", "Mile 2", "Finish"]);
    expect(points.at(-1)?.distanceMeters).toBe(5000);
  });
});

describe("running performance summary", () => {
  const gun = 1_000_000;

  it("accumulates split times and pace from primary observations", () => {
    const summary = summarizeRunningPerformance({
      startedAt: gun,
      totalDistanceMeters: 5000,
      targetTimeMs: 1_140_000,
      personalRecordMs: 1_152_000,
      seasonBestMs: 1_152_000,
      observations: [
        {
          id: "o1",
          timingPointId: "m1",
          timingPointName: "Mile 1",
          distanceMeters: 1609,
          sortOrder: 1,
          observedAt: gun + 360_000,
          recordedByUserId: "a",
          role: "primary",
          conflictsWithId: null,
        },
        {
          id: "o2",
          timingPointId: "m2",
          timingPointName: "Mile 2",
          distanceMeters: 3218,
          sortOrder: 2,
          observedAt: gun + 735_000,
          recordedByUserId: "b",
          role: "primary",
          conflictsWithId: null,
        },
      ],
    });

    expect(summary.splits).toHaveLength(2);
    expect(summary.splits[0].elapsedMs).toBe(360_000);
    expect(summary.splits[1].splitMs).toBe(375_000);
    expect(summary.projectedFinishMs).toBe(Math.round(735_000 * (5000 / 3218)));
    expect(summary.vsTargetMs).not.toBeNull();
    expect(summary.onPersonalRecordPace).toBe(true);
  });

  it("keeps conflict observations out of official splits", () => {
    const summary = summarizeRunningPerformance({
      startedAt: gun,
      totalDistanceMeters: 5000,
      targetTimeMs: null,
      personalRecordMs: null,
      seasonBestMs: null,
      observations: [
        {
          id: "primary",
          timingPointId: "m1",
          timingPointName: "Mile 1",
          distanceMeters: 1609,
          sortOrder: 1,
          observedAt: gun + 360_000,
          recordedByUserId: "a",
          role: "primary",
          conflictsWithId: null,
        },
        {
          id: "conflict",
          timingPointId: "m1",
          timingPointName: "Mile 1",
          distanceMeters: 1609,
          sortOrder: 1,
          observedAt: gun + 362_000,
          recordedByUserId: "b",
          role: "conflict",
          conflictsWithId: "primary",
        },
      ],
    });
    expect(summary.splits).toHaveLength(1);
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.splits[0].observationId).toBe("primary");
  });
});
