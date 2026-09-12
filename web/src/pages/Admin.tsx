import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type AdminUser, type Team, type User } from "../api";

export function AdminPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState<Record<string, string>>({});
  const [teamName, setTeamName] = useState<Record<string, string>>({});

  async function load() {
    try {
      const session = await api.me();
      if (!session.user.isPlatformAdmin) {
        navigate("/app");
        return;
      }
      setMe(session.user);
      const [userList, teamList] = await Promise.all([api.adminUsers(), api.adminTeams()]);
      setUsers(userList.users);
      setTeams(teamList.teams);
      setEditName(Object.fromEntries(userList.users.map((user) => [user.id, user.displayName])));
      setTeamName(Object.fromEntries(teamList.teams.map((team) => [team.id, team.name])));
    } catch {
      navigate("/");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveCoach(event: FormEvent, user: AdminUser) {
    event.preventDefault();
    setError(null);
    try {
      await api.updateCoach(user.id, { displayName: editName[user.id] ?? user.displayName });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update coach");
    }
  }

  async function toggleAdmin(user: AdminUser) {
    setError(null);
    try {
      await api.updateCoach(user.id, { isPlatformAdmin: !user.isPlatformAdmin });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update administrator");
    }
  }

  async function saveTeam(event: FormEvent, team: Team) {
    event.preventDefault();
    setError(null);
    try {
      await api.adminUpdateTeam(team.id, teamName[team.id] ?? team.name);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update team");
    }
  }

  async function removeTeam(team: Team) {
    if (!confirm(`Delete ${team.name} and all of its athletes, meets, and results?`)) return;
    setError(null);
    try {
      await api.adminDeleteTeam(team.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete team");
    }
  }

  if (!me) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">
            <Link to="/app">SplitMesh</Link>
          </p>
          <h1>Administrators</h1>
        </div>
        <Link to="/app">← Team home</Link>
      </header>
      <p className="muted">View and edit coaches and teams. At least one administrator is required.</p>
      {error && <p className="error">{error}</p>}

      <section className="grid">
        <div className="card">
          <h2>Coaches</h2>
          <ul className="plain">
            {users.map((user) => (
              <li key={user.id}>
                <form className="manage-row" onSubmit={(event) => void saveCoach(event, user)}>
                  <div>
                    <input
                      value={editName[user.id] ?? user.displayName}
                      onChange={(e) => setEditName((current) => ({ ...current, [user.id]: e.target.value }))}
                      required
                    />
                    <p className="muted">
                      {user.email}
                      {user.teams.length > 0 &&
                        ` · ${user.teams.map((team) => `${team.teamName} (${team.role})`).join(", ")}`}
                    </p>
                  </div>
                  <span className="row">
                    <button className="primary">Save</button>
                    <button type="button" onClick={() => void toggleAdmin(user)}>
                      {user.isPlatformAdmin ? "Remove admin" : "Make admin"}
                    </button>
                  </span>
                </form>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Teams</h2>
          <ul className="plain">
            {teams.map((team) => (
              <li key={team.id}>
                <form className="manage-row" onSubmit={(event) => void saveTeam(event, team)}>
                  <div>
                    <input
                      value={teamName[team.id] ?? team.name}
                      onChange={(e) => setTeamName((current) => ({ ...current, [team.id]: e.target.value }))}
                      required
                    />
                    <p className="muted">
                      Invite {team.inviteCode}
                      {team.members.length > 0 &&
                        ` · ${team.members.map((member) => member.displayName).join(", ")}`}
                    </p>
                  </div>
                  <span className="row">
                    <button className="primary">Save</button>
                    <button type="button" className="danger" onClick={() => void removeTeam(team)}>
                      Delete
                    </button>
                  </span>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
