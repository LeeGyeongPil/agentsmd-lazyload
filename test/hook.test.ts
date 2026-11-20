// AC-3: end to end through stdin/stdout of the built CLI.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchInput, preToolUse, runCli, type Sandbox, makeSandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const hook = (input: unknown) => runCli(["hook"], { env: sb.env, input: JSON.stringify(input), cwd: sb.repo });

describe("hook end to end (AC-3)", () => {
  it("injects the api AGENTS.md the first time packages/api is touched", () => {
    const r = hook(preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts")));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const out = JSON.parse(r.stdout) as {
      systemMessage: string;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("# AGENTS.md instructions for packages/api");
    expect(out.hookSpecificOutput.additionalContext).toContain("API: run go test ./...");
    expect(out.hookSpecificOutput.additionalContext).not.toContain("Root rules");
    expect(out.systemMessage).toContain("+packages/api/AGENTS.md");
  });

  it("prints nothing for an identical second call and exits 0", () => {
    const input = preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts"));
    expect(hook(input).stdout).not.toBe("");
    const second = hook(input);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
  });

  it("limits output keys to what Codex's schema allows", () => {
    const r = hook(preToolUse(sb.repo, "apply_patch", patchInput("packages/web/src/app.ts")));
    const out = JSON.parse(r.stdout) as Record<string, Record<string, unknown>>;
    expect(Object.keys(out).sort()).toEqual(["hookSpecificOutput", "systemMessage"]);
    expect(Object.keys(out.hookSpecificOutput as object).sort()).toEqual(["additionalContext", "hookEventName"]);
  });

  it("echoes PostToolUse as the event name", () => {
    const input = preToolUse(sb.repo, "Bash", { command: "ls packages/api" }, "s9", "PostToolUse");
    const out = JSON.parse(hook(input).stdout) as { hookSpecificOutput: { hookEventName: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  });

  it("injects the override file and not the shadowed AGENTS.md", () => {
    const r = hook(preToolUse(sb.repo, "Bash", { command: "cd packages/web && cat src/app.ts" }));
    const ctx = (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("WEB OVERRIDE");
    expect(ctx).not.toContain("should be shadowed");
  });

  it("answers in Korean when AGENTSMD_LAZYLOAD_LANG=ko", () => {
    const env = { ...sb.env, AGENTSMD_LAZYLOAD_LANG: "ko" };
    const r = runCli(["hook"], {
      env,
      input: JSON.stringify(preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts"))),
      cwd: sb.repo,
    });
    const out = JSON.parse(r.stdout) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
    expect(out.systemMessage).toContain("+packages/api/AGENTS.md");
    // the model-facing text stays English in every language
    expect(out.hookSpecificOutput.additionalContext).toContain("# AGENTS.md instructions for packages/api");
  });
});
