import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Athlete, type Meet, type Team, type User } from "../api";
import { GENDER_LABELS, GENDERS, GRADE_LABELS, GRADE_LEVELS } from "../format";

export function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [meets, setMeets] = useState<Meet[]>([]);
  const [teamName, setTeamName] = useState("");
  const [invite, setInvite] = useState("");
  const [rename, setRename] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("boys");
  const [gradeLevel, setGradeLevel] = useState("high_school");
  const [meetName, setMeetName] = useState("");
  const [meetDate, setMeetDate] = useState("2026-09-12");
  const [editingAthlete, setEditingAthlete] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editGender, setEditGender] = useState("boys");
  const [editGradeLevel, setEditGradeLevel] = useState("high_school");
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
      setRename(detail.team.name);
      const [roster, meetList] = await Promise.all([
        api.athletes(detail.team.id),
        api.meets(detail.team.id),
      ]);
      setAthletes(roster.athletes);
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

  async function onAddAthlete(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    await api.addAthlete(team.id, { firstName, lastName, gender, gradeLevel });
    setFirstName("");
    setLastName("");
    await load();
  }

  async function onCreateMeet(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    const created = await api.createMeet(team.id, { name: meetName, startsOn: meetDate });
    navigate(`/meets/${created.meet.id}`);
  }

  async function onRenameTeam(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    setError(null);
    try {
      await api.updateTeam(team.id, rename);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename team");
    }
  }

  async function onDeleteTeam() {
    if (!team) return;
    if (!confirm(`Delete ${team.name} and all of its athletes, meets, and results?`)) return;
    setError(null);
    try {
      await api.deleteTeam(team.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete team");
    }
  }

  async function onSaveAthlete(athleteId: string) {
    setError(null);
    try {
      await api.updateAthlete(athleteId, {
        firstName: editFirst,
        lastName: editLast,
        gender: editGender,
        gradeLevel: editGradeLevel,
      });
      setEditingAthlete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update athlete");
    }
  }

  async function onDeleteAthlete(athlete: Athlete) {
    if (!confirm(`Remove ${athlete.firstName} ${athlete.lastName} from the roster?`)) return;
    setError(null);
    try {
      await api.deleteAthlete(athlete.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete athlete");
    }
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
  const canDeleteTeam = role === "owner";
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
      <p className="invite">
        Invite code <strong>{team.inviteCode}</strong>
      </p>
      {error && <p className="error">{error}</p>}

      {canManageTeam && (
        <form className="card" onSubmit={onRenameTeam}>
          <h2>Team</h2>
          <div className="row">
            <input value={rename} onChange={(e) => setRename(e.target.value)} required />
            <button className="primary">Save name</button>
            {canDeleteTeam && (
              <button type="button" className="danger" onClick={() => void onDeleteTeam()}>
                Delete team
              </button>
            )}
          </div>
        </form>
      )}

      <section className="grid">
        <div className="card">
          <h2>Athletes</h2>
          <ul className="plain">
            {athletes.map((athlete) => (
              <li key={athlete.id} className="manage-row">
                {editingAthlete === athlete.id ? (
                  <form
                    className="row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onSaveAthlete(athlete.id);
                    }}
                  >
                    <input value={editFirst} onChange={(e) => setEditFirst(e.target.value)} required />
                    <input value={editLast} onChange={(e) => setEditLast(e.target.value)} required />
                    <select value={editGender} onChange={(e) => setEditGender(e.target.value)}>
                      {GENDERS.map((value) => (
                        <option key={value} value={value}>
                          {GENDER_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <select value={editGradeLevel} onChange={(e) => setEditGradeLevel(e.target.value)}>
                      {GRADE_LEVELS.map((value) => (
                        <option key={value} value={value}>
                          {GRADE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <button className="primary">Save</button>
                    <button type="button" onClick={() => setEditingAthlete(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span>
                      {athlete.lastName}, {athlete.firstName}{" "}
                      <span className="muted">
                        {GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender} ·{" "}
                        {GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel}
                      </span>
                    </span>
                    {canManageRoster && (
                      <span className="row">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAthlete(athlete.id);
                            setEditFirst(athlete.firstName);
                            setEditLast(athlete.lastName);
                            setEditGender(athlete.gender);
                            setEditGradeLevel(athlete.gradeLevel);
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => void onDeleteAthlete(athlete)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {canManageRoster && (
            <form className="row" onSubmit={onAddAthlete}>
              <input placeholder="First" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              <input placeholder="Last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                {GENDERS.map((value) => (
                  <option key={value} value={value}>
                    {GENDER_LABELS[value]}
                  </option>
                ))}
              </select>
              <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
                {GRADE_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {GRADE_LABELS[value]}
                  </option>
                ))}
              </select>
              <button className="primary">Add</button>
            </form>
          )}
        </div>
        <div className="card">
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
        </div>
      </section>
    </main>
  );
}
