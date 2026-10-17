'use strict';

// Executado pelo git/ssh (via GIT_ASKPASS/SSH_ASKPASS) como processo Node do
// próprio Electron. Repassa o prompt à janela do GitPolvo por um socket local.
const net = require('net');

const sock = net.connect(process.env.POLVO_ASKPASS_SOCK);
let buf = '';
sock.on('connect', () => sock.write(JSON.stringify({ prompt: process.argv[2] || '' }) + '\n'));
sock.on('data', (d) => {
  buf += d;
  if (!buf.includes('\n')) return;
  const reply = JSON.parse(buf.slice(0, buf.indexOf('\n')));
  sock.end();
  if (reply.cancel) process.exit(1);
  process.stdout.write(String(reply.value || '') + '\n');
  process.exit(0);
});
sock.on('error', () => process.exit(1));
