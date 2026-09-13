import { describe, expect, it } from "vitest";
import { parseGender, parseGradeLevel, selectRosterByFilters } from "../../src/domain/athletes.ts";

describe("athlete attributes", () => {
  it("accepts Boys and Girls", () => {
    expect(parseGender("boys")).toBe("boys");
    expect(parseGender("girls")).toBe("girls");
    expect(parseGender("other")).toBeNull();
  });

  it("accepts High School, Junior High, and Elementary", () => {
    expect(parseGradeLevel("high_school")).toBe("high_school");
    expect(parseGradeLevel("junior_high")).toBe("junior_high");
    expect(parseGradeLevel("elementary")).toBe("elementary");
    expect(parseGradeLevel("college")).toBeNull();
  });

  it("selects every athlete of a gender and leaves targets in place", () => {
    const athletes = [
      { id: "a", gender: "boys", gradeLevel: "high_school" },
      { id: "b", gender: "girls", gradeLevel: "high_school" },
      { id: "c", gender: "boys", gradeLevel: "elementary" },
    ];
    const draft = {
      a: { selected: false, target: "18:00" },
      b: { selected: true, target: "19:00" },
      c: { selected: false, target: "20:00" },
    };
    const next = selectRosterByFilters(athletes, draft, ["boys"], []);
    expect(next.a).toEqual({ selected: true, target: "18:00" });
    expect(next.b).toEqual({ selected: false, target: "19:00" });
    expect(next.c).toEqual({ selected: true, target: "20:00" });
  });

  it("intersects gender and grade filters", () => {
    const athletes = [
      { id: "a", gender: "boys", gradeLevel: "high_school" },
      { id: "b", gender: "girls", gradeLevel: "high_school" },
      { id: "c", gender: "boys", gradeLevel: "elementary" },
    ];
    const next = selectRosterByFilters(athletes, {}, ["boys"], ["high_school"]);
    expect(next.a?.selected).toBe(true);
    expect(next.b?.selected).toBe(false);
    expect(next.c?.selected).toBe(false);
  });
});
