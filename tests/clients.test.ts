import { describe, it, expect } from 'vitest';
import { SkilledError } from '../src/errors.js';
import { nullClaudeClient, nullGitHubClient } from '../src/clients.js';
import type { Source } from '../src/types.js';

const source: Source = { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' };

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected the call to reject');
}

describe('nullGitHubClient', () => {
  const github = nullGitHubClient();

  it('rejects every method with NO_AUTH and exit code 3', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => github.searchCode('needle'),
      () => github.getRepoMeta('owner/repo'),
      () => github.listCommits(source),
      () => github.readTree(source, 'a'.repeat(40)),
    ];

    for (const call of calls) {
      const err = await captureError(call);
      expect(err.code).toBe('NO_AUTH');
      expect(err.exitCode).toBe(3);
      expect(err.cause).toContain('No managed file was modified.');
    }
  });

  it('names the operation it could not perform', async () => {
    const err = await captureError(() => github.searchCode('needle'));
    expect(err.problem).toContain('search GitHub code');
    expect(err.fixes.join('\n')).toContain('gh auth login');
  });
});

describe('nullClaudeClient', () => {
  const claude = nullClaudeClient();

  it('rejects every method with NO_AUTH and exit code 3', async () => {
    const identifyError = await captureError(() => claude.identify('an excerpt'));
    expect(identifyError.code).toBe('NO_AUTH');
    expect(identifyError.exitCode).toBe(3);
    expect(identifyError.problem).toContain('identify content with Claude');

    const conflictError = await captureError(() =>
      claude.resolveConflict({ base: 'b', local: 'l', upstream: 'u', conflicted: 'c' }),
    );
    expect(conflictError.code).toBe('NO_AUTH');
    expect(conflictError.problem).toContain('resolve a conflict with Claude');
  });
});
