// Reads the three Codex config.toml keys that change AGENTS.md discovery.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import type { CodexDocConfig, Env } from "./types.js";

export const DEFAULT_CONFIG: CodexDocConfig = {
  maxBytes: 32768,
  fallbackNames: [],
  rootMarkers: [".git"],
};

/** Folder that holds Codex's user config (`CODEX_HOME`, default `~/.codex`). */
export function codexHome(env: Env): string {
  return env.CODEX_HOME && env.CODEX_HOME !== "" ? env.CODEX_HOME : path.join(os.homedir(), ".codex");
}

/** Apply the recognised keys of one parsed TOML table onto a config. Wrong types are ignored. */
function applyTable(base: CodexDocConfig, table: Record<string, unknown>): CodexDocConfig {
  const out: CodexDocConfig = { ...base };
  const max = table.project_doc_max_bytes;
  if (typeof max === "number" && Number.isFinite(max) && max >= 0) out.maxBytes = Math.floor(max);
  const fb = table.project_doc_fallback_filenames;
  if (Array.isArray(fb) && fb.every((x) => typeof x === "string")) {
    out.fallbackNames = (fb as string[]).filter((x) => x !== "");
  }
  const markers = table.project_root_markers;
  if (Array.isArray(markers) && markers.every((x) => typeof x === "string")) {
    out.rootMarkers = markers as string[];
  }
  return out;
}

/** Read one config.toml. A missing or broken file leaves the config unchanged. */
export function readConfigFile(file: string, base: CodexDocConfig): CodexDocConfig {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return base;
  }
  try {
    return applyTable(base, parse(text) as Record<string, unknown>);
  } catch {
    return base;
  }
}

/** Read the user-level config only. */
export function loadUserConfig(env: Env): CodexDocConfig {
  return readConfigFile(path.join(codexHome(env), "config.toml"), DEFAULT_CONFIG);
}

/**
 * Overlay project configs on top of a base: `<dir>/.codex/config.toml` for every folder from the
 * project root down to `cwd` (deeper files win), like Codex's layered project config.
 */
export function overlayProjectConfig(base: CodexDocConfig, root: string, cwd: string): CodexDocConfig {
  const dirs: string[] = [];
  for (let d = cwd; ; d = path.dirname(d)) {
    dirs.unshift(d);
    if (d === root || path.dirname(d) === d) break;
  }
  let cfg = base;
  for (const d of dirs) cfg = readConfigFile(path.join(d, ".codex", "config.toml"), cfg);
  return cfg;
}
