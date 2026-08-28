import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SkilledError } from './errors.js';
import type { ConfigOrigin, ResolvedConfig, SkilledConfig } from './types.js';

/** Home directory, from the injected env when present so tests stay hermetic. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  return home !== undefined && home.length > 0 ? home : os.homedir();
}

/** ~/.config/skilled/config.json — config lives outside the managed dir by design. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg.length > 0 ? xdg : path.join(homeDir(env), '.config');
  return path.join(base, 'skilled', 'config.json');
}

/** The directory skilled falls back to when nothing else is configured. */
export function autodetectDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(homeDir(env), '.claude');
}

export function stateDir(managedDir: string): string {
  return path.join(managedDir, '.skilled');
}

export function manifestPath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'manifest.json');
}

/** id uses POSIX separators, so split it before joining. */
export function basePath(managedDir: string, id: string): string {
  return path.join(stateDir(managedDir), 'base', ...id.split('/'));
}

export function cachePath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'cache', 'status.json');
}

export function statusLinePath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'status');
}

/** Expands a leading `~` and resolves to an absolute path. */
export function expandPath(p: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = homeDir(env);
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return path.resolve(p);
}

/** fs.stat follows symlinks, so a symlinked skills/ still counts. */
async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A directory qualifies as managed only when it exists and contains a skills/
 * or agents/ subdirectory. Throws SkilledError BAD_DIR otherwise — never accept
 * a typo silently.
 */
export async function validateManagedDir(dir: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new SkilledError({
      code: 'BAD_DIR',
      problem: `Managed directory not found: ${dir}`,
      cause:
        'skilled needs an existing directory that contains a skills/ or agents/ subdirectory; that path does not exist.',
      fixes: [
        `mkdir -p ${path.join(dir, 'skills')}`,
        'skilled config dir <path>   point skilled somewhere else',
        'skilled config             show what is configured now',
      ],
      exitCode: 2,
    });
  }

  if (!stat.isDirectory()) {
    throw new SkilledError({
      code: 'BAD_DIR',
      problem: `Not a directory: ${dir}`,
      cause:
        'The managed directory must be a directory containing skills/ or agents/; this path is a file.',
      fixes: [
        'skilled config dir <path>   point skilled at a directory',
        'skilled config             show what is configured now',
      ],
      exitCode: 2,
    });
  }

  if (
    (await isDirectory(path.join(dir, 'skills'))) ||
    (await isDirectory(path.join(dir, 'agents')))
  ) {
    return;
  }

  const names = (await fs.readdir(dir, { withFileTypes: true }))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .sort();
  const found =
    names.length === 0
      ? '(empty)'
      : `${names.slice(0, 5).join(', ')}${names.length > 5 ? `, … (${names.length} entries)` : ''}`;

  throw new SkilledError({
    code: 'BAD_DIR',
    problem: `${dir} is not a managed directory.`,
    cause: `Expected a skills/ or agents/ subdirectory. Found: ${found}.`,
    fixes: [
      `mkdir -p ${path.join(dir, 'skills')}`,
      'skilled config dir <path>   point skilled somewhere else',
      'skilled config             show what is configured now',
    ],
    exitCode: 2,
  });
}

const configFileSchema = z.object({
  version: z.literal(1),
  dirs: z.array(z.string()),
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Writes JSON through a temp file so a crash cannot leave a half-written file. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function badConfigFile(cfgPath: string, problem: string, detail: string): SkilledError {
  return new SkilledError({
    code: 'BAD_DIR',
    problem,
    cause: `${detail} No managed file was modified.`,
    fixes: [
      `cat ${cfgPath}`,
      `rm ${cfgPath}   start over from auto-detection`,
      'skilled config dir <path>   rewrite it',
    ],
    exitCode: 2,
  });
}

/** Reads ~/.config/skilled/config.json. An absent file is not an error. */
export async function readConfigFile(cfgPath: string): Promise<SkilledConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(cfgPath, 'utf8');
  } catch {
    return { version: 1, dirs: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw badConfigFile(cfgPath, `${cfgPath} is not valid JSON.`, `Parsing it failed: ${message}.`);
  }

  const result = configFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw badConfigFile(
      cfgPath,
      `${cfgPath} is not a valid skilled config.`,
      `Field \`${field}\`: ${issue.message}.`,
    );
  }

  const config: SkilledConfig = result.data;
  return config;
}

export interface ResolveConfigOptions {
  dirFlag?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * When true, a managed dir that fails validation is dropped instead of
   * throwing. Only `skilled config` sets this: it must run even when the
   * current setup is broken. An explicit dirFlag is always strict.
   */
  tolerant?: boolean;
}

async function keepValid(dirs: string[], tolerant: boolean): Promise<string[]> {
  const kept: string[] = [];
  for (const dir of dirs) {
    try {
      await validateManagedDir(dir);
      kept.push(dir);
    } catch (err) {
      if (!tolerant) throw err;
    }
  }
  return kept;
}

/**
 * Precedence, highest first: --dir flag, SKILLED_DIR, config file, ~/.claude.
 * origin reports which one actually applied, so it is never a mystery.
 */
export async function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig> {
  const env = opts.env ?? process.env;
  const tolerant = opts.tolerant === true;
  const cfgPath = configPath(env);
  const configExists = await pathExists(cfgPath);

  const finish = async (dirs: string[], origin: ConfigOrigin): Promise<ResolvedConfig> => ({
    dirs: await keepValid(dirs, tolerant),
    origin,
    configPath: cfgPath,
    configExists,
  });

  if (opts.dirFlag !== undefined && opts.dirFlag.length > 0) {
    const dir = expandPath(opts.dirFlag, env);
    await validateManagedDir(dir);
    return { dirs: [dir], origin: 'flag', configPath: cfgPath, configExists };
  }

  const envDir = env.SKILLED_DIR;
  if (envDir !== undefined && envDir.length > 0) {
    return await finish([expandPath(envDir, env)], 'env');
  }

  if (configExists) {
    const file = await readConfigFile(cfgPath);
    if (file.dirs.length > 0) {
      return await finish(
        file.dirs.map((dir) => expandPath(dir, env)),
        'file',
      );
    }
  }

  return await finish([autodetectDir(env)], 'autodetect');
}
