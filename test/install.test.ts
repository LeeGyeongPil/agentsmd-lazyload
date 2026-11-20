// AC-7: install / uninstall and the plugin bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { spawnSync } from "node:child_process";
import { EVENTS, isOurs, isStaleOurs, makeEntries, matcherFor } from "../src/install.js";
import { CLI, makeSandbox, type Sandbox } from "./helpers.js";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.cleanup());

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(args: string[], env = sb.env, cwd = sb.repo) {
  let out = "";
  let err = "";
  const code = main(args, env, cwd, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

const userFile = () => path.join(sb.env.CODEX_HOME as string, "hooks.json");
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as { hooks: Record<string, { matcher: string; hooks: { command: string }[] }[]> };
const countOurs = (cfg: ReturnType<typeof read>, ev: string) =>
  ((cfg.hooks ?? {})[ev] ?? []).flatMap((g) => g.hooks).filter((h) => isOurs(h)).length;

describe("install (AC-7)", () => {
  it("creates hooks.json with one handler for each event", () => {
    const r = run(["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("/hooks");
    const cfg = read(userFile());
    for (const ev of EVENTS) expect(countOurs(cfg, ev)).toBe(1);
    expect(cfg.hooks.PreToolUse?.[0]?.matcher).toBe("^(apply_patch|Bash|mcp__.*)$");
    expect(cfg.hooks.SessionStart?.[0]?.matcher).toBe("compact|clear");
  });

  it("uses the bare command when it is on PATH and an absolute one otherwise", () => {
    run(["install"]);
    expect(read(userFile()).hooks.PreToolUse?.[0]?.hooks[0]?.command).toMatch(/cli\.(js|ts)"? hook$/);
    fs.rmSync(userFile());
    const bin = path.join(sb.tmp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "agentsmd-lazyload"), "#!/bin/sh\n", { mode: 0o755 });
    const r = run(["install"], { ...sb.env, PATH: bin });
    expect(read(userFile()).hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe("agentsmd-lazyload hook");
    expect(r.out).not.toContain("not on PATH");
  });

  it("is idempotent: a second run leaves one handler per event and the same bytes", () => {
    run(["install"]);
    const first = fs.readFileSync(userFile(), "utf8");
    const again = run(["install"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("already installed");
    expect(fs.readFileSync(userFile(), "utf8")).toBe(first);
    for (const ev of EVENTS) expect(countOurs(read(userFile()), ev)).toBe(1);
  });

  it("preserves existing entries and unrelated keys", () => {
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(
      userFile(),
      JSON.stringify({
        note: "keep me",
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool check" }] }],
          Stop: [{ hooks: [{ type: "command", command: "notify" }] }],
        },
      }),
    );
    run(["install"]);
    const cfg = read(userFile()) as unknown as { note: string; hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(cfg.note).toBe("keep me");
    expect(cfg.hooks.Stop?.[0]?.hooks[0]?.command).toBe("notify");
    const pre = cfg.hooks.PreToolUse?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(pre).toContain("other-tool check");
    expect(pre.filter((c) => isOurs({ command: c }))).toHaveLength(1);
  });

  it("--dry-run leaves the file untouched and prints the entries", () => {
    const r = run(["install", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(fs.existsSync(userFile())).toBe(false);
    expect(r.out).toContain("PreToolUse");
    expect(r.out).toContain("additionalContextLimit");
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(userFile(), '{"hooks":{}}');
    run(["install", "--dry-run"]);
    expect(fs.readFileSync(userFile(), "utf8")).toBe('{"hooks":{}}');
  });

  it("--project from a subfolder writes <project root>/.codex/hooks.json", () => {
    const sub = path.join(sb.repo, "packages", "api");
    fs.mkdirSync(sub, { recursive: true });
    run(["install", "--project"], sb.env, sub);
    expect(fs.existsSync(path.join(sb.repo, ".codex", "hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(sub, ".codex"))).toBe(false);
  });

  it("recognises its handlers whatever the install folder is called", () => {
    const dir = path.join(sb.tmp, "some-other-name", "dist");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "..", "package.json"), '{"name":"agentsmd-lazyload"}');
    const script = path.join(dir, "cli.js");
    fs.writeFileSync(script, "");
    const cmd = JSON.stringify(process.execPath) + " " + JSON.stringify(script) + " hook";
    expect(isOurs({ command: cmd })).toBe(true);
    expect(isOurs({ command: JSON.stringify(process.execPath) + " " + JSON.stringify(path.join(sb.tmp, "x.js")) + " hook" })).toBe(false);
    expect(isOurs({ command: "other-tool hook" })).toBe(false);
    expect(isOurs({ command: "node agentsmd-lazyload-notes.js hook" })).toBe(false);
    // an install made from another folder is replaced, not duplicated, and removed by uninstall
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(userFile(), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "x", hooks: [{ type: "command", command: cmd }] }] } }));
    run(["install"]);
    for (const ev of EVENTS) expect(countOurs(read(userFile()), ev)).toBe(1);
    run(["uninstall"]);
    if (fs.existsSync(userFile())) for (const ev of EVENTS) expect(countOurs(read(userFile()), ev)).toBe(0);
  });

  it("--project writes <cwd>/.codex/hooks.json", () => {
    run(["install", "--project"]);
    expect(fs.existsSync(path.join(sb.repo, ".codex", "hooks.json"))).toBe(true);
    expect(fs.existsSync(userFile())).toBe(false);
  });

  it("exits 3 and leaves a broken hooks.json unchanged", () => {
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(userFile(), "{ broken");
    const r = run(["install"]);
    expect(r.code).toBe(3);
    expect(r.err).toContain(userFile());
    expect(fs.readFileSync(userFile(), "utf8")).toBe("{ broken");
    fs.writeFileSync(userFile(), '{"hooks":{"PreToolUse":"nope"}}');
    expect(run(["install"]).code).toBe(3);
    expect(fs.readFileSync(userFile(), "utf8")).toBe('{"hooks":{"PreToolUse":"nope"}}');
    expect(run(["uninstall"]).code).toBe(3);
  });
});

describe("uninstall (AC-7)", () => {
  it("removes only our handlers", () => {
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(
      userFile(),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool check" }] }] } }),
    );
    run(["install"]);
    const r = run(["uninstall"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3");
    const cfg = read(userFile());
    for (const ev of EVENTS) expect(countOurs(cfg, ev)).toBe(0);
    expect(cfg.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe("other-tool check");
    expect(cfg.hooks.PostToolUse).toBeUndefined();
  });

  it("reports nothing to remove when we were never installed", () => {
    const r = run(["uninstall"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nothing to remove");
    expect(fs.existsSync(userFile())).toBe(false);
  });
});

describe("moved or deleted checkout (AC-7)", () => {
  /** A fake earlier checkout: <tmp>/<name>/dist/cli.js plus package.json; returns its hook command. */
  function oldCheckout(name: string): { dir: string; cmd: string } {
    const dir = path.join(sb.tmp, name);
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"agentsmd-lazyload"}');
    fs.writeFileSync(path.join(dir, "dist", "cli.js"), "");
    return { dir, cmd: JSON.stringify(process.execPath) + " " + JSON.stringify(path.join(dir, "dist", "cli.js")) + " hook" };
  }
  const allCommands = (f: string) =>
    Object.values(read(f).hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  const writeWithOther = (cmd: string) => {
    const entries = makeEntries(cmd);
    entries.PreToolUse?.push({ matcher: "Bash", hooks: [{ type: "command", command: "other-tool check" }] });
    fs.mkdirSync(path.dirname(userFile()), { recursive: true });
    fs.writeFileSync(userFile(), JSON.stringify({ hooks: entries }));
  };

  it("install replaces handlers whose checkout was deleted (no duplicates)", () => {
    const old = oldCheckout("copyA-moved");
    writeWithOther(old.cmd);
    fs.rmSync(old.dir, { recursive: true });
    expect(isOurs({ command: old.cmd })).toBe(true);
    expect(isStaleOurs({ command: old.cmd })).toBe(true);
    const r = run(["install"]);
    expect(r.code).toBe(0);
    expect(r.out.match(/replaced a stale path/g)).toHaveLength(3);
    const cmds = allCommands(userFile());
    expect(cmds).not.toContain(old.cmd);
    expect(cmds).toContain("other-tool check");
    for (const ev of EVENTS) expect(countOurs(read(userFile()), ev)).toBe(1);
    // uninstall then leaves none of ours
    expect(run(["uninstall"]).out).toContain("Removed 3");
    expect(allCommands(userFile())).toEqual(["other-tool check"]);
  });

  it("uninstall removes handlers whose checkout was deleted", () => {
    const old = oldCheckout("some-other-name");
    writeWithOther(old.cmd);
    fs.rmSync(old.dir, { recursive: true });
    const r = run(["uninstall", "--lang", "ko"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3개");
    expect(r.out).toContain("이미 없는 cli.js");
    expect(allCommands(userFile())).toEqual(["other-tool check"]);
  });

  it("drops a stale duplicate even when the current handler is already installed", () => {
    run(["install"]);
    const current = fs.readFileSync(userFile(), "utf8");
    const old = oldCheckout("copyA");
    const cfg = JSON.parse(current) as { hooks: Record<string, { hooks: Record<string, unknown>[] }[]> };
    cfg.hooks.PostToolUse?.[0]?.hooks.push({ type: "command", command: old.cmd });
    fs.writeFileSync(userFile(), JSON.stringify(cfg));
    fs.rmSync(old.dir, { recursive: true });
    const r = run(["install"]);
    expect(r.out).toContain("PostToolUse (replaced a stale path)");
    expect(r.out).toContain("PreToolUse (already installed)");
    expect(allCommands(userFile())).not.toContain(old.cmd);
    for (const ev of EVENTS) expect(countOurs(read(userFile()), ev)).toBe(1);
  });

  it("only treats our exact shape with a missing <abs>/dist/cli.js as stale", () => {
    const gone = path.join(sb.tmp, "gone");
    const q = (s: string) => JSON.stringify(s);
    const node = q(process.execPath);
    expect(isStaleOurs({ command: node + " " + q(path.join(gone, "dist", "other.js")) + " hook" })).toBe(false);
    expect(isStaleOurs({ command: node + " " + q(path.join(gone, "lib", "cli.js")) + " hook" })).toBe(false);
    expect(isStaleOurs({ command: q("/usr/bin/python3") + " " + q(path.join(gone, "dist", "cli.js")) + " hook" })).toBe(false);
    expect(isStaleOurs({ command: node + " " + q(path.join(gone, "dist", "cli.js")) + " hook --other" })).toBe(false);
    expect(isStaleOurs({ command: "node dist/cli.js hook" })).toBe(false);
    // another tool's existing dist/cli.js (not our package) is left alone
    const other = path.join(sb.tmp, "other-tool", "dist");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "..", "package.json"), '{"name":"other-tool"}');
    fs.writeFileSync(path.join(other, "cli.js"), "");
    const otherCmd = node + " " + q(path.join(other, "cli.js")) + " hook";
    expect(isStaleOurs({ command: otherCmd })).toBe(false);
    expect(isOurs({ command: otherCmd })).toBe(false);
  });

  it("end to end with the built CLI: install from copy A, delete A, install from B, uninstall", () => {
    // copy A: dist + package.json, node_modules linked to this checkout's
    const copyA = path.join(sb.tmp, "copyA-moved");
    fs.mkdirSync(copyA);
    fs.cpSync(path.join(root, "dist"), path.join(copyA, "dist"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(copyA, "package.json"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(copyA, "node_modules"), "dir");
    const env = { ...process.env, ...sb.env, PATH: "" } as NodeJS.ProcessEnv;
    const cli = (script: string, ...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { env, cwd: sb.repo, encoding: "utf8" });
    expect(cli(path.join(copyA, "dist", "cli.js"), "install").status).toBe(0);
    fs.rmSync(copyA, { recursive: true });
    const b = cli(CLI, "install");
    expect(b.status).toBe(0);
    expect(b.stdout.match(/replaced a stale path/g)).toHaveLength(3);
    const cmds = allCommands(userFile());
    expect(cmds).toHaveLength(3);
    for (const c of cmds) expect(c).toContain(JSON.stringify(CLI));
    const u = cli(CLI, "uninstall");
    expect(u.status).toBe(0);
    expect(u.stdout).toContain("Removed 3");
    expect(fs.existsSync(userFile()) ? allCommands(userFile()) : []).toEqual([]);
  });
});

describe("output piped to a reader that closes early (AC-7)", () => {
  it("install | head -n 1 prints no EPIPE stack trace", () => {
    const env = { ...process.env, ...sb.env, PATH: process.env.PATH ?? "" } as NodeJS.ProcessEnv;
    const sh = JSON.stringify(process.execPath) + " " + JSON.stringify(CLI) + " install --dry-run | head -n 1";
    const r = spawnSync("/bin/sh", ["-c", sh], { env, cwd: sb.repo, encoding: "utf8" });
    expect(r.stdout.startsWith("File: ")).toBe(true);
    expect(r.stderr).not.toContain("EPIPE");
  });
});

describe("plugin bundle (AC-7)", () => {
  it("hooks/hooks.json has the same events and matchers as install", () => {
    const bundle = JSON.parse(fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { matcher: string; hooks: { command: string; type: string }[] }[]>;
    };
    const wanted = makeEntries("x");
    expect(Object.keys(bundle.hooks).sort()).toEqual([...EVENTS].sort());
    for (const ev of EVENTS) {
      expect(bundle.hooks[ev]?.[0]?.matcher).toBe(matcherFor(ev));
      expect(bundle.hooks[ev]?.[0]?.matcher).toBe(wanted[ev]?.[0]?.matcher);
      expect(bundle.hooks[ev]?.[0]?.hooks[0]?.command).toContain("$PLUGIN_ROOT");
    }
  });

  it("plugin.json has name, version and description matching package.json", () => {
    const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")) as Record<string, string>;
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Record<string, string>;
    expect(plugin.name).toBe("agentsmd-lazyload");
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.description).toBeTruthy();
  });
});
