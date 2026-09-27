import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type EventType, type Team } from "../api";
import { rememberTeamId, selectedTeamId } from "../teamSelection";

type SplitDraft = { name: string; distanceMeters: string };

export function EventTypesPage() {
  const navigate = useNavigate();
  const [team, setTeam] = useState<Team | null>(null);
  const [types, setTypes] = useState<EventType[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [distance, setDistance] = useState("3200");
  const [discipline, setDiscipline] = useState("track_running");
  const [splits, setSplits] = useState<SplitDraft[]>([{ name: "1 Mile", distanceMeters: "1609" }]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const me = await api.me();
    const teamId = selectedTeamId(me.teams);
    if (!teamId) {
      navigate("/app");
      return;
    }
    rememberTeamId(teamId);
    const detail = await api.team(teamId);
    setTeam(detail.team);
    const list = await api.eventTypes(detail.team.id);
    setTypes(list.eventTypes);
  }

  useEffect(() => {
    void load().catch(() => navigate("/"));
  }, []);

  function startNew() {
    setEditingId("new");
    setName("");
    setDistance("3200");
    setDiscipline("track_running");
    setSplits([{ name: "1 Mile", distanceMeters: "1609" }]);
  }

  function startEdit(type: EventType) {
    setEditingId(type.id);
    setName(type.name);
    setDistance(String(type.distanceMeters));
    setDiscipline(type.discipline);
    setSplits(
      type.splits
        .filter((split) => split.distanceMeters < type.distanceMeters)
        .map((split) => ({ name: split.name, distanceMeters: String(split.distanceMeters) })),
    );
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    setError(null);
    const body = {
      name,
      distanceMeters: Number(distance),
      discipline,
      splits: splits
        .filter((split) => split.name.trim() && Number(split.distanceMeters) > 0)
        .map((split) => ({ name: split.name.trim(), distanceMeters: Number(split.distanceMeters) })),
    };
    try {
      if (editingId === "new") await api.createEventType(team.id, body);
      else if (editingId) await api.updateEventType(editingId, body);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save event type");
    }
  }

  async function onDelete(type: EventType) {
    if (!confirm(`Delete ${type.name} from the event list? Existing races stay as they are.`)) return;
    setError(null);
    try {
      await api.deleteEventType(type.id);
      if (editingId === type.id) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event type");
    }
  }

  if (!team) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <p>
        <Link to="/app">← {team.name}</Link>
      </p>
      <h1>Event types</h1>
      <p className="muted">Each type has a total distance and the splits you want to record.</p>
      {error && <p className="error">{error}</p>}

      <ul className="plain">
        {types.map((type) => (
          <li key={type.id} className="card">
            <div className="manage-row">
              <div>
                <strong>{type.name}</strong>{" "}
                <span className="muted">
                  {type.distanceMeters}m · {type.splits.map((split) => split.name).join(", ")}
                </span>
              </div>
              <span className="row">
                <button type="button" onClick={() => startEdit(type)}>
                  Edit
                </button>
                <button type="button" className="danger" onClick={() => void onDelete(type)}>
                  Delete
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p>
        <button type="button" className="primary" onClick={startNew}>
          Add event type
        </button>
      </p>

      {editingId && (
        <form className="card" onSubmit={onSave}>
          <h2>{editingId === "new" ? "New event type" : "Edit event type"}</h2>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Total distance (meters)
            <input value={distance} onChange={(e) => setDistance(e.target.value)} required />
          </label>
          <label>
            Discipline
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
              <option value="cross_country">Cross country</option>
              <option value="track_running">Track running</option>
            </select>
          </label>
          <p className="muted">Intermediate splits (Finish is added automatically at the total distance)</p>
          {splits.map((split, index) => (
            <div key={index} className="row">
              <input
                placeholder="1 Mile"
                value={split.name}
                onChange={(e) =>
                  setSplits((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: e.target.value } : item,
                    ),
                  )
                }
              />
              <input
                placeholder="1609"
                value={split.distanceMeters}
                onChange={(e) =>
                  setSplits((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, distanceMeters: e.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="danger"
                onClick={() => setSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSplits((current) => [...current, { name: "", distanceMeters: "" }])}
          >
            Add split
          </button>
          <div className="row">
            <button className="primary">Save</button>
            <button type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
