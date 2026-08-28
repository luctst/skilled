import { describe, it, expect } from 'vitest';
import {
  RESERVED_COMMANDS,
  getCommand,
  listCommands,
  registerCommand,
  resolveName,
} from '../src/cli.js';
import type { Command, CommandContext } from '../src/cli.js';
import { SkilledError } from '../src/errors.js';
import type { LocalItem } from '../src/types.js';

const items: LocalItem[] = [
  { id: 'agents/ponytail.md', absPath: '/m/agents/ponytail.md', kind: 'agent', files: [''] },
  { id: 'agents/git.md', absPath: '/m/agents/git.md', kind: 'agent', files: [''] },
  { id: 'skills/cso', absPath: '/m/skills/cso', kind: 'skill', files: ['SKILL.md'] },
  { id: 'skills/git', absPath: '/m/skills/git', kind: 'skill', files: ['SKILL.md'] },
];

function captureError(run: () => unknown): SkilledError {
  try {
    run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected resolveName to throw');
}

const probe: Command = {
  name: 'spec01-probe',
  summary: 'a test double',
  async run(_ctx: CommandContext) {
    return 0;
  },
};

describe('command registry', () => {
  it('registers and reads back a command', () => {
    registerCommand(probe);

    expect(getCommand('spec01-probe')?.summary).toBe('a test double');
    expect(getCommand('nothing-here')).toBeUndefined();
  });

  it('replaces a command registered under the same name', () => {
    registerCommand(probe);
    registerCommand({ ...probe, summary: 'the replacement' });

    expect(getCommand('spec01-probe')?.summary).toBe('the replacement');
    expect(listCommands().filter((c) => c.name === 'spec01-probe')).toHaveLength(1);
  });

  it('lists commands sorted by name', () => {
    registerCommand(probe);
    const names = listCommands().map((command) => command.name);

    expect([...names]).toEqual([...names].sort());
  });

  it('names the whole command surface', () => {
    expect([...RESERVED_COMMANDS]).toEqual(['scan', 'show', 'update', 'add', 'remove', 'config']);
  });
});

describe('resolveName', () => {
  it('matches a full id', () => {
    expect(resolveName('skills/cso', items).id).toBe('skills/cso');
  });

  it('matches a bare basename', () => {
    expect(resolveName('cso', items).id).toBe('skills/cso');
  });

  it('matches an agent name with or without .md', () => {
    expect(resolveName('ponytail', items).id).toBe('agents/ponytail.md');
    expect(resolveName('ponytail.md', items).id).toBe('agents/ponytail.md');
    expect(resolveName('agents/ponytail.md', items).id).toBe('agents/ponytail.md');
  });

  it('ignores case, a leading ./ and a trailing /', () => {
    expect(resolveName('CSO', items).id).toBe('skills/cso');
    expect(resolveName('./skills/cso', items).id).toBe('skills/cso');
    expect(resolveName('skills/cso/', items).id).toBe('skills/cso');
  });

  it('reports an unknown name', () => {
    const err = captureError(() => resolveName('nope', items));

    expect(err.code).toBe('UNKNOWN_ENTRY');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain('nope');
    expect(err.cause).toContain('No managed file was modified.');
  });

  it('lists the candidates for an ambiguous name', () => {
    const err = captureError(() => resolveName('git', items));

    expect(err.code).toBe('AMBIGUOUS_NAME');
    expect(err.exitCode).toBe(2);
    expect(err.cause).toContain('agents/git.md');
    expect(err.cause).toContain('skills/git');
    expect(err.fixes).toEqual(['skilled agents/git.md', 'skilled skills/git']);
  });
});
