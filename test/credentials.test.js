'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  credKey,
  isSshCredentialPrompt,
  shouldPersist,
  packCredentials,
  unpackCredentials,
  applyPersistUpdate,
} = require('../src/credentials');

test('credKey agrupa a passphrase pela chave, não pelo texto do prompt', () => {
  assert.equal(credKey("Enter passphrase for key '/home/ada/.ssh/id_ed25519':"), 'ssh-key:/home/ada/.ssh/id_ed25519');
  assert.equal(credKey('Enter passphrase for /home/ada/.ssh/id_rsa:'), 'ssh-key:/home/ada/.ssh/id_rsa');
  assert.equal(credKey("Password for 'https://github.com':"), "Password for 'https://github.com':");
});

test('só prompt de senha SSH oferece persistência', () => {
  assert.equal(isSshCredentialPrompt("Enter passphrase for key '/home/ada/.ssh/id_ed25519':"), true);
  assert.equal(isSshCredentialPrompt("ada@github.com's password:"), true);
  assert.equal(isSshCredentialPrompt("Password for 'https://github.com':"), false);
  assert.equal(isSshCredentialPrompt("Username for 'https://github.com':"), false);
  assert.equal(isSshCredentialPrompt(''), false);
});

test('persistir exige caixa marcada, cofre disponível e prompt SSH', () => {
  const prompt = "Enter passphrase for key '/tmp/id_ed25519':";
  assert.equal(shouldPersist(prompt, true, true), true);
  assert.equal(shouldPersist(prompt, false, true), false);
  assert.equal(shouldPersist(prompt, true, false), false);
  assert.equal(shouldPersist("Password for 'https://github.com':", true, true), false);
});

test('o arquivo cifrado guarda só o mapa e some quando fica vazio', () => {
  const encrypt = (json) => Buffer.from(json, 'utf8').toString('base64');
  const decrypt = (blob) => Buffer.from(blob, 'base64').toString('utf8');
  const packed = packCredentials({ 'ssh-key:/tmp/id': 'segredo', vazio: '' }, encrypt);
  assert.equal(packed.v, 1);
  assert.deepEqual(unpackCredentials(packed, decrypt), { 'ssh-key:/tmp/id': 'segredo' });
  assert.equal(packCredentials({}, encrypt), null);
  assert.deepEqual(unpackCredentials({ v: 1, blob: 'não-é-json' }, () => 'não'), {});
});

test('atualizar uma chave não apaga as outras', () => {
  const map = { 'ssh-key:/a': 'um', 'ssh-key:/b': 'dois' };
  assert.deepEqual(applyPersistUpdate(map, 'ssh-key:/a', null), { 'ssh-key:/b': 'dois' });
  assert.deepEqual(applyPersistUpdate(map, 'ssh-key:/c', 'três'), {
    'ssh-key:/a': 'um',
    'ssh-key:/b': 'dois',
    'ssh-key:/c': 'três',
  });
  assert.deepEqual(map, { 'ssh-key:/a': 'um', 'ssh-key:/b': 'dois' });
});
