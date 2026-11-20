// Shared types for agentsmd-lazyload.

/** Settings read from Codex config.toml (the three keys that affect AGENTS.md discovery). */
export interface CodexDocConfig {
  /** Total byte budget of the AGENTS.md chain (`project_doc_max_bytes`). */
  maxBytes: number;
  /** Extra file names tried after AGENTS.override.md and AGENTS.md (`project_doc_fallback_filenames`). */
  fallbackNames: string[];
  /** Files or folders that mark a project root (`project_root_markers`). */
  rootMarkers: string[];
}

/** One chosen instruction file of a chain. */
export interface ChainEntry {
  /** Absolute folder that owns the file. */
  dir: string;
  /** Absolute file path. */
  file: string;
  /** File name that was chosen, e.g. AGENTS.override.md. */
  name: string;
  /** File content (possibly truncated when a budget was applied). */
  content: string;
  /** Byte length of `content`. */
  bytes: number;
  /** Byte length of the whole file on disk. */
  fullBytes: number;
  /** sha256 of the whole file content. */
  sha: string;
  /** True when `content` was cut to fit the byte budget. */
  truncated: boolean;
}

export interface Chain {
  /** Project root of the target folder (nearest marker, or the folder itself). */
  root: string;
  /** Marker that identified the root, or null when none was found. */
  marker: string | null;
  entries: ChainEntry[];
}

/** Candidate states used by `explain`. */
export type CandidateStatus = "chosen" | "shadowed" | "empty" | "missing";

export interface FolderReport {
  dir: string;
  candidates: { name: string; status: CandidateStatus; bytes: number }[];
}

/** Hook input fields we rely on (Codex sends more). */
export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: unknown;
  source?: string;
  [key: string]: unknown;
}

export type Env = Record<string, string | undefined>;
