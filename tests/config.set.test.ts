import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configPath, setConfigDir } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

async function makeEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await makeTempDir();
  created.push(home);
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
}

describe('setConfigDir', () => {
  it('writes the config file, creating the directory tree', async () => {
    const env = await makeEnv();
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    const saved = await setConfigDir(dir, 'replace', env);

    expect(saved).toEqual({ version: 1, dirs: [dir] });
    const onDisk = JSON.parse(await fs.readFile(configPath(env), 'utf8')) as unknown;
    expect(onDisk).toEqual({ version: 1, dirs: [dir] });
  });

  it('replaces the previous directory in replace mode', async () => {
    const env = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);

    await setConfigDir(first, 'replace', env);
    const saved = await setConfigDir(second, 'replace', env);

    expect(saved.dirs).toEqual([second]);
  });

  it('appends in add mode and de-duplicates', async () => {
    const env = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);

    await setConfigDir(first, 'replace', env);
    const withSecond = await setConfigDir(second, 'add', env);
    const again = await setConfigDir(first, 'add', env);

    expect(withSecond.dirs).toEqual([first, second]);
    expect(again.dirs).toEqual([second, first]);
  });

  it('expands a tilde before saving', async () => {
    const env = await makeEnv();
    const home = env.HOME as string;
    await fs.mkdir(path.join(home, 'codex', 'skills'), { recursive: true });

    const saved = await setConfigDir('~/codex', 'replace', env);

    expect(saved.dirs).toEqual([path.join(home, 'codex')]);
  });

  it('never saves a directory that is not managed', async () => {
    const env = await makeEnv();
    const plain = await makeTempDir();
    created.push(plain);

    await expect(setConfigDir(plain, 'replace', env)).rejects.toBeInstanceOf(SkilledError);
    await expect(fs.stat(configPath(env))).rejects.toThrow();
  });

  it('leaves no temp file behind', async () => {
    const env = await makeEnv();
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    await setConfigDir(dir, 'replace', env);

    const entries = await fs.readdir(path.dirname(configPath(env)));
    expect(entries).toEqual(['config.json']);
  });
});
