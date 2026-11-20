// AC-8: explain and demo.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { runDemo } from "../src/demo.js";
import { makeCodexHome } from "../src/fixture.js";
import { CLI, makeSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

function run(args: string[]) {
  let out = "";
  let err = "";
  const code = main(args, sb.env, sb.repo, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe("explain (AC-8)", () => {
  it("shows the override as chosen and AGENTS.md as shadowed", () => {
    const r = run(["explain", "packages/web/src/app.ts"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/AGENTS\.override\.md\s+\d+ B\s+chosen/);
    expect(r.out).toMatch(/AGENTS\.md\s+\d+ B\s+shadowed/);
    expect(r.out).toContain("marker: .hg");
    expect(r.out).toContain("Budget:");
  });

  it("--json is parseable and lists the chosen files", () => {
    const r = run(["explain", "packages/web/src/app.ts", "--json"]);
    const report = JSON.parse(r.out) as { injectable: string[]; marker: string; folders: { rel: string; candidates: { name: string; status: string }[] }[]; budget: { max: number; used: number } };
    expect(report.injectable).toEqual(["AGENTS.md", "packages/web/AGENTS.override.md"]);
    expect(report.marker).toBe(".hg");
    expect(report.budget.max).toBe(32768);
    const web = report.folders.find((f) => f.rel === "packages/web");
    expect(web?.candidates.find((c) => c.name === "AGENTS.md")?.status).toBe("shadowed");
  });

  it("explains excluded folders and budget truncation", () => {
    expect(run(["explain", "node_modules/dep/index.js"]).out).toContain("Excluded");
    expect(run(["explain", "packages/api"]).out).not.toContain("Truncated");
    makeCodexHome(sb.env.CODEX_HOME as string, "project_doc_max_bytes = 30\n");
    const tight = run(["explain", "packages/api"]);
    expect(tight.out).toContain("Truncated to fit the budget: packages/api/AGENTS.md");
    expect(tight.out).toContain("30 of 30 bytes");
  });

  it("exits 2 with a fix hint when the path does not exist or is missing", () => {
    const missing = run(["explain", "no/such/file.ts"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("Path not found");
    const none = run(["explain"]);
    expect(none.code).toBe(2);
    expect(none.err).toContain("explain needs a path");
  });
});

describe("demo (AC-8)", () => {
  it("runs all 6 steps as expected and labels itself a simulation", () => {
    const { lines, ok } = runDemo("en", { PATH: "" });
    expect(ok).toBe(true);
    expect(lines[0]).toContain("simulation");
    expect(lines[lines.length - 1]).toBe("6/6 steps as expected");
    expect(lines.join("\n")).not.toContain("MISMATCH");
  });

  it("works in Korean too", () => {
    const { lines, ok } = runDemo("ko", { PATH: "" });
    expect(ok).toBe(true);
    expect(lines[0]).toContain("시뮬레이션");
    expect(lines[lines.length - 1]).toBe("6/6 단계가 기대와 일치");
  });

  it("the built CLI prints the simulation and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "demo", "--lang", "en"], { env: { PATH: "" }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toContain("simulation");
    expect(r.stdout.trimEnd().split("\n").pop()).toBe("6/6 steps as expected");
  });
});
