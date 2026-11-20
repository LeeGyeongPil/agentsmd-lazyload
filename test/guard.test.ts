// AC-5: safety and fail-open behaviour.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { excludedNames, guardTarget, DEFAULT_EXCLUDES } from "../src/guard.js";
import { handleHook } from "../src/hook.js";
import { patchInput, preToolUse, runCli, makeSandbox, write, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const touch = (rel: string, tool = "apply_patch", input: unknown = patchInput(rel)) =>
  handleHook(preToolUse(sb.repo, tool, input), sb.env);

describe("exclusions (AC-5)", () => {
  it("never injects AGENTS.md from node_modules or vendor by default", () => {
    expect(touch("node_modules/dep/index.js")).toBeNull();
    expect(touch("packages/web/vendor/lib/index.js")).toBeNull();
    expect(touch("node_modules/dep/AGENTS.md", "Bash", { command: "cat node_modules/dep/AGENTS.md" })).toBeNull();
  });

  it("lists the default excluded folders", () => {
    expect(DEFAULT_EXCLUDES).toEqual(expect.arrayContaining(["node_modules", ".venv", "venv", "vendor", "third_party", ".git", "dist", "build"]));
  });

  it("an empty AGENTSMD_LAZYLOAD_EXCLUDE keeps the defaults", () => {
    expect(excludedNames({ ...sb.env, AGENTSMD_LAZYLOAD_EXCLUDE: "" })).toEqual(DEFAULT_EXCLUDES);
    expect(excludedNames({ ...sb.env, AGENTSMD_LAZYLOAD_EXCLUDE: " , " })).toEqual(DEFAULT_EXCLUDES);
  });

  it("AGENTSMD_LAZYLOAD_EXCLUDE replaces the list", () => {
    const env = { ...sb.env, AGENTSMD_LAZYLOAD_EXCLUDE: "packages" };
    expect(excludedNames(env)).toEqual(["packages"]);
    expect(handleHook(preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts")), env)).toBeNull();
    const env2 = { ...sb.env, AGENTSMD_LAZYLOAD_EXCLUDE: "nothing" };
    expect(handleHook(preToolUse(sb.repo, "apply_patch", patchInput("node_modules/dep/index.js"), "s2"), env2)).not.toBeNull();
  });
});

describe("boundaries (AC-5)", () => {
  it("ignores paths outside the project root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aml-outside-"));
    try {
      write(path.join(outside, "AGENTS.md"), "outside rules\n");
      expect(touch("x", "mcp__fs__read", { path: path.join(outside, "f.ts") })).toBeNull();
      expect(touch("x", "Bash", { command: "cat " + path.join(outside, "AGENTS.md") })).toBeNull();
      expect(touch("../escape.ts")).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("ignores symlinks that point outside the project root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aml-outside-"));
    try {
      write(path.join(outside, "AGENTS.md"), "outside rules\n");
      fs.symlinkSync(outside, path.join(sb.repo, "packages", "linked"));
      expect(touch("packages/linked/f.ts")).toBeNull();
      expect(guardTarget(path.join(sb.repo, "packages", "linked", "f.ts"), sb.repo, DEFAULT_EXCLUDES).reason).toBe("symlink-escape");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts symlinks that stay inside the project", () => {
    fs.symlinkSync(path.join(sb.repo, "packages", "api"), path.join(sb.repo, "packages", "alias"));
    expect(guardTarget(path.join(sb.repo, "packages", "alias", "x.ts"), sb.repo, DEFAULT_EXCLUDES).ok).toBe(true);
  });
});

describe("fail-open (AC-5)", () => {
  const run = (input: string, env = sb.env) => runCli(["hook"], { env, input, cwd: sb.repo });

  it("AGENTSMD_LAZYLOAD_DISABLE=1 prints nothing", () => {
    const input = JSON.stringify(preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts")));
    const r = run(input, { ...sb.env, AGENTSMD_LAZYLOAD_DISABLE: "1" });
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("malformed JSON exits 0 with empty stdout and one stderr line", () => {
    const r = run("{ this is not json");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("agentsmd-lazyload");
  });

  it("empty input and non-object JSON behave the same way", () => {
    for (const input of ["", "[]", "42", "null"]) {
      const r = run(input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("an unknown event exits 0 with empty stdout and one stderr line", () => {
    const r = run(JSON.stringify({ ...preToolUse(sb.repo, "Bash", { command: "ls" }), hook_event_name: "UserPromptSubmit" }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("unsupported hook event");
  });

  it("missing session_id or a relative cwd is ignored the same way", () => {
    const base = preToolUse(sb.repo, "Bash", { command: "ls" });
    for (const bad of [{ ...base, session_id: undefined }, { ...base, cwd: "relative/dir" }]) {
      const r = run(JSON.stringify(bad));
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("an unwritable state directory fails open", () => {
    const blocker = path.join(sb.tmp, "blocker");
    fs.writeFileSync(blocker, "a file, not a folder");
    const r = run(JSON.stringify(preToolUse(sb.repo, "apply_patch", patchInput("packages/api/src/h.ts"))), {
      ...sb.env,
      AGENTSMD_LAZYLOAD_STATE_DIR: path.join(blocker, "state"),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });
});
