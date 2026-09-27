import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Athlete, type SchoolSummary, type Team, type TeamSummary, type User } from "../api";
import { rememberTeamId, selectedTeamId } from "../teamSelection";
import {
  GENDER_LABELS,
  GENDERS,
  GRADE_LABELS,
  GRADE_LEVELS,
  formatDistanceLabel,
  formatMs,
  formatTargetInput,
  parseTimeInput,
} from "../format";

export function AthletesPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("boys");
  const [gradeLevel, setGradeLevel] = useState("high_school");
  const [editingAthlete, setEditingAthlete] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editGender, setEditGender] = useState("boys");
  const [editGradeLevel, setEditGradeLevel] = useState("high_school");
  const [prTimes, setPrTimes] = useState<Record<string, string>>({});
  const [newPrDistance, setNewPrDistance] = useState("5000");
  const [newPrTime, setNewPrTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const me = await api.me();
      setUser(me.user);
      setTeams(me.teams);
      setSchools(me.schools);
      const teamId = selectedTeamId(me.teams);
      if (!teamId) {
        navigate("/app");
        return;
      }
      rememberTeamId(teamId);
      const detail = await api.team(teamId);
      setTeam(detail.team);
      const roster = await api.schoolAthletes(detail.team.schoolId);
      setAthletes(roster.athletes);
    } catch {
      navigate("/");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onAddAthlete(event: FormEvent) {
    event.preventDefault();
    if (!team) return;
    await api.addAthlete(team.id, { firstName, lastName, gender, gradeLevel });
    setFirstName("");
    setLastName("");
    await load();
  }

  async function onSavePr(athlete: Athlete, recordId: string, distanceMeters: number, discipline: string) {
    const markValueMs = parseTimeInput(prTimes[recordId] ?? "");
    if (markValueMs == null) {
      setError("Enter a PR time like 19:12.4");
      return;
    }
    setError(null);
    try {
      await api.upsertRecord(athlete.id, { distanceMeters, markValueMs, discipline });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PR");
    }
  }

  async function onDeletePr(athlete: Athlete, recordId: string) {
    setError(null);
    try {
      await api.deleteRecord(athlete.id, recordId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete PR");
    }
  }

  async function onAddPr(athlete: Athlete) {
    const markValueMs = parseTimeInput(newPrTime);
    const distanceMeters = Number(newPrDistance);
    if (markValueMs == null) {
      setError("Enter a PR time like 19:12.4");
      return;
    }
    setError(null);
    try {
      await api.upsertRecord(athlete.id, { distanceMeters, markValueMs });
      setNewPrTime("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PR");
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

  async function onUnassign(athlete: Athlete) {
    if (!team) return;
    if (!confirm(`Remove ${athlete.firstName} ${athlete.lastName} from ${team.name}? Their results stay.`)) return;
    setError(null);
    try {
      await api.unassignAthlete(team.schoolId, athlete.id, team.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove athlete");
    }
  }

  async function onToggleTeam(athlete: Athlete, teamId: string, assigned: boolean) {
    if (!team) return;
    setError(null);
    try {
      if (assigned) await api.unassignAthlete(team.schoolId, athlete.id, teamId);
      else await api.assignAthlete(team.schoolId, athlete.id, teamId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update teams");
    }
  }

  async function onDeleteAthlete(athlete: Athlete) {
    if (!confirm(`Delete ${athlete.firstName} ${athlete.lastName} from the school? Their race history will be removed.`)) return;
    setError(null);
    try {
      await api.deleteAthlete(athlete.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete athlete");
    }
  }

  if (!user || !team) return <main className="page">Loading…</main>;

  const role = team.members.find((member) => member.id === user.id)?.role;
  const canManageRoster = role === "owner" || role === "admin" || role === "coach";
  const schoolTeams = teams.filter((item) => item.schoolId === team.schoolId);
  const isSchoolAdmin = schools.some((school) => school.id === team.schoolId) || user.isPlatformAdmin;
  function canEdit(athlete: Athlete) {
    if (isSchoolAdmin) return true;
    return (athlete.teams ?? []).some((assigned) => {
      const membership = teams.find((item) => item.id === assigned.id);
      return membership && ["owner", "admin", "coach"].includes(membership.role);
    });
  }

  return (
    <main className="page">
      <p>
        <Link to="/app">← {team.name}</Link>
      </p>
      <h1>Athletes</h1>
      <p className="muted">{team.schoolName}</p>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <ul className="plain">
          {athletes.map((athlete) => (
            <li key={athlete.id} className="manage-row">
              {editingAthlete === athlete.id ? (
                <div className="athlete-edit">
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
                  <p className="muted">Personal records</p>
                  {(athlete.records ?? []).map((record) => (
                    <form
                      key={record.id}
                      className="row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onSavePr(athlete, record.id, record.distanceMeters ?? 0, record.discipline);
                      }}
                    >
                      <span className="pr-distance">{formatDistanceLabel(record.distanceMeters)}</span>
                      <input
                        className="target"
                        value={prTimes[record.id] ?? formatTargetInput(record.markValueMs)}
                        onChange={(e) => setPrTimes((current) => ({ ...current, [record.id]: e.target.value }))}
                        placeholder="19:12.4"
                        required
                      />
                      <button className="primary">Save PR</button>
                      <button type="button" className="danger" onClick={() => void onDeletePr(athlete, record.id)}>
                        Delete
                      </button>
                    </form>
                  ))}
                  <form
                    className="row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onAddPr(athlete);
                    }}
                  >
                    <select value={newPrDistance} onChange={(e) => setNewPrDistance(e.target.value)}>
                      {[800, 1500, 1600, 3000, 3200, 5000, 8000, 10000].map((meters) => (
                        <option key={meters} value={String(meters)}>
                          {formatDistanceLabel(meters)}
                        </option>
                      ))}
                    </select>
                    <input
                      className="target"
                      placeholder="19:12.4"
                      value={newPrTime}
                      onChange={(e) => setNewPrTime(e.target.value)}
                      required
                    />
                    <button className="primary">Add PR</button>
                  </form>
                </div>
              ) : (
                <>
                  <span>
                    {athlete.lastName}, {athlete.firstName}{" "}
                    <span className="muted">
                      {GENDER_LABELS[athlete.gender as keyof typeof GENDER_LABELS] ?? athlete.gender} ·{" "}
                      {GRADE_LABELS[athlete.gradeLevel as keyof typeof GRADE_LABELS] ?? athlete.gradeLevel}
                      {(athlete.records ?? []).length > 0 &&
                        ` · ${(athlete.records ?? [])
                          .map((record) => `${formatDistanceLabel(record.distanceMeters)} ${formatMs(record.markValueMs)}`)
                          .join(" · ")}`}
                    </span>
                  </span>
                  <span className="row">
                    {schoolTeams.map((item) => {
                      const assigned = (athlete.teams ?? []).some((row) => row.id === item.id);
                      const canToggle =
                        isSchoolAdmin || ["owner", "admin", "coach"].includes(teams.find((row) => row.id === item.id)?.role ?? "");
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={assigned ? "primary" : ""}
                          disabled={!canToggle}
                          onClick={() => void onToggleTeam(athlete, item.id, assigned)}
                        >
                          {item.name}
                        </button>
                      );
                    })}
                  </span>
                  {canEdit(athlete) && (
                    <span className="row">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAthlete(athlete.id);
                          setEditFirst(athlete.firstName);
                          setEditLast(athlete.lastName);
                          setEditGender(athlete.gender);
                          setEditGradeLevel(athlete.gradeLevel);
                          setPrTimes(
                            Object.fromEntries(
                              (athlete.records ?? []).map((record) => [
                                record.id,
                                formatTargetInput(record.markValueMs),
                              ]),
                            ),
                          );
                          setNewPrTime("");
                        }}
                      >
                        Edit
                      </button>
                      {(athlete.teams ?? []).some((row) => row.id === team.id) && canManageRoster && (
                        <button type="button" onClick={() => void onUnassign(athlete)}>
                          Remove from {team.name}
                        </button>
                      )}
                      {isSchoolAdmin && (
                        <button type="button" className="danger" onClick={() => void onDeleteAthlete(athlete)}>
                          Delete from school
                        </button>
                      )}
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
      </section>
    </main>
  );
}
