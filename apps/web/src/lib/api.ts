import { QueryClient } from "@tanstack/react-query";
import type { VersionInfo, AiStatus, AskResult, AskSource, GraphData, NoteDetail, NoteListItem, Parsed, Prefs, Project, ProjectDetail, SettingsPage, SystemInfo, TaskAction, TaskCard, TaskDetail, TodayBoard } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`HTTP ${status}`);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    // x-omnicore is required by the server for cookie-authenticated writes (CSRF defence).
    headers: { "x-omnicore": "1", ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  me: () => req<{ authenticated: boolean; mode?: string }>("GET", "/me"),
  login: (token: string) => req<{ ok: boolean }>("POST", "/session", { token }),
  loginTelegram: (initData: string) => req<{ ok: boolean; user: { id: number; firstName: string | null } }>("POST", "/session/telegram", { initData }),
  logout: () => req("POST", "/logout"),
  today: () => req<TodayBoard>("GET", "/today/board"),
  upcoming: (days = 14) => req<{ date: string; tasks: TaskCard[] }[]>("GET", `/upcoming?days=${days}`),
  inbox: () => req<{ tasks: TaskCard[]; notes: NoteListItem[] }>("GET", "/inbox"),
  board: () => req<Record<"backlog" | "ready" | "in_progress" | "blocked" | "done", TaskCard[]>>("GET", "/board"),
  detail: (id: string) => req<TaskDetail>("GET", `/tasks/${encodeURIComponent(id)}/detail`),
  create: (text: string) => req<TaskCard>("POST", "/tasks", { text }),
  patch: (id: string, patch: Record<string, unknown>) => req<TaskCard>("PATCH", `/tasks/${encodeURIComponent(id)}`, patch),
  action: (id: string, action: TaskAction) => req<{ summary: string }>("POST", `/tasks/${encodeURIComponent(id)}/actions/${action}`),
  remark: (id: string, text: string) => req("POST", `/tasks/${encodeURIComponent(id)}/remarks`, { text }),
  parse: (text: string) => req<Parsed>("POST", "/parse", { text }),
  search: (q: string) => req<{ tasks: TaskCard[]; notes: (NoteListItem & { snippet: string })[] }>("GET", `/search?q=${encodeURIComponent(q)}`),
  projects: () => req<Project[]>("GET", "/projects"),
  prefs: () => req<Prefs>("GET", "/prefs"),
  settings: () => req<SettingsPage>("GET", "/settings"),
  saveSettings: (values: Record<string, string | null>) => req<SettingsPage & { restart: string[] }>("PUT", "/settings", { values }),
  restart: () => req<{ restarting: boolean }>("POST", "/settings/restart"),
  pause: (minutes: number) => req<{ pausedUntil: string | null }>("POST", "/reminders/pause", { minutes }),
  system: () => req<SystemInfo>("GET", "/system"),
  backupNow: () => req<{ name: string; bytes: number }>("POST", "/backup"),
  deleteTask: (id: string) => req<{ title: string; removed: number; undo: string | null }>("DELETE", `/tasks/${encodeURIComponent(id)}`),
  deleteProject: (slug: string, keepTasks: boolean) => req<{ title: string; tasksDeleted: number; tasksKept: number }>("DELETE", `/projects/${encodeURIComponent(slug)}?keepTasks=${keepTasks}`),
  deleteNote: (id: string) => req<{ trash: string; undo: string }>("DELETE", `/notes/${encodeURIComponent(id)}`),
  undo: (token: string) => req<{ kind: string; path: string }>("POST", "/undo", { token }),
  project: (slug: string) => req<ProjectDetail>("GET", `/projects/${encodeURIComponent(slug)}`),
  createProject: (name: string) => req<Project & { path: string; created: boolean }>("POST", "/projects", { name }),
  suggest: () => req<{ projects: { slug: string; title: string }[]; tags: string[] }>("GET", "/suggest"),
  createIn: (text: string, projectSlug?: string) => req<TaskCard>("POST", "/tasks", projectSlug ? { text, projectSlug } : { text }),
  notes: () => req<NoteListItem[]>("GET", "/notes"),
  note: (id: string) => req<NoteDetail>("GET", `/notes/${encodeURIComponent(id)}`),
  noteByPath: (path: string) => req<NoteDetail>("GET", `/notes/by-path?path=${encodeURIComponent(path)}`),
  saveNote: (id: string, content: string, checksum: string) => req<NoteDetail>("PUT", `/notes/${encodeURIComponent(id)}`, { content, checksum }),
  createNote: (title: string, content = "") => req<NoteDetail>("POST", "/notes", { title, content }),
  log: (text: string) => req<{ path: string }>("POST", "/log", { text }),
  graph: () => req<GraphData>("GET", "/graph"),
  ai: () => req<AiStatus>("GET", "/ai/status"),
  version: () => req<VersionInfo>("GET", "/version"),
  ask: (q: string) => req<AskResult>("POST", "/ai/ask", { q }),
  related: (q: string) => req<{ timeRange: string | null; hits: (AskSource & { score: number })[] }>("GET", `/search/semantic?q=${encodeURIComponent(q)}&k=6`),
  breakdown: (id: string, hint?: string) => req<{ subtasks: string[]; provider: string; model: string }>("POST", `/tasks/${encodeURIComponent(id)}/breakdown`, hint ? { hint } : {}),
  addSubtasks: (id: string, titles: string[]) => req<TaskCard[]>("POST", `/tasks/${encodeURIComponent(id)}/subtasks`, { titles }),
  digest: (kind: "standup" | "retro") => req<{ text: string; ai: boolean; empty?: boolean; path: string; model?: string }>("POST", "/ai/digest", { kind }),
};

/** A friendly message for AI errors (model down, busy, not configured). */
export function aiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { reason?: string; message?: string } | null;
    if (e.status === 429) return "The AI is busy with another request. Try again in a moment.";
    if (b?.reason === "disabled") return b.message ?? "AI is turned off.";
    if (e.status === 503) return "The AI model didn't answer. Is Ollama running, with the model pulled?";
  }
  return "Something went wrong.";
}

export const queryClient = new QueryClient({
  defaultOptions: {
    // The nag engine and the vault watcher change data server-side; keep views fresh.
    queries: { refetchInterval: 30_000, refetchOnWindowFocus: true, staleTime: 5_000, retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2 },
  },
});

/** After any write, refresh everything (small app, cheap queries, always consistent). */
export const refreshAll = () => queryClient.invalidateQueries();
