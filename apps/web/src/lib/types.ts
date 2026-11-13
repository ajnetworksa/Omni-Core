export type TaskStatus = "backlog" | "ready" | "in_progress" | "blocked" | "done" | "cancelled";
export type NagState = "overdue" | "partial" | "remark";
export type TaskAction = "done" | "start" | "p25" | "p50" | "p75" | "snooze1h" | "tomorrow" | "mute" | "reopen";

export interface Remark { at: string; text: string; source: string }

export interface TaskCard {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  tags: string[];
  rolloverCount: number;
  remarks: Remark[];
  pinned: boolean;
  progress: number;
  snoozedUntil: string | null;
  recurrence: string | null;
  anchor: string | null;
  noteId: string | null;
  projectId: string | null;
  parentTaskId: string | null;
  completedAt: string | null;
  projectTitle: string | null;
  projectSlug: string | null;
  notePath: string | null;
  sub: { done: number; total: number };
  lastRemark: Remark | null;
  nag: { state: NagState; dueAt: string; nextAt: string | null; intervalMin: number; sent: number; snoozedUntil: string | null } | null;
}

export interface TaskDetail extends TaskCard {
  children: TaskCard[];
  reminders: { sentAt: string; state: string; ackAt: string | null; channel: string }[];
  parent: { id: string; title: string } | null;
  sourceLine: number | null;
  rawLine: string | null;
}

export interface TodayBoard {
  date: string;
  dailyNotePath: string;
  attention: TaskCard[];
  later: TaskCard[];
  pinned: TaskCard[];
  done: TaskCard[];
  counts: { open: number; done: number };
}

export interface Project { id: string; title: string; slug: string; total: number; done: number; blocked: number; overdue: number; dueToday: number; percent: number }
export interface ProjectDetail extends Project { openTasks: TaskCard[]; doneTasks: TaskCard[] }
export interface NoteListItem { id: string; title: string; path: string; updatedAt: string }
export interface NoteDetail extends NoteListItem {
  content: string;
  checksum: string;
  frontmatter: Record<string, unknown>;
  backlinks: { id: string; title: string; path: string }[];
  outgoing: { title: string; heading: string | null; targetId: string | null }[];
  tasks: TaskCard[];
}
export interface Parsed { title: string; priority: number | null; dueDate: string | null; dueTime: string | null; recurrence: string | null; project: string | null; tags: string[] }
export interface GraphData { nodes: { id: string; title: string; path: string; orphan: boolean }[]; edges: { source: string; target: string }[]; dangling: { source: string; targetTitle: string }[] }

export interface AiStatus {
  enabled: boolean;
  local?: { provider: string; chatModel: string; embedModel: string; visionModel?: string };
  cloud?: { provider: string; model: string; mode: "fallback" | "prefer" };
  speechToText: boolean;
  vision: boolean;
  index: { engine: string; chunks: number; model: string | null; health: { failures: number; lastError: string | null; retryAt: string | null }; lastSync: { at: string; error?: string } | null } | null;
  features: { ask: boolean; breakdown: boolean; summaries: boolean; voice: boolean; photos: boolean; localReachable: boolean | null };
}
export interface AskSource { n: number; kind: "note" | "task"; title: string; path: string | null; noteId: string | null; taskId: string | null; heading: string | null; day: string | null; snippet: string }
export interface AskResult { answer: string; sources: AskSource[]; cited: number[]; provider: string; model: string; timeRange: string | null }

export interface VersionInfo {
  version: string;
  sha: string | null;
  builtAt: string | null;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  updateAvailable: boolean;
  updateCommand: string;
}

export interface Prefs {
  name: string;
  theme: "light" | "dark" | "auto";
  accent: "blue" | "teal" | "violet" | "pink";
  startScreen: "today" | "upcoming" | "projects";
  weekStart: "sat" | "sun" | "mon";
  timeFormat: "24h" | "12h";
  pausedUntil: string | null;
}
export interface SettingItem {
  key: string;
  label: string;
  help: string;
  type: "text" | "time" | "optional-time" | "timezone" | "select" | "minutes" | "quiet-hours" | "weekdays";
  options?: { value: string; label: string }[];
  value: string;
  source: "app" | "env" | "default";
  restart: boolean;
  pending: boolean;
}
export interface SettingsPage {
  groups: { id: string; title: string; items: SettingItem[] }[];
  timezones: string[];
  canRestart: boolean;
}
export interface SystemInfo {
  version: VersionInfo;
  updateCommand: string;
  telegram: { status: string; miniApp: boolean };
  ai: { ask: boolean; model: string | null } & Record<string, unknown>;
  counts: { tasks: number; done: number; notes: number; projects: number };
  backups: { name: string; bytes: number; at: string }[];
  docker: boolean;
}
