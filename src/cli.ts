#!/usr/bin/env node
import { SkilledError } from './errors.js';

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
