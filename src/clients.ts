import { SkilledError } from './errors.js';
import type { RepoMeta, Source } from './types.js';

export interface GitHubClient {
  searchCode(query: string): Promise<Array<{ repo: string; path: string }>>;
  getRepoMeta(repo: string): Promise<RepoMeta>;
  listCommits(
    source: Source,
    sinceSha?: string,
  ): Promise<Array<{ sha: string; date: string; message: string }>>;
  readTree(source: Source, sha: string): Promise<Map<string, string>>; // relpath -> text
}

export interface ClaudeClient {
  /** returns "owner/name" or null when it cannot identify the content */
  identify(excerpt: string): Promise<string | null>;
  /** resolves a conflicted merge; returns merged content or null to give up */
  resolveConflict(args: {
    base: string;
    local: string;
    upstream: string;
    conflicted: string;
  }): Promise<string | null>;
}

function noGitHubAuth(operation: string): SkilledError {
  return new SkilledError({
    code: 'NO_AUTH',
    problem: `Cannot ${operation}: no GitHub credentials are available.`,
    cause:
      'skilled borrows a token from the gh CLI and no usable token was found. No managed file was modified.',
    fixes: [
      'gh auth login',
      'export GITHUB_TOKEN=<token>',
      'skilled            re-run offline; the free detection strategies still work',
    ],
    exitCode: 3,
  });
}

function noClaudeClient(operation: string): SkilledError {
  return new SkilledError({
    code: 'NO_AUTH',
    problem: `Cannot ${operation}: no Claude client is configured.`,
    cause:
      'This build has no Claude integration wired up, so it cannot ask Claude anything. No managed file was modified.',
    fixes: [
      'skilled            re-run; the deterministic strategies still work',
      'skilled <name>     see how an entry was identified without Claude',
    ],
    exitCode: 3,
  });
}

/**
 * Every method throws SkilledError NO_AUTH. Lets specs 01-02 ship before the
 * real clients exist in spec 03's fetch.ts.
 */
export function nullGitHubClient(): GitHubClient {
  return {
    async searchCode() {
      throw noGitHubAuth('search GitHub code');
    },
    async getRepoMeta() {
      throw noGitHubAuth('read GitHub repository metadata');
    },
    async listCommits() {
      throw noGitHubAuth('list upstream commits');
    },
    async readTree() {
      throw noGitHubAuth('read an upstream file tree');
    },
  };
}

export function nullClaudeClient(): ClaudeClient {
  return {
    async identify() {
      throw noClaudeClient('identify content with Claude');
    },
    async resolveConflict() {
      throw noClaudeClient('resolve a conflict with Claude');
    },
  };
}
