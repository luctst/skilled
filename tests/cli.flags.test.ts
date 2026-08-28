import { describe, it, expect } from 'vitest';
import { parseArgs, shouldUseColor } from '../src/cli.js';
import { SkilledError } from '../src/errors.js';

function captureError(run: () => unknown): SkilledError {
  try {
    run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected parseArgs to throw');
}

describe('parseArgs', () => {
  it('returns nothing for no arguments', () => {
    expect(parseArgs([])).toEqual({ args: [], flags: {} });
  });

  it('keeps positional arguments in order', () => {
    expect(parseArgs(['add', 'https://github.com/o/r', 'skills/cso']).args).toEqual([
      'add',
      'https://github.com/o/r',
      'skills/cso',
    ]);
  });

  it('parses the switches', () => {
    expect(parseArgs(['--refresh', '--json', '--no-color', '--confirm-each']).flags).toEqual({
      refresh: true,
      json: true,
      'no-color': true,
      'confirm-each': true,
    });
  });

  it('accepts --confirm-each, which spec 02 reads', () => {
    // Spec 02's provenance confirmation reads this flag. If it is missing from
    // BOOLEAN_FLAGS, `skilled --confirm-each` exits 2 before any command runs.
    expect(parseArgs(['--confirm-each']).flags['confirm-each']).toBe(true);
  });

  it('parses --dir in both forms', () => {
    expect(parseArgs(['--dir', '~/.codex']).flags.dir).toBe('~/.codex');
    expect(parseArgs(['--dir=~/.codex']).flags.dir).toBe('~/.codex');
  });

  it('parses the short flags', () => {
    expect(parseArgs(['-h']).flags.help).toBe(true);
    expect(parseArgs(['-V']).flags.version).toBe(true);
  });

  it('parses --add for config dir', () => {
    const parsed = parseArgs(['config', 'dir', '--add', './.claude']);

    expect(parsed.args).toEqual(['config', 'dir', './.claude']);
    expect(parsed.flags.add).toBe(true);
  });

  it('treats everything after -- as positional', () => {
    expect(parseArgs(['--', '--dir']).args).toEqual(['--dir']);
  });

  it('rejects an unknown flag', () => {
    const err = captureError(() => parseArgs(['--turbo']));

    expect(err.code).toBe('BAD_FLAG');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain('--turbo');
    expect(err.fixes.join('\n')).toContain('skilled --help');
  });

  it('rejects --dir without a value', () => {
    const err = captureError(() => parseArgs(['--dir']));

    expect(err.code).toBe('BAD_FLAG');
    expect(err.cause).toContain('needs a value');
  });

  it('rejects a value given to a switch', () => {
    const err = captureError(() => parseArgs(['--json=yes']));

    expect(err.cause).toContain('takes no value');
  });
});

describe('shouldUseColor', () => {
  it('follows the TTY by default', () => {
    expect(shouldUseColor({}, {}, true)).toBe(true);
    expect(shouldUseColor({}, {}, false)).toBe(false);
  });

  it('honors --no-color and NO_COLOR', () => {
    expect(shouldUseColor({ 'no-color': true }, {}, true)).toBe(false);
    expect(shouldUseColor({}, { NO_COLOR: '1' }, true)).toBe(false);
    expect(shouldUseColor({}, { NO_COLOR: '' }, true)).toBe(true);
  });

  it('never colors machine-readable output', () => {
    expect(shouldUseColor({ json: true }, {}, true)).toBe(false);
  });

  it('honors FORCE_COLOR when there is no TTY', () => {
    expect(shouldUseColor({}, { FORCE_COLOR: '1' }, false)).toBe(true);
  });
});
