export type Role = "owner" | "admin" | "coach" | "assistant" | "viewer";

export type LiveEventState = {
  seq: number;
  event: {
    id: string;
    meetId: string;
    meetName: string;
    teamId: string;
    seasonId: string;
    name: string;
    category: string;
    discipline: string;
    distanceMeters: number | null;
    status: string;
    startedAt: number | null;
    pausedAt: number | null;
    completedAt: number | null;
  };
  timingPoints: {
    id: string;
    name: string;
    distanceMeters: number;
    sortOrder: number;
    isFinish: boolean;
  }[];
  athletes: LiveAthlete[];
};

export type LiveAthlete = {
  entryId: string;
  performanceId: string | null;
  athleteId: string;
  firstName: string;
  lastName: string;
  gender: string;
  gradeLevel: string;
  bib: string | null;
  targetTimeMs: number | null;
  personalRecordMs: number | null;
  previousPersonalRecordMs: number | null;
  prImprovementMs: number | null;
  isNewPersonalRecord: boolean;
  seasonBestMs: number | null;
  status: string;
  summary: {
    elapsedMs: number | null;
    finished: boolean;
    projectedFinishMs: number | null;
    vsTargetMs: number | null;
    onPersonalRecordPace: boolean;
    onSeasonBestPace: boolean;
    splits: {
      observationId: string;
      timingPointId: string;
      timingPointName: string;
      distanceMeters: number;
      observedAt: number;
      elapsedMs: number;
      splitMs: number;
      paceSecPerMile: number | null;
      vsTargetMs: number | null;
      role: "primary" | "conflict";
      recordedByUserId: string;
      conflictsWithId: string | null;
    }[];
    conflicts: {
      observationId: string;
      timingPointId: string;
      timingPointName: string;
      elapsedMs: number;
      recordedByUserId: string;
      conflictsWithId: string | null;
    }[];
  };
};
