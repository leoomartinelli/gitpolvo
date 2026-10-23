'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/highlight.js'), 'utf8'), sandbox);
const { langOf, tokenize, wordDiff } = sandbox.window.Highlight;

const classes = (line, lang, state) => {
  const r = tokenize(line, lang, state);
  return { list: r.tokens.map(([s, e, c]) => `${c}:${line.slice(s, e)}`).join(' '), state: r.state };
};

test('langOf reconhece a linguagem pela extensão', () => {
  assert.equal(langOf('controllers/cortexs.php'), 'php');
  assert.equal(langOf('views/home.blade.php'), 'php');
  assert.equal(langOf('src/app.ts'), 'js');
  assert.equal(langOf('Dockerfile'), 'sh');
  assert.equal(langOf('LEIAME'), null);
});

test('PHP: variáveis, palavras-chave, strings, funções e comentários', () => {
  const { list } = classes("$total = count($itens); // soma 'x'", 'php');
  assert.equal(list, "va:$total fn:count va:$itens cm:// soma 'x'");
  assert.equal(classes('public function salvar(string $nome) {', 'php').list, 'kw:public kw:function fn:salvar kw:string va:$nome');
});

test('comentário de bloco e template string continuam na linha seguinte', () => {
  const a = classes('const x = 1; /* começa', 'js');
  assert.equal(a.list, 'kw:const nu:1 cm:/* cm: começa');
  const b = classes('ainda comentário */ return y', 'js', a.state);
  assert.equal(b.list, 'cm:ainda comentário */ kw:return');
  const c = classes('const s = `linha', 'js');
  assert.equal(classes('fim` + 1', 'js', c.state).list, 'st:fim` nu:1');
});

test('SQL ignora maiúsculas nas palavras-chave', () => {
  assert.equal(classes("SELECT nome FROM pessoas WHERE id = 3 -- x", 'sql').list, 'kw:SELECT kw:FROM kw:WHERE nu:3 cm:-- x');
});

test('wordDiff marca só a palavra trocada', () => {
  const a = 'return $valor * 2;';
  const b = 'return $total * 2;';
  const [ra, rb] = wordDiff(a, b);
  assert.equal(ra.map(([s, e]) => a.slice(s, e)).join('|'), 'valor');
  assert.equal(rb.map(([s, e]) => b.slice(s, e)).join('|'), 'total');
});

test('wordDiff não destaca quando a linha mudou quase toda', () => {
  const [ra, rb] = wordDiff('foo bar baz', 'completamente diferente agora');
  assert.equal(ra.length + rb.length, 0);
});
