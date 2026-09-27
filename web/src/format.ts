import { formatMs, formatPace, formatPrGain, parseTimeInput, raceClockMs } from "../../src/domain/timing";
import {
  GENDER_LABELS,
  GENDERS,
  GRADE_LABELS,
  GRADE_LEVELS,
  selectRosterByFilters,
} from "../../src/domain/athletes";

export {
  formatMs,
  formatPace,
  formatPrGain,
  parseTimeInput,
  raceClockMs,
  GENDERS,
  GENDER_LABELS,
  GRADE_LEVELS,
  GRADE_LABELS,
  selectRosterByFilters,
};

export function formatDelta(ms: number | null): string {
  if (ms == null) return "";
  const abs = formatMs(Math.abs(ms));
  if (ms < 0) return `${abs} ahead`;
  if (ms > 0) return `${abs} behind`;
  return "on pace";
}

export function formatDistanceLabel(meters: number | null): string {
  if (meters == null) return "";
  if (meters % 1000 === 0) return `${meters / 1000}K`;
  return `${meters}m`;
}

export function formatTargetInput(ms: number | null): string {
  if (ms == null) return "";
  return formatMs(ms);
}
