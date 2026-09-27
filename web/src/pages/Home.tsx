import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Meet, type SchoolSummary, type Season, type Team, type TeamSummary, type User } from "../api";
import { rememberTeamId, selectedTeamId } from "../teamSelection";

export function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [meets, setMeets] = useState<Meet[]>([]);
  const [pastSeasons, setPastSeasons] = useState<Season[]>([]);
  const [pastSeasonId, setPastSeasonId] = useState("");
  const [pastMeets, setPastMeets] = useState<Meet[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [invite, setInvite] = useState("");
  const [meetName, setMeetName] = useState("");
  const [meetDate, setMeetDate] = useState("2026-09-12");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const me = await api.me();
      setUser(me.user);
      setTeams(me.teams);
      setSchools(me.schools);
      const teamId = selectedTeamId(me.teams);
      if (!teamId) {
        setTeam(null);
        return;
      }
      rememberTeamId(teamId);
      const detail = await api.team(teamId);
      setTeam(detail.team);
      const meetList = await api.meets(detail.team.id);
      setMeets(meetList.meets);
      const seasonList = await api.seasons(detail.team.id);
      const past = seasonList.seasons.filter((season) => !season.isCurrent);
      setPastSeasons(past);
      const nextPast = past[0]?.id ?? "";
      setPastSeasonId(nextPast);
      if (nextPast) {
        const pastList = await api.meets(detail.team.id, nextPast);
        setPastMeets(pastList.meets);
      } else {
        setPastMeets([]);
      }
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
      const created = await api.createTeam(teamName || schoolName, schoolName);
      if (created.team?.id) rememberTeamId(created.team.id);
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

  async function onPastSeason(seasonId: string) {
    if (!team) return;
    setPastSeasonId(seasonId);
    setError(null);
    try {
      const pastList = await api.meets(team.id, seasonId);
      setPastMeets(pastList.meets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that season");
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
        {schools.length === 0 ? (
          <>
            <p>Create a school or join a team with an invite code.</p>
            {error && <p className="error">{error}</p>}
            <form className="card" onSubmit={onCreateTeam}>
              <h2>Create a school</h2>
              <label>
                School name
                <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} required />
              </label>
              <label>
                First team name
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </label>
              <p className="muted">This creates a new school and its first team. You will be the school admin.</p>
              <button className="primary">Create school</button>
            </form>
          </>
        ) : (
          <>
            <p>Open a school you administer, or join a team with an invite code.</p>
            {error && <p className="error">{error}</p>}
            <section className="card">
              {schools.map((school) => (
                <Link key={school.id} to={`/schools/${school.id}`}>
                  School admin · {school.name}
                </Link>
              ))}
            </section>
          </>
        )}
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
          {teams.length > 1 ? (
            <label>
              Team
              <select
                value={team.id}
                onChange={(event) => {
                  rememberTeamId(event.target.value);
                  void load();
                }}
              >
                {teams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h1>{team.name}</h1>
          )}
          {teams.length > 1 && <h1>{team.name}</h1>}
          {team.currentSeason && <p className="muted">Season {team.currentSeason.name}</p>}
          <p className="muted">{team.schoolName}</p>
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
        <Link className="button" to={`/schools/${team.schoolId}/records`}>
          School records
        </Link>
        <Link className="button" to="/event-types">
          Event types
        </Link>
        {schools.map((school) => (
          <Link key={school.id} className="button" to={`/schools/${school.id}`}>
            School admin · {school.name}
          </Link>
        ))}
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

      <section className="card">
        <h2>Previous seasons</h2>
        {pastSeasons.length === 0 ? (
          <p className="muted">No earlier seasons yet. On June 1 this season rolls forward and its meets stay here.</p>
        ) : (
          <>
            <label>
              Season
              <select value={pastSeasonId} onChange={(event) => void onPastSeason(event.target.value)}>
                {pastSeasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
            {pastMeets.length === 0 ? (
              <p className="muted">No meets in this season.</p>
            ) : (
              <ul className="plain">
                {pastMeets.map((meet) => (
                  <li key={meet.id}>
                    <Link to={`/meets/${meet.id}`}>
                      {meet.name} <span className="muted">{meet.startsOn}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
