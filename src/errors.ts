export type ErrorCode =
  | 'BAD_DIR'
  | 'BAD_FLAG'
  | 'UNKNOWN_ENTRY'
  | 'AMBIGUOUS_NAME'
  | 'NO_AUTH'
  | 'RATE_LIMIT'
  | 'UPSTREAM_GONE'
  | 'NETWORK'
  | 'MERGE_CONFLICT'
  | 'BAD_MANIFEST'
  /** exit 2; a source URL that cannot be parsed. Raised by spec 02's parseSourceUrl. */
  | 'BAD_SOURCE';

/**
 * The only error type in src/. cli.ts catches it, prints format() to stderr,
 * and exits with exitCode. A bare `throw new Error(...)` is a defect.
 */
export class SkilledError extends Error {
  readonly code: ErrorCode;
  /** what went wrong, one line */
  readonly problem: string;
  /** why, one or two lines; include the offending value */
  readonly cause: string;
  /** concrete next commands, one per line */
  readonly fixes: string[];
  readonly exitCode: 2 | 3 | 4;

  constructor(init: {
    code: ErrorCode;
    problem: string;
    cause: string;
    fixes: string[];
    exitCode: 2 | 3 | 4;
  }) {
    super(init.problem);
    this.name = 'SkilledError';
    this.code = init.code;
    this.problem = init.problem;
    this.cause = init.cause;
    this.fixes = init.fixes;
    this.exitCode = init.exitCode;
  }

  /** renders problem / cause / fixes, in that order */
  format(): string {
    const lines: string[] = [`✗ ${this.problem}`, ''];
    for (const line of this.cause.split('\n')) {
      lines.push(`  ${line}`);
    }
    if (this.fixes.length > 0) {
      lines.push('');
      for (const fix of this.fixes) {
        lines.push(`  → ${fix}`);
      }
    }
    return lines.join('\n');
  }
}
