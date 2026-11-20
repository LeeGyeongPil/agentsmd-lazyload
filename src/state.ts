// Per-session record of which instruction files were already injected.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Env } from "./types.js";

export interface InjectedFile {
  /** Absolute path. */
  path: string;
  sha: string;
  /** Bytes counted against the budget (0 when the file was skipped for lack of budget). */
  bytes: number;
  /** True for files Codex itself loaded at startup. */
  startup: boolean;
}

export interface SessionState {
  version: 1;
  cwd: string;
  files: InjectedFile[];
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where session files live: PLUGIN_DATA > AGENTSMD_LAZYLOAD_STATE_DIR > XDG state > ~/.local/state. */
export function stateDir(env: Env): string {
  if (env.PLUGIN_DATA) return env.PLUGIN_DATA;
  if (env.AGENTSMD_LAZYLOAD_STATE_DIR) return env.AGENTSMD_LAZYLOAD_STATE_DIR;
  const base = env.XDG_STATE_HOME ? env.XDG_STATE_HOME : path.join(os.homedir(), ".local", "state");
  return path.join(base, "agentsmd-lazyload");
}

/** Session ids become file names, so anything unusual is hashed. */
export function statePath(env: Env, sessionId: string): string {
  const safe = /^[A-Za-z0-9_-]{1,100}$/.test(sessionId)
    ? sessionId
    : crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return path.join(stateDir(env), "session-" + safe + ".json");
}

export function loadState(env: Env, sessionId: string): SessionState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(env, sessionId), "utf8")) as SessionState;
    if (parsed.version !== 1 || !Array.isArray(parsed.files) || typeof parsed.cwd !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic write: temp file in the same folder, then rename. Also drops stale session files. */
export function saveState(env: Env, sessionId: string, state: SessionState): void {
  const file = statePath(env, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
  pruneOld(path.dirname(file), file);
}

export function deleteState(env: Env, sessionId: string): void {
  fs.rmSync(statePath(env, sessionId), { force: true });
}

/** Remove session files untouched for more than 7 days (best effort). */
function pruneOld(dir: string, keep: string): void {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!/^session-.*\.json$/.test(name)) continue;
      const p = path.join(dir, name);
      if (p === keep) continue;
      if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.rmSync(p, { force: true });
    }
  } catch {
    // cleanup must never break a hook call
  }
}

export function usedBytes(state: SessionState, exceptPaths: Set<string> = new Set()): number {
  return state.files.filter((f) => !exceptPaths.has(f.path)).reduce((sum, f) => sum + f.bytes, 0);
}
