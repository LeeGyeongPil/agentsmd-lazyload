# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-20

### Added

- `hook` command: PreToolUse, PostToolUse and SessionStart (`compact`, `clear`) handler that injects
  nested AGENTS.md files the first time a tool call touches their folder.
- Codex-compatible chain rules: `AGENTS.override.md` > `AGENTS.md` > `project_doc_fallback_filenames`,
  `project_root_markers`, nested repository boundaries and `project_doc_max_bytes` truncation.
- Target path extraction for `apply_patch`, `Bash` (cd, pushd, git -C, `bash -lc`, redirects) and MCP tools.
- Safety guards: dependency folders excluded, paths outside the project and symlink escapes ignored,
  fail-open behaviour (exit 0, empty stdout, one stderr line).
- Per-session state with re-injection of changed files and of all injected files after compaction.
- `explain`, `install`, `uninstall` and `demo` commands; English and Korean output (`--lang en|ko`).
- Codex plugin bundle (`plugin.json`, `hooks/hooks.json`) and a conformance test against `codex debug prompt-input`.
