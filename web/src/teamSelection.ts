const STORAGE_KEY = "splitmesh.selectedTeamId";

export function selectedTeamId(teams: { id: string }[]): string | null {
  if (!teams.length) return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && teams.some((team) => team.id === stored)) return stored;
  return teams[0].id;
}

export function rememberTeamId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}
