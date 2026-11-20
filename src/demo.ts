// `demo`: replay six hook inputs on a throwaway monorepo. The hook logic is the real one;
// only the Codex session and the model are replaced by these canned inputs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleHook } from "./hook.js";
import { makeCodexHome, makeFixtureRepo } from "./fixture.js";
import { t, type Lang, type MessageKey } from "./i18n.js";
import { resolve } from "./resolve.js";
import { loadUserConfig } from "./config.js";
import type { Env } from "./types.js";

interface Step {
  n: number;
  /** Fields of the hook input that differ per step. */
  input: Record<string, unknown>;
  /** Folders (relative to the repo) whose AGENTS.md we expect to be injected. */
  expectDirs: string[];
}

const STEPS: Step[] = [
  {
    n: 1,
    input: {
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: packages/api/src/h.ts\n@@\n-export const h = 1;\n+export const h = 2;\n*** End Patch\n" },
    },
    expectDirs: ["packages/api"],
  },
  {
    n: 2,
    input: {
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: packages/api/src/h.ts\n@@\n-export const h = 2;\n+export const h = 3;\n*** End Patch\n" },
    },
    expectDirs: [],
  },
  {
    n: 3,
    input: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cd packages/web && cat src/app.ts" } },
    expectDirs: ["packages/web"],
  },
  {
    n: 4,
    input: {
      hook_event_name: "PreToolUse",
      tool_name: "mcp__filesystem__read_file",
      tool_input: { path: "packages/legacy/src/old.ts" },
    },
    expectDirs: ["packages/legacy"],
  },
  {
    n: 5,
    input: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat node_modules/dep/AGENTS.md" } },
    expectDirs: [],
  },
  {
    n: 6,
    input: { hook_event_name: "SessionStart", source: "compact" },
    expectDirs: ["packages/api", "packages/web", "packages/legacy"],
  },
];

function headings(context: string): string[] {
  return [...context.matchAll(/^# AGENTS\.md instructions for (.+)$/gm)].map((m) => m[1] as string);
}

/** Run the demo. Returns the lines to print and whether all steps matched. */
export function runDemo(lang: Lang, baseEnv: Env): { lines: string[]; ok: boolean } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentsmd-lazyload-demo-"));
  try {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    makeFixtureRepo(repo);
    makeCodexHome(path.join(tmp, "codex-home"));
    const env: Env = {
      PATH: baseEnv.PATH,
      CODEX_HOME: path.join(tmp, "codex-home"),
      AGENTSMD_LAZYLOAD_STATE_DIR: path.join(tmp, "state"),
      AGENTSMD_LAZYLOAD_LANG: lang,
    };
    const startup = resolve(repo, loadUserConfig(env)).entries.map((e) => path.relative(repo, e.file));
    const lines: string[] = [t(lang, "demo.header"), t(lang, "demo.repo", { path: repo }), t(lang, "demo.startup", { files: startup.join(", ") }), ""];

    let matched = 0;
    for (const step of STEPS) {
      const raw = { session_id: "demo-session", cwd: repo, model: "demo", ...step.input };
      const out = handleHook(raw, env);
      const got = out ? headings(out.hookSpecificOutput.additionalContext) : [];
      const ok = JSON.stringify(got) === JSON.stringify(step.expectDirs);
      if (ok) matched++;
      lines.push(t(lang, "demo.step", { n: step.n, total: STEPS.length, title: t(lang, `demo.s${step.n}.title` as MessageKey) }));
      lines.push(got.length > 0 ? t(lang, "demo.injected", { dirs: got.join(", ") }) : t(lang, "demo.nothing"));
      if (out) lines.push(t(lang, "demo.notice", { text: out.systemMessage }));
      lines.push(t(lang, "demo.why", { text: t(lang, `demo.s${step.n}.why` as MessageKey) }));
      if (!ok) lines.push(t(lang, "demo.mismatch", { expected: JSON.stringify(step.expectDirs), got: JSON.stringify(got) }));
      lines.push("");
    }
    lines.push(t(lang, "demo.summary", { ok: matched, total: STEPS.length }));
    return { lines, ok: matched === STEPS.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

