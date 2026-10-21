'use strict';

// Script que o processo principal dispara no Linux antes de sair: espera o PID
// morrer, instala o pacote (ou troca o AppImage) e reabre o app. Instalar
// .deb/.rpm com o Electron ainda aberto sobrescreve /opt/GitPolvo e o processo
// cai sem conseguir relançar.

const path = require('path');

function shQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

function appImageDestination(oldPath, installerPath) {
  const existingBaseName = path.basename(oldPath);
  if (path.basename(installerPath) === existingBaseName || !/\d+\.\d+\.\d+/.test(existingBaseName)) return oldPath;
  return path.join(path.dirname(oldPath), path.basename(installerPath));
}

function waitForPid(pid) {
  return `oldpid=${Number(pid)}\nwhile kill -0 "$oldpid" 2>/dev/null; do sleep 0.2; done\nsleep 0.5\n`;
}

function runAsRoot(command) {
  return [
    'if command -v pkexec >/dev/null 2>&1; then',
    `  pkexec /bin/bash -c ${shQuote(command)}`,
    'elif command -v sudo >/dev/null 2>&1; then',
    `  sudo /bin/bash -c ${shQuote(command)}`,
    'else',
    `  /bin/bash -c ${shQuote(command)}`,
    'fi',
  ].join('\n');
}

function launch(cmd) {
  return `nohup ${cmd} >/dev/null 2>&1 &\n`;
}

function linuxUpdateScript({ pid, kind, installerPath, relaunchPath, appImagePath }) {
  const wait = waitForPid(pid);
  if (kind === 'appimage') {
    const dest = appImageDestination(appImagePath, installerPath);
    return (
      wait +
      `rm -f ${shQuote(appImagePath)}\n` +
      `mv -f ${shQuote(installerPath)} ${shQuote(dest)}\n` +
      `chmod +x ${shQuote(dest)}\n` +
      launch(`env APPIMAGE_SILENT_INSTALL=true ${shQuote(dest)}`)
    );
  }
  const install =
    kind === 'deb'
      ? `dpkg -i ${shQuote(installerPath)} || apt-get install -f -y`
      : `(command -v dnf >/dev/null && dnf -y install ${shQuote(installerPath)}) || (command -v yum >/dev/null && yum -y install ${shQuote(installerPath)}) || (command -v zypper >/dev/null && zypper --no-refresh install --allow-unsigned-rpm -y -f ${shQuote(installerPath)})`;
  return wait + runAsRoot(install) + '\n' + launch(shQuote(relaunchPath));
}

module.exports = { shQuote, appImageDestination, linuxUpdateScript };
