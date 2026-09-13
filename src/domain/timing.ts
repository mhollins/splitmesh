export const METERS_PER_MILE = 1609.344;

export type SplitObservation = {
  id: string;
  timingPointId: string;
  timingPointName: string;
  distanceMeters: number;
  sortOrder: number;
  isFinish?: boolean;
  observedAt: number;
  recordedByUserId: string;
  role: "primary" | "conflict" | "retracted";
  conflictsWithId: string | null;
};

export type ComputedSplit = {
  observationId: string;
  timingPointId: string;
  timingPointName: string;
  distanceMeters: number;
  observedAt: number;
  elapsedMs: number;
  splitMs: number;
  splitDistanceMeters: number;
  paceSecPerKm: number | null;
  paceSecPerMile: number | null;
  vsTargetMs: number | null;
  role: "primary" | "conflict";
  recordedByUserId: string;
  conflictsWithId: string | null;
};

export type RunningSummary = {
  elapsedMs: number | null;
  finished: boolean;
  splits: ComputedSplit[];
  conflicts: ComputedSplit[];
  projectedFinishMs: number | null;
  vsTargetMs: number | null;
  onPersonalRecordPace: boolean;
  onSeasonBestPace: boolean;
};

export function elapsedMs(startedAt: number, observedAt: number): number {
  return Math.max(0, observedAt - startedAt);
}

export function raceClockMs(
  startedAt: number | null,
  completedAt: number | null,
  now: number,
  status: string,
  pausedAt: number | null = null,
): number | null {
  if (startedAt == null) return null;
  const end =
    status === "completed" && completedAt != null
      ? completedAt
      : status === "paused" && pausedAt != null
        ? pausedAt
        : now;
  return Math.max(0, end - startedAt);
}

export function paceSecPerKm(timeMs: number, distanceMeters: number): number | null {
  if (timeMs < 0 || distanceMeters <= 0) return null;
  return timeMs / 1000 / (distanceMeters / 1000);
}

export function paceSecPerMile(timeMs: number, distanceMeters: number): number | null {
  const perKm = paceSecPerKm(timeMs, distanceMeters);
  if (perKm == null) return null;
  return perKm * (METERS_PER_MILE / 1000);
}

export function expectedElapsedMs(
  targetFinishMs: number,
  distanceMeters: number,
  totalDistanceMeters: number,
): number | null {
  if (totalDistanceMeters <= 0 || distanceMeters < 0) return null;
  return Math.round(targetFinishMs * (distanceMeters / totalDistanceMeters));
}

export function vsTargetMs(
  currentElapsedMs: number,
  targetFinishMs: number | null,
  distanceMeters: number,
  totalDistanceMeters: number,
): number | null {
  if (targetFinishMs == null) return null;
  const expected = expectedElapsedMs(targetFinishMs, distanceMeters, totalDistanceMeters);
  if (expected == null) return null;
  return currentElapsedMs - expected;
}

export function projectedFinishMs(
  currentElapsedMs: number,
  distanceCoveredMeters: number,
  totalDistanceMeters: number,
): number | null {
  if (distanceCoveredMeters <= 0 || totalDistanceMeters <= 0) return null;
  return Math.round(currentElapsedMs * (totalDistanceMeters / distanceCoveredMeters));
}

export function formatMs(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const tenths = Math.floor((safe % 1000) / 100);
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function formatPace(secPerUnit: number): string {
  if (!Number.isFinite(secPerUnit) || secPerUnit < 0) return "—";
  const minutes = Math.floor(secPerUnit / 60);
  const seconds = Math.round(secPerUnit % 60);
  if (seconds === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function defaultTimingPoints(
  distanceMeters: number,
): { name: string; distanceMeters: number }[] {
  if (distanceMeters >= 5000) {
    const points = [
      { name: "Mile 1", distanceMeters: 1609 },
      { name: "Mile 2", distanceMeters: 3218 },
    ];
    if (distanceMeters >= 8000) {
      points.push({ name: "Mile 3", distanceMeters: 4828 });
    }
    points.push({ name: "Finish", distanceMeters });
    return points;
  }
  if (distanceMeters >= 3000) {
    return [
      { name: "1000m", distanceMeters: 1000 },
      { name: "2000m", distanceMeters: 2000 },
      { name: "Finish", distanceMeters },
    ];
  }
  if (distanceMeters >= 1500) {
    return [
      { name: "400m", distanceMeters: 400 },
      { name: "800m", distanceMeters: 800 },
      { name: "1200m", distanceMeters: 1200 },
      { name: "Finish", distanceMeters },
    ];
  }
  if (distanceMeters >= 800) {
    return [
      { name: "400m", distanceMeters: 400 },
      { name: "Finish", distanceMeters },
    ];
  }
  return [{ name: "Finish", distanceMeters }];
}

export function summarizeRunningPerformance(args: {
  startedAt: number | null;
  totalDistanceMeters: number;
  targetTimeMs: number | null;
  personalRecordMs: number | null;
  seasonBestMs: number | null;
  observations: SplitObservation[];
}): RunningSummary {
  const { startedAt, totalDistanceMeters, targetTimeMs, personalRecordMs, seasonBestMs } = args;
  const active = args.observations.filter((o) => o.role !== "retracted");
  const primaries = active
    .filter((o) => o.role === "primary")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.distanceMeters - b.distanceMeters);
  const conflicts = active.filter((o) => o.role === "conflict");

  if (startedAt == null) {
    return {
      elapsedMs: null,
      finished: false,
      splits: [],
      conflicts: [],
      projectedFinishMs: null,
      vsTargetMs: null,
      onPersonalRecordPace: false,
      onSeasonBestPace: false,
    };
  }

  const toComputed = (obs: SplitObservation, previousElapsed: number, previousDistance: number): ComputedSplit => {
    const elapsed = elapsedMs(startedAt, obs.observedAt);
    const splitDistance = obs.distanceMeters - previousDistance;
    const split = elapsed - previousElapsed;
    return {
      observationId: obs.id,
      timingPointId: obs.timingPointId,
      timingPointName: obs.timingPointName,
      distanceMeters: obs.distanceMeters,
      observedAt: obs.observedAt,
      elapsedMs: elapsed,
      splitMs: split,
      splitDistanceMeters: splitDistance,
      paceSecPerKm: paceSecPerKm(split, splitDistance),
      paceSecPerMile: paceSecPerMile(split, splitDistance),
      vsTargetMs: vsTargetMs(elapsed, targetTimeMs, obs.distanceMeters, totalDistanceMeters),
      role: obs.role === "conflict" ? "conflict" : "primary",
      recordedByUserId: obs.recordedByUserId,
      conflictsWithId: obs.conflictsWithId,
    };
  };

  const splits: ComputedSplit[] = [];
  let prevElapsed = 0;
  let prevDistance = 0;
  for (const obs of primaries) {
    splits.push(toComputed(obs, prevElapsed, prevDistance));
    prevElapsed = elapsedMs(startedAt, obs.observedAt);
    prevDistance = obs.distanceMeters;
  }

  const conflictSplits = conflicts.map((obs) => {
    const previous = primaries
      .filter((p) => p.sortOrder < obs.sortOrder)
      .at(-1);
    const previousElapsed = previous ? elapsedMs(startedAt, previous.observedAt) : 0;
    const previousDistance = previous ? previous.distanceMeters : 0;
    return toComputed(obs, previousElapsed, previousDistance);
  });

  const last = splits.at(-1) ?? null;
  const projection = last
    ? projectedFinishMs(last.elapsedMs, last.distanceMeters, totalDistanceMeters)
    : null;
  const vsTarget = last
    ? vsTargetMs(last.elapsedMs, targetTimeMs, last.distanceMeters, totalDistanceMeters)
    : null;
  const finished = primaries.some((p) => p.isFinish) || (last != null && last.distanceMeters === totalDistanceMeters);

  return {
    elapsedMs: last?.elapsedMs ?? null,
    finished,
    splits,
    conflicts: conflictSplits,
    projectedFinishMs: finished ? last?.elapsedMs ?? null : projection,
    vsTargetMs: vsTarget,
    onPersonalRecordPace:
      projection != null && personalRecordMs != null && projection < personalRecordMs,
    onSeasonBestPace: projection != null && seasonBestMs != null && projection < seasonBestMs,
  };
}
