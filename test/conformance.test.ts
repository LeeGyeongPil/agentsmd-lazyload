// AC-10: compare our chain with the AGENTS.md chain Codex itself builds (`codex debug prompt-input`).
// Skipped (with a printed reason) when the codex binary is not available.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "../src/resolve.js";
import { CFG, makeSandbox, type Sandbox } from "./helpers.js";

const probe = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 60000 });
// 다른 버전의 codex 가 PATH 에 있어도 비교 명령(debug prompt-input)이 없으면 실패 대신 건너뛴다
const canPrompt =
  probe.status === 0 && spawnSync("codex", ["debug", "prompt-input", "--help"], { encoding: "utf8", timeout: 60000 }).status === 0;
const available = probe.status === 0 && canPrompt;
if (probe.status !== 0) console.log("skipped: codex not found");
else if (!canPrompt) console.log("skipped: " + probe.stdout.trim() + " has no 'debug prompt-input'");
else console.log("codex: " + probe.stdout.trim());

let sb: Sandbox;
beforeAll(() => {
  if (available) sb = makeSandbox();
});
afterAll(() => {
  if (available) sb.cleanup();
});

/** The text inside <INSTRUCTIONS> of the "# AGENTS.md instructions for <cwd>" message. */
function codexChain(cwd: string, extra: string[]): string | null {
  const args = ["debug", "prompt-input", "-c", 'project_root_markers=[".hg"]', ...extra.flatMap((e) => ["-c", e]), "hi"];
  const r = spawnSync("codex", args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: sb.env.CODEX_HOME },
    encoding: "utf8",
    timeout: 60000,
  });
  expect(r.status, r.stderr).toBe(0);
  const items = JSON.parse(r.stdout) as { content?: { text?: string }[] }[];
  for (const item of items) {
    for (const c of item.content ?? []) {
      const m = c.text?.match(/# AGENTS\.md instructions for .*?\n\n<INSTRUCTIONS>\n([\s\S]*)\n?<\/INSTRUCTIONS>/);
      if (m) return m[1] as string;
    }
  }
  return null;
}

/** Our chain, joined the way Codex joins files ("\n\n" between files). */
function ourChain(cwd: string, maxBytes: number): string {
  const r = resolve(cwd, { ...CFG, maxBytes });
  return r.entries.map((e) => e.content).join("\n\n");
}

const norm = (s: string | null) => (s ?? "").trimEnd();

describe.skipIf(!available)("matches `codex debug prompt-input` (AC-10)", () => {
  const cases: [string, string, number, string[]][] = [
    ["project root", ".", 32768, []],
    ["packages/web/src (override wins)", "packages/web/src", 32768, []],
    ["nested repo", "packages/legacy/src", 32768, []],
    ["budget 30 (truncation)", "packages/api", 30, ["project_doc_max_bytes=30"]],
  ];
  for (const [name, rel, max, extra] of cases) {
    it(name, () => {
      const cwd = path.join(sb.repo, rel);
      expect(norm(codexChain(cwd, extra))).toBe(norm(ourChain(cwd, max)));
    });
  }
});
