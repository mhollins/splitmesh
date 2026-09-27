export type SchoolYear = {
  startYear: number;
  name: string;
  startsOn: string;
  endsOn: string;
};

function yearLabel(year: number): string {
  return String(year % 100).padStart(2, "0");
}

/** School year rolls on June 1 UTC. 2026-09-27 is 26/27; 2026-05-31 is 25/26. */
export function schoolYearFor(nowMs: number): SchoolYear {
  const date = new Date(nowMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const startYear = month > 5 || (month === 5 && day >= 1) ? year : year - 1;
  return {
    startYear,
    name: `${yearLabel(startYear)}/${yearLabel(startYear + 1)}`,
    startsOn: `${startYear}-06-01`,
    endsOn: `${startYear + 1}-05-31`,
  };
}

export function schoolYearForDate(isoDate: string): SchoolYear {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid date ${isoDate}`);
  }
  return schoolYearFor(Date.parse(`${isoDate}T12:00:00Z`));
}

export function isSchoolYearName(name: string): boolean {
  return /^\d{2}\/\d{2}$/.test(name);
}
