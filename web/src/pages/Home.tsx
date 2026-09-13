import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Meet, type Team, type User } from "../api";

export function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [meets, setMeets] = useState<Meet[]>([]);
  const [teamName, setTeamName] = useState("");
  const [invite, setInvite] = useState("");
  const [meetName, setMeetName] = useState("");
  const [meetDate, setMeetDate] = useState("2026-09-12");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const me = await api.me();
      setUser(me.user);
      if (!me.teams.length) {
        setTeam(null);
        return;
      }
      const detail = await api.team(me.teams[0].id);
      setTeam(detail.team);
      const meetList = await api.meets(detail.team.id);
      setMeets(meetList.meets);
    } catch {
      navigate("/");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreateTeam(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.createTeam(teamName);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create team");
    }
  }

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.joinTeam(invite);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join team");
    }
  }

  async function onCreateMeet(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    const created = await api.createMeet(team.id, { name: meetName, startsOn: meetDate });
    navigate(`/meets/${created.meet.id}`);
  }

  async function onDeleteMeet(meet: Meet) {
    if (!confirm(`Delete ${meet.name} and its events?`)) return;
    setError(null);
    try {
      await api.deleteMeet(meet.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete meet");
    }
  }

  if (!user) return <main className="page">Loading…</main>;

  if (!team) {
    return (
      <main className="page narrow">
        <header className="topbar">
          <h1>SplitMesh</h1>
          {user.isPlatformAdmin && <Link to="/admin">Admin</Link>}
        </header>
        <p>Create a team or join with an invite code.</p>
        {error && <p className="error">{error}</p>}
        <form className="card" onSubmit={onCreateTeam}>
          <h2>New team</h2>
          <label>
            Team name
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
          </label>
          <button className="primary">Create team</button>
        </form>
        <form className="card" onSubmit={onJoin}>
          <h2>Join team</h2>
          <label>
            Invite code
            <input value={invite} onChange={(e) => setInvite(e.target.value)} required />
          </label>
          <button className="primary">Join</button>
        </form>
      </main>
    );
  }

  const role = team.members.find((member) => member.id === user.id)?.role;
  const canManageTeam = role === "owner" || role === "admin";
  const canManageRoster = role === "owner" || role === "admin" || role === "coach";

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">SplitMesh</p>
          <h1>{team.name}</h1>
        </div>
        <span className="row">
          {user.isPlatformAdmin && <Link to="/admin">Admin</Link>}
          <button
            onClick={async () => {
              await api.logout();
              navigate("/");
            }}
          >
            Log out {user.displayName}
          </button>
        </span>
      </header>
      <div className="row" style={{ margin: "0.75rem 0 1rem" }}>
        <Link className="button" to="/athletes">
          Athletes
        </Link>
        {canManageTeam && (
          <Link className="button" to="/team">
            Edit team
          </Link>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Meets</h2>
        <ul className="plain">
          {meets.map((meet) => (
            <li key={meet.id} className="manage-row">
              <Link to={`/meets/${meet.id}`}>
                {meet.name} <span className="muted">{meet.startsOn}</span>
              </Link>
              {canManageRoster && (
                <button type="button" className="danger" onClick={() => void onDeleteMeet(meet)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManageRoster && (
          <form onSubmit={onCreateMeet}>
            <label>
              Meet name
              <input value={meetName} onChange={(e) => setMeetName(e.target.value)} required />
            </label>
            <label>
              Date
              <input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} required />
            </label>
            <button className="primary">Create meet</button>
          </form>
        )}
      </section>
    </main>
  );
}
