import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  autodetectDir,
  basePath,
  cachePath,
  configPath,
  expandPath,
  homeDir,
  manifestPath,
  stateDir,
  statusLinePath,
} from '../src/config.js';

describe('path helpers', () => {
  it('reads the home directory from the injected env', () => {
    expect(homeDir({ HOME: '/home/collector' })).toBe('/home/collector');
    expect(homeDir({})).toBe(os.homedir());
  });

  it('puts the config file under ~/.config by default', () => {
    expect(configPath({ HOME: '/home/collector' })).toBe(
      '/home/collector/.config/skilled/config.json',
    );
  });

  it('honors XDG_CONFIG_HOME', () => {
    expect(configPath({ HOME: '/home/collector', XDG_CONFIG_HOME: '/xdg' })).toBe(
      '/xdg/skilled/config.json',
    );
  });

  it('auto-detects ~/.claude', () => {
    expect(autodetectDir({ HOME: '/home/collector' })).toBe('/home/collector/.claude');
  });

  it('derives every state path from the managed dir', () => {
    const dir = '/managed';
    expect(stateDir(dir)).toBe(path.join('/managed', '.skilled'));
    expect(manifestPath(dir)).toBe(path.join('/managed', '.skilled', 'manifest.json'));
    expect(basePath(dir, 'skills/cso')).toBe(
      path.join('/managed', '.skilled', 'base', 'skills', 'cso'),
    );
    expect(basePath(dir, 'agents/ponytail.md')).toBe(
      path.join('/managed', '.skilled', 'base', 'agents', 'ponytail.md'),
    );
    expect(cachePath(dir)).toBe(path.join('/managed', '.skilled', 'cache', 'status.json'));
    expect(statusLinePath(dir)).toBe(path.join('/managed', '.skilled', 'status'));
  });

  it('expands a leading tilde and makes paths absolute', () => {
    const env = { HOME: '/home/collector' };
    expect(expandPath('~', env)).toBe('/home/collector');
    expect(expandPath('~/.codex', env)).toBe('/home/collector/.codex');
    expect(expandPath('/already/absolute', env)).toBe('/already/absolute');
    expect(expandPath('./relative', env)).toBe(path.resolve('./relative'));
  });
});
