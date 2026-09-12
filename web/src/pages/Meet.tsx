import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Athlete, type EventDetail, type MeetDetail } from "../api";
import {
  GENDER_LABELS,
  GENDERS,
  GRADE_LABELS,
  GRADE_LEVELS,
  formatTargetInput,
  parseTimeInput,
  selectRosterByAttribute,
} from "../format";

type RosterDraft = Record<string, { selected: boolean; target: string }>;

export function MeetPage() {
  const { meetId } = useParams();
  const navigate = useNavigate();
  const [meet, setMeet] = useState<MeetDetail | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [eventName, setEventName] = useState("Varsity 5K");
  const [distance, setDistance] = useState("5000");
  const [meetName, setMeetName] = useState("");
  const [meetDate, setMeetDate] = useState("");
  const [meetLocation, setMeetLocation] = useState("");
  const [rosterEvent, setRosterEvent] = useState<EventDetail | null>(null);
  const [rosterDraft, setRosterDraft] = useState<RosterDraft>({});
  const [rosterBusy, setRosterBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!meetId) return;
    const { meet: detail } = await api.meet(meetId);
    setMeet(detail);
    setMeetName(detail.name);
    setMeetDate(detail.startsOn);
    setMeetLocation(detail.location ?? "");
    const roster = await api.athletes(detail.teamId);
    setAthletes(roster.athletes);
  }

  useEffect(() => {
    void load().catch(() => navigate("/app"));
  }, [meetId]);

  async function onCreateEvent(event: FormEvent) {
    event.preventDefault();
    if (!meet) return;
    setError(null);
    try {
      const created = await api.createEvent(meet.id, {
        name: eventName,
        distanceMeters: Number(distance),
      });
      const ids = athletes.map((a) => a.id);
      if (ids.length) {
        await api.addEntries(created.event.id, ids);
      }
      await load();
      await openRoster(created.event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    }
  }

  function selectGroup(match: { gender?: string; gradeLevel?: string }) {
    setRosterDraft((current) => selectRosterByAttribute(athletes, current, match));
  }

  function draftFrom(event: EventDetail, teamAthletes: Athlete[]): RosterDraft {
    const entered = new Map(event.entries.map((entry) => [entry.athleteId, entry]));
    const draft: RosterDraft = {};
    for (const athlete of teamAthletes) {
      const entry = entered.get(athlete.id);
      draft[athlete.id] = {
        selected: Boolean(entry),
        target: entry ? formatTargetInput(entry.targetTimeMs) : prTarget(athlete, event),
      };
    }
    return draft;
  }

  function prTarget(athlete: Athlete, event: EventDetail): string {
    const records = athlete.records ?? [];
    const match =
      records.find(
        (record) => record.distanceMeters === event.distanceMeters && record.discipline === event.discipline,
      ) ?? records.find((record) => record.distanceMeters === event.distanceMeters);
    return match ? formatTargetInput(match.markValueMs) : "";
  }

  async function openRoster(eventId: string) {
    setError(null);
    try {
      const { event } = await api.event(eventId);
      setRosterEvent(event);
      setRosterDraft(draftFrom(event, athletes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load roster");
    }
  }

  async function saveRoster(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!rosterEvent) return;
    setRosterBusy(true);
    setError(null);
    try {
      const current = new Set(rosterEvent.entries.map((entry) => entry.athleteId));
      const selectedIds = Object.entries(rosterDraft)
        .filter(([, row]) => row.selected)
        .map(([id]) => id);

      if (rosterEvent.status === "upcoming") {
        for (const athleteId of current) {
          if (!selectedIds.includes(athleteId)) {
            await api.removeEntry(rosterEvent.id, athleteId);
          }
        }
      }
      for (const athleteId of selectedIds) {
        if (!current.has(athleteId)) {
          await api.addEntries(rosterEvent.id, [athleteId], parseTimeInput(rosterDraft[athleteId]?.target ?? ""));
        } else {
          await api.setEntryTarget(rosterEvent.id, athleteId, parseTimeInput(rosterDraft[athleteId]?.target ?? ""));
        }
      }

      const { event } = await api.event(rosterEvent.id);
      setRosterEvent(event);
      setRosterDraft(draftFrom(event, athletes));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save roster");
    } finally {
      setRosterBusy(false);
    }
  }

  async function onDeleteEvent(eventId: string, name: string) {
    if (!confirm(`Delete ${name} from this meet?`)) return;
    setError(null);
    try {
      await api.deleteEvent(eventId);
      if (rosterEvent?.id === eventId) setRosterEvent(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event");
    }
  }

  async function onSaveMeet(event: FormEvent) {
    event.preventDefault();
    if (!meet) return;
    setError(null);
    try {
      const updated = await api.updateMeet(meet.id, {
        name: meetName,
        startsOn: meetDate,
        location: meetLocation,
      });
      setMeet(updated.meet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update meet");
    }
  }

  async function onDeleteMeet() {
    if (!meet) return;
    if (!confirm(`Delete ${meet.name} and its events?`)) return;
    setError(null);
    try {
      await api.deleteMeet(meet.id);
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete meet");
    }
  }

  if (!meet) return <main className="page">Loading…</main>;

  const rosterLocked = rosterEvent?.status === "completed";
  const canRemoveFromRoster = rosterEvent?.status === "upcoming";

  return (
    <main className="page">
      <p>
        <Link to="/app">← {meet.name}</Link>
      </p>
      <h1>{meet.name}</h1>
      <p className="muted">
        {meet.startsOn}
        {meet.location ? ` · ${meet.location}` : ""}
      </p>
      {error && <p className="error">{error}</p>}

      <form className="card" onSubmit={onSaveMeet}>
        <h2>Meet details</h2>
        <label>
          Name
          <input value={meetName} onChange={(e) => setMeetName(e.target.value)} required />
        </label>
        <label>
          Date
          <input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} required />
        </label>
        <label>
          Location
          <input value={meetLocation} onChange={(e) => setMeetLocation(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary">Save meet</button>
          <button type="button" className="danger" onClick={() => void onDeleteMeet()}>
            Delete meet
          </button>
        </div>
      </form>

      <section className="card">
        <h2>Events</h2>
        {meet.events.length === 0 && <p className="muted">No events yet.</p>}
        <ul className="event-list">
          {meet.events.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{event.name}</strong>
                <span className="muted">
                  {" "}
                  {event.distanceMeters}m · {event.status} · {event.entryCount} entered
                </span>
              </div>
              <div className="row">
                <button type="button" onClick={() => void openRoster(event.id)}>
                  Edit roster
                </button>
                {event.status === "upcoming" && (
                  <Link className="button primary" to={`/events/${event.id}/live`}>
                    Go to event
                  </Link>
                )}
                {event.status === "live" && (
                  <Link className="button primary" to={`/events/${event.id}/live`}>
                    Open live
                  </Link>
                )}
                {event.status === "completed" && (
                  <Link className="button primary" to={`/events/${event.id}/live`}>
                    Open results
                  </Link>
                )}
                <button type="button" className="danger" onClick={() => void onDeleteEvent(event.id, event.name)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {rosterEvent && (
        <form className="card" onSubmit={(event) => void saveRoster(event)}>
          <h2>Roster · {rosterEvent.name}</h2>
          {athletes.length === 0 && <p className="muted">Add athletes to the team first.</p>}
          <div className="filters">
            {GENDERS.map((value) => (
              <button key={value} type="button" disabled={rosterLocked} onClick={() => selectGroup({ gender: value })}>
                {GENDER_LABELS[value]}
              </button>
            ))}
            {GRADE_LEVELS.map((value) => (
              <button key={value} type="button" disabled={rosterLocked} onClick={() => selectGroup({ gradeLevel: value })}>
                {GRADE_LABELS[value]}
              </button>
            ))}
          </div>
          <ul className="plain">
            {athletes.map((athlete) => {
              const row = rosterDraft[athlete.id] ?? { selected: false, target: prTarget(athlete, rosterEvent) };
              return (
                <li key={athlete.id} className="manage-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={rosterLocked || (Boolean(row.selected) && !canRemoveFromRoster)}
                      onChange={(e) =>
                        setRosterDraft((current) => ({
                          ...current,
                          [athlete.id]: { ...row, selected: e.target.checked },
                        }))
                      }
                    />
                    {athlete.lastName}, {athlete.firstName}{" "}
                    <span className="muted">
                      {GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender} ·{" "}
                      {GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel}
                    </span>
                  </label>
                  <input
                    className="target"
                    placeholder="PR"
                    value={row.target}
                    disabled={!row.selected}
                    onChange={(e) =>
                      setRosterDraft((current) => ({
                        ...current,
                        [athlete.id]: { ...row, target: e.target.value },
                      }))
                    }
                  />
                </li>
              );
            })}
          </ul>
          {!canRemoveFromRoster && rosterEvent.status !== "upcoming" && (
            <p className="muted">Athletes already in a started event cannot be removed. You can still add or update targets.</p>
          )}
          <div className="row">
            <button className="primary" disabled={rosterBusy || athletes.length === 0}>
              {rosterBusy ? "Saving…" : "Save roster"}
            </button>
            <button type="button" onClick={() => setRosterEvent(null)}>
              Close
            </button>
          </div>
        </form>
      )}

      <form className="card" onSubmit={onCreateEvent}>
        <h2>New running event</h2>
        <label>
          Name
          <input value={eventName} onChange={(e) => setEventName(e.target.value)} required />
        </label>
        <label>
          Distance (meters)
          <input value={distance} onChange={(e) => setDistance(e.target.value)} required />
        </label>
        <p className="muted">Each athlete’s target will be their PR for this distance, if they have one.</p>
        <button className="primary">Create event and enter roster</button>
      </form>
    </main>
  );
}
