// AC-4: session state.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHook } from "../src/hook.js";
import { loadState, statePath } from "../src/state.js";
import { makeCodexHome } from "../src/fixture.js";
import { makeSandbox, patchInput, preToolUse, sessionStart, write, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const ctx = (out: ReturnType<typeof handleHook>) => out?.hookSpecificOutput.additionalContext ?? "";
const touch = (rel: string, session = "s1") => handleHook(preToolUse(sb.repo, "apply_patch", patchInput(rel), session), sb.env);

describe("session state (AC-4)", () => {
  it("does not re-inject the startup chain (root AGENTS.md)", () => {
    expect(touch("AGENTS.md")).toBeNull();
    expect(touch("packages/api/src/h.ts")).not.toBeNull();
    expect(ctx(touch("packages/web/src/app.ts"))).not.toContain("Root rules");
  });

  it("records the startup chain of the session cwd as already loaded", () => {
    touch("packages/api/src/h.ts");
    const state = loadState(sb.env, "s1");
    expect(state?.files.filter((f) => f.startup).map((f) => path.relative(sb.repo, f.path))).toEqual(["AGENTS.md"]);
  });

  it("re-injects a changed file as updated", () => {
    expect(ctx(touch("packages/api/src/h.ts"))).toContain("API: run go test");
    expect(touch("packages/api/src/h.ts")).toBeNull();
    write(path.join(sb.repo, "packages", "api", "AGENTS.md"), "API: now run make test\n");
    const out = touch("packages/api/src/h.ts");
    expect(ctx(out)).toContain("API: now run make test");
    expect(ctx(out)).toContain("(updated since it was last injected)");
    expect(out?.systemMessage).toContain("~packages/api/AGENTS.md");
  });

  it("keeps sessions independent", () => {
    expect(touch("packages/api/src/h.ts", "a")).not.toBeNull();
    expect(touch("packages/api/src/h.ts", "a")).toBeNull();
    expect(touch("packages/api/src/h.ts", "b")).not.toBeNull();
  });

  it("re-injects everything injected so far on SessionStart compact", () => {
    touch("packages/api/src/h.ts");
    touch("packages/web/src/app.ts");
    const out = handleHook(sessionStart(sb.repo, "compact"), sb.env);
    expect(out?.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const text = ctx(out);
    expect(text).toContain("# AGENTS.md instructions for packages/api");
    expect(text).toContain("# AGENTS.md instructions for packages/web");
    expect(text).toContain("WEB OVERRIDE");
    expect(text).not.toContain("Root rules");
    // state stays consistent: nothing new is injected afterwards
    expect(touch("packages/api/src/h.ts")).toBeNull();
  });

  it("does nothing on compact when nothing was injected", () => {
    expect(handleHook(sessionStart(sb.repo, "compact"), sb.env)).toBeNull();
    touch("AGENTS.md");
    expect(handleHook(sessionStart(sb.repo, "compact"), sb.env)).toBeNull();
  });

  it("clear resets the state silently so files are injected again", () => {
    touch("packages/api/src/h.ts");
    expect(fs.existsSync(statePath(sb.env, "s1"))).toBe(true);
    expect(handleHook(sessionStart(sb.repo, "clear"), sb.env)).toBeNull();
    expect(fs.existsSync(statePath(sb.env, "s1"))).toBe(false);
    expect(touch("packages/api/src/h.ts")).not.toBeNull();
  });

  it("ignores other SessionStart sources", () => {
    touch("packages/api/src/h.ts");
    expect(handleHook(sessionStart(sb.repo, "resume"), sb.env)).toBeNull();
    expect(handleHook(sessionStart(sb.repo, "startup"), sb.env)).toBeNull();
  });

  it("counts injected bytes against project_doc_max_bytes and truncates the overflow", () => {
    makeCodexHome(sb.env.CODEX_HOME as string, "project_doc_max_bytes = 30\n");
    const out = touch("packages/api/src/h.ts");
    expect(ctx(out)).toContain("API: run");
    expect(ctx(out)).not.toContain("go test");
    expect(ctx(out)).toContain("truncated");
    expect(out?.systemMessage).toContain("truncated");
  });

  it("reports files that no longer fit at all, once", () => {
    makeCodexHome(sb.env.CODEX_HOME as string, "project_doc_max_bytes = 22\n");
    const first = touch("packages/api/src/h.ts");
    expect(first?.systemMessage).toContain("over budget");
    expect(touch("packages/api/src/h.ts")).toBeNull();
  });

  it("survives a corrupt state file by starting over", () => {
    touch("packages/api/src/h.ts");
    fs.writeFileSync(statePath(sb.env, "s1"), "{not json");
    expect(touch("packages/api/src/h.ts")).not.toBeNull();
  });
});
