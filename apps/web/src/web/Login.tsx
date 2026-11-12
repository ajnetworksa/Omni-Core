import { useState } from "react";
import { api, ApiError, refreshAll } from "../lib/api";

export function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(token);
      await refreshAll();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait 15 minutes." : "That token didn't work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-full items-center justify-center px-5">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-panel p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-ink">O</div>
          <h1 className="m-0 text-lg font-semibold">OmniCore</h1>
        </div>
        <label htmlFor="token" className="text-sm text-fg-2">API token</label>
        <input id="token" type="password" autoComplete="current-password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} className="rounded-lg border border-line-strong bg-card px-3 py-2.5 text-fg outline-none focus:border-accent/60" />
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={!token || busy} className="h-11 rounded-lg bg-accent font-semibold text-ink disabled:opacity-50">Sign in</button>
        <p className="m-0 text-xs text-muted">The token is the <code className="font-mono">API_TOKEN</code> from your <code className="font-mono">.env</code>. You stay signed in for 30 days on this browser.</p>
      </form>
    </main>
  );
}
