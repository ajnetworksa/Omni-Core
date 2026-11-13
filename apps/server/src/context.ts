import { SETTINGS, SettingsStore } from "./settings.js";
import {
  AiClient,
  SemanticIndex,
  DEFAULT_NAG_CONFIG,
  openDatabase,
  parseHHMMRange,
  TaskService,
  Vault,
  VaultIndexer,
  type DB,
  type NagConfig,
} from "@omnicore/core";
import { aiSettings, type Config } from "./config.js";

export interface AppContext {
  config: Config;
  db: DB;
  vault: Vault;
  indexer: VaultIndexer;
  tasks: TaskService;
  nag: NagConfig;
  ai: AiClient;
  /** Present when a local embedding model is configured and the index is enabled. */
  semantic?: SemanticIndex;
  /** Settings changed in the app (override .env). */
  settings: SettingsStore;
  /** Effective value of each setting when this process started (to show "waiting for restart"). */
  appliedSettings: Record<string, string>;
}

export function createContext(config: Config): AppContext {
  const db = openDatabase(config.DATABASE_PATH, { allowExtensions: true });
  const vault = new Vault(config.VAULT_PATH);
  const indexer = new VaultIndexer(db, vault, { writeAnchors: config.TASK_ANCHORS });
  const tasks = new TaskService(db, indexer, {
    timeZone: config.TIMEZONE,
    writeDoneDate: config.TASK_DONE_DATE,
    weekendDays: config.WEEKEND_DAYS,
  });
  const nag: NagConfig = {
    ...DEFAULT_NAG_CONFIG,
    timeZone: config.TIMEZONE,
    defaultDueTime: config.NAG_DEFAULT_DUE_TIME,
    intervalsMin: config.NAG_INTERVALS,
    quietHours: parseHHMMRange(config.NAG_QUIET_HOURS),
    maxPerTick: config.NAG_MAX_PER_TICK,
  };
  const ai = new AiClient(aiSettings(config));
  const semantic =
    ai.canEmbed && config.AI_EMBED_INTERVAL_SECONDS > 0
      ? new SemanticIndex(db, ai, config.TIMEZONE, { vector: config.AI_VECTOR_ENGINE })
      : undefined;
  if (!semantic) {
    // Extensions are only needed for sqlite-vec; switch the loader off when it isn't used.
    try {
      (db.$client.native as unknown as { enableLoadExtension(on: boolean): void }).enableLoadExtension(false);
    } catch {
      /* ignore */
    }
  }
  const settings = new SettingsStore(db, process.env);
  const appliedSettings = Object.fromEntries(SETTINGS.map((d) => [d.key, settings.get(d.key)]));
  return { config, db, vault, indexer, tasks, nag, ai, semantic, settings, appliedSettings };
}
