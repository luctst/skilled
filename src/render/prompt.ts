import { SkilledError } from '../errors.js';

/** The slice of a readable stream a keypress prompt needs. process.stdin satisfies it. */
export interface PromptInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  setEncoding(encoding: BufferEncoding): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  removeListener(event: 'data', listener: (chunk: string) => void): void;
}

export interface PromptOutput {
  write(s: string): void;
}

export interface PromptIO {
  input: PromptInput;
  output: PromptOutput;
}

/** Prompts go to stderr so that --json output on stdout stays machine-readable. */
export function defaultPromptIO(): PromptIO {
  return { input: process.stdin, output: process.stderr };
}

export function isInteractive(io: PromptIO = defaultPromptIO()): boolean {
  return io.input.isTTY === true;
}

/** What promptKey resolves to when the user presses Ctrl-C or Escape. */
export const PROMPT_CANCEL = 'cancel';

/**
 * Single-keypress prompt. keys are lowercase single chars. Returns the chosen key,
 * or PROMPT_CANCEL. Non-interactive callers must check isInteractive() first and
 * pick an explicit default; this function refuses rather than guessing.
 */
export async function promptKey(
  message: string,
  keys: Array<{ key: string; label: string }>,
  io: PromptIO = defaultPromptIO(),
): Promise<string> {
  if (!isInteractive(io)) {
    throw new SkilledError({
      code: 'BAD_FLAG',
      problem: 'skilled needs an answer but the terminal is not interactive.',
      cause: `stdin is not a TTY, so "${message}" cannot be answered. Nothing was written to disk.`,
      fixes: [
        'run skilled in a terminal',
        'skilled --json     non-interactive output, no questions asked',
      ],
      exitCode: 2,
    });
  }

  const hint = keys.map((entry) => `[${entry.key}] ${entry.label}`).join('  ');
  io.output.write(`${message}\n  ${hint} `);

  const allowed = new Set(keys.map((entry) => entry.key.toLowerCase()));

  return await new Promise<string>((resolve) => {
    const finish = (value: string): void => {
      io.input.removeListener('data', onData);
      if (io.input.setRawMode !== undefined) io.input.setRawMode(false);
      io.input.pause();
      io.output.write('\n');
      resolve(value);
    };

    const onData = (chunk: string): void => {
      const text = String(chunk);
      // The two literals compared next are U+0003 (Ctrl-C) and U+001B (Escape),
      // written as raw control characters. '' and '' are equivalent.
      if (text === '' || text === '') {
        finish(PROMPT_CANCEL);
        return;
      }
      const key = text.toLowerCase();
      if (allowed.has(key)) finish(key);
      // any other key: ignore it and keep waiting
    };

    if (io.input.setRawMode !== undefined) io.input.setRawMode(true);
    io.input.setEncoding('utf8');
    io.input.resume();
    io.input.on('data', onData);
  });
}
