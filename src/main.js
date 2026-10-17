'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net: electronNet } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Apps abertos pelo Finder recebem um PATH mínimo; inclui os locais usuais do
// git/gh instalados via Homebrew.
if (IS_MAC) {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin'];
  process.env.PATH = [...extra, ...(process.env.PATH || '').split(':')].filter((v, i, a) => v && a.indexOf(v) === i).join(':');
}

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = { recent: [], openTabs: [], theme: 'dark', zoom: 0, avatars: true };

let win = null;
const watchers = new Map();

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2));
  return next;
}

function addRecent(repoPath) {
  const recent = loadSettings().recent.filter((p) => p !== repoPath);
  recent.unshift(repoPath);
  saveSettings({ recent: recent.slice(0, 20) });
}

// Credenciais: git/ssh chamam askpass.sh, que roda askpass.js com o Node do
// Electron; ele conversa com este servidor, que pergunta à janela.
const askpass = { sock: null, script: null, pending: new Map(), seq: 0 };

function startAskpassServer() {
  // Windows usa named pipe; Linux/macOS, socket de domínio Unix
  askpass.sock = IS_WIN ? `\\\\.\\pipe\\gitpolvo-${process.pid}` : path.join(os.tmpdir(), `gitpolvo-${process.pid}.sock`);
  if (!IS_WIN) {
    try {
      fs.unlinkSync(askpass.sock);
    } catch {}
  }
  net
    .createServer((conn) => {
      let buf = '';
      conn.on('data', (d) => {
        buf += d;
        if (!buf.includes('\n')) return;
        const { prompt } = JSON.parse(buf.slice(0, buf.indexOf('\n')));
        const id = ++askpass.seq;
        askpass.pending.set(id, (reply) => conn.end(JSON.stringify(reply) + '\n'));
        if (win && !win.isDestroyed()) win.webContents.send('askpass:request', id, prompt);
        else askpass.pending.get(id)({ cancel: true });
      });
      conn.on('error', () => {});
    })
    .listen(askpass.sock);
  askpass.script = path.join(app.getPath('userData'), IS_WIN ? 'askpass.cmd' : 'askpass.sh');
  fs.mkdirSync(path.dirname(askpass.script), { recursive: true });
  const script = IS_WIN
    ? '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%POLVO_ELECTRON%" "%POLVO_ASKPASS_JS%" %*\r\n'
    : '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$POLVO_ELECTRON" "$POLVO_ASKPASS_JS" "$@"\n';
  fs.writeFileSync(askpass.script, script, { mode: 0o755 });
}

ipcMain.on('askpass:response', (_e, id, reply) => {
  const done = askpass.pending.get(id);
  askpass.pending.delete(id);
  if (done) done(reply);
});

// Executa git sem shell; sempre resolve com { code, stdout, stderr } para que o
// renderer decida o que é erro (ex.: `diff --no-index` retorna 1 normalmente).
function runGit(cwd, args, input) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        // mensagens do git em inglês (o app interpreta algumas delas)
        LC_ALL: process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8',
        GIT_ASKPASS: askpass.script,
        SSH_ASKPASS: askpass.script,
        SSH_ASKPASS_REQUIRE: 'force',
        POLVO_ELECTRON: process.execPath,
        // empacotado, o askpass.js fica fora do .asar para o Node conseguir executá-lo
        POLVO_ASKPASS_JS: path.join(__dirname, 'askpass.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
        POLVO_ASKPASS_SOCK: askpass.sock,
      },
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => resolve({ code: -1, stdout: '', stderr: String(e.message) }));
    child.on('close', (code) =>
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    );
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

// Observa o repositório com um watch NÃO recursivo por pasta. O modo recursivo
// do Node 20 no Linux vigia cada arquivo pelo inode e para de avisar depois que
// um editor (vim, etc.) salva gravando um arquivo novo e renomeando por cima.
const WATCH_SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', 'vendor', 'dist', 'build', 'target', '.next', '.cache']);
const WATCH_MAX_DIRS = 4000;

function watchRepo(repoPath) {
  if (watchers.has(repoPath)) return;
  const gitDir = path.join(repoPath, '.git');
  const state = { handles: new Map(), timer: null, closed: false };
  watchers.set(repoPath, state);
  const notify = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => send('repo:changed', repoPath), 300);
  };
  const add = (dir, depth) => {
    if (state.closed || state.handles.has(dir) || state.handles.size >= WATCH_MAX_DIRS) return;
    let h;
    try {
      h = fs.watch(dir, (_event, name) => {
        notify();
        // pasta nova criada dentro desta: passa a ser observada também
        if (name && dir !== gitDir) {
          const full = path.join(dir, String(name));
          fs.stat(full, (err, st) => {
            if (!err && st.isDirectory()) add(full, depth + 1);
            else if (err) dropMissing(full);
          });
        }
      });
    } catch {
      return;
    }
    h.on('error', () => dropMissing(dir));
    state.handles.set(dir, h);
    if (dir === gitDir) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.git' || WATCH_SKIP_DIRS.has(e.name)) continue;
      add(path.join(dir, e.name), depth + 1);
    }
  };
  const dropMissing = (dir) => {
    for (const [d, h] of state.handles) {
      if (d === dir || d.startsWith(dir + path.sep)) {
        h.close();
        state.handles.delete(d);
      }
    }
  };
  add(repoPath, 0);
  // HEAD, index e refs (commits, checkouts e fetch feitos fora do app)
  add(gitDir, 0);
  for (const sub of ['refs/heads', 'refs/remotes', 'refs/tags']) {
    const walk = (d) => {
      add(d, 0);
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name));
      } catch {}
    };
    walk(path.join(gitDir, sub));
  }
}

function unwatchRepo(repoPath) {
  const state = watchers.get(repoPath);
  if (!state) return;
  state.closed = true;
  clearTimeout(state.timer);
  for (const h of state.handles.values()) h.close();
  watchers.delete(repoPath);
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function buildMenu() {
  const cmd = (name) => () => send('menu:command', name);
  const template = [
    {
      label: '&Arquivo',
      submenu: [
        { label: 'Nova aba', accelerator: 'CmdOrCtrl+T', click: cmd('tab:new') },
        { label: 'Abrir repositório...', accelerator: 'CmdOrCtrl+O', click: cmd('repo:open') },
        { label: 'Clonar repositório...', accelerator: 'CmdOrCtrl+N', click: cmd('repo:clone') },
        { label: 'Iniciar repositório...', accelerator: 'CmdOrCtrl+I', click: cmd('repo:init') },
        { type: 'separator' },
        { label: 'Abrir no gerenciador de arquivos', click: cmd('repo:reveal') },
        { label: 'Abrir terminal externo', accelerator: 'Alt+T', click: cmd('repo:terminal') },
        { type: 'separator' },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: cmd('tab:close') },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: '&Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: '&Repositório',
      submenu: [
        { label: 'Fetch', accelerator: 'CmdOrCtrl+L', click: cmd('repo:fetch') },
        { label: 'Pull', click: cmd('repo:pull') },
        { label: 'Push', click: cmd('repo:push') },
        { type: 'separator' },
        { label: 'Nova branch...', accelerator: 'CmdOrCtrl+B', click: cmd('repo:branch') },
        { label: 'Stash', click: cmd('repo:stash') },
        { label: 'Aplicar último stash (pop)', click: cmd('repo:pop') },
        { type: 'separator' },
        { label: 'Stage em tudo', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('repo:stageAll') },
        { label: 'Unstage em tudo', accelerator: 'CmdOrCtrl+Shift+U', click: cmd('repo:unstageAll') },
        { label: 'Atualizar', accelerator: 'F5', click: cmd('repo:refresh') },
      ],
    },
    {
      label: '&Exibir',
      submenu: [
        { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+P', click: cmd('view:palette') },
        { label: 'Painel esquerdo', accelerator: 'CmdOrCtrl+J', click: cmd('view:toggleLeft') },
        { label: 'Painel de detalhes', accelerator: 'CmdOrCtrl+K', click: cmd('view:toggleRight') },
        { label: 'Alternar tema claro/escuro', click: cmd('view:theme') },
        { label: 'Atalhos de teclado', accelerator: 'CmdOrCtrl+/', click: cmd('view:shortcuts') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Aumentar zoom', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { type: 'separator' },
        { role: 'reload', label: 'Recarregar janela' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
      ],
    },
    {
      label: 'A&juda',
      submenu: [{ label: 'Sobre o GitPolvo', click: cmd('help:about') }],
    },
  ];
  template.find((m) => m.label === 'A&juda').submenu.push({ label: 'Verificar atualizações', click: cmd('help:updates') });
  if (IS_MAC) template.unshift({ role: 'appMenu', label: app.name });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'GitPolvo',
    backgroundColor: '#1b1e24',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('focus', () => send('window:focus'));
  win.on('closed', () => {
    win = null;
  });
}

// ---------- fotos de perfil ----------
// Ordem: e-mail noreply do GitHub → API de commits do GitHub (se o remoto for
// GitHub) → Gravatar. O resultado (imagem em data URL ou "não tem") fica em
// cache no disco para cada e-mail.
const AVATAR_TTL_OK = 7 * 86400e3;
const AVATAR_TTL_MISS = 86400e3;
const avatarCache = { data: null, saveTimer: null, inflight: new Map(), githubBlockedUntil: 0 };

const AVATAR_CACHE_VERSION = 2;

function avatarStore() {
  if (!avatarCache.data) {
    try {
      avatarCache.data = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'avatars.json'), 'utf8'));
    } catch {
      avatarCache.data = {};
    }
    // v1 marcava "sem foto" quando o repositório era privado e não havia login;
    // descarta essas falhas para buscar de novo com o token.
    if (avatarCache.data.__v !== AVATAR_CACHE_VERSION) {
      for (const [k, v] of Object.entries(avatarCache.data)) if (!v || !v.img) delete avatarCache.data[k];
      avatarCache.data.__v = AVATAR_CACHE_VERSION;
    }
  }
  return avatarCache.data;
}

// Token do GitHub: variável de ambiente ou o login já feito no GitHub CLI (`gh`).
// Usado só para falar com api.github.com (repositórios privados e limite maior).
let githubTokenPromise = null;

function githubToken() {
  if (!githubTokenPromise) {
    githubTokenPromise = (async () => {
      if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      // o app aberto pelo menu pode não ter ~/.local/bin no PATH
      const candidates = ['gh', path.join(os.homedir(), '.local/bin/gh'), '/usr/local/bin/gh', '/opt/homebrew/bin/gh', '/usr/bin/gh', '/snap/bin/gh'];
      for (const bin of candidates) {
        const token = await new Promise((resolve) => {
          const child = spawn(bin, ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] });
          let out = '';
          const timer = setTimeout(() => child.kill(), 5000);
          child.stdout.on('data', (d) => (out += d));
          child.on('error', () => resolve(null));
          child.on('close', (code) => {
            clearTimeout(timer);
            resolve(code === 0 && out.trim() ? out.trim() : null);
          });
        });
        if (token) return token;
      }
      return null;
    })();
  }
  return githubTokenPromise;
}

async function githubApi(urlPath) {
  const headers = { 'User-Agent': 'GitPolvo', Accept: 'application/vnd.github+json' };
  const token = await githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await electronNet.fetch('https://api.github.com' + urlPath, { headers, signal: AbortSignal.timeout(8000) });
  return { r, authed: !!token };
}

// Sua própria conta: commits feitos com o e-mail do `git config` (ou com e-mails
// da conta, quando o token permite listá-los) usam a sua foto do GitHub.
let ownIdentityPromise = null;

function ownIdentity() {
  if (!ownIdentityPromise) {
    ownIdentityPromise = (async () => {
      const emails = new Set();
      const cfg = await runGit(os.homedir(), ['config', '--global', 'user.email']);
      if (cfg.code === 0 && cfg.stdout.trim()) emails.add(cfg.stdout.trim().toLowerCase());
      let avatarUrl = null;
      try {
        if (await githubToken()) {
          const { r } = await githubApi('/user');
          if (r.ok) {
            const user = await r.json();
            avatarUrl = user.avatar_url;
            if (user.email) emails.add(user.email.toLowerCase());
            const em = (await githubApi('/user/emails')).r;
            if (em.ok) for (const e of await em.json()) if (e.verified) emails.add(e.email.toLowerCase());
          }
        }
      } catch {}
      return { avatarUrl, emails };
    })();
  }
  return ownIdentityPromise;
}

function saveAvatarStore() {
  clearTimeout(avatarCache.saveTimer);
  avatarCache.saveTimer = setTimeout(() => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'avatars.json'), JSON.stringify(avatarCache.data));
  }, 1000);
}

async function fetchImage(url) {
  try {
    const r = await electronNet.fetch(url, { headers: { 'User-Agent': 'GitPolvo' }, signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return null;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

async function githubAvatarUrl(ctx) {
  if (!ctx || !ctx.owner || Date.now() < avatarCache.githubBlockedUntil) return { url: null, definitive: false };
  try {
    const { r, authed } = await githubApi(`/repos/${ctx.owner}/${ctx.repo}/commits/${ctx.sha}`);
    if (r.status === 403 || r.status === 429) {
      // limite de 60 req/h sem token: para de consultar até o reset
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
      avatarCache.githubBlockedUntil = reset > Date.now() ? reset : Date.now() + 15 * 60e3;
      return { url: null, definitive: false };
    }
    // sem login, 404 normalmente significa repositório privado: não é resposta final
    if (!r.ok) return { url: null, definitive: authed && (r.status === 404 || r.status === 422) };
    const json = await r.json();
    return { url: json.author?.avatar_url || null, definitive: true };
  } catch {
    return { url: null, definitive: false };
  }
}

async function resolveAvatar(email, ctx) {
  const own = await ownIdentity();
  if (own.avatarUrl && own.emails.has(email)) {
    const img = await fetchImage(own.avatarUrl + (own.avatarUrl.includes('?') ? '&' : '?') + 's=80');
    if (img) return { img, definitive: true };
  }
  const noreply = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email);
  if (noreply) {
    const url = noreply[1] ? `https://avatars.githubusercontent.com/u/${noreply[1]}?s=80&v=4` : `https://github.com/${noreply[2]}.png?size=80`;
    const img = await fetchImage(url);
    if (img) return { img, definitive: true };
  }
  const gh = await githubAvatarUrl(ctx);
  if (gh.url) {
    const img = await fetchImage(gh.url + (gh.url.includes('?') ? '&' : '?') + 's=80');
    if (img) return { img, definitive: true };
  }
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  const img = await fetchImage(`https://www.gravatar.com/avatar/${hash}?s=80&d=404`);
  // sem foto em lugar nenhum: só é "definitivo" se o GitHub também respondeu
  return { img, definitive: !!img || gh.definitive || !ctx || !ctx.owner };
}

ipcMain.handle('avatar:get', async (_e, email, ctx) => {
  if (!email) return null;
  const key = email.trim().toLowerCase();
  const store = avatarStore();
  const hit = store[key];
  if (hit && Date.now() - hit.t < (hit.img ? AVATAR_TTL_OK : AVATAR_TTL_MISS)) return hit.img;
  if (avatarCache.inflight.has(key)) return avatarCache.inflight.get(key);
  const p = resolveAvatar(key, ctx).then(({ img, definitive }) => {
    avatarCache.inflight.delete(key);
    if (img || definitive) {
      store[key] = { img, t: Date.now() };
      saveAvatarStore();
    }
    return img || (hit && hit.img) || null;
  });
  avatarCache.inflight.set(key, p);
  return p;
});

ipcMain.handle('avatar:clear', () => {
  avatarCache.data = { __v: AVATAR_CACHE_VERSION };
  saveAvatarStore();
});

ipcMain.handle('git:run', (_e, cwd, args, input) => runGit(cwd, args, input));

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch));

ipcMain.handle('repo:validate', async (_e, repoPath) => {
  if (!repoPath || !fs.existsSync(repoPath)) return { ok: false, error: 'Pasta não encontrada' };
  const r = await runGit(repoPath, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) return { ok: false, error: 'Não é um repositório Git' };
  const root = r.stdout.trim();
  addRecent(root);
  return { ok: true, root };
});

ipcMain.handle('repo:watch', (_e, repoPath) => watchRepo(repoPath));
ipcMain.handle('repo:unwatch', (_e, repoPath) => unwatchRepo(repoPath));

ipcMain.handle('recent:remove', (_e, repoPath) => {
  saveSettings({ recent: loadSettings().recent.filter((p) => p !== repoPath) });
});

ipcMain.handle('dialog:pickDir', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('repo:init', async (_e, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const r = await runGit(dir, ['init', '-b', 'main']);
  if (r.code === 0) addRecent(dir);
  return r;
});

ipcMain.handle('repo:clone', async (_e, url, parentDir, name) => {
  const target = path.join(parentDir, name);
  const r = await runGit(parentDir, ['clone', '--progress', url, name]);
  if (r.code === 0) addRecent(target);
  return { ...r, target };
});

ipcMain.handle('shell:reveal', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:openExternal', (_e, url) => /^https?:/.test(url) && shell.openExternal(url));

ipcMain.handle('shell:terminal', (_e, cwd) => {
  if (IS_MAC) {
    spawn('open', ['-a', 'Terminal', cwd], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (IS_WIN) {
    // Windows Terminal se existir; senão, prompt de comando
    const wt = spawn('wt.exe', ['-d', cwd], { detached: true, stdio: 'ignore' });
    wt.on('error', () => spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', `cd /d "${cwd}"`], { detached: true, stdio: 'ignore', shell: false }).unref());
    wt.unref();
    return;
  }
  const candidates = [
    process.env.TERMINAL,
    'x-terminal-emulator',
    'gnome-terminal',
    'konsole',
    'xfce4-terminal',
    'tilix',
    'alacritty',
    'kitty',
    'xterm',
  ].filter(Boolean);
  const tryNext = (i) => {
    if (i >= candidates.length) return;
    const child = spawn(candidates[i], [], { cwd, detached: true, stdio: 'ignore' });
    child.on('error', () => tryNext(i + 1));
    child.unref();
  };
  tryNext(0);
});

ipcMain.handle('fs:readFile', (_e, repo, rel) => {
  const full = path.resolve(repo, rel);
  if (!full.startsWith(path.resolve(repo) + path.sep)) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('fs:writeFile', (_e, repo, rel, content) => {
  const full = path.resolve(repo, rel);
  if (!full.startsWith(path.resolve(repo) + path.sep)) return false;
  fs.writeFileSync(full, content);
  return true;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));

// ---------- atualizações (opcionais) ----------
// Nada é baixado sem o usuário pedir: o app só avisa que existe versão nova.
// Windows e Linux (AppImage/.deb/.rpm) usam o electron-updater com os
// releases do GitHub. No macOS sem assinatura de código a instalação
// automática não é permitida, então o aviso abre a página de download.
const UPDATE_REPO = 'leoomartinelli/gitpolvo';
const updater = { lib: null, info: null, manualOnly: IS_MAC };

function sendUpdate(status) {
  updater.last = status;
  send('update:status', status);
}

function newerThan(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) sendUpdate({ state: 'dev' });
    return;
  }
  try {
    if (updater.manualOnly) {
      const r = await electronNet.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { 'User-Agent': 'GitPolvo', Accept: 'application/vnd.github+json' },
      });
      if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
      const rel = await r.json();
      if (newerThan(rel.tag_name, app.getVersion())) sendUpdate({ state: 'available', version: rel.tag_name.replace(/^v/, ''), manual: true, url: rel.html_url });
      else if (manual) sendUpdate({ state: 'none' });
      return;
    }
    const res = await updater.lib.checkForUpdates();
    if (manual && (!res || !res.updateInfo || !newerThan(res.updateInfo.version, app.getVersion()))) sendUpdate({ state: 'none' });
  } catch (e) {
    if (manual) sendUpdate({ state: 'error', message: String(e.message || e) });
  }
}

function setupUpdater() {
  if (!app.isPackaged || updater.manualOnly) return;
  try {
    updater.lib = require('electron-updater').autoUpdater;
  } catch {
    updater.manualOnly = true;
    return;
  }
  const u = updater.lib;
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  u.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
  u.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  u.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  u.on('error', (e) => sendUpdate({ state: 'error', message: String(e && e.message ? e.message : e) }));
}

ipcMain.handle('update:check', () => checkForUpdates(true));
ipcMain.handle('update:last', () => updater.last || null);
ipcMain.handle('update:download', async () => {
  if (updater.manualOnly) return;
  sendUpdate({ state: 'downloading', percent: 0 });
  await updater.lib.downloadUpdate();
});
ipcMain.handle('update:install', () => updater.lib && updater.lib.quitAndInstall(false, true));

app.whenReady().then(() => {
  startAskpassServer();
  buildMenu();
  createWindow();
  setupUpdater();
  // primeira verificação logo após abrir e depois a cada 4 horas
  setTimeout(() => checkForUpdates(false), 8000);
  setInterval(() => checkForUpdates(false), 4 * 3600e3);
});

app.on('window-all-closed', () => {
  for (const repo of [...watchers.keys()]) unwatchRepo(repo);
  app.quit();
});

app.on('quit', () => {
  if (IS_WIN) return;
  try {
    fs.unlinkSync(askpass.sock);
  } catch {}
});
