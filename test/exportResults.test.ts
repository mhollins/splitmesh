import { describe, expect, it } from "vitest";
import { buildResultRows, resultsCsv, resultsFilename } from "../src/resultsExport.ts";

const state = {
  event: { name: "Varsity Boys 5K", meetName: "Early Season Invite" },
  timingPoints: [
    { id: "p1", name: "Mile 1" },
    { id: "p2", name: "Finish" },
  ],
};

const athletes = [
  {
    athleteId: "a1",
    firstName: "Maya",
    lastName: "Chen",
    gender: "girls",
    gradeLevel: "high_school",
    personalRecordMs: 1_140_000,
    previousPersonalRecordMs: 1_152_000,
    prImprovementMs: 12_000,
    isNewPersonalRecord: true,
    summary: {
      elapsedMs: 1_140_000,
      finished: true,
      splits: [
        { timingPointId: "p1", elapsedMs: 360_000 },
        { timingPointId: "p2", elapsedMs: 1_140_000 },
      ],
    },
  },
];

describe("results export", () => {
  it("builds csv with place, splits, and PR notes", () => {
    const csv = resultsCsv(state, athletes);
    expect(csv).toContain("Place,Name,Gender,Grade,Total,Mile 1,Finish,PR,PR note");
    expect(csv).toContain("1,\"Chen, Maya\",Girls,High School,19:00.0,6:00.0,19:00.0,19:00.0");
    expect(csv).toContain("PR −0:12.0 (was 19:12.0)");
  });

  it("names the file from the meet and event", () => {
    expect(resultsFilename(state, "csv")).toBe("early-season-invite-varsity-boys-5k-results.csv");
  });

  it("assigns place by finish time", () => {
    const rows = buildResultRows(state, athletes);
    expect(rows[0]?.place).toBe("1");
  });
});
