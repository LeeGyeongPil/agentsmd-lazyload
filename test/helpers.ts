// Test helpers: temp example repos, hook inputs, running the built CLI.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeCodexHome, makeFixtureRepo } from "../src/fixture.js";
import type { CodexDocConfig, Env } from "../src/types.js";

export const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

export interface Sandbox {
  tmp: string;
  repo: string;
  env: Env;
  cleanup: () => void;
}

/** A temp example monorepo plus an isolated Codex home and state dir. */
export function makeSandbox(): Sandbox {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aml-test-")));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  makeFixtureRepo(repo);
  makeCodexHome(path.join(tmp, "codex-home"));
  const env: Env = {
    PATH: "",
    CODEX_HOME: path.join(tmp, "codex-home"),
    AGENTSMD_LAZYLOAD_STATE_DIR: path.join(tmp, "state"),
    AGENTSMD_LAZYLOAD_LANG: "en",
  };
  return { tmp, repo, env, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

export const CFG: CodexDocConfig = { maxBytes: 32768, fallbackNames: [], rootMarkers: [".hg"] };

let counter = 0;

/** A PreToolUse input in the shape Codex sends. */
export function preToolUse(
  cwd: string,
  tool: string,
  toolInput: unknown,
  sessionId = "s1",
  event = "PreToolUse",
): Record<string, unknown> {
  counter += 1;
  return {
    session_id: sessionId,
    transcript_path: null,
    cwd,
    hook_event_name: event,
    model: "test-model",
    permission_mode: "default",
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: "use-" + counter,
    turn_id: "turn-1",
  };
}

export function patchInput(rel: string, kind = "Update"): { command: string } {
  return { command: "*** Begin Patch\n*** " + kind + " File: " + rel + "\n@@\n-a\n+b\n*** End Patch\n" };
}

export function sessionStart(cwd: string, source: string, sessionId = "s1"): Record<string, unknown> {
  return {
    session_id: sessionId,
    transcript_path: null,
    cwd,
    hook_event_name: "SessionStart",
    model: "test-model",
    permission_mode: "default",
    source,
  };
}

/** Run the built CLI as a child process. */
export function runCli(
  args: string[],
  opts: { env: Env; input?: string; cwd?: string },
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: opts.input ?? "",
    env: opts.env as NodeJS.ProcessEnv,
    cwd: opts.cwd,
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

export function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
