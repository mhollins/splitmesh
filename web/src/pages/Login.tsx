import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("coach-a@splitmesh.local");
  const [password, setPassword] = useState("password123");
  const [displayName, setDisplayName] = useState("Coach Avery");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api.login({ email, password });
      else await api.register({ email, password, displayName });
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <header className="brand">
        <p className="eyebrow">Race-day timing</p>
        <h1>SplitMesh</h1>
        <p className="lede">Shared splits for every coach on the course.</p>
      </header>
      <form className="card" onSubmit={onSubmit}>
        <div className="tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Log in
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Register
          </button>
        </div>
        {mode === "register" && (
          <label>
            Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Working…" : mode === "login" ? "Enter" : "Create account"}
        </button>
        <p className="hint">Demo: coach-a@splitmesh.local / coach-b@splitmesh.local — password123</p>
      </form>
    </main>
  );
}
