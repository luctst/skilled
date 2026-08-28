import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureCommands, getCommand, registerCommand, run, usage } from '../src/cli.js';
import type { Command, CommandContext } from '../src/cli.js';
import { makeTempDir, removeTempDir } from './fixtures/index.js';

// Register the real commands first, so the doubles below win over them.
beforeAll(async () => {
  await ensureCommands();
});

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Capture {
  out: string[];
  err: string[];
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}

/** A hermetic home with a valid ~/.claude, so auto-detection succeeds. */
async function capture(): Promise<Capture> {
  const home = await makeTempDir();
  created.push(home);
  await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    },
  };
}

let seen: CommandContext | null = null;

const spy: Command = {
  name: 'scan',
  summary: 'a test double for scan',
  async run(ctx) {
    seen = ctx;
    return 0;
  },
};

afterEach(() => {
  seen = null;
});

describe('run', () => {
  it('prints usage for --help and -h', async () => {
    const first = await capture();
    expect(await run(['--help'], first.io)).toBe(0);
    expect(first.out.join('\n')).toContain('skilled config [dir <path>]');

    const second = await capture();
    expect(await run(['-h'], second.io)).toBe(0);
    expect(second.out.join('\n')).toBe(usage());
  });

  it('prints the package version for --version', async () => {
    const c = await capture();

    expect(await run(['--version'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('tolerates the later specs command modules being absent', async () => {
    // spec 01 ships without ./commands/index.js and ./update.js
    await expect(ensureCommands()).resolves.toBeUndefined();
  });

  it('dispatches a bare invocation to scan', async () => {
    registerCommand(spy);
    const c = await capture();

    expect(await run([], c.io)).toBe(0);
    expect(seen?.args).toEqual([]);
  });

  it('normalizes color, json, and refresh into booleans', async () => {
    registerCommand(spy);
    const c = await capture();

    await run(['--json'], c.io);

    expect(seen?.flags.json).toBe(true);
    expect(seen?.flags.color).toBe(false);
    expect(seen?.flags.refresh).toBe(false);
  });

  it('passes the resolved config and env to the command', async () => {
    registerCommand(spy);
    const c = await capture();

    await run([], c.io);

    expect(seen?.config.origin).toBe('autodetect');
    expect(seen?.config.dirs).toEqual([path.join(c.io.env.HOME as string, '.claude')]);
    expect(seen?.env).toBe(c.io.env);
  });

  it('returns the exit code the command returns', async () => {
    registerCommand({
      ...spy,
      async run() {
        return 1;
      },
    });
    const c = await capture();

    expect(await run([], c.io)).toBe(1);
  });

  it('routes an unrecognized first argument to show, arguments unchanged', async () => {
    registerCommand({
      name: 'show',
      summary: 'a test double for show',
      async run(ctx) {
        seen = ctx;
        return 0;
      },
    });
    const c = await capture();

    await run(['cso'], c.io);

    expect(seen?.args).toEqual(['cso']);
  });

  it('strips the command name from the arguments it passes on', async () => {
    registerCommand({
      name: 'add',
      summary: 'a test double for add',
      async run(ctx) {
        seen = ctx;
        return 0;
      },
    });
    const c = await capture();

    await run(['add', 'https://github.com/o/r', 'skills/cso'], c.io);

    expect(seen?.args).toEqual(['https://github.com/o/r', 'skills/cso']);
  });

  it('says plainly when a reserved command is not wired up', async () => {
    expect(getCommand('remove')).toBeUndefined();
    const c = await capture();

    expect(await run(['remove', 'cso'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('`skilled remove` is not available in this build');
  });

  it('maps a SkilledError to its exit code and prints it to stderr', async () => {
    const c = await capture();

    expect(await run(['--turbo'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('✗ Unusable flag: --turbo');
    expect(c.out).toEqual([]);
  });

  it('exits 2 when the managed directory cannot be resolved', async () => {
    registerCommand(spy);
    const home = await makeTempDir();
    created.push(home);
    const out: string[] = [];
    const err: string[] = [];

    const code = await run([], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    });

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('Managed directory not found');
  });

  it('reports an unexpected failure as a bug and exits 3', async () => {
    registerCommand({
      name: 'scan',
      summary: 'a test double that throws',
      async run() {
        throw new TypeError('cannot read properties of undefined');
      },
    });
    const c = await capture();

    expect(await run([], c.io)).toBe(3);
    expect(c.err.join('\n')).toContain('This is a bug in skilled.');
    expect(c.err.join('\n')).toContain('cannot read properties of undefined');
  });
});
