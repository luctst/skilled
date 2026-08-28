import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkilledError } from './errors.js';

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
