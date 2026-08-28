#!/usr/bin/env node
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from './config.js';
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

export interface RunIO {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

export function usage(): string {
  return [
    'skilled — keep collected skills and agents current',
    '',
    'Usage',
    '  skilled                      scan the managed directory and report',
    '  skilled <name>               detail on one entry',
    '  skilled update [<name>]      review and apply upstream changes, one at a time',
    '  skilled add <url> [<path>]   register a source by hand',
    '  skilled remove <name>        stop tracking an entry; the file is left alone',
    '  skilled config [dir <path>]  show or set the managed directory',
    '',
    'Flags',
    '  --refresh          hit the network instead of reading the cache',
    '  --json             machine-readable output, no human output',
    '  --dir <path>       one-off managed-directory override',
    '  --no-color         disable color (also honored via NO_COLOR)',
    '  --confirm-each     confirm every detected source, including certain ones',
    '  -h, --help         this help',
    '  -V, --version      print the version',
    '',
    'Exit codes',
    '  0 everything current   1 something is stale   2 user error',
    '  3 operational failure  4 unresolved conflict',
  ].join('\n');
}

/** Reads the version from the package's own package.json, in src/ and in dist/. */
export async function readVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Commands added by later specs. They import registerCommand from this module,
 * so they must be loaded and called from inside run(), never at module scope.
 * The specifiers are plain strings so tsc does not resolve modules that do not
 * exist in this build.
 */
const OPTIONAL_COMMAND_MODULES: ReadonlyArray<{ specifier: string; registrar: string }> = [
  { specifier: './commands/index.js', registrar: 'registerCommands' },
  { specifier: './update.js', registrar: 'registerUpdateCommand' },
];

async function registerOptionalCommands(): Promise<void> {
  for (const { specifier, registrar } of OPTIONAL_COMMAND_MODULES) {
    let loaded: Record<string, unknown>;
    try {
      loaded = (await import(specifier)) as Record<string, unknown>;
    } catch (err) {
      // Node reports a missing module with a code; Vitest's module runner
      // reports it with a message instead. Anything else is a real defect.
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : String(err);
      const missing =
        code === 'ERR_MODULE_NOT_FOUND' ||
        /cannot find module|failed to load url|failed to resolve import/i.test(message);
      if (missing) continue;
      throw err;
    }
    const register = loaded[registrar];
    if (typeof register === 'function') (register as () => void)();
  }
}

let commandsRegistered = false;

/**
 * Registers every command, once per process. Built-ins first, then the sibling
 * specs' registrars, so a later spec's command of the same name wins.
 * A test that overrides a command must await this before registering its double.
 */
export async function ensureCommands(): Promise<void> {
  if (commandsRegistered) return;
  commandsRegistered = true;
  await registerOptionalCommands();
}

/** Returns the exit code instead of calling process.exit, so tests can assert it. */
export async function run(argv: string[], io: RunIO = {}): Promise<number> {
  const stdout =
    io.stdout ??
    ((s: string) => {
      process.stdout.write(`${s}\n`);
    });
  const stderr =
    io.stderr ??
    ((s: string) => {
      process.stderr.write(`${s}\n`);
    });
  const env = io.env ?? process.env;
  const isTTY = io.isTTY ?? process.stdout.isTTY === true;

  try {
    await ensureCommands();

    const { args, flags } = parseArgs(argv);
    flags.color = shouldUseColor(flags, env, isTTY);
    flags.json = flags.json === true;
    flags.refresh = flags.refresh === true;

    if (flags.help === true) {
      stdout(usage());
      return 0;
    }
    if (flags.version === true) {
      stdout(await readVersion());
      return 0;
    }

    const first = args[0];
    let commandName: string;
    let commandArgs: string[];
    if (first === undefined) {
      commandName = 'scan';
      commandArgs = [];
    } else if (getCommand(first) !== undefined) {
      commandName = first;
      commandArgs = args.slice(1);
    } else if (RESERVED_COMMANDS.includes(first)) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: `\`skilled ${first}\` is not available in this build.`,
        cause: `${first} is part of skilled's command surface but is not wired up here. No managed file was modified.`,
        fixes: [
          'skilled            scan and report',
          'skilled config     show or set the managed directory',
          'skilled --help     the full surface',
        ],
        exitCode: 2,
      });
    } else {
      commandName = 'show';
      commandArgs = args;
    }

    const command = getCommand(commandName);
    if (command === undefined) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: `\`skilled ${commandName}\` is not available in this build.`,
        cause: `${commandName} is part of skilled's command surface but is not wired up here. No managed file was modified.`,
        fixes: [
          'skilled config     show or set the managed directory',
          'skilled --help     the full surface',
        ],
        exitCode: 2,
      });
    }

    const dirFlag = typeof flags.dir === 'string' ? flags.dir : undefined;
    const config = await resolveConfig({ dirFlag, env, tolerant: commandName === 'config' });

    return await command.run({ args: commandArgs, flags, config, stdout, stderr, env });
  } catch (err) {
    if (err instanceof SkilledError) {
      stderr(err.format());
      return err.exitCode;
    }
    if (env.SKILLED_DEBUG !== undefined && env.SKILLED_DEBUG !== '') throw err;
    const message = err instanceof Error ? err.message : String(err);
    stderr(
      [
        '✗ skilled hit an unexpected failure.',
        '',
        `  ${message}`,
        '  This is a bug in skilled. No managed file was modified.',
        '',
        '  → re-run with SKILLED_DEBUG=1 to see a stack trace',
      ].join('\n'),
    );
    return 3;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // process.exitCode rather than process.exit, so stdout is never truncated
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 3;
    },
  );
}
