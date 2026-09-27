import { describe, expect, it } from "vitest";
import { schoolYearFor, schoolYearForDate } from "../../src/domain/seasons.ts";

describe("school year", () => {
  it("names the year that contains September 2026 as 26/27", () => {
    expect(schoolYearFor(Date.parse("2026-09-27T15:00:00Z"))).toEqual({
      startYear: 2026,
      name: "26/27",
      startsOn: "2026-06-01",
      endsOn: "2027-05-31",
    });
  });

  it("rolls forward on June 1 and not the day before", () => {
    expect(schoolYearFor(Date.parse("2026-05-31T23:59:59Z")).name).toBe("25/26");
    expect(schoolYearFor(Date.parse("2026-06-01T00:00:00Z")).name).toBe("26/27");
    expect(schoolYearFor(Date.parse("2027-05-31T12:00:00Z")).name).toBe("26/27");
    expect(schoolYearFor(Date.parse("2027-06-01T00:00:00Z")).name).toBe("27/28");
  });

  it("places a meet date in the school year that contains it", () => {
    expect(schoolYearForDate("2026-04-04").name).toBe("25/26");
    expect(schoolYearForDate("2026-06-01").name).toBe("26/27");
  });
});
