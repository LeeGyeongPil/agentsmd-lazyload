// Find the file and folder paths a tool call is about to touch.
import fs from "node:fs";
import path from "node:path";
import { splitCommands, tokenize, type Command } from "./shell.js";
import type { HookInput } from "./types.js";

/** Upper bound on targets per call, so a huge command cannot make the hook slow. */
export const MAX_TARGETS = 64;

const MCP_PATH_KEYS = ["path", "file_path", "filePath", "paths", "source", "destination", "target", "dir", "directory"];
const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveFrom(base: string, p: string): string {
  return path.resolve(base, p);
}

/** Paths from apply_patch headers (`*** Add File:`, `Update File:`, `Delete File:`, `Move to:`). */
export function extractPatchPaths(patch: string, cwd: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(PATCH_HEADER)) {
    const p = (m[1] ?? "").trim();
    if (p !== "") out.push(resolveFrom(cwd, p));
  }
  return out;
}

/** Paths from path-like keys of an MCP tool's arguments. Files need not exist yet. */
export function extractMcpPaths(args: unknown, cwd: string): string[] {
  if (typeof args !== "object" || args === null) return [];
  const rec = args as Record<string, unknown>;
  const out: string[] = [];
  for (const key of MCP_PATH_KEYS) {
    const v = rec[key];
    const list = Array.isArray(v) ? v : [v];
    for (const item of list) if (typeof item === "string" && item !== "") out.push(resolveFrom(cwd, item));
  }
  return out;
}

/** Walk one command; returns the folder later commands of the same line run in. */
function walkCommand(cmd: Command, base: string, found: string[], depth: number): string {
  const words = cmd.words;
  const head = words[0];
  let nextBase = base;
  let argBase = base;
  let start = 1;

  if (head !== undefined && (head === "cd" || head === "pushd")) {
    const target = words.find((w, i) => i > 0 && !w.startsWith("-"));
    if (target !== undefined) {
      const dir = resolveFrom(base, target);
      if (isDir(dir)) {
        found.push(dir);
        nextBase = dir;
      }
    }
    start = words.length;
  } else if (head === "git") {
    // git -C <dir> <subcommand> ...: arguments resolve against <dir>.
    for (let i = 1; i < words.length; i++) {
      if (words[i] === "-C" && words[i + 1] !== undefined) {
        const dir = resolveFrom(argBase, words[i + 1] as string);
        found.push(dir);
        argBase = dir;
        i++;
      }
    }
  } else if (head !== undefined && SHELLS.has(path.basename(head)) && depth === 0) {
    // bash -lc '<script>': unwrap one level.
    const idx = words.findIndex((w, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w));
    const script = idx >= 0 ? words[idx + 1] : undefined;
    if (script !== undefined) {
      try {
        let inner = base;
        for (const c of splitCommands(tokenize(script))) inner = walkCommand(c, inner, found, depth + 1);
      } catch {
        // an unparsable inner script is ignored
      }
      start = words.length;
    }
  }

  for (let i = start; i < words.length; i++) {
    const w = words[i] as string;
    if (w === "" || w.startsWith("-") || w.startsWith("$") || w.startsWith("~")) continue;
    const abs = resolveFrom(argBase, w);
    if (fs.existsSync(abs)) found.push(abs);
  }
  // A path-like command word such as ./scripts/run.sh counts as well.
  if (head !== undefined && head.includes("/")) {
    const abs = resolveFrom(base, head);
    if (fs.existsSync(abs)) found.push(abs);
  }
  for (const target of cmd.redirectTargets) {
    if (target === "" || target.startsWith("&") || target.startsWith("$")) continue;
    const abs = resolveFrom(base, target);
    if (isDir(path.dirname(abs))) found.push(abs);
  }
  return nextBase;
}

/** Paths from a shell command line: cd, pushd, git -C, bash -lc, &&, ;, |, redirects. */
export function extractShellPaths(command: string, cwd: string): string[] {
  const found: string[] = [];
  let base = cwd;
  for (const cmd of splitCommands(tokenize(command))) base = walkCommand(cmd, base, found, 0);
  return found;
}

/** Targets of one hook input, absolute, de-duplicated, at most MAX_TARGETS. Never throws. */
export function extractTargets(input: HookInput): string[] {
  const cwd = input.cwd;
  const tool = input.tool_name ?? "";
  const ti = input.tool_input;
  let raw: string[] = [];
  try {
    if (tool === "apply_patch" || tool === "Edit" || tool === "Write") {
      const text =
        typeof ti === "string"
          ? ti
          : typeof (ti as { command?: unknown } | null)?.command === "string"
            ? ((ti as { command: string }).command)
            : "";
      raw = extractPatchPaths(text, cwd);
      if (raw.length === 0 && typeof ti === "object" && ti !== null) raw = extractMcpPaths(ti, cwd);
    } else if (tool === "Bash") {
      const cmd = typeof ti === "string" ? ti : (ti as { command?: unknown } | null)?.command;
      if (typeof cmd === "string") raw = extractShellPaths(cmd, cwd);
    } else if (tool.startsWith("mcp__")) {
      raw = extractMcpPaths(ti, cwd);
    }
  } catch {
    raw = [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}
