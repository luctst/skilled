import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';
import type {
  ConfigOrigin,
  Entry,
  EntryStatus,
  LocalItem,
  ResolvedConfig,
  StatusReport,
  StatusRow,
} from '../types.js';

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

export interface DirSummary {
  dir: string;
  counts: ItemCounts;
}

/** Two-column layout: a 20-character label, then the value. */
function label(text: string): string {
  return text.padEnd(20);
}

export function renderConfig(
  config: ResolvedConfig,
  dirs: DirSummary[],
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const origin = ORIGIN_LABELS[config.origin];
  const lines: string[] = [];

  if (dirs.length === 0) {
    lines.push(`${label('managed directory')}${c.dim('(none)')}  (${origin})`);
  } else {
    const heading = dirs.length === 1 ? 'managed directory' : 'managed directories';
    dirs.forEach((summary, index) => {
      const suffix = index === 0 ? `  (${origin})` : '';
      lines.push(`${label(index === 0 ? heading : '')}${c.bold(tildify(summary.dir))}${suffix}`);
      lines.push(`${label('')}${c.dim(formatCounts(summary.counts))}`);
    });
  }

  const state = config.configExists ? 'in use' : 'not created yet';
  lines.push(`${label('config file')}${tildify(config.configPath)}  (${state})`);
  return lines.join('\n');
}

export function renderConfigSaved(
  dirs: DirSummary[],
  mode: 'replace' | 'add',
  configFile: string,
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const lines: string[] = [];
  const only = dirs[0];

  if (mode === 'replace' && dirs.length === 1 && only !== undefined) {
    lines.push(`${label('managed directory')}${c.bold(tildify(only.dir))}  ${c.green('✓ saved')}`);
    lines.push(`  found ${formatCounts(only.counts)}`);
  } else {
    lines.push(`managing ${plural(dirs.length, 'directory', 'directories')}:`);
    for (const summary of dirs) {
      lines.push(`  ${tildify(summary.dir).padEnd(24)}${formatCounts(summary.counts)}`);
    }
  }

  lines.push(`  ${c.dim(`saved to ${tildify(configFile)}`)}`);
  return lines.join('\n');
}

export function renderNoManagedDirHint(autodetected: string, opts: RenderOptions): string {
  const c = colors(opts);
  return [
    '',
    `  ${c.bold('No managed directory yet.')}`,
    `  skilled looked at ${tildify(autodetected)} and found no skills/ or agents/ subdirectory.`,
    '',
    '  → skilled config dir <path>   point skilled at your instructions directory',
  ].join('\n');
}

export function renderItemDetail(
  item: LocalItem,
  entry: Entry | undefined,
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const field = (text: string): string => `  ${text.padEnd(10)}`;
  const files = item.files
    .map((file) => (file === '' ? path.basename(item.absPath) : file))
    .join(', ');

  const lines: string[] = [
    c.bold(item.id),
    `${field('path')}${tildify(item.absPath)}`,
    `${field('kind')}${item.kind}`,
    `${field('files')}${files}`,
  ];

  if (entry === undefined) {
    lines.push(`${field('source')}${c.dim('unknown — not tracked yet')}`);
    lines.push('');
    lines.push(`  → skilled add <url> ${item.id}   record where this came from`);
    return lines.join('\n');
  }

  const subpath = entry.source.subpath === '' ? '' : ` · ${entry.source.subpath}`;
  const reconstructed = entry.base.reconstructed ? ' (reconstructed)' : '';
  lines.push(`${field('source')}github.com/${entry.source.repo} (${entry.source.ref})${subpath}`);
  lines.push(
    `${field('base')}${entry.base.commit.slice(0, 7)} adopted ${entry.base.adoptedAt}${reconstructed}`,
  );
  lines.push(
    `${field('detected')}${entry.detection.method} · confidence ${entry.detection.confidence.toFixed(2)} · ${entry.detection.confirmedBy ?? 'unconfirmed'}`,
  );
  lines.push(`${field('evidence')}${entry.detection.evidence}`);
  return lines.join('\n');
}
