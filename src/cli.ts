#!/usr/bin/env node
import { SkilledError } from './errors.js';
import type { LocalItem, ResolvedConfig } from './types.js';

export interface ParsedArgs {
  args: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set([
  'refresh',
  'json',
  'no-color',
  'confirm-each',
  'help',
  'version',
  'add',
]);
const VALUE_FLAGS = new Set(['dir']);
const SHORT_FLAGS: Record<string, string> = { h: 'help', V: 'version' };

function badFlag(token: string, why: string): SkilledError {
  return new SkilledError({
    code: 'BAD_FLAG',
    problem: `Unusable flag: ${token}`,
    cause: `${why}. No managed file was modified.`,
    fixes: ['skilled --help   list every flag'],
    exitCode: 2,
  });
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (positionalOnly) {
      args.push(token);
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    if (token === '-' || !token.startsWith('-')) {
      args.push(token);
      continue;
    }

    const isLong = token.startsWith('--');
    const body = isLong ? token.slice(2) : token.slice(1);
    const eq = body.indexOf('=');
    const rawName = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);
    const name = isLong ? rawName : (SHORT_FLAGS[rawName] ?? rawName);

    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[i + 1];
      if (inlineValue === undefined) i += 1;
      if (value === undefined || value.length === 0) {
        throw badFlag(token, `--${name} needs a value, e.g. --${name} ~/.claude`);
      }
      flags[name] = value;
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw badFlag(token, `--${name} is a switch and takes no value`);
      }
      flags[name] = true;
      continue;
    }

    throw badFlag(token, `skilled has no ${token} flag`);
  }

  return { args, flags };
}

/** NO_COLOR and --json both win over a TTY; FORCE_COLOR wins over no TTY. */
export function shouldUseColor(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
): boolean {
  if (flags['no-color'] === true) return false;
  if (flags.json === true) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return true;
  return isTTY;
}

export interface Command {
  name: string;
  summary: string;
  run(ctx: CommandContext): Promise<number>; // returns exit code
}

export interface CommandContext {
  args: string[];
  flags: Record<string, string | boolean>;
  config: ResolvedConfig;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Always supplied by run(). Commands read this instead of process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The whole surface. scan backs bare `skilled`; show backs `skilled <entry>`.
 * A reserved name with no command registered is reported, not guessed at.
 */
export const RESERVED_COMMANDS: readonly string[] = [
  'scan',
  'show',
  'update',
  'add',
  'remove',
  'config',
];

const registry = new Map<string, Command>();

/** Registering a name twice replaces it: later specs override spec 01's commands. */
export function registerCommand(c: Command): void {
  registry.set(c.name, c);
}

export function getCommand(name: string): Command | undefined {
  return registry.get(name);
}

export function listCommands(): Command[] {
  return [...registry.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function normalizeName(name: string): string {
  let n = name.trim().replace(/\\/g, '/');
  while (n.endsWith('/')) n = n.slice(0, -1);
  if (n.startsWith('./')) n = n.slice(2);
  if (n.toLowerCase().endsWith('.md')) n = n.slice(0, -3);
  return n.toLowerCase();
}

/** Accepts a full id, a bare basename, or an agent filename. */
export function resolveName(name: string, items: LocalItem[]): LocalItem {
  const wanted = normalizeName(name);
  const matches = items.filter((item) => {
    const id = normalizeName(item.id);
    return id === wanted || id.slice(id.lastIndexOf('/') + 1) === wanted;
  });

  const only = matches[0];
  if (matches.length === 1 && only !== undefined) return only;

  if (matches.length === 0) {
    throw new SkilledError({
      code: 'UNKNOWN_ENTRY',
      problem: `No skill or agent named "${name}".`,
      cause: `${items.length} entries were found in the managed directory and none of them matched. No managed file was modified.`,
      fixes: [
        'skilled            list everything that was found',
        'skilled config     check which directory skilled manages',
      ],
      exitCode: 2,
    });
  }

  throw new SkilledError({
    code: 'AMBIGUOUS_NAME',
    problem: `"${name}" matches ${matches.length} entries.`,
    cause: `Candidates: ${matches.map((item) => item.id).join(', ')}. No managed file was modified.`,
    fixes: matches.map((item) => `skilled ${item.id}`),
    exitCode: 2,
  });
}
