import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type LiveAthlete, type LiveState } from "../api";
import { formatMs, formatTargetInput, GENDER_LABELS, GRADE_LABELS, parseTimeInput } from "../format";

export function EditResultsPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LiveState | null>(null);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!eventId) return;
    const { state: next } = await api.state(eventId);
    setState(next);
    const nextTimes: Record<string, string> = {};
    for (const athlete of next.athletes) {
      for (const point of next.timingPoints) {
        const split = athlete.summary.splits.find((item) => item.timingPointId === point.id);
        nextTimes[key(athlete.athleteId, point.id)] = split ? formatTargetInput(split.elapsedMs) : "";
      }
    }
    setTimes(nextTimes);
  }

  useEffect(() => {
    void load().catch(() => navigate("/app"));
  }, [eventId]);

  const athletes = useMemo(() => {
    if (!state) return [];
    return [...state.athletes].sort(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    );
  }, [state]);

  async function saveOfficial(athlete: LiveAthlete, pointId: string) {
    if (!eventId || !state) return;
    const elapsedMs = parseTimeInput(times[key(athlete.athleteId, pointId)] ?? "");
    if (elapsedMs == null) {
      setError("Enter a time like 6:12.4");
      return;
    }
    const split = athlete.summary.splits.find((item) => item.timingPointId === pointId);
    setBusy(key(athlete.athleteId, pointId));
    setError(null);
    try {
      if (split) await api.correctObservation(split.observationId, elapsedMs);
      else {
        await api.record(eventId, {
          athleteId: athlete.athleteId,
          timingPointId: pointId,
          idempotencyKey: crypto.randomUUID(),
          elapsedMs,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save time");
    } finally {
      setBusy(null);
    }
  }

  async function useConflict(observationId: string) {
    setError(null);
    try {
      await api.promoteObservation(observationId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that mark");
    }
  }

  async function discard(observationId: string) {
    setError(null);
    try {
      await api.retract(observationId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard mark");
    }
  }

  if (!state) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <p>
        <Link to={`/events/${state.event.id}/live`}>← {state.event.name} results</Link>
      </p>
      <h1>Edit results</h1>
      <p className="muted">{state.event.meetName}</p>
      {error && <p className="error">{error}</p>}

      {athletes.map((athlete) => (
        <section key={athlete.athleteId} className="card">
          <h2>
            {athlete.lastName}, {athlete.firstName}{" "}
            <span className="muted">
              {GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender} ·{" "}
              {GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel}
            </span>
          </h2>
          {state.timingPoints.map((point) => {
            const official = athlete.summary.splits.find((item) => item.timingPointId === point.id);
            const conflicts = athlete.summary.conflicts.filter((item) => item.timingPointId === point.id);
            const field = key(athlete.athleteId, point.id);
            return (
              <div key={point.id} className="result-edit-point">
                <strong>{point.name}</strong>
                <form
                  className="row"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void saveOfficial(athlete, point.id);
                  }}
                >
                  <input
                    className="target"
                    placeholder="6:12.4"
                    value={times[field] ?? ""}
                    onChange={(e) => setTimes((current) => ({ ...current, [field]: e.target.value }))}
                  />
                  <button className="primary" disabled={busy === field}>
                    {official ? "Save time" : "Add time"}
                  </button>
                  {official && (
                    <button type="button" className="danger" onClick={() => void discard(official.observationId)}>
                      Clear
                    </button>
                  )}
                </form>
                {official && <p className="muted">Official {formatMs(official.elapsedMs)}</p>}
                {conflicts.length > 0 && (
                  <ul className="plain">
                    {conflicts.map((item) => (
                      <li key={item.observationId} className="manage-row">
                        <span>
                          Conflict {formatMs(item.elapsedMs)} <span className="conflict">conflict</span>
                        </span>
                        <span className="row">
                          <button type="button" onClick={() => void useConflict(item.observationId)}>
                            Use as official
                          </button>
                          <button type="button" className="danger" onClick={() => void discard(item.observationId)}>
                            Discard
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </main>
  );
}

function key(athleteId: string, pointId: string): string {
  return `${athleteId}:${pointId}`;
}
