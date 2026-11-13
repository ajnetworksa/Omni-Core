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
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait 15 minutes." : "That password didn't work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="tg flex min-h-full items-center justify-center px-5">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-[22px] bg-panel p-7" style={{ boxShadow: "var(--tg-ring)" }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-[var(--tg-accent-fg)]">O</div>
          <h1 className="m-0 font-display text-[20px] font-extrabold">OmniCore</h1>
        </div>
        <label htmlFor="token" className="text-[15px] font-semibold">Password</label>
        <input id="token" type="password" autoComplete="current-password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} className="rounded-[12px] bg-raised px-3.5 py-3 text-[16px] text-fg outline-none" />
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={!token || busy} className="h-12 rounded-[14px] bg-accent text-[16px] font-semibold text-[var(--tg-accent-fg)] disabled:opacity-50">Sign in</button>
        <p className="m-0 text-[13.5px] leading-snug text-muted">Find it on your server: <code className="font-mono">cat data/api-token</code> (or <code className="font-mono">API_TOKEN</code> in <code className="font-mono">.env</code> if you set one). You stay signed in for 30 days on this browser.</p>
      </form>
    </main>
  );
}
