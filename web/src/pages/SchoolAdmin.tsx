import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type SchoolDetail } from "../api";
import { rememberTeamId } from "../teamSelection";

const ROLES = ["viewer", "assistant", "coach", "admin", "owner"] as const;

export function SchoolAdminPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const [school, setSchool] = useState<SchoolDetail | null>(null);
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
  const [memberRole, setMemberRole] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!schoolId) return;
    const detail = await api.school(schoolId);
    setSchool(detail.school);
    setName(detail.school.name);
  }

  useEffect(() => {
    void load().catch(() => navigate("/app"));
  }, [schoolId]);

  async function onRename(event: FormEvent) {
    event.preventDefault();
    if (!school) return;
    setError(null);
    try {
      const updated = await api.updateSchool(school.id, name);
      setSchool(updated.school);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename school");
    }
  }

  async function onDeleteSchool() {
    if (!school) return;
    if (!confirm(`Delete ${school.name}? Teams, athletes, and results are destroyed.`)) return;
    await api.deleteSchool(school.id);
    navigate("/app");
  }

  async function onAddTeam(event: FormEvent) {
    event.preventDefault();
    if (!school) return;
    setError(null);
    try {
      await api.createSchoolTeam(school.id, teamName);
      setTeamName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add team");
    }
  }

  async function onAddAdmin(event: FormEvent) {
    event.preventDefault();
    if (!school) return;
    setError(null);
    try {
      const updated = await api.addSchoolAdmin(school.id, adminEmail);
      setSchool(updated.school);
      setAdminEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add administrator");
    }
  }

  async function onRemoveAdmin(userId: string) {
    if (!school) return;
    setError(null);
    try {
      const updated = await api.removeSchoolAdmin(school.id, userId);
      setSchool(updated.school);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove administrator");
    }
  }

  if (!school) return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <p>
        <Link to="/app">← Home</Link>
      </p>
      <h1>{school.name}</h1>
      {error && <p className="error">{error}</p>}
      <form className="card" onSubmit={onRename}>
        <h2>School</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="row">
          <button className="primary">Save</button>
          <button type="button" className="danger" onClick={() => void onDeleteSchool()}>
            Delete school
          </button>
          <Link className="button" to={`/schools/${school.id}/records`}>
            School records
          </Link>
          {school.teams[0] && (
            <Link className="button" to="/athletes" onClick={() => rememberTeamId(school.teams[0].id)}>
              Roster
            </Link>
          )}
        </div>
      </form>

      <form className="card" onSubmit={onAddTeam}>
        <h2>Add a team to {school.name}</h2>
        <label>
          Team name
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
        </label>
        <p className="muted">
          This adds a team to {school.name}. It does not create a new school. You are not on the team until you assign
          yourself.
        </p>
        <button className="primary">Add team to {school.name}</button>
      </form>

      {school.teams.map((team) => (
        <section className="card" key={team.id}>
          <h2>{team.name}</h2>
          <p className="muted">
            Invite {team.inviteCode}
            {team.currentSeason ? ` · Season ${team.currentSeason.name}` : ""}
          </p>
          <ul className="plain">
            {team.members.map((member) => (
              <li key={member.id} className="manage-row">
                <span>
                  {member.displayName} <span className="muted">{member.email}</span>
                </span>
                <span className="row">
                  <select
                    value={member.role}
                    onChange={(event) =>
                      void api.setTeamMember(team.id, { email: member.email, role: event.target.value }).then(() => load())
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void api.removeTeamMember(team.id, member.id).then(() => load())}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              void api
                .setTeamMember(team.id, {
                  email: memberEmail[team.id] ?? "",
                  role: memberRole[team.id] ?? "coach",
                })
                .then(() => {
                  setMemberEmail((current) => ({ ...current, [team.id]: "" }));
                  return load();
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Could not assign coach"));
            }}
          >
            <input
              placeholder="Email"
              value={memberEmail[team.id] ?? ""}
              onChange={(event) => setMemberEmail((current) => ({ ...current, [team.id]: event.target.value }))}
              required
            />
            <select
              value={memberRole[team.id] ?? "coach"}
              onChange={(event) => setMemberRole((current) => ({ ...current, [team.id]: event.target.value }))}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button className="primary">Assign</button>
          </form>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (
                !confirm(
                  `Delete ${team.name}? Its meets and results are removed. Athletes stay on the school, and school records are recomputed.`,
                )
              )
                return;
              void api.deleteTeam(team.id).then(() => load());
            }}
          >
            Delete team
          </button>
        </section>
      ))}

      <section className="card">
        <h2>Administrators</h2>
        <ul className="plain">
          {school.admins.map((admin) => (
            <li key={admin.id} className="manage-row">
              <span>
                {admin.displayName} <span className="muted">{admin.email}</span>
              </span>
              <button type="button" onClick={() => void onRemoveAdmin(admin.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={onAddAdmin}>
          <input
            placeholder="Email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            required
          />
          <button className="primary">Add administrator</button>
        </form>
      </section>

      {school.teams.length === 0 && <UnassignedRoster schoolId={school.id} />}
    </main>
  );
}

function UnassignedRoster({ schoolId }: { schoolId: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.addSchoolAthlete(schoolId, {
        firstName,
        lastName,
        gender: "boys",
        gradeLevel: "high_school",
      });
      setFirstName("");
      setLastName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add athlete");
    }
  }

  return (
    <form className="card" onSubmit={onAdd}>
      <h2>Roster</h2>
      <p className="muted">This school has no teams yet. Athletes added here are not on a team.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input placeholder="First" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <input placeholder="Last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        <button className="primary">Add athlete</button>
      </div>
    </form>
  );
}
