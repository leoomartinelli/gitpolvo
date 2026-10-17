'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('polvo', {
  git: (cwd, args, input) => ipcRenderer.invoke('git:run', cwd, args, input),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  repo: {
    validate: (p) => ipcRenderer.invoke('repo:validate', p),
    watch: (p) => ipcRenderer.invoke('repo:watch', p),
    unwatch: (p) => ipcRenderer.invoke('repo:unwatch', p),
    init: (dir) => ipcRenderer.invoke('repo:init', dir),
    clone: (url, parent, name) => ipcRenderer.invoke('repo:clone', url, parent, name),
    removeRecent: (p) => ipcRenderer.invoke('recent:remove', p),
  },
  pickDir: (title) => ipcRenderer.invoke('dialog:pickDir', title),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  terminal: (cwd) => ipcRenderer.invoke('shell:terminal', cwd),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  readFile: (repo, rel) => ipcRenderer.invoke('fs:readFile', repo, rel),
  writeFile: (repo, rel, content) => ipcRenderer.invoke('fs:writeFile', repo, rel, content),
  appInfo: () => ipcRenderer.invoke('app:info'),
  avatar: (email, ctx) => ipcRenderer.invoke('avatar:get', email, ctx),
  clearAvatars: () => ipcRenderer.invoke('avatar:clear'),
  onRepoChanged: (fn) => ipcRenderer.on('repo:changed', (_e, p) => fn(p)),
  onWindowFocus: (fn) => ipcRenderer.on('window:focus', () => fn()),
  onMenu: (fn) => ipcRenderer.on('menu:command', (_e, name) => fn(name)),
  onAskpass: (fn) => ipcRenderer.on('askpass:request', (_e, id, prompt) => fn(id, prompt)),
  answerAskpass: (id, reply) => ipcRenderer.send('askpass:response', id, reply),
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    last: () => ipcRenderer.invoke('update:last'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (fn) => ipcRenderer.on('update:status', (_e, s) => fn(s)),
  },
});
