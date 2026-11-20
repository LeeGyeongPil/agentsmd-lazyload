// `explain <path>`: show which AGENTS.md files apply to a path and why.
import fs from "node:fs";
import path from "node:path";
import { sessionConfig } from "./hook.js";
import { excludedNames, guardTarget } from "./guard.js";
import { relDir, relFile, type ExplainReport } from "./render.js";
import { foldersFromRoot, inspectFolder, resolve } from "./resolve.js";
import type { Env } from "./types.js";

/** Build the report for a path (relative paths resolve against `cwd`). Returns null if it does not exist. */
export function buildExplain(target: string, cwd: string, env: Env): ExplainReport | null {
  const abs = path.resolve(cwd, target);
  if (!fs.existsSync(abs)) return null;
  const dir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  const { cfg } = sessionConfig(dir, env);
  const chain = resolve(dir, cfg);
  const guard = guardTarget(abs, chain.root, excludedNames(env));
  const used = chain.entries.reduce((sum, e) => sum + e.bytes, 0);
  return {
    target: abs,
    root: chain.root,
    marker: chain.marker,
    folders: foldersFromRoot(chain.root, dir).map((f) => ({ ...inspectFolder(f, cfg), rel: relDir(chain.root, f) })),
    excluded: guard.reason === "excluded" ? (guard.excluded ?? null) : null,
    budget: {
      max: cfg.maxBytes,
      used,
      truncated: chain.entries.filter((e) => e.truncated).map((e) => relFile(chain.root, e.file)),
      dropped: chain.dropped.map((e) => relFile(chain.root, e.file)),
    },
    injectable: chain.entries.map((e) => relFile(chain.root, e.file)),
  };
}
