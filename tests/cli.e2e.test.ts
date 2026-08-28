import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../src/cli.js';
import { configPath } from '../src/config.js';
import {
  copyManagedFixture,
  makeManagedDir,
  makeTempDir,
  removeTempDir,
} from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Session {
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

/** One shell session: a hermetic HOME, a shared env, fresh output buffers. */
function session(env: NodeJS.ProcessEnv, isTTY = false): Session {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    env,
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env, isTTY },
  };
}

async function hermeticEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await makeTempDir();
  created.push(home);
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
}

describe('first run, end to end', () => {
  it('goes from no config, to a saved directory, to a scan of it', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    const before = session(env);
    expect(await run(['config'], before.io)).toBe(0);
    expect(before.out.join('\n')).toContain('(none)');

    const saving = session(env);
    expect(await run(['config', 'dir', managed], saving.io)).toBe(0);
    expect(saving.out.join('\n')).toContain('✓ saved');

    const scanning = session(env);
    expect(await run([], scanning.io)).toBe(0);
    expect(scanning.out.join('\n')).toContain('0 of 6 identified');

    const detail = session(env);
    expect(await run(['marketing-ads'], detail.io)).toBe(0);
    expect(detail.out.join('\n')).toContain('references/ad-copy-patterns.md');
  });

  it('lets SKILLED_DIR override the saved config for one run', async () => {
    const env = await hermeticEnv();
    const saved = await copyManagedFixture();
    const other = await makeManagedDir(['skills']);
    created.push(saved, other);
    await fs.writeFile(path.join(other, 'skills', 'solo.md'), '# solo\n', 'utf8');

    await run(['config', 'dir', saved], session(env).io);

    const overridden = session({ ...env, SKILLED_DIR: other });
    expect(await run(['config'], overridden.io)).toBe(0);
    expect(overridden.out.join('\n')).toContain('(SKILLED_DIR env var)');
    expect(overridden.out.join('\n')).toContain('1 skill');
  });

  it('scans every configured directory', async () => {
    const env = await hermeticEnv();
    const first = await copyManagedFixture();
    const second = await makeManagedDir(['agents']);
    created.push(first, second);
    await fs.writeFile(path.join(second, 'agents', 'solo.md'), '# solo\n', 'utf8');

    await run(['config', 'dir', first], session(env).io);
    await run(['config', 'dir', '--add', second], session(env).io);

    const scanning = session(env);
    expect(await run([], scanning.io)).toBe(0);
    const text = scanning.out.join('\n');
    expect(text).toContain('0 of 6 identified');
    expect(text).toContain('0 of 1 identified');

    const asJson = session(env);
    expect(await run(['--json'], asJson.io)).toBe(0);
    expect(asJson.err.join('\n')).toContain('--json covers');
    expect(JSON.parse(asJson.out.join('\n')).dir).toBe(first);
  });

  it('colors output for a TTY and never for --json or --no-color', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    const tty = session(env, true);
    await run(['--dir', managed], tty.io);
    expect(tty.out.join('\n')).toContain('[1m');

    const noColor = session(env, true);
    await run(['--dir', managed, '--no-color'], noColor.io);
    expect(noColor.out.join('\n')).not.toContain('[1m');

    const asJson = session(env, true);
    await run(['--dir', managed, '--json'], asJson.io);
    expect(asJson.out.join('\n')).not.toContain('[1m');
  });

  it('never touches the real config path', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    await run(['config', 'dir', managed], session(env).io);

    expect(configPath(env).startsWith(env.HOME as string)).toBe(true);
    await expect(fs.stat(configPath(env))).resolves.toBeDefined();
  });

  it('keeps every documented exit code reachable from the CLI', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    expect(await run(['--dir', managed], session(env).io)).toBe(0);
    expect(await run(['--turbo'], session(env).io)).toBe(2);
    expect(await run(['--dir', '/definitely/not/here'], session(env).io)).toBe(2);
    expect(await run(['nope', '--dir', managed], session(env).io)).toBe(2);
    expect(await run(['update'], session(env).io)).toBe(2);
  });
});
