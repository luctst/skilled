// ---------- sources & entries ----------

export type SourceType = 'github';

export interface Source {
  type: SourceType;
  /** "owner/name" */
  repo: string;
  /** branch or tag, e.g. "main" */
  ref: string;
  /** path within the repo, e.g. "skills/cso". "" means repo root. */
  subpath: string;
}

export interface BaseRecord {
  /** full 40-char commit sha */
  commit: string;
  /** ISO 8601 date, YYYY-MM-DD */
  adoptedAt: string;
  /** true when BASE was inferred after the fact rather than captured at adopt time */
  reconstructed: boolean;
}

export type DetectionMethod =
  'inline-url' | 'plugin-cache' | 'known-index' | 'code-search' | 'cluster' | 'claude' | 'manual';

export interface Detection {
  method: DetectionMethod;
  /** 0..1 */
  confidence: number;
  confirmedBy: 'user' | 'auto' | null;
  /** one human-readable line, e.g. "matched 14 consecutive lines of SKILL.md" */
  evidence: string;
}

export interface Entry {
  /** path relative to the managed dir, POSIX separators, e.g. "skills/cso" */
  id: string;
  source: Source;
  base: BaseRecord;
  detection: Detection;
}

export interface Manifest {
  version: 1;
  entries: Entry[];
  /** ids present on disk with no known source */
  unknown: string[];
}

// ---------- config ----------

export interface SkilledConfig {
  version: 1;
  /** absolute paths, in precedence order */
  dirs: string[];
}

export type ConfigOrigin = 'flag' | 'env' | 'file' | 'autodetect';

export interface ResolvedConfig {
  /** absolute, validated, at least one entry */
  dirs: string[];
  /** which source actually won */
  origin: ConfigOrigin;
  /** absolute path to config.json, whether or not it exists */
  configPath: string;
  configExists: boolean;
}

// ---------- local items ----------

export type ItemKind = 'skill' | 'agent';

export interface LocalItem {
  /** e.g. "skills/cso" or "agents/ponytail.md" */
  id: string;
  /** absolute path to the file or directory */
  absPath: string;
  kind: ItemKind;
  /** file paths relative to absPath; for a single-file agent this is [""] */
  files: string[];
}

// ---------- detection ----------

export interface RepoMeta {
  /** ISO 8601 date */
  createdAt: string;
  stars: number;
  /** ISO 8601 date */
  pushedAt: string;
}

export interface Candidate {
  /** the LocalItem.id this candidate is for */
  id: string;
  source: Source;
  method: DetectionMethod;
  /** 0..1 */
  confidence: number;
  evidence: string;
  repoMeta?: RepoMeta;
}

// ---------- status ----------

export type EntryStatus = 'current' | 'behind' | 'unknown' | 'unreachable';

export interface StatusRow {
  id: string;
  status: EntryStatus;
  source?: Source;
  /** commits behind upstream; only set when status === 'behind' */
  behindBy?: number;
  /** true when LOCAL differs from BASE */
  localEdits: boolean;
}

export interface StatusReport {
  /** the managed dir this report covers */
  dir: string;
  rows: StatusRow[];
  identified: number;
  total: number;
  behind: number;
  unknown: number;
  /** ISO 8601 timestamp of last successful upstream fetch; null = never */
  fetchedAt: string | null;
}

// ---------- merge ----------

export type MergeOutcome =
  { kind: 'clean'; content: string } | { kind: 'conflict'; content: string; conflictCount: number };
