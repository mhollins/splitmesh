import { formatMs, formatPace, raceClockMs } from "../../src/domain/timing";
import {
  GENDER_LABELS,
  GENDERS,
  GRADE_LABELS,
  GRADE_LEVELS,
  selectRosterByAttribute,
} from "../../src/domain/athletes";

export {
  formatMs,
  formatPace,
  raceClockMs,
  GENDERS,
  GENDER_LABELS,
  GRADE_LEVELS,
  GRADE_LABELS,
  selectRosterByAttribute,
};

export function formatDelta(ms: number | null): string {
  if (ms == null) return "";
  const abs = formatMs(Math.abs(ms));
  if (ms < 0) return `${abs} ahead`;
  if (ms > 0) return `${abs} behind`;
  return "on pace";
}

export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const seconds = Number(parts[0]);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return null;
}

export function formatTargetInput(ms: number | null): string {
  if (ms == null) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
