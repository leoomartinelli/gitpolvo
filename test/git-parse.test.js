'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/git.js'), 'utf8'), sandbox);
const { parseBlame, remoteWeb } = sandbox.window.GitLayer;

test('remoteWeb reconhece https, ssh e scp do GitHub, GitLab e Bitbucket', () => {
  const sha = 'abc123';
  assert.equal(remoteWeb('https://github.com/leo/gitpolvo.git').commitUrl(sha), 'https://github.com/leo/gitpolvo/commit/abc123');
  assert.equal(remoteWeb('git@github.com:leo/gitpolvo.git').commitUrl(sha), 'https://github.com/leo/gitpolvo/commit/abc123');
  assert.equal(remoteWeb('ssh://git@gitlab.com:2222/grupo/sub/proj.git').commitUrl(sha), 'https://gitlab.com/grupo/sub/proj/-/commit/abc123');
  assert.equal(remoteWeb('https://user@bitbucket.org/time/repo').commitUrl(sha), 'https://bitbucket.org/time/repo/commits/abc123');
  assert.equal(remoteWeb('git@gitlab.empresa.com.br:time/api.git').name, 'GitLab');
  assert.equal(remoteWeb('/caminho/local/repo.git'), null);
  assert.equal(remoteWeb('https://exemplo.com/repo.git'), null);
});

test('parseBlame separa linhas por commit e marca o que não foi commitado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polvo-blame-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@x', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\ndois\n');
  git('add', '.');
  git('commit', '-qm', 'primeiro');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\ndois\ntres\n');
  const { commits, lines } = parseBlame(git('blame', '--porcelain', '--', 'a.txt'));
  assert.equal(lines.map((l) => l.text).join(','), 'um,dois,tres');
  const first = commits[lines[0].sha];
  assert.equal(first.author, 'Ana');
  assert.equal(first.email, 'ana@x');
  assert.equal(first.summary, 'primeiro');
  assert.equal(lines[1].sha, lines[0].sha);
  assert.equal(commits[lines[2].sha].uncommitted, true);
});

test('parseSubmoduleStatus lê o estado de cada submódulo', () => {
  const { parseSubmoduleStatus } = sandbox.window.GitLayer;
  const list = parseSubmoduleStatus(
    ' 1111111111111111111111111111111111111111 libs/a (v1.0)\n-2222222222222222222222222222222222222222 libs/b\n+3333333333333333333333333333333333333333 libs/c (heads/main)\n'
  );
  assert.equal(list.map((x) => `${x.path}:${x.state}:${x.describe}`).join(' '), 'libs/a:ok:v1.0 libs/b:uninit: libs/c:changed:heads/main');
});

test('parseWorktrees separa diretório principal, branch e detached', () => {
  const { parseWorktrees } = sandbox.window.GitLayer;
  const list = parseWorktrees(
    'worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree /repo-feat\nHEAD bbb\nbranch refs/heads/feat/x\nlocked\n\nworktree /tmp/solto\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n'
  );
  assert.equal(list.map((w) => `${w.path}|${w.branch}|${w.detached}|${w.locked}|${w.prunable}`).join(' '), '/repo|main|false|false|false /repo-feat|feat/x|false|true|false /tmp/solto|null|true|false|true');
});
