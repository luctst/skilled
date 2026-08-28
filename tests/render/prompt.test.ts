import { describe, it, expect } from 'vitest';
import { SkilledError } from '../../src/errors.js';
import { PROMPT_CANCEL, isInteractive, promptKey } from '../../src/render/prompt.js';
import type { PromptIO, PromptInput } from '../../src/render/prompt.js';

class FakeInput implements PromptInput {
  isTTY = true;
  raw: boolean | null = null;
  encoding: string | null = null;
  resumed = 0;
  paused = 0;
  private listeners: Array<(chunk: string) => void> = [];

  setRawMode(mode: boolean): void {
    this.raw = mode;
  }
  resume(): void {
    this.resumed += 1;
  }
  pause(): void {
    this.paused += 1;
  }
  setEncoding(encoding: string): void {
    this.encoding = encoding;
  }
  on(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners.push(listener);
  }
  removeListener(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners = this.listeners.filter((existing) => existing !== listener);
  }
  send(chunk: string): void {
    for (const listener of [...this.listeners]) listener(chunk);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

function makeIO(): { input: FakeInput; written: string[]; io: PromptIO } {
  const input = new FakeInput();
  const written: string[] = [];
  return { input, written, io: { input, output: { write: (s) => written.push(s) } } };
}

const keys = [
  { key: 'a', label: 'apply' },
  { key: 's', label: 'skip' },
  { key: 'q', label: 'quit' },
];

describe('isInteractive', () => {
  it('is true only when stdin is a TTY', () => {
    const { input, io } = makeIO();
    expect(isInteractive(io)).toBe(true);

    input.isTTY = false;
    expect(isInteractive(io)).toBe(false);
  });
});

describe('promptKey', () => {
  it('prints the message and the key hints', async () => {
    const { input, written, io } = makeIO();

    const answer = promptKey('skills/cso — 6 commits behind', keys, io);
    input.send('a');

    expect(await answer).toBe('a');
    expect(written[0]).toContain('skills/cso — 6 commits behind');
    expect(written[0]).toContain('[a] apply');
    expect(written[0]).toContain('[s] skip');
  });

  it('accepts an uppercase keypress', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    input.send('S');

    expect(await answer).toBe('s');
  });

  it('ignores keys that were not offered', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    input.send('z');
    input.send('\r');
    input.send('q');

    expect(await answer).toBe('q');
  });

  // Ctrl-C is U+0003 and Escape is U+001B. Both are sent below as the raw
  // control characters they are — write them as escape sequences if you prefer:
  // '' for Ctrl-C and '' for Escape.
  it('reports Ctrl-C and Escape as a cancel', async () => {
    const ctrlC = makeIO();
    const ctrlCAnswer = promptKey('pick', keys, ctrlC.io);
    ctrlC.input.send('');
    expect(await ctrlCAnswer).toBe(PROMPT_CANCEL);

    const escape = makeIO();
    const escapeAnswer = promptKey('pick', keys, escape.io);
    escape.input.send('');
    expect(await escapeAnswer).toBe(PROMPT_CANCEL);
  });

  it('leaves the terminal as it found it', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    expect(input.raw).toBe(true);
    expect(input.encoding).toBe('utf8');
    input.send('a');
    await answer;

    expect(input.raw).toBe(false);
    expect(input.paused).toBe(1);
    expect(input.listenerCount).toBe(0);
  });

  it('refuses to prompt when stdin is not a TTY', async () => {
    const { input, io } = makeIO();
    input.isTTY = false;

    try {
      await promptKey('pick', keys, io);
      throw new Error('expected promptKey to reject');
    } catch (err) {
      if (!(err instanceof SkilledError)) throw err;
      expect(err.code).toBe('BAD_FLAG');
      expect(err.exitCode).toBe(2);
      expect(err.cause).toContain('Nothing was written to disk.');
    }
  });
});
