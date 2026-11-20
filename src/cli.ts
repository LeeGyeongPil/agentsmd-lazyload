#!/usr/bin/env node
// Command line entry point: hook, explain, install, uninstall, demo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDemo } from "./demo.js";
import { buildExplain } from "./explain.js";
import { runHook } from "./hook.js";
import { parseLang, resolveLang, t, type Lang } from "./i18n.js";
import {
  EVENTS,
  HooksFileError,
  hookCommand,
  hooksPath,
  makeEntries,
  mergeHooks,
  readHooksFile,
  removeHooks,
  serialize,
  writeHooksFile,
} from "./install.js";
import { renderExplain } from "./render.js";
import type { Env } from "./types.js";

interface Args {
  command: string | null;
  positionals: string[];
  lang: string | undefined;
  json: boolean;
  project: boolean;
  dryRun: boolean;
  help: boolean;
  version: boolean;
  unknownOption: string | null;
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    command: null,
    positionals: [],
    lang: undefined,
    json: false,
    project: false,
    dryRun: false,
    help: false,
    version: false,
    unknownOption: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--lang") a.lang = argv[++i] ?? "";
    else if (arg.startsWith("--lang=")) a.lang = arg.slice("--lang=".length);
    else if (arg === "--json") a.json = true;
    else if (arg === "--project") a.project = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "-h" || arg === "--help") a.help = true;
    else if (arg === "-v" || arg === "--version") a.version = true;
    else if (arg.startsWith("-") && arg !== "-") a.unknownOption ??= arg;
    else if (a.command === null) a.command = arg;
    else a.positionals.push(arg);
  }
  return a;
}

function packageVersion(): string {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { version: string }).version;
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function install(args: Args, lang: Lang, env: Env, cwd: string, io: Io): number {
  const file = hooksPath(args.project, cwd, env);
  const cliPath = fileURLToPath(import.meta.url);
  const { command, absolute } = hookCommand(env, cliPath);
  let merged;
  try {
    merged = mergeHooks(readHooksFile(file), command, cliPath);
  } catch (err) {
    if (!(err instanceof HooksFileError)) throw err;
    io.err(t(lang, "error.hooks_file", { file, reason: err.message }) + "\n");
    return 3;
  }
  io.out(t(lang, "install.header", { file }) + "\n");
  if (args.dryRun) io.out(t(lang, "install.dryrun") + "\n");
  for (const ev of EVENTS) {
    // 옛 클론이 사라져 죽은 항목을 바꿨다면 그 사실을 따로 알린다
    const key = merged.added.includes(ev)
      ? "install.added"
      : merged.replacedStale.includes(ev)
        ? "install.replaced_stale"
        : merged.updated.includes(ev)
          ? "install.updated"
          : "install.unchanged";
    io.out(t(lang, key, { event: ev }) + "\n");
  }
  if (args.dryRun) {
    io.out(serialize({ hooks: makeEntries(command) }));
    return 0;
  }
  if (merged.added.length === 0 && merged.updated.length === 0) {
    io.out(t(lang, "install.nochange", { file }) + "\n");
    return 0;
  }
  writeHooksFile(file, merged.config);
  io.out(t(lang, "install.done", { file }) + "\n");
  if (absolute) io.out(t(lang, "install.absolute") + "\n");
  io.out(t(lang, "install.trust") + "\n");
  return 0;
}

function uninstall(args: Args, lang: Lang, env: Env, cwd: string, io: Io): number {
  const file = hooksPath(args.project, cwd, env);
  let result;
  try {
    result = removeHooks(readHooksFile(file), fileURLToPath(import.meta.url));
  } catch (err) {
    if (!(err instanceof HooksFileError)) throw err;
    io.err(t(lang, "error.hooks_file", { file, reason: err.message }) + "\n");
    return 3;
  }
  if (result.removed === 0) {
    io.out(t(lang, "uninstall.none", { file }) + "\n");
    return 0;
  }
  writeHooksFile(file, result.config);
  io.out(t(lang, "uninstall.done", { count: result.removed, file }) + "\n");
  if (result.stale > 0) io.out(t(lang, "uninstall.stale", { count: result.stale }) + "\n");
  return 0;
}

/** Run the CLI. Returns the exit code; output goes through `io` so tests can capture it. */
export function main(argv: string[], env: Env, cwd: string, io: Io): number {
  const args = parseArgs(argv);

  if (args.command === "hook") {
    const res = runHook(readStdin(), env);
    if (res.stdout) io.out(res.stdout);
    if (res.stderr) io.err(res.stderr);
    return res.code;
  }

  if (args.lang !== undefined && parseLang(args.lang) === null) {
    io.err(t("en", "error.lang_value", { value: args.lang }) + "\n");
    return 2;
  }
  const lang = resolveLang(args.lang, env);

  if (args.version) {
    io.out(packageVersion() + "\n");
    return 0;
  }
  if (args.help || args.command === null || args.command === "help") {
    io.out(t(lang, "help.text", { version: packageVersion() }) + "\n");
    return 0;
  }
  if (args.unknownOption !== null) {
    io.err(t(lang, "error.unknown_option", { name: args.unknownOption }) + "\n");
    return 2;
  }

  switch (args.command) {
    case "explain": {
      const target = args.positionals[0];
      if (target === undefined) {
        io.err(t(lang, "error.explain_missing_path") + "\n");
        return 2;
      }
      const report = buildExplain(target, cwd, env);
      if (report === null) {
        io.err(t(lang, "error.path_not_found", { path: target }) + "\n");
        return 2;
      }
      io.out((args.json ? JSON.stringify(report, null, 2) : renderExplain(lang, report)) + "\n");
      return 0;
    }
    case "install":
      return install(args, lang, env, cwd, io);
    case "uninstall":
      return uninstall(args, lang, env, cwd, io);
    case "demo": {
      const { lines, ok } = runDemo(lang, env);
      io.out(lines.join("\n") + "\n");
      return ok ? 0 : 1;
    }
    default:
      io.err(t(lang, "error.unknown_command", { name: args.command }) + "\n");
      return 2;
  }
}

// Only run when executed as a program (not when imported by tests).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  // `install | head` 처럼 읽는 쪽이 먼저 닫혀도 스택 트레이스 없이 조용히 끝낸다
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") throw err;
    });
  }
  process.exitCode = main(process.argv.slice(2), process.env, process.cwd(), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
