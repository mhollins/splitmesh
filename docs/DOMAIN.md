# SplitMesh domain model

The domain is **not** `Athlete → Race → Split`. It is:

`User / Team → Athlete → Season → Meet → Event → EventEntry → Performance`

with event-specific result data hanging off `Performance`.

A cross country 5K and a future long jump live in the same meet. Only the performance payload differs.

## Entities (MVP)

| Entity | Role |
| --- | --- |
| **User** | Authenticated person (coach, assistant, later athlete/viewer). |
| **Team** | The authorization and roster boundary. Has an invite code. |
| **TeamMembership** | User ↔ team with role `owner`, `admin`, `coach`, `assistant`, `viewer`. |
| **Athlete** | Roster person. Not necessarily a user. |
| **Season** | Container for meets and season-best records. Creating a team creates a current season. |
| **Meet** | A date/place gathering that contains many events. |
| **Event** | One contest inside a meet (`category` = `running` \| `field` \| `relay`, plus a `discipline`). |
| **TimingPoint** | Named distance on a running event (e.g. Mile 1, Finish). |
| **EventEntry** | Athlete entered in an event, optional bib and target finish time. |
| **Performance** | That entry's result record. Created when the event starts (or when the athlete is entered into an already-live event). |
| **TimingObservation** | Immutable "this athlete passed this point" record. |
| **EventLog** | Monotonic, durable stream of state changes for an event. |
| **PersonalRecord** | Best mark by athlete + discipline + distance + mark type. |
| **SeasonBest** | Same, scoped to a season. |

### Running performance (MVP)

- `started_at` — usually the event gun time
- `finished_at` / `elapsed_ms` — set when a primary finish observation exists
- split observations (see below)
- derived pace, projected finish, vs-target delta

### Field performance (not implemented in UI)

Reserved for later: attempts, marks, fouls, heights/distances, best attempt. `events.category = 'field'` is already a legal value so this does not require a rewrite.

## Timing observations are immutable

A tap never updates a previous row in place.

Each observation stores:

- event, performance, athlete, timing point
- `observed_at` — server clock at accept time (authoritative for elapsed time)
- `client_observed_at` — device clock, audit only
- `recorded_at` — server receive time
- `recorded_by_user_id`
- `idempotency_key` (unique per event)
- `role`: `primary` | `conflict` | `retracted`

### Idempotency

The client sends an `idempotencyKey` with every tap. A retry with the same key returns the original observation. Duplicate submissions do not create a second row.

### Conflicts

Two different keys for the same athlete + timing point (typically two coaches tapping the same runner):

1. Both rows are stored. Nothing is silently discarded.
2. The first committed row (serialized by `BEGIN IMMEDIATE`) is `primary`.
3. The other is `role = conflict` and `conflicts_with_id` points at the primary.
4. Live state shows a conflict marker. Splits and pace use **primary** observations only.
5. A coach may retract an observation. If the primary is retracted, the earliest remaining non-retracted conflict is promoted to primary.

Retraction is a status change plus audit fields (`retracted_at`, `retracted_by_user_id`). The row remains.

## Derived timing math

All times are integer milliseconds. Distances are meters.

Let `gun = event.started_at`.

- `elapsed = observed_at - gun`
- `split = elapsed - previous_primary_elapsed` (or `elapsed` at the first point)
- `pace (sec/km) = (split_ms / 1000) / (split_distance_m / 1000)`
- `expected_elapsed = target_finish_ms * (distance_covered / event_distance)` (even-pace target)
- `vs_target = elapsed - expected_elapsed` — negative is ahead
- `projected_finish = elapsed * (event_distance / distance_covered)`

The UI displays minutes/mile because that is the US XC convention. Storage stays SI.

## Personal records and season bests

When a running performance reaches a primary finish:

- Compare `elapsed_ms` to the athlete's PR and current-season SB for that `discipline` + `distance_meters` + `mark_type = time_ms`.
- Lower is better. Upsert if improved or missing.

If a finish observation is later retracted, PR/SB for that athlete/discipline/distance are recomputed from remaining finished performances. Live state includes the current PR and SB so coaches can see them during the race.

## Event lifecycle

`upcoming → live → completed`

- **Start** sets `started_at` (gun) and moves entries onto in-progress performances.
- Observations are rejected until the event is live.
- **Complete** freezes new observations. Existing performances remain; they are historical records, not a live session.

## First vertical slice

In:

1. Register / log in
2. Create a team (caller is owner) or join via invite code
3. Add athletes
4. Create a meet and a running event with timing points
5. Enter athletes, optional target finish
6. Start the event
7. Multiple members record passes
8. All connected clients receive updated state
9. Splits, pace, projection, vs-target
10. PR / season-best on the live view
11. Retract an accidental tap
12. Complete the event; results remain

Out: field-event workflows, athlete user accounts, offline queue, heats, public results.
