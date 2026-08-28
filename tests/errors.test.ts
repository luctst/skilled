import { describe, it, expect } from 'vitest';
import { SkilledError } from '../src/errors.js';

describe('SkilledError', () => {
  const err = new SkilledError({
    code: 'BAD_DIR',
    problem: '/tmp/nope is not a managed directory.',
    cause:
      'Expected a skills/ or agents/ subdirectory. Found: notes, README.md.\nNo managed file was modified.',
    fixes: ['skilled config dir ~/.claude', 'skilled --dir <path>'],
    exitCode: 2,
  });

  it('carries the catalogue fields and behaves like an Error', () => {
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SkilledError');
    expect(err.code).toBe('BAD_DIR');
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe('/tmp/nope is not a managed directory.');
    expect(err.fixes).toEqual(['skilled config dir ~/.claude', 'skilled --dir <path>']);
  });

  it('formats problem, then cause, then fixes', () => {
    expect(err.format()).toBe(
      [
        '✗ /tmp/nope is not a managed directory.',
        '',
        '  Expected a skills/ or agents/ subdirectory. Found: notes, README.md.',
        '  No managed file was modified.',
        '',
        '  → skilled config dir ~/.claude',
        '  → skilled --dir <path>',
      ].join('\n'),
    );
  });

  it('omits the fixes block when there are none', () => {
    const bare = new SkilledError({
      code: 'NETWORK',
      problem: 'github.com is unreachable.',
      cause: 'The DNS lookup failed.',
      fixes: [],
      exitCode: 3,
    });

    expect(bare.format()).toBe(
      ['✗ github.com is unreachable.', '', '  The DNS lookup failed.'].join('\n'),
    );
  });

  it('carries BAD_SOURCE for an unparseable source URL', () => {
    const badSource = new SkilledError({
      code: 'BAD_SOURCE',
      problem: 'Cannot read a repository out of "github.com/owner".',
      cause: 'A source needs an owner and a repository name, like github.com/owner/repo.',
      fixes: ['skilled add https://github.com/owner/repo skills/cso'],
      exitCode: 2,
    });

    expect(badSource.code).toBe('BAD_SOURCE');
    expect(badSource.exitCode).toBe(2);
  });
});
