import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configPath, readConfigFile, resolveConfig } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

/** A hermetic env: HOME and XDG_CONFIG_HOME both inside a temp dir. */
async function makeEnv(): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await makeTempDir();
  created.push(home);
  return { home, env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } };
}

async function writeConfigFile(env: NodeJS.ProcessEnv, dirs: string[]): Promise<string> {
  const file = configPath(env);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ version: 1, dirs }, null, 2)}\n`, 'utf8');
  return file;
}

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected resolveConfig to reject');
}

describe('resolveConfig precedence', () => {
  it('prefers the --dir flag over everything else', async () => {
    const { home, env } = await makeEnv();
    const flagDir = await makeManagedDir(['skills']);
    const envDir = await makeManagedDir(['skills']);
    created.push(flagDir, envDir);
    await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
    await writeConfigFile(env, [envDir]);

    const resolved = await resolveConfig({
      dirFlag: flagDir,
      env: { ...env, SKILLED_DIR: envDir },
    });

    expect(resolved.dirs).toEqual([flagDir]);
    expect(resolved.origin).toBe('flag');
    expect(resolved.configPath).toBe(configPath(env));
    expect(resolved.configExists).toBe(true);
  });

  it('falls back to SKILLED_DIR', async () => {
    const { env } = await makeEnv();
    const envDir = await makeManagedDir(['agents']);
    created.push(envDir);

    const resolved = await resolveConfig({ env: { ...env, SKILLED_DIR: envDir } });

    expect(resolved.dirs).toEqual([envDir]);
    expect(resolved.origin).toBe('env');
    expect(resolved.configExists).toBe(false);
  });

  it('falls back to the config file, keeping its order', async () => {
    const { env } = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);
    await writeConfigFile(env, [first, second]);

    const resolved = await resolveConfig({ env });

    expect(resolved.dirs).toEqual([first, second]);
    expect(resolved.origin).toBe('file');
    expect(resolved.configExists).toBe(true);
  });

  it('falls back to auto-detecting ~/.claude', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });

    const resolved = await resolveConfig({ env });

    expect(resolved.dirs).toEqual([path.join(home, '.claude')]);
    expect(resolved.origin).toBe('autodetect');
    expect(resolved.configExists).toBe(false);
  });

  it('auto-detects when the config file has no dirs', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, '.claude', 'agents'), { recursive: true });
    await writeConfigFile(env, []);

    const resolved = await resolveConfig({ env });

    expect(resolved.origin).toBe('autodetect');
    expect(resolved.dirs).toEqual([path.join(home, '.claude')]);
  });

  it('expands a tilde in the env var', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, 'codex', 'skills'), { recursive: true });

    const resolved = await resolveConfig({ env: { ...env, SKILLED_DIR: '~/codex' } });

    expect(resolved.dirs).toEqual([path.join(home, 'codex')]);
    expect(resolved.origin).toBe('env');
  });
});

describe('resolveConfig failure modes', () => {
  it('rejects an invalid --dir flag', async () => {
    const { env } = await makeEnv();

    const err = await captureError(() => resolveConfig({ dirFlag: '/definitely/not/here', env }));
    expect(err.code).toBe('BAD_DIR');
    expect(err.exitCode).toBe(2);
  });

  it('rejects when auto-detection finds nothing', async () => {
    const { home, env } = await makeEnv();

    const err = await captureError(() => resolveConfig({ env }));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain(path.join(home, '.claude'));
  });

  it('returns no dirs instead of throwing in tolerant mode', async () => {
    const { env } = await makeEnv();

    const resolved = await resolveConfig({ env, tolerant: true });

    expect(resolved.dirs).toEqual([]);
    expect(resolved.origin).toBe('autodetect');
  });

  it('still validates an explicit --dir in tolerant mode', async () => {
    const { env } = await makeEnv();

    const err = await captureError(() =>
      resolveConfig({ dirFlag: '/definitely/not/here', env, tolerant: true }),
    );
    expect(err.code).toBe('BAD_DIR');
  });
});

describe('readConfigFile', () => {
  it('returns an empty config when the file is absent', async () => {
    const { env } = await makeEnv();

    expect(await readConfigFile(configPath(env))).toEqual({ version: 1, dirs: [] });
  });

  it('rejects a file that is not JSON', async () => {
    const { env } = await makeEnv();
    const file = configPath(env);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json at all', 'utf8');

    const err = await captureError(() => readConfigFile(file));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain('is not valid JSON');
    expect(err.cause).toContain('No managed file was modified.');
  });

  it('names the offending field when the shape is wrong', async () => {
    const { env } = await makeEnv();
    const file = configPath(env);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 1, dirs: 'nope' }), 'utf8');

    const err = await captureError(() => readConfigFile(file));
    expect(err.code).toBe('BAD_DIR');
    expect(err.cause).toContain('dirs');
  });
});
