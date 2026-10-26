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

  // OpenCode 1.x loads the default config dir's plugins beside OPENCODE_CONFIG_DIR's, deduping by file URL only.
  it('hooks inject leaves one OpenCode plugin, so OpenCode 1.x does not fire every event twice', () => {
    const movedPlugin = path.join(sandbox, 'oc', 'plugin', 'teamai-hooks.ts');
    const defaultPlugin = path.join(home, '.config', 'opencode', 'plugin', 'teamai-hooks.ts');
    env = { ...env, XDG_CONFIG_HOME: '', OPENCODE_CONFIG_DIR: path.join(sandbox, 'oc') };
    fs.mkdirSync(path.join(sandbox, 'oc'));
    fs.mkdirSync(path.dirname(defaultPlugin), { recursive: true });
    fs.writeFileSync(defaultPlugin, '// [teamai] hooks plugin, as an earlier release wrote it');

    run('hooks', 'inject');

    expect(fs.existsSync(movedPlugin)).toBe(true);
    expect(fs.existsSync(defaultPlugin)).toBe(false);
  });

  // A Muse team hook carries no marker: only its record names it, and an HTTP-backed team has no
  // hook history to recognize it by. Clearing one copy must not take the record the other needs.
  it.each(['uninstall --force', 'hooks remove'])('%s clears a Muse team hook from both homes with one record', (command) => {
    const teamRepo = path.join(home, '.teamai', 'team-repo');
    fs.writeFileSync(path.join(teamRepo, 'teamai.yaml'), 'team: moved-hooks-e2e\nrepo: https://example.com/team.git\nprovider: git\nsharing:\n  hooks:\n    autoApply: true\n    requireTeamScripts: false\n');
    fs.mkdirSync(path.join(teamRepo, 'hooks'));
    fs.writeFileSync(path.join(teamRepo, 'hooks', 'hooks.yaml'), 'hooks:\n  - id: company-check\n    description: Company check\n    event: Stop\n    command: echo company-check\n');
    fs.writeFileSync(path.join(home, '.teamai', 'config.yaml'), [
      'repo:', '  kind: http', '  url: https://example.com/team', `  localPath: ${teamRepo}`, '  remote: https://example.com/team',
      'username: e2e-user', 'updatePolicy: skip', 'scope: user', 'enabledAgents: [muse]',
    ].join('\n'));
    fs.mkdirSync(path.join(sandbox, 'xdg', 'muse'));
    const movedSettings = path.join(sandbox, 'xdg', 'muse', 'settings.json');
    const defaultSettings = path.join(home, '.config', 'muse', 'settings.json');
    const hasTeamHook = (file: string) => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('company-check');
    run('hooks', 'inject');
    expect(hasTeamHook(movedSettings)).toBe(true);
    fs.mkdirSync(path.dirname(defaultSettings), { recursive: true });
    fs.copyFileSync(movedSettings, defaultSettings);

    run(...command.split(' '));

    expect(hasTeamHook(movedSettings)).toBe(false);
    expect(hasTeamHook(defaultSettings)).toBe(false);
    expect(hasTeamHook(path.join(home, '.teamai', 'managed-hooks.json'))).toBe(false);
  });
});
