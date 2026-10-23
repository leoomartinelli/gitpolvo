'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

// git.js roda no renderer e se registra em window.GitLayer.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/git.js'), 'utf8'), sandbox);
const { parseDiff, linesPatch } = sandbox.window.GitLayer;

function repo(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polvo-lines-'));
  const git = (args, input) => execFileSync('git', args, { cwd: dir, input, encoding: 'utf8' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'f.txt'), initial);
  git(['add', 'f.txt']);
  git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'base']);
  return { dir, git, write: (t) => fs.writeFileSync(path.join(dir, 'f.txt'), t), read: () => fs.readFileSync(path.join(dir, 'f.txt'), 'utf8') };
}

const pick = (texts) => (_hunk, line) => texts.includes(line.type + ':' + line.text);

test('stage de uma linha adicionada e de uma removida, deixando as outras no diretório', () => {
  const r = repo('a\nb\nc\nd\n');
  r.write('a\nB1\nc\nnova\nd\n'); // troca b por B1 e acrescenta "nova"
  const [file] = parseDiff(r.git(['diff']));
  const patch = linesPatch(file, pick(['del:b', 'add:nova']));
  r.git(['apply', '--cached', '-'], patch);
  assert.equal(r.git(['show', ':f.txt']), 'a\nc\nnova\nd\n');
  assert.equal(r.read(), 'a\nB1\nc\nnova\nd\n');
});

test('unstage de uma linha preparada mantém as demais no índice', () => {
  const r = repo('a\nb\nc\n');
  r.write('a\nx\nb\ny\nc\n');
  r.git(['add', 'f.txt']);
  const [file] = parseDiff(r.git(['diff', '--cached']));
  const patch = linesPatch(file, pick(['add:x']), { reverse: true });
  r.git(['apply', '--cached', '-R', '-'], patch);
  assert.equal(r.git(['show', ':f.txt']), 'a\nb\ny\nc\n');
});

test('descartar linhas volta só elas no arquivo, em hunks diferentes', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const r = repo(lines.join('\n') + '\n');
  const changed = lines.slice();
  changed[2] = 'mudou2';
  changed[25] = 'mudou25';
  changed.splice(27, 0, 'extra');
  r.write(changed.join('\n') + '\n');
  const [file] = parseDiff(r.git(['diff']));
  assert.equal(file.hunks.length, 2);
  const patch = linesPatch(file, pick(['del:l2', 'add:mudou2', 'add:extra']), { reverse: true });
  r.git(['apply', '-R', '-'], patch);
  const expected = lines.slice();
  expected[25] = 'mudou25';
  assert.equal(r.read(), expected.join('\n') + '\n');
});

test('sem linha escolhida não gera patch', () => {
  const r = repo('a\n');
  r.write('b\n');
  const [file] = parseDiff(r.git(['diff']));
  assert.equal(linesPatch(file, () => false), null);
});
