'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shQuote, appImageDestination, linuxUpdateScript } = require('../src/linux-update');

test('shQuote protege espaços e aspas simples', () => {
  assert.equal(shQuote('/opt/GitPolvo/gitpolvo'), "'/opt/GitPolvo/gitpolvo'");
  assert.equal(shQuote("/tmp/It's a file.deb"), "'/tmp/It'\\''s a file.deb'");
});

test('AppImage com versão no nome vai para o arquivo novo', () => {
  assert.equal(
    appImageDestination('/home/ada/GitPolvo-1.1.4-x86_64.AppImage', '/tmp/GitPolvo-1.1.6-x86_64.AppImage'),
    '/home/ada/GitPolvo-1.1.6-x86_64.AppImage'
  );
  assert.equal(
    appImageDestination('/home/ada/GitPolvo.AppImage', '/tmp/GitPolvo-1.1.6-x86_64.AppImage'),
    '/home/ada/GitPolvo.AppImage'
  );
});

test('script .deb espera o PID, instala com pkexec e reabre', () => {
  const script = linuxUpdateScript({
    pid: 4242,
    kind: 'deb',
    installerPath: '/tmp/gitpolvo_1.2.0_amd64.deb',
    relaunchPath: '/opt/GitPolvo/gitpolvo',
  });
  assert.match(script, /oldpid=4242/);
  assert.match(script, /kill -0 "\$oldpid"/);
  assert.match(script, /pkexec \/bin\/bash -c/);
  assert.match(script, /dpkg -i /);
  assert.match(script, /gitpolvo_1\.2\.0_amd64\.deb/);
  assert.match(script, /nohup '\/opt\/GitPolvo\/gitpolvo'/);
  assert.doesNotMatch(script, /--disable-internal-agent/);
});

test('script AppImage só troca o arquivo depois do processo sair', () => {
  const script = linuxUpdateScript({
    pid: 7,
    kind: 'appimage',
    installerPath: '/tmp/GitPolvo-1.1.6-x86_64.AppImage',
    appImagePath: '/home/ada/GitPolvo-1.1.4-x86_64.AppImage',
  });
  const waitAt = script.indexOf('oldpid=7');
  const mvAt = script.indexOf("mv -f '/tmp/GitPolvo-1.1.6-x86_64.AppImage'");
  assert.ok(waitAt >= 0 && mvAt > waitAt);
  assert.match(script, /APPIMAGE_SILENT_INSTALL=true '\/home\/ada\/GitPolvo-1\.1\.6-x86_64\.AppImage'/);
});
