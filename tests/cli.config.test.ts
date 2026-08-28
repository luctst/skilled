import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../src/cli.js';
import { configPath } from '../src/config.js';
import { copyManagedFixture, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Capture {
  out: string[];
  err: string[];
  env: NodeJS.ProcessEnv;
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}

/** A hermetic home with no ~/.claude: auto-detection finds nothing. */
async function capture(): Promise<Capture> {
  const home = await makeTempDir();
  created.push(home);
  const env: NodeJS.ProcessEnv = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    env,
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env, isTTY: false },
  };
}

describe('skilled config', () => {
  it('reports the directory, the config file, and which source won', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('managed directory');
    expect(text).toContain(managed);
    expect(text).toContain('(--dir flag)');
    expect(text).toContain('4 skills, 2 agents');
    expect(text).toContain(configPath(c.env));
    expect(text).toContain('(not created yet)');
  });

  it('runs even when no managed directory can be found', async () => {
    const c = await capture();

    const code = await run(['config'], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('(none)');
    expect(text).toContain('No managed directory yet.');
    expect(text).toContain('skilled config dir <path>');
  });

  it('saves a directory and reports what it found', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', 'dir', managed], c.io);

    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('✓ saved');
    expect(c.out.join('\n')).toContain('found 4 skills, 2 agents');
    expect(JSON.parse(await fs.readFile(configPath(c.env), 'utf8'))).toEqual({
      version: 1,
      dirs: [managed],
    });
  });

  it('reports the config file as the winning source once it is saved', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    await run(['config', 'dir', managed], c.io);
    const after = await capture();
    after.io.env.HOME = c.env.HOME;
    after.io.env.XDG_CONFIG_HOME = c.env.XDG_CONFIG_HOME;

    const code = await run(['config'], after.io);

    expect(code).toBe(0);
    expect(after.out.join('\n')).toContain('(config file)');
    expect(after.out.join('\n')).toContain('(in use)');
  });

  it('adds a second directory with --add', async () => {
    const first = await copyManagedFixture();
    const second = await copyManagedFixture();
    created.push(first, second);
    const c = await capture();

    await run(['config', 'dir', first], c.io);
    const code = await run(['config', 'dir', '--add', second], c.io);

    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('managing 2 directories:');
    expect(JSON.parse(await fs.readFile(configPath(c.env), 'utf8'))).toEqual({
      version: 1,
      dirs: [first, second],
    });
  });

  it('refuses a path that is not a managed directory and saves nothing', async () => {
    const plain = await makeTempDir();
    created.push(plain);
    const c = await capture();

    const code = await run(['config', 'dir', plain], c.io);

    expect(code).toBe(2);
    expect(c.err.join('\n')).toContain('is not a managed directory');
    expect(c.err.join('\n')).toContain('Expected a skills/ or agents/ subdirectory');
    await expect(fs.stat(configPath(c.env))).rejects.toThrow();
  });

  it('rejects config dir without a path', async () => {
    const c = await capture();

    expect(await run(['config', 'dir'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('needs a path');
  });

  it('rejects an unknown subcommand', async () => {
    const c = await capture();

    expect(await run(['config', 'reset'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('reset');
    expect(c.err.join('\n')).toContain('skilled config dir <path>');
  });

  it('emits JSON with --json and no human output', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', '--dir', managed, '--json'], c.io);
    const parsed = JSON.parse(c.out.join('\n')) as {
      origin: string;
      configExists: boolean;
      dirs: Array<{ dir: string; skills: number; agents: number }>;
    };

    expect(code).toBe(0);
    expect(parsed.origin).toBe('flag');
    expect(parsed.configExists).toBe(false);
    expect(parsed.dirs).toEqual([{ dir: managed, skills: 4, agents: 2 }]);
  });
});
