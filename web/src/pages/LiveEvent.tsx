import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type LiveAthlete, type LiveState } from "../api";
import { formatDelta, formatMs, formatPace, GENDER_LABELS, GRADE_LABELS, raceClockMs } from "../format";

export function LiveEventPage() {
  const { eventId } = useParams();
  const [state, setState] = useState<LiveState | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(false);
  const [undo, setUndo] = useState<{ id: string; name: string; pointName: string } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const sse = useRef<{ close: () => void; open: () => void } | null>(null);

  useEffect(() => {
    if (state?.event.status === "completed") return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [state?.event.status]);

  useEffect(() => {
    if (!eventId) return;
    let source: EventSource | null = null;
    let stopped = false;

    const open = () => {
      if (stopped) return;
      source?.close();
      source = new EventSource(`/api/events/${eventId}/stream`);
      const apply = (raw: string) => {
        if (!raw) return;
        try {
          const next = JSON.parse(raw) as LiveState;
          setState(next);
          setConnected(true);
          setPointId((current) => current ?? next.timingPoints[0]?.id ?? null);
        } catch {
          // ignore comments / incomplete frames
        }
      };
      source.addEventListener("state", (event) => apply((event as MessageEvent).data));
      source.onmessage = (event) => apply(event.data);
      source.onerror = () => setConnected(false);
    };

    open();
    sse.current = {
      open,
      close: () => source?.close(),
    };
    return () => {
      stopped = true;
      source?.close();
    };
  }, [eventId]);

  const selectedPoint = state?.timingPoints.find((p) => p.id === pointId) ?? state?.timingPoints[0];

  const athletes = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    const filtered = state.athletes.filter((athlete) => {
      if (!q) return true;
      return `${athlete.firstName} ${athlete.lastName}`.toLowerCase().includes(q);
    });
    if (state.event.status === "completed") {
      return filtered.sort((a, b) => {
        if (a.summary.finished !== b.summary.finished) return a.summary.finished ? -1 : 1;
        const ae = a.summary.elapsedMs;
        const be = b.summary.elapsedMs;
        if (ae == null && be == null) {
          return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
        }
        if (ae == null) return 1;
        if (be == null) return -1;
        return ae - be;
      });
    }
    return filtered.sort((a, b) => {
      const aDone = hasSplit(a, selectedPoint?.id);
      const bDone = hasSplit(b, selectedPoint?.id);
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    });
  }, [state, query, selectedPoint?.id]);

  async function tap(athlete: LiveAthlete) {
    if (!eventId || !selectedPoint) return;
    if (state?.event.status !== "live") {
      setError("This race is not live, so splits cannot be recorded.");
      return;
    }
    const key = newClientId();
    setPending((set) => new Set(set).add(athlete.athleteId));
    setError(null);
    sse.current?.close();
    try {
      const result = await api.record(eventId, {
        athleteId: athlete.athleteId,
        timingPointId: selectedPoint.id,
        idempotencyKey: key,
        clientObservedAt: Date.now(),
      });
      const observation = (result as { observation: { id: string; role: string } }).observation;
      setUndo({
        id: observation.id,
        name: `${athlete.firstName} ${athlete.lastName}`,
        pointName: selectedPoint.name,
      });
      const snapshot = await api.state(eventId);
      setState(snapshot.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record");
    } finally {
      sse.current?.open();
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
            <Link to="/app">SplitMesh</Link>
          </p>
          <p>
            <Link to={`/meets/${state.event.meetId}`}>← {state.event.meetName}</Link>
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

      {!finished && (
        <div className="points">
          {state.timingPoints.map((point) => (
            <button
              key={point.id}
              className={point.id === selectedPoint.id ? "point active" : "point"}
              onClick={() => {
                if (point.id !== selectedPoint.id) setUndo(null);
                setPointId(point.id);
              }}
            >
              {point.name}
            </button>
          ))}
        </div>
      )}

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
          Recorded {undo.name} at {undo.pointName}.
          <button type="button" onClick={() => void undoLast()}>
            Undo
          </button>
        </div>
      )}

      <ul className="athletes">
        {athletes.map((athlete) => (
          <AthleteRow
            key={athlete.athleteId}
            athlete={athlete}
            selectedPointId={selectedPoint.id}
            pending={pending.has(athlete.athleteId)}
            live={state.event.status === "live"}
            onTap={() => void tap(athlete)}
            onNotLive={() => setError("This race is not live, so splits cannot be recorded.")}
          />
        ))}
      </ul>
    </main>
  );
}

function hasSplit(athlete: LiveAthlete, timingPointId: string | undefined): boolean {
  if (!timingPointId) return false;
  return athlete.summary.splits.some((split) => split.timingPointId === timingPointId);
}

function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function AthleteRow(props: {
  athlete: LiveAthlete;
  selectedPointId: string;
  pending: boolean;
  live: boolean;
  onTap: () => void;
  onNotLive: () => void;
}) {
  const { athlete, selectedPointId, pending, live, onTap, onNotLive } = props;
  const origin = useRef<{ x: number; y: number } | null>(null);
  const ignoreClick = useRef(false);
  const recorded = hasSplit(athlete, selectedPointId);
  const last = athlete.summary.splits.at(-1);
  const vs = last?.vsTargetMs ?? athlete.summary.vsTargetMs;
  const totalMs = athlete.summary.elapsedMs ?? last?.elapsedMs ?? null;

  function activate() {
    if (pending) return;
    if (!live) {
      onNotLive();
      return;
    }
    onTap();
  }

  const tapProps = live
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-disabled": pending,
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          origin.current = { x: event.clientX, y: event.clientY };
        },
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
          const start = origin.current;
          origin.current = null;
          if (!start) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 16) return;
          ignoreClick.current = true;
          activate();
        },
        onPointerCancel: () => {
          origin.current = null;
        },
        onClick: () => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          activate();
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        },
      }
    : {};

  return (
    <li>
      <div
        className={`athlete ${recorded ? "done" : ""} ${pending ? "pending" : ""} ${live ? "" : "result"}`}
        {...tapProps}
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
        {live ? (
          <>
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
          </>
        ) : (
          <>
            <span className="total">
              {totalMs == null ? "No time" : athlete.summary.finished ? `Total ${formatMs(totalMs)}` : `Last ${formatMs(totalMs)}`}
            </span>
            {athlete.summary.splits.length > 0 && (
              <span className="split-table">
                <span className="split-head">Split</span>
                <span className="split-head">Elapsed</span>
                <span className="split-head">Split</span>
                <span className="split-head">Pace</span>
                {athlete.summary.splits.map((split) => (
                  <span className="split-row" key={split.observationId}>
                    <span>{split.timingPointName}</span>
                    <span>{formatMs(split.elapsedMs)}</span>
                    <span>{formatMs(split.splitMs)}</span>
                    <span>{split.paceSecPerMile != null ? `${formatPace(split.paceSecPerMile)} /mi` : "—"}</span>
                  </span>
                ))}
              </span>
            )}
            <span className="records">
              {athlete.personalRecordMs != null && <span>PR {formatMs(athlete.personalRecordMs)}</span>}
              {athlete.seasonBestMs != null && <span>SB {formatMs(athlete.seasonBestMs)}</span>}
            </span>
          </>
        )}
      </div>
    </li>
  );
}
