// Text builders: injected context, user notices, explain output.
import path from "node:path";
import { t, type Lang } from "./i18n.js";
import type { ChainEntry, FolderReport } from "./types.js";

export interface Injected {
  entry: ChainEntry;
  /** True when the file was injected before and its content changed. */
  updated: boolean;
}

/** Folder of a path relative to the session root, with forward slashes ("." for the root). */
export function relDir(root: string, dir: string): string {
  const rel = path.relative(root, dir).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

export function relFile(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * The text added to the model context. The header mimics how Codex presents its own startup
 * AGENTS.md chain. It stays in English because the reader is the model, not the user.
 */
export function renderContext(root: string, items: Injected[], skipped: ChainEntry[], reason: string): string {
  const blocks = items.map(({ entry, updated }) => {
    const rel = relDir(root, entry.dir);
    const scope = rel === "." ? "the whole project" : "files under " + rel + "/";
    const lines = [
      "# AGENTS.md instructions for " + rel,
      "",
      "Applies to " + scope + ". Deeper AGENTS.md files override shallower ones." +
        (updated ? " (updated since it was last injected)" : ""),
      "",
      "<INSTRUCTIONS>",
      entry.content.replace(/\n$/, ""),
      "</INSTRUCTIONS>",
    ];
    if (entry.truncated) lines.push("", "Note: this file was truncated to fit the project_doc_max_bytes budget.");
    return lines.join("\n");
  });
  const head = reason + " (deeper files override shallower ones):";
  const tail =
    skipped.length > 0
      ? "\n\nNot injected because the project_doc_max_bytes budget is used up: " +
        skipped.map((e) => relFile(root, e.file)).join(", ")
      : "";
  return head + "\n\n" + blocks.join("\n\n") + tail;
}

/** The short notice Codex shows to the user. */
export function renderNotice(lang: Lang, root: string, items: Injected[], skipped: ChainEntry[]): string {
  const parts = items.map(({ entry, updated }) => (updated ? "~" : "+") + relFile(root, entry.file));
  const extras: string[] = [];
  const cut = items.filter((i) => i.entry.truncated).map((i) => relFile(root, i.entry.file));
  if (cut.length > 0) extras.push(t(lang, "hook.truncated", { files: cut.join(", ") }));
  if (skipped.length > 0) {
    extras.push(t(lang, "hook.skipped", { files: skipped.map((e) => relFile(root, e.file)).join(", ") }));
  }
  const changes = parts.join(", ") + (extras.length > 0 ? " (" + extras.join("; ") + ")" : "");
  return t(lang, "hook.notice", { changes });
}

export interface ExplainReport {
  target: string;
  root: string;
  marker: string | null;
  folders: (FolderReport & { rel: string })[];
  excluded: string | null;
  budget: { max: number; used: number; truncated: string[]; dropped: string[] };
  injectable: string[];
}

/** Human-readable explain output in the chosen language. */
export function renderExplain(lang: Lang, r: ExplainReport): string {
  const lines: string[] = [];
  lines.push(t(lang, "explain.target", { path: r.target }));
  lines.push(
    r.marker === null
      ? t(lang, "explain.root.nomarker", { root: r.root })
      : t(lang, "explain.root", { root: r.root, marker: r.marker }),
  );
  if (r.excluded !== null) lines.push(t(lang, "explain.excluded", { name: r.excluded }));
  for (const f of r.folders) {
    lines.push("", f.rel + "/");
    for (const c of f.candidates) {
      if (c.status === "missing") continue;
      const detail =
        c.status === "chosen"
          ? t(lang, "explain.chosen")
          : c.status === "shadowed"
            ? t(lang, "explain.shadowed")
            : t(lang, "explain.empty");
      lines.push("  " + c.name.padEnd(22) + " " + String(c.bytes).padStart(6) + " B  " + detail);
    }
    if (f.candidates.every((c) => c.status === "missing")) lines.push("  " + t(lang, "explain.none"));
  }
  lines.push("", t(lang, "explain.budget", { used: r.budget.used, max: r.budget.max }));
  for (const f of r.budget.truncated) lines.push(t(lang, "explain.truncated", { file: f }));
  for (const f of r.budget.dropped) lines.push(t(lang, "explain.dropped", { file: f }));
  return lines.join("\n");
}
