// Safety checks: stay inside the project, skip dependency folders, ignore symlink escapes.
import fs from "node:fs";
import path from "node:path";
import type { Env } from "./types.js";

export const DEFAULT_EXCLUDES = ["node_modules", ".venv", "venv", "vendor", "third_party", ".git", "dist", "build"];

/** Folder names whose AGENTS.md files are never injected (`AGENTSMD_LAZYLOAD_EXCLUDE`, comma separated). */
export function excludedNames(env: Env): string[] {
  const raw = env.AGENTSMD_LAZYLOAD_EXCLUDE;
  if (raw === undefined) return DEFAULT_EXCLUDES;
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return names.length === 0 ? DEFAULT_EXCLUDES : names; // an empty value must not switch dependency exclusion off
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath of the nearest existing ancestor (a new file's folder may not exist yet). */
function realOfNearest(p: string): string | null {
  for (let d = p; ; d = path.dirname(d)) {
    try {
      return fs.realpathSync(d);
    } catch {
      if (path.dirname(d) === d) return null;
    }
  }
}

export interface GuardResult {
  ok: boolean;
  /** Folder to resolve the chain for (when ok). */
  dir?: string;
  /** Why the target was rejected (when not ok). */
  reason?: "outside-root" | "excluded" | "symlink-escape";
  /** The excluded folder name (when reason is "excluded"). */
  excluded?: string;
}

/** Decide whether a target may trigger an injection and which folder to use. */
export function guardTarget(target: string, sessionRoot: string, excludes: string[]): GuardResult {
  const dir = isDirectory(target) ? target : path.dirname(target);
  if (!within(sessionRoot, dir)) return { ok: false, reason: "outside-root" };
  const segments = path.relative(sessionRoot, dir).split(path.sep).filter((s) => s !== "");
  const hit = segments.find((s) => excludes.includes(s));
  if (hit !== undefined) return { ok: false, reason: "excluded", excluded: hit };
  const realRoot = realOfNearest(sessionRoot);
  const realDir = realOfNearest(dir);
  if (realRoot === null || realDir === null || !within(realRoot, realDir)) {
    return { ok: false, reason: "symlink-escape" };
  }
  return { ok: true, dir };
}
