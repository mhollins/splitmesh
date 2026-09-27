import { GENDER_LABELS, GRADE_LABELS } from "./domain/athletes.ts";
import { formatMs, formatPrGain } from "./domain/timing.ts";

export type ExportAthlete = {
  athleteId: string;
  firstName: string;
  lastName: string;
  gender: string;
  gradeLevel: string;
  personalRecordMs: number | null;
  previousPersonalRecordMs: number | null;
  prImprovementMs: number | null;
  isNewPersonalRecord: boolean;
  summary: {
    elapsedMs: number | null;
    finished: boolean;
    splits: { timingPointId: string; elapsedMs: number }[];
  };
};

export type ExportEvent = {
  event: { name: string; meetName: string };
  timingPoints: { id: string; name: string }[];
};

export type ResultRow = {
  place: string;
  name: string;
  gender: string;
  grade: string;
  total: string;
  splits: string[];
  pr: string;
  prNote: string;
};

export function buildResultRows(state: ExportEvent, athletes: ExportAthlete[]): ResultRow[] {
  const finished = athletes
    .filter((athlete) => athlete.summary.finished && athlete.summary.elapsedMs != null)
    .sort((a, b) => (a.summary.elapsedMs ?? 0) - (b.summary.elapsedMs ?? 0));
  const placeById = new Map(finished.map((athlete, index) => [athlete.athleteId, String(index + 1)]));

  return athletes.map((athlete) => {
    const splits = state.timingPoints.map((point) => {
      const split = athlete.summary.splits.find((item) => item.timingPointId === point.id);
      return split ? formatMs(split.elapsedMs) : "";
    });
    const prNote = athlete.isNewPersonalRecord
      ? formatPrGain(athlete.prImprovementMs, true) +
        (athlete.previousPersonalRecordMs != null ? ` (was ${formatMs(athlete.previousPersonalRecordMs)})` : "")
      : "";
    return {
      place: placeById.get(athlete.athleteId) ?? "",
      name: `${athlete.lastName}, ${athlete.firstName}`,
      gender: GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender,
      grade: GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel,
      total: athlete.summary.elapsedMs == null ? "" : formatMs(athlete.summary.elapsedMs),
      splits,
      pr: athlete.personalRecordMs != null ? formatMs(athlete.personalRecordMs) : "",
      prNote,
    };
  });
}

export function resultsCsv(state: ExportEvent, athletes: ExportAthlete[]): string {
  const rows = buildResultRows(state, athletes);
  const headers = [
    "Place",
    "Name",
    "Gender",
    "Grade",
    "Total",
    ...state.timingPoints.map((point) => point.name),
    "PR",
    "PR note",
  ];
  const lines = [
    csvLine(headers),
    ...rows.map((row) => csvLine([row.place, row.name, row.gender, row.grade, row.total, ...row.splits, row.pr, row.prNote])),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

export function resultsFilename(state: ExportEvent, extension: string): string {
  const base = `${state.event.meetName}-${state.event.name}-results`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "splitmesh-results"}.${extension}`;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
