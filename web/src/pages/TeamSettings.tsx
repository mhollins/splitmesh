import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Team, type User } from "../api";
import { rememberTeamId, selectedTeamId } from "../teamSelection";

export function TeamSettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [rename, setRename] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const me = await api.me();
      setUser(me.user);
      const teamId = selectedTeamId(me.teams);
      if (!teamId) {
        navigate("/app");
        return;
      }
      rememberTeamId(teamId);
      const detail = await api.team(teamId);
      setTeam(detail.team);
      setRename(detail.team.name);
    } catch {
      navigate("/");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onRenameTeam(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    setError(null);
    try {
      const updated = await api.updateTeam(team.id, rename);
      setTeam(updated.team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename team");
    }
  }

  async function onDeleteTeam() {
    if (!team) return;
    if (
      !confirm(
        `Delete ${team.name}? Its meets and results are removed. Athletes stay on the school, and school records are recomputed.`,
      )
    )
      return;
    setError(null);
    try {
      await api.deleteTeam(team.id);
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete team");
    }
  }

  if (!user || !team) return <main className="page">Loading…</main>;

  const role = team.members.find((member) => member.id === user.id)?.role;
  const canManageTeam = role === "owner" || role === "admin";
  const canDeleteTeam = role === "owner";

  if (!canManageTeam) {
    return (
      <main className="page narrow">
        <p>
          <Link to="/app">← {team.name}</Link>
        </p>
        <p>You don’t have permission to edit this team.</p>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <p>
        <Link to="/app">← {team.name}</Link>
      </p>
      <h1>Edit team</h1>
      {error && <p className="error">{error}</p>}
      <form className="card" onSubmit={onRenameTeam}>
        <label>
          Team name
          <input value={rename} onChange={(e) => setRename(e.target.value)} required />
        </label>
        <p className="invite">
          Invite code <strong>{team.inviteCode}</strong>
        </p>
        <div className="row">
          <button className="primary">Save name</button>
          {canDeleteTeam && (
            <button type="button" className="danger" onClick={() => void onDeleteTeam()}>
              Delete team
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
