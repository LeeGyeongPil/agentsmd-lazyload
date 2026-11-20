// `install` / `uninstall`: merge our handlers into a Codex hooks.json without touching other entries.
import fs from "node:fs";
import path from "node:path";
import { codexHome, loadUserConfig } from "./config.js";
import { findRoot } from "./resolve.js";
import type { Env } from "./types.js";

export const MATCHER_TOOLS = "^(apply_patch|Bash|mcp__.*)$";
export const MATCHER_SESSION = "compact|clear";
export const EVENTS = ["PreToolUse", "PostToolUse", "SessionStart"] as const;

export type Handler = {
  type: "command";
  command: string;
  timeout: number;
  additionalContextLimit: number;
};
export interface Group {
  matcher?: string;
  hooks: Record<string, unknown>[];
  [key: string]: unknown;
}
export type HooksFile = { hooks?: Record<string, Group[]> } & Record<string, unknown>;

/** Thrown when hooks.json cannot be parsed or has an unexpected shape; the file is left untouched. */
export class HooksFileError extends Error {}

export function matcherFor(event: string): string {
  return event === "SessionStart" ? MATCHER_SESSION : MATCHER_TOOLS;
}

/** The handler we add. additionalContextLimit 0 = no preview cut-off; our own byte budget applies. */
export function makeHandler(command: string): Handler {
  return { type: "command", command, timeout: 10, additionalContextLimit: 0 };
}

/** The entries `install` writes (also the shape of hooks/hooks.json in the plugin bundle). */
export function makeEntries(command: string): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};
  for (const ev of EVENTS) out[ev] = [{ matcher: matcherFor(ev), hooks: [makeHandler(command)] }];
  return out;
}

const PACKAGE_NAME = "agentsmd-lazyload";

/** Name of the package that owns `file` (nearest package.json upwards), or undefined. */
function packageNameOf(file: string): string | undefined {
  for (let d = path.dirname(file), i = 0; i < 6; i++, d = path.dirname(d)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")) as { name?: unknown };
      return typeof pkg.name === "string" ? pkg.name : undefined;
    } catch {
      // no package.json here, keep climbing
    }
    if (path.dirname(d) === d) break;
  }
  return undefined;
}

/** Split a command line into tokens, honouring the JSON-style double quotes `hookCommand` writes. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    if (m[1] !== undefined) {
      try {
        out.push(JSON.parse('"' + m[1] + '"') as string);
      } catch {
        out.push(m[1]);
      }
    } else out.push(m[2] as string);
  }
  return out;
}

/** Node-like runtimes `hookCommand` may write as the first token (process.execPath). */
const RUNTIME_NAME = /^(node|nodejs|bun)(\.exe)?$/i;

/**
 * True for a handler left behind by an absolute install whose checkout was moved or deleted:
 * exactly `<node> "<abs>/dist/cli.js" hook` (the shape `hookCommand` writes) and that cli.js is gone.
 * Such a handler can only fail ("Cannot find module") on every tool call, so install replaces it
 * and uninstall removes it. A path that still exists is never treated as stale.
 */
export function isStaleOurs(handler: Record<string, unknown>): boolean {
  const cmd = handler.command;
  if (typeof cmd !== "string") return false;
  const tokens = tokenize(cmd);
  if (tokens.length !== 3 || tokens[2] !== "hook") return false;
  const [runtime, script] = tokens as [string, string, string];
  if (!RUNTIME_NAME.test(path.basename(runtime))) return false;
  // 우리가 쓰는 모양(<절대경로>/dist/cli.js)만 본다 — 다른 도구의 x.js 등은 건드리지 않는다
  if (!path.isAbsolute(script) || path.basename(script) !== "cli.js" || path.basename(path.dirname(script)) !== "dist") return false;
  return !fs.existsSync(script);
}

/**
 * True for handlers created by this tool. Recognised by shape, not by folder name: the bare
 * `agentsmd-lazyload hook`, `<node> "<this cli.js>" hook`, an absolute cli.js whose package.json
 * says it is agentsmd-lazyload (an install made from another location), or an absolute
 * `<node> "<abs>/dist/cli.js" hook` whose cli.js no longer exists (see isStaleOurs). `cliPath` is this cli.js.
 */
export function isOurs(handler: Record<string, unknown>, cliPath = ""): boolean {
  const cmd = handler.command;
  if (typeof cmd !== "string") return false;
  const tokens = tokenize(cmd);
  if (tokens.length < 2 || tokens[tokens.length - 1] !== "hook") return false;
  if (tokens.length === 2 && path.basename(tokens[0] as string) === PACKAGE_NAME) return true;
  const script = tokens[tokens.length - 2] as string;
  if (cliPath !== "" && path.resolve(script) === path.resolve(cliPath)) return true;
  if (path.isAbsolute(script) && packageNameOf(script) === PACKAGE_NAME) return true;
  // 옛 클론을 지운 뒤에는 package.json 도 없다 — 모양이 같고 파일이 사라진 항목도 우리 것으로 본다
  return isStaleOurs(handler);
}

function onPath(name: string, env: Env): boolean {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/** Command string for hooks.json: the bare name when it is on PATH, else an absolute node invocation. */
export function hookCommand(env: Env, cliPath: string): { command: string; absolute: boolean } {
  if (onPath("agentsmd-lazyload", env)) return { command: "agentsmd-lazyload hook", absolute: false };
  return { command: JSON.stringify(process.execPath) + " " + JSON.stringify(cliPath) + " hook", absolute: true };
}

/** Where hooks.json lives: `<project root>/.codex/hooks.json` for --project (root found like Codex does, from cwd upwards), else `$CODEX_HOME/hooks.json`. */
export function hooksPath(project: boolean, cwd: string, env: Env): string {
  return project ? path.join(findRoot(cwd, loadUserConfig(env).rootMarkers).root, ".codex", "hooks.json") : path.join(codexHome(env), "hooks.json");
}

/** Read hooks.json. Missing file gives an empty config; broken JSON or a wrong shape throws. */
export function readHooksFile(file: string): HooksFile {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new HooksFileError("cannot read " + file + ": " + (err as Error).message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new HooksFileError("invalid JSON in " + file + ": " + (err as Error).message);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HooksFileError(file + " must contain a JSON object");
  }
  const cfg = parsed as HooksFile;
  if (cfg.hooks !== undefined) {
    const h = cfg.hooks as unknown;
    if (typeof h !== "object" || h === null || Array.isArray(h)) throw new HooksFileError(file + ': "hooks" must be an object');
    for (const [ev, groups] of Object.entries(h as Record<string, unknown>)) {
      if (!Array.isArray(groups)) throw new HooksFileError(file + ': "hooks.' + ev + '" must be an array');
      for (const g of groups) {
        if (typeof g !== "object" || g === null || !Array.isArray((g as Group).hooks)) {
          throw new HooksFileError(file + ': every entry of "hooks.' + ev + '" needs a "hooks" array');
        }
      }
    }
  }
  return cfg;
}

export interface MergeResult {
  config: HooksFile;
  added: string[];
  updated: string[];
  /** Events whose handler pointed at a cli.js that no longer exists (subset of `updated`). */
  replacedStale: string[];
  unchanged: string[];
}

/** Pure merge: returns a new config with exactly one handler of ours per event. */
export function mergeHooks(existing: HooksFile, command: string, cliPath = ""): MergeResult {
  const config: HooksFile = structuredClone(existing);
  const hooks = (config.hooks ??= {});
  const result: MergeResult = { config, added: [], updated: [], replacedStale: [], unchanged: [] };
  const wanted = makeHandler(command);
  for (const ev of EVENTS) {
    const groups = (hooks[ev] ??= []);
    let found = false;
    let changed = false; // 우리 핸들러를 고치거나 중복·옛 경로 항목을 지웠으면 true
    let stale = false; // 사라진 cli.js 를 가리키던 항목을 정리했으면 true
    for (const g of groups) {
      for (let i = 0; i < g.hooks.length; i++) {
        const h = g.hooks[i] as Record<string, unknown>;
        if (!isOurs(h, cliPath)) continue;
        if (isStaleOurs(h)) stale = true;
        if (found) {
          g.hooks.splice(i--, 1); // keep only one handler of ours per event
          changed = true;
          continue;
        }
        found = true;
        const same = JSON.stringify(h) === JSON.stringify(wanted) && g.matcher === matcherFor(ev);
        if (!same) {
          g.hooks[i] = { ...h, ...wanted };
          g.matcher = matcherFor(ev);
          changed = true;
        }
      }
    }
    if (!found) {
      groups.push({ matcher: matcherFor(ev), hooks: [wanted as unknown as Record<string, unknown>] });
      result.added.push(ev);
    } else if (changed) {
      result.updated.push(ev);
      if (stale) result.replacedStale.push(ev);
    } else result.unchanged.push(ev);
    hooks[ev] = groups.filter((g) => g.hooks.length > 0);
  }
  return result;
}

/** Pure removal: drops our handlers (and groups or events left empty). */
export function removeHooks(existing: HooksFile, cliPath = ""): { config: HooksFile; removed: number; stale: number } {
  const config: HooksFile = structuredClone(existing);
  let removed = 0;
  let stale = 0;
  if (config.hooks) {
    for (const ev of Object.keys(config.hooks)) {
      const groups = config.hooks[ev] as Group[];
      for (const g of groups) {
        const before = g.hooks.length;
        stale += g.hooks.filter((h) => isStaleOurs(h)).length;
        g.hooks = g.hooks.filter((h) => !isOurs(h, cliPath));
        removed += before - g.hooks.length;
      }
      const left = groups.filter((g) => g.hooks.length > 0);
      if (left.length > 0) config.hooks[ev] = left;
      else delete config.hooks[ev];
    }
    if (Object.keys(config.hooks).length === 0) delete config.hooks;
  }
  return { config, removed, stale };
}

export function serialize(config: HooksFile): string {
  return JSON.stringify(config, null, 2) + "\n";
}

export function writeHooksFile(file: string, config: HooksFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, serialize(config));
  fs.renameSync(tmp, file);
}
