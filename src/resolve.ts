// AGENTS.md chain resolution that mirrors Codex's startup rules.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Chain, ChainEntry, CodexDocConfig, FolderReport } from "./types.js";

export const OVERRIDE_NAME = "AGENTS.override.md";
export const DEFAULT_NAME = "AGENTS.md";

/** Names tried in each folder, in priority order. */
export function candidateNames(cfg: CodexDocConfig): string[] {
  const names = [OVERRIDE_NAME, DEFAULT_NAME];
  for (const n of cfg.fallbackNames) if (!names.includes(n)) names.push(n);
  return names;
}

/** Nearest ancestor (inclusive) that contains a root marker; otherwise the folder itself. */
export function findRoot(dir: string, markers: string[]): { root: string; marker: string | null } {
  if (markers.length === 0) return { root: dir, marker: null };
  for (let d = dir; ; d = path.dirname(d)) {
    for (const m of markers) {
      if (fs.existsSync(path.join(d, m))) return { root: d, marker: m };
    }
    if (path.dirname(d) === d) return { root: dir, marker: null };
  }
}

function fileSize(file: string): number | null {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

/** Folders from `root` down to `dir`, root first. */
export function foldersFromRoot(root: string, dir: string): string[] {
  const out: string[] = [];
  for (let d = dir; ; d = path.dirname(d)) {
    out.unshift(d);
    if (d === root || path.dirname(d) === d) break;
  }
  return out;
}

/** Inspect every candidate name of one folder (used by `explain` and by chain building). */
export function inspectFolder(dir: string, cfg: CodexDocConfig): FolderReport {
  const candidates: FolderReport["candidates"] = [];
  let chosen = false;
  for (const name of candidateNames(cfg)) {
    const size = fileSize(path.join(dir, name));
    if (size === null) candidates.push({ name, status: "missing", bytes: 0 });
    else if (size === 0) candidates.push({ name, status: "empty", bytes: 0 });
    else if (chosen) candidates.push({ name, status: "shadowed", bytes: size });
    else {
      chosen = true;
      candidates.push({ name, status: "chosen", bytes: size });
    }
  }
  return { dir, candidates };
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Chain for `dir` with no byte budget applied. */
export function resolveChain(dir: string, cfg: CodexDocConfig): Chain {
  const { root, marker } = findRoot(dir, cfg.rootMarkers);
  const entries: ChainEntry[] = [];
  for (const folder of foldersFromRoot(root, dir)) {
    const chosen = inspectFolder(folder, cfg).candidates.find((c) => c.status === "chosen");
    if (!chosen) continue;
    const file = path.join(folder, chosen.name);
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (buf.length === 0) continue;
    entries.push({
      dir: folder,
      file,
      name: chosen.name,
      content: buf.toString("utf8"),
      bytes: buf.length,
      fullBytes: buf.length,
      sha: sha256(buf),
      truncated: false,
    });
  }
  return { root, marker, entries };
}

/**
 * Apply a byte budget the way Codex does: files are taken root first; the file that crosses the
 * budget is cut to the remaining bytes and flagged; later files are dropped. A budget of 0 gives nothing.
 */
export function applyBudget(entries: ChainEntry[], budget: number): { entries: ChainEntry[]; dropped: ChainEntry[] } {
  let remaining = Math.max(0, budget);
  const kept: ChainEntry[] = [];
  const dropped: ChainEntry[] = [];
  for (const e of entries) {
    if (remaining <= 0) {
      dropped.push(e);
      continue;
    }
    if (e.fullBytes <= remaining) {
      kept.push(e);
      remaining -= e.fullBytes;
      continue;
    }
    const cut = Buffer.from(e.content, "utf8").subarray(0, remaining);
    kept.push({ ...e, content: cut.toString("utf8"), bytes: cut.length, truncated: true });
    remaining = 0;
  }
  return { entries: kept, dropped };
}

/** Full Codex-style chain: resolve, then apply `maxBytes`. */
export function resolve(dir: string, cfg: CodexDocConfig): Chain & { dropped: ChainEntry[] } {
  const chain = resolveChain(dir, cfg);
  const { entries, dropped } = applyBudget(chain.entries, cfg.maxBytes);
  return { ...chain, entries, dropped };
}
