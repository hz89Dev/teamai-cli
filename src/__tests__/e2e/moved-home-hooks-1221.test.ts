import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/index.js');

const hasTeamaiHooks = (file: string) => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('hook-dispatch');

describe('hooks follow a moved CodeBuddy and OpenCode home (#1221, real CLI)', () => {
  let sandbox: string;
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-moved-hooks-'));
    home = path.join(sandbox, 'home');
    const teamRepo = path.join(home, '.teamai', 'team-repo');
    fs.mkdirSync(teamRepo, { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'cb'));
    fs.mkdirSync(path.join(sandbox, 'xdg', 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(teamRepo, 'teamai.yaml'), 'team: moved-hooks-e2e\nrepo: https://example.com/team.git\nprovider: git\n');
    fs.writeFileSync(path.join(home, '.teamai', 'config.yaml'), [
      'repo:', `  localPath: ${teamRepo}`, '  remote: https://example.com/team.git',
      'username: e2e-user', 'updatePolicy: auto', 'scope: user', 'enabledAgents: [codebuddy, opencode]',
    ].join('\n'));
    env = {
      ...process.env, HOME: home, USERPROFILE: home, FORCE_COLOR: '0',
      CODEBUDDY_CONFIG_DIR: path.join(sandbox, 'cb'), XDG_CONFIG_HOME: path.join(sandbox, 'xdg'), OPENCODE_CONFIG_DIR: '',
    };
  });

  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: home, env, encoding: 'utf8', timeout: 30_000 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout;
  };

  it('injects into the moved homes, and uninstall also clears the default-home copies an earlier release wrote', () => {
    const movedSettings = path.join(sandbox, 'cb', 'settings.json');
    const movedPlugin = path.join(sandbox, 'xdg', 'opencode', 'plugin', 'teamai-hooks.ts');
    const defaultSettings = path.join(home, '.codebuddy', 'settings.json');
    const defaultPlugin = path.join(home, '.config', 'opencode', 'plugin', 'teamai-hooks.ts');

    run('hooks', 'inject');

    expect(hasTeamaiHooks(movedSettings)).toBe(true);
    expect(fs.existsSync(movedPlugin)).toBe(true);
    expect(fs.existsSync(defaultSettings)).toBe(false);
    expect(fs.existsSync(defaultPlugin)).toBe(false);

    // What a release before #1221 left in the default homes.
    fs.mkdirSync(path.dirname(defaultSettings), { recursive: true });
    fs.copyFileSync(movedSettings, defaultSettings);
    fs.mkdirSync(path.dirname(defaultPlugin), { recursive: true });
    fs.copyFileSync(movedPlugin, defaultPlugin);

    run('uninstall', '--force');

    expect(hasTeamaiHooks(movedSettings)).toBe(false);
    expect(hasTeamaiHooks(defaultSettings)).toBe(false);
    expect(fs.existsSync(movedPlugin)).toBe(false);
    expect(fs.existsSync(defaultPlugin)).toBe(false);
  });

  it('hooks remove also clears the default-home copies, which the tool reads again once the variable is unset', () => {
    const movedSettings = path.join(sandbox, 'cb', 'settings.json');
    const defaultSettings = path.join(home, '.codebuddy', 'settings.json');
    const defaultPlugin = path.join(home, '.config', 'opencode', 'plugin', 'teamai-hooks.ts');
    run('hooks', 'inject');
    fs.mkdirSync(path.dirname(defaultSettings), { recursive: true });
    fs.copyFileSync(movedSettings, defaultSettings);
    fs.mkdirSync(path.dirname(defaultPlugin), { recursive: true });
    fs.copyFileSync(path.join(sandbox, 'xdg', 'opencode', 'plugin', 'teamai-hooks.ts'), defaultPlugin);

    run('hooks', 'remove');

    expect(hasTeamaiHooks(movedSettings)).toBe(false);
    expect(hasTeamaiHooks(defaultSettings)).toBe(false);
    expect(fs.existsSync(defaultPlugin)).toBe(false);
  });
});
