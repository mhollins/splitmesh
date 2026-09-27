export type EventTypeSplitInput = { name: string; distanceMeters: number };

export type EventTypeInput = {
  name: string;
  distanceMeters: number;
  discipline: string;
  splits: EventTypeSplitInput[];
};

export const DEFAULT_EVENT_TYPES: EventTypeInput[] = [
  {
    name: "800m",
    distanceMeters: 800,
    discipline: "track_running",
    splits: [
      { name: "400m", distanceMeters: 400 },
      { name: "Finish", distanceMeters: 800 },
    ],
  },
  {
    name: "1600m",
    distanceMeters: 1600,
    discipline: "track_running",
    splits: [
      { name: "400m", distanceMeters: 400 },
      { name: "800m", distanceMeters: 800 },
      { name: "1200m", distanceMeters: 1200 },
      { name: "Finish", distanceMeters: 1600 },
    ],
  },
  {
    name: "3200m",
    distanceMeters: 3200,
    discipline: "track_running",
    splits: [
      { name: "1 Mile", distanceMeters: 1609 },
      { name: "Finish", distanceMeters: 3200 },
    ],
  },
  {
    name: "5000m",
    distanceMeters: 5000,
    discipline: "cross_country",
    splits: [
      { name: "Mile 1", distanceMeters: 1609 },
      { name: "Mile 2", distanceMeters: 3218 },
      { name: "Finish", distanceMeters: 5000 },
    ],
  },
];

export function normalizeSplits(
  distanceMeters: number,
  splits: EventTypeSplitInput[],
): EventTypeSplitInput[] {
  const cleaned = splits
    .map((split) => ({
      name: split.name.trim(),
      distanceMeters: split.distanceMeters,
    }))
    .filter((split) => split.name && Number.isInteger(split.distanceMeters) && split.distanceMeters > 0)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  const withoutFinish = cleaned.filter((split) => split.distanceMeters < distanceMeters);
  return [...withoutFinish, { name: "Finish", distanceMeters }];
}
