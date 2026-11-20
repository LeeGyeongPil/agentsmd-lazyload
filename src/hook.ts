// The hook entry point: one Codex hook input in, at most one hook output out.
import path from "node:path";
import { loadUserConfig, overlayProjectConfig } from "./config.js";
import { extractTargets } from "./extract.js";
import { excludedNames, guardTarget } from "./guard.js";
import { resolveLang } from "./i18n.js";
import { renderContext, renderNotice, type Injected } from "./render.js";
import { applyBudget, findRoot, resolve, resolveChain } from "./resolve.js";
import { deleteState, loadState, saveState, usedBytes, type SessionState } from "./state.js";
import type { ChainEntry, CodexDocConfig, Env, HookInput } from "./types.js";

/** What we print on stdout: only the keys Codex's output schema allows. */
export interface HookOutput {
  systemMessage: string;
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

/** Raised for input we do not handle; the caller turns it into a one-line stderr message. */
export class HookInputError extends Error {}

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

function validate(raw: unknown): HookInput {
  if (typeof raw !== "object" || raw === null) throw new HookInputError("hook input must be a JSON object");
  const input = raw as HookInput;
  if (typeof input.hook_event_name !== "string") throw new HookInputError("missing hook_event_name");
  if (!TOOL_EVENTS.has(input.hook_event_name) && input.hook_event_name !== "SessionStart") {
    throw new HookInputError("unsupported hook event: " + input.hook_event_name);
  }
  if (typeof input.session_id !== "string" || input.session_id === "") throw new HookInputError("missing session_id");
  if (typeof input.cwd !== "string" || !path.isAbsolute(input.cwd)) throw new HookInputError("cwd must be an absolute path");
  return input;
}

/** Config for a session: user config, then project configs from the root down to cwd. */
export function sessionConfig(cwd: string, env: Env): { cfg: CodexDocConfig; root: string } {
  const user = loadUserConfig(env);
  const firstRoot = findRoot(cwd, user.rootMarkers).root;
  const cfg = overlayProjectConfig(user, firstRoot, cwd);
  return { cfg, root: findRoot(cwd, cfg.rootMarkers).root };
}

/** The chain Codex itself loaded at session start, recorded as "already in context". */
function initialState(cwd: string, cfg: CodexDocConfig): SessionState {
  const startup = resolve(cwd, cfg).entries;
  return {
    version: 1,
    cwd,
    files: startup.map((e) => ({ path: e.file, sha: e.sha, bytes: e.bytes, startup: true })),
  };
}

/** Put chosen entries into the state, replacing older records of the same file. */
function record(state: SessionState, kept: ChainEntry[], dropped: ChainEntry[]): void {
  const touched = new Set([...kept, ...dropped].map((e) => e.file));
  state.files = state.files.filter((f) => !touched.has(f.path));
  for (const e of kept) state.files.push({ path: e.file, sha: e.sha, bytes: e.bytes, startup: false });
  for (const e of dropped) state.files.push({ path: e.file, sha: e.sha, bytes: 0, startup: false });
}

function output(event: string, message: string, context: string): HookOutput {
  return { systemMessage: message, hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

/** PreToolUse / PostToolUse: inject chain files of the touched folders that are new or changed. */
function onToolCall(input: HookInput, env: Env): HookOutput | null {
  const { cfg, root } = sessionConfig(input.cwd, env);
  const state = loadState(env, input.session_id) ?? initialState(input.cwd, cfg);

  const excludes = excludedNames(env);
  const dirs: string[] = [];
  for (const target of extractTargets(input)) {
    const g = guardTarget(target, root, excludes);
    if (g.ok && g.dir !== undefined && !dirs.includes(g.dir)) dirs.push(g.dir);
  }

  // Collect files that are not in context yet (or changed since), root-most first.
  const pending: Injected[] = [];
  for (const dir of dirs) {
    for (const entry of resolveChain(dir, cfg).entries) {
      const known = state.files.find((f) => f.path === entry.file);
      if (known && known.sha === entry.sha) continue;
      if (pending.some((p) => p.entry.file === entry.file)) continue;
      pending.push({ entry, updated: known !== undefined });
    }
  }
  if (pending.length === 0) {
    saveState(env, input.session_id, state);
    return null;
  }

  const replaced = new Set(pending.map((p) => p.entry.file));
  const remaining = cfg.maxBytes - usedBytes(state, replaced);
  const { entries: kept, dropped } = applyBudget(pending.map((p) => p.entry), remaining);
  record(state, kept, dropped);
  saveState(env, input.session_id, state);

  const items = pending.filter((p) => kept.some((k) => k.file === p.entry.file)).map((p) => ({
    entry: kept.find((k) => k.file === p.entry.file) as ChainEntry,
    updated: p.updated,
  }));
  if (items.length === 0 && dropped.length === 0) return null;
  const lang = resolveLang(undefined, env);
  const context = renderContext(
    root,
    items,
    dropped,
    "Nested AGENTS.md instructions apply to the files this tool call touches",
  );
  return output(input.hook_event_name, renderNotice(lang, root, items, dropped), context);
}

/** SessionStart: after a compaction put every lazily injected file back; on clear forget the session. */
function onSessionStart(input: HookInput, env: Env): HookOutput | null {
  if (input.source === "clear") {
    deleteState(env, input.session_id);
    return null;
  }
  if (input.source !== "compact") return null;
  const state = loadState(env, input.session_id);
  if (state === null) return null;
  const { cfg, root } = sessionConfig(input.cwd, env);

  const lazy = state.files.filter((f) => !f.startup && f.bytes > 0);
  const startupBytes = state.files.filter((f) => f.startup).reduce((s, f) => s + f.bytes, 0);
  const fresh: ChainEntry[] = [];
  for (const f of lazy) {
    const dir = path.dirname(f.path);
    const entry = resolveChain(dir, cfg).entries.find((e) => e.file === f.path);
    if (entry) fresh.push(entry);
  }
  if (fresh.length === 0) return null;
  const { entries: kept, dropped } = applyBudget(fresh, cfg.maxBytes - startupBytes);
  state.files = state.files.filter((f) => f.startup);
  record(state, kept, dropped);
  saveState(env, input.session_id, state);

  const items: Injected[] = kept.map((entry) => ({ entry, updated: false }));
  if (items.length === 0) return null;
  const lang = resolveLang(undefined, env);
  const context = renderContext(root, items, dropped, "Restoring nested AGENTS.md instructions after context compaction");
  return output("SessionStart", renderNotice(lang, root, items, dropped), context);
}

/** Handle one parsed hook input. Returns the output object or null for "print nothing". */
export function handleHook(raw: unknown, env: Env): HookOutput | null {
  if (env.AGENTSMD_LAZYLOAD_DISABLE === "1") return null;
  const input = validate(raw);
  return input.hook_event_name === "SessionStart" ? onSessionStart(input, env) : onToolCall(input, env);
}

/**
 * Run the hook on raw stdin text. Fail-open: any problem becomes exit code 0, empty stdout and one
 * stderr line, so a hook bug can never block Codex.
 */
export function runHook(stdin: string, env: Env): { stdout: string; stderr: string; code: number } {
  if (env.AGENTSMD_LAZYLOAD_DISABLE === "1") return { stdout: "", stderr: "", code: 0 };
  try {
    const out = handleHook(JSON.parse(stdin) as unknown, env);
    return { stdout: out ? JSON.stringify(out) + "\n" : "", stderr: "", code: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: "", stderr: "agentsmd-lazyload: ignored hook input (" + msg.split("\n")[0] + ")\n", code: 0 };
  }
}
