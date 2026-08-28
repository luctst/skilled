import os from 'node:os';
import path from 'node:path';

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
