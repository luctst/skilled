import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';
import type { ConfigOrigin, EntryStatus, LocalItem, StatusReport, StatusRow } from '../types.js';

export interface RenderOptions {
  color: boolean;
}

export interface ItemCounts {
  skills: number;
  agents: number;
  total: number;
}

/** picocolors with color forced on or off, so --no-color is exact, not ambient. */
function colors(opts: RenderOptions) {
  return pc.createColors(opts.color);
}
// If the typecheck reports that `createColors` is not on the default export,
// picocolors is exposing it as a named export in the installed version: switch
// to `import { createColors } from 'picocolors';` and call it directly.

export function countItems(items: LocalItem[]): ItemCounts {
  const skills = items.filter((item) => item.kind === 'skill').length;
  const agents = items.filter((item) => item.kind === 'agent').length;
  return { skills, agents, total: items.length };
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function formatCounts(counts: ItemCounts): string {
  const parts: string[] = [];
  if (counts.skills > 0) parts.push(plural(counts.skills, 'skill'));
  if (counts.agents > 0) parts.push(plural(counts.agents, 'agent'));
  return parts.length > 0 ? parts.join(', ') : 'no skills or agents';
}

export function tildify(p: string, home: string = os.homedir()): string {
  if (p === home) return '~';
  return p.startsWith(`${home}${path.sep}`) ? `~${path.sep}${p.slice(home.length + 1)}` : p;
}

/** "skills/marketing-ads" -> "marketing-ads", "agents/ponytail.md" -> "ponytail" */
export function shortName(id: string): string {
  const base = id.slice(id.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

export const ORIGIN_LABELS: Record<ConfigOrigin, string> = {
  flag: '--dir flag',
  env: 'SKILLED_DIR env var',
  file: 'config file',
  autodetect: 'auto-detected',
};

export const STATUS_SYMBOLS: Record<EntryStatus, string> = {
  current: '✓',
  behind: '↑',
  unknown: '?',
  unreachable: '✗',
};

export function renderScanHeader(dir: string, counts: ItemCounts, opts: RenderOptions): string {
  const c = colors(opts);
  return `Scanning ${c.bold(tildify(dir))} … ${formatCounts(counts)}`;
}

export function renderStatusRow(row: StatusRow, opts: RenderOptions): string {
  const c = colors(opts);
  const symbol = STATUS_SYMBOLS[row.status];
  const painted =
    row.status === 'current'
      ? c.green(symbol)
      : row.status === 'behind'
        ? c.yellow(symbol)
        : row.status === 'unreachable'
          ? c.red(symbol)
          : c.dim(symbol);

  const source = row.source === undefined ? '—' : row.source.repo;

  const detail: string[] = [];
  if (row.status === 'behind' && row.behindBy !== undefined) {
    detail.push(`${plural(row.behindBy, 'commit')} behind`);
  }
  if (row.status === 'unknown') {
    detail.push(row.source === undefined ? 'no known source' : 'not checked yet');
  }
  if (row.status === 'unreachable') detail.push('upstream unreachable');
  if (row.localEdits) detail.push('local edits');
  const tail = detail.length > 0 ? `  ${c.dim(`(${detail.join(' · ')})`)}` : '';

  return `  ${painted} ${row.id.padEnd(28)} → ${source}${tail}`;
}

export function renderTotals(report: StatusReport, opts: RenderOptions): string {
  const c = colors(opts);
  const parts = [
    `${report.identified} of ${report.total} identified`,
    `${report.behind} behind upstream`,
    `${report.unknown} unknown origin`,
  ];
  return `  ${c.bold(parts.join(' · '))}`;
}

export function renderStatusReport(report: StatusReport, opts: RenderOptions): string {
  const lines = report.rows.map((row) => renderStatusRow(row, opts));
  lines.push('');
  lines.push(renderTotals(report, opts));
  return lines.join('\n');
}

export function renderNextSteps(reports: StatusReport[], opts: RenderOptions): string {
  const c = colors(opts);
  const behind = reports.reduce((sum, report) => sum + report.behind, 0);
  const unknown = reports.reduce((sum, report) => sum + report.unknown, 0);

  const steps: Array<[string, string]> = [];
  if (behind > 0) steps.push(['skilled update', `review the ${behind} behind upstream`]);
  if (unknown > 0) {
    steps.push([
      'skilled add <url> <name>',
      `tell skilled about the ${unknown} with no known source`,
    ]);
  }
  steps.push(['skilled config', 'check which directory skilled manages']);

  return steps
    .map(([command, why], index) => {
      const lead = index === 0 ? 'Next:' : '     ';
      return `  ${lead}  ${c.bold(command.padEnd(26))}${c.dim(why)}`;
    })
    .join('\n');
}

/** The one line <managed-dir>/.skilled/status holds for the session hook. */
export function statusLineSummary(report: StatusReport): string | null {
  if (report.behind === 0) return null;
  const names = report.rows
    .filter((row) => row.status === 'behind')
    .map((row) => shortName(row.id));
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? `, +${names.length - 3} more` : '';
  return `skilled: ${plural(report.behind, 'entry', 'entries')} behind upstream (${shown}${more}) · run \`skilled update\``;
}
