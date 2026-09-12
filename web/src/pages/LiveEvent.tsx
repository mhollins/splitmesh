import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type LiveAthlete, type LiveState } from "../api";
import { formatDelta, formatMs, formatPace, GENDER_LABELS, GRADE_LABELS, raceClockMs } from "../format";

export function LiveEventPage() {
  const { eventId } = useParams();
  const [state, setState] = useState<LiveState | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(false);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.event.status === "completed") return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [state?.event.status]);

  useEffect(() => {
    if (!eventId) return;
    const source = new EventSource(`/api/events/${eventId}/stream`);
    source.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as LiveState;
      setState(next);
      setConnected(true);
      setPointId((current) => current ?? next.timingPoints[0]?.id ?? null);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [eventId]);

  const selectedPoint = state?.timingPoints.find((p) => p.id === pointId) ?? state?.timingPoints[0];

  const athletes = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    const filtered = state.athletes.filter((athlete) => {
      if (!q) return true;
      return `${athlete.firstName} ${athlete.lastName}`.toLowerCase().includes(q);
    });
    return filtered.sort((a, b) => {
      const aDone = hasSplit(a, selectedPoint?.id);
      const bDone = hasSplit(b, selectedPoint?.id);
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    });
  }, [state, query, selectedPoint?.id]);

  async function tap(athlete: LiveAthlete) {
    if (!eventId || !selectedPoint || state?.event.status !== "live") return;
    const key = crypto.randomUUID();
    setPending((set) => new Set(set).add(athlete.athleteId));
    setError(null);
    try {
      const result = await api.record(eventId, {
        athleteId: athlete.athleteId,
        timingPointId: selectedPoint.id,
        idempotencyKey: key,
        clientObservedAt: Date.now(),
      });
      const observation = (result as { observation: { id: string; role: string } }).observation;
      setUndo({ id: observation.id, name: `${athlete.firstName} ${athlete.lastName}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record");
    } finally {
      setPending((set) => {
        const next = new Set(set);
        next.delete(athlete.athleteId);
        return next;
      });
    }
  }

  async function undoLast() {
    if (!undo) return;
    await api.retract(undo.id);
    setUndo(null);
  }

  if (!state || !selectedPoint) return <main className="page">Connecting to live event…</main>;

  const clockMs = raceClockMs(state.event.startedAt, state.event.completedAt, now, state.event.status);
  const elapsedClock = clockMs == null ? "—" : formatMs(clockMs);
  const finished = state.event.status === "completed";

  return (
    <main className="live">
      <header className="live-header">
        <div>
          <p className="eyebrow">
            <Link to="/app">SplitMesh</Link> · {state.event.meetName}
          </p>
          <h1>{state.event.name}</h1>
        </div>
        <div className="live-meta">
          <span className={finished ? "pill" : connected ? "pill ok" : "pill warn"}>
            {finished ? "Finished" : connected ? "Live" : "Reconnecting"}
          </span>
          <span className="clock">{elapsedClock}</span>
          {state.event.status === "live" && (
            <button
              type="button"
              onClick={async () => {
                if (!eventId) return;
                setError(null);
                try {
                  await api.completeEvent(eventId);
                  const snapshot = await api.state(eventId);
                  setState(snapshot.state);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not finish race");
                }
              }}
            >
              Finish race
            </button>
          )}
        </div>
      </header>

      <div className="points">
        {state.timingPoints.map((point) => (
          <button
            key={point.id}
            className={point.id === selectedPoint.id ? "point active" : "point"}
            onClick={() => setPointId(point.id)}
          >
            {point.name}
          </button>
        ))}
      </div>

      <input
        className="search"
        placeholder="Find athlete"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="off"
      />

      {error && <p className="error">{error}</p>}
      {undo && !finished && (
        <div className="undo">
          Recorded {undo.name} at {selectedPoint.name}.
          <button type="button" onClick={() => void undoLast()}>
            Undo
          </button>
        </div>
      )}

      <ul className="athletes">
        {athletes.map((athlete) => {
          const recorded = hasSplit(athlete, selectedPoint.id);
          const last = athlete.summary.splits.at(-1);
          const vs = last?.vsTargetMs ?? athlete.summary.vsTargetMs;
          return (
            <li key={athlete.athleteId}>
              <button
                className={`athlete ${recorded ? "done" : ""}`}
                disabled={pending.has(athlete.athleteId) || state.event.status !== "live"}
                onClick={() => void tap(athlete)}
              >
                <span className="who">
                  <strong>
                    {athlete.lastName}, {athlete.firstName}
                  </strong>
                  <span className="muted">
                    {GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender} ·{" "}
                    {GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel}
                  </span>
                  {athlete.summary.conflicts.length > 0 && <span className="conflict">conflict</span>}
                  {athlete.summary.onPersonalRecordPace && <span className="badge">PR pace</span>}
                </span>
                <span className="marks">
                  <span>{last ? `${last.timingPointName} ${formatMs(last.elapsedMs)}` : "No splits"}</span>
                  {vs != null && <span className={vs < 0 ? "ahead" : vs > 0 ? "behind" : ""}>{formatDelta(vs)}</span>}
                  {last?.paceSecPerMile != null && <span>{formatPace(last.paceSecPerMile)} /mi</span>}
                </span>
                <span className="records">
                  {athlete.personalRecordMs != null && <span>PR {formatMs(athlete.personalRecordMs)}</span>}
                  {athlete.seasonBestMs != null && <span>SB {formatMs(athlete.seasonBestMs)}</span>}
                  {athlete.summary.projectedFinishMs != null && (
                    <span>proj {formatMs(athlete.summary.projectedFinishMs)}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function hasSplit(athlete: LiveAthlete, timingPointId: string | undefined): boolean {
  if (!timingPointId) return false;
  return athlete.summary.splits.some((split) => split.timingPointId === timingPointId);
}
