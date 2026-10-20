'use strict';

// Classificação e formato das credenciais SSH, sem Electron, para poder testar.
// A senha em si só entra no disco cifrada pelo cofre do sistema (safeStorage).

function credKey(prompt) {
  const p = String(prompt || '').trim();
  const keyFile = /passphrase for(?: key)? ['"]?([^'"]+?)['"]?\s*:?\s*$/i.exec(p);
  return keyFile ? 'ssh-key:' + keyFile[1] : p;
}

// Prompts de passphrase/senha do SSH (não a senha HTTPS do Git).
function isSshCredentialPrompt(prompt) {
  const p = String(prompt || '').trim();
  if (!p) return false;
  if (/passphrase for(?: key)?/i.test(p)) return true;
  if (/\bssh\b/i.test(p) && /passphrase|password|senha/i.test(p)) return true;
  if (/password\s*:/i.test(p) && !/https?:\/\//i.test(p)) return true;
  return false;
}

function shouldPersist(prompt, remember, encryptionAvailable) {
  return !!(remember && encryptionAvailable && isSshCredentialPrompt(prompt));
}

// null = não há nada para gravar (o arquivo deve ser apagado).
function packCredentials(map, encrypt) {
  const entries = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (typeof k === 'string' && k && typeof v === 'string' && v) entries[k] = v;
  }
  if (!Object.keys(entries).length) return null;
  return { v: 1, blob: encrypt(JSON.stringify(entries)) };
}

function unpackCredentials(raw, decrypt) {
  if (!raw || raw.v !== 1 || typeof raw.blob !== 'string' || !raw.blob) return {};
  let json;
  try {
    json = JSON.parse(decrypt(raw.blob));
  } catch {
    return {};
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof k === 'string' && k && typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

function applyPersistUpdate(map, key, value) {
  const next = { ...(map || {}) };
  if (value == null || value === '') delete next[key];
  else next[key] = String(value);
  return next;
}

module.exports = {
  credKey,
  isSshCredentialPrompt,
  shouldPersist,
  packCredentials,
  unpackCredentials,
  applyPersistUpdate,
};
