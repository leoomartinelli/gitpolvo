'use strict';

// Camada de acesso ao Git: cada função executa o binário git via IPC e devolve
// estruturas já interpretadas para a interface.

const FS = '\x1f';
const RS = '\x1e';
const LOG_PAGE = 3000; // commits lidos por vez; rolar até o fim do grafo carrega mais

class GitError extends Error {
  constructor(args, result) {
    super((result.stderr || result.stdout || 'git falhou').trim());
    this.args = args;
    this.code = result.code;
  }
}

class Repo {
  constructor(root) {
    this.root = root;
    this.name = root.split('/').filter(Boolean).pop();
  }

  async raw(args, input) {
    return window.polvo.git(this.root, args, input);
  }

  async run(args, input) {
    const r = await this.raw(args, input);
    if (r.code !== 0) throw new GitError(args, r);
    return r.stdout;
  }

  async head() {
    const r = await this.raw(['symbolic-ref', '--short', '-q', 'HEAD']);
    if (r.code === 0) return { branch: r.stdout.trim(), detached: false };
    const sha = await this.raw(['rev-parse', '--short', 'HEAD']);
    return { branch: null, detached: true, sha: sha.stdout.trim() };
  }

  async state() {
    const probe = async (rel) => (await this.raw(['rev-parse', '-q', '--verify', rel])).code === 0;
    if (await probe('MERGE_HEAD')) return 'merge';
    if (await this.rebasing()) return 'rebase';
    if (await probe('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await probe('REVERT_HEAD')) return 'revert';
    return 'clean';
  }

  async gitDir() {
    if (!this._gitDir) this._gitDir = (await this.run(['rev-parse', '--absolute-git-dir'])).trim();
    return this._gitDir;
  }

  // O git pode deixar REBASE_HEAD para trás (ex.: depois de um squash); a pasta
  // rebase-merge/rebase-apply só existe enquanto o rebase está em andamento.
  async rebasing() {
    const dir = await this.gitDir();
    const [merge, apply] = await Promise.all([window.polvo.readFile(dir, 'rebase-merge/head-name'), window.polvo.readFile(dir, 'rebase-apply/head-name')]);
    return merge != null || apply != null;
  }

  // hidden: refs (ou globs como refs/remotes/origin/*) fora do grafo.
  // solo: se não vazio, o grafo mostra só o histórico dessas refs.
  async log({ limit = LOG_PAGE, hidden = [], solo = [] } = {}) {
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D', '%b'].join(FS) + RS;
    const revs = solo.length ? ['--ignore-missing', ...solo] : ['--exclude=refs/stash', ...hidden.map((x) => `--exclude=${x}`), '--all'];
    const r = await this.raw(['log', '--decorate=full', ...revs, '--date-order', `-n${limit}`, `--format=${fmt}`, '--']);
    if (r.code !== 0) return []; // repositório sem commits
    return r.stdout
      .split(RS)
      .map((s) => s.replace(/^\n/, ''))
      .filter(Boolean)
      .map((rec) => {
        const [sha, parents, author, email, at, subject, refs, body] = rec.split(FS);
        return {
          sha,
          parents: parents ? parents.split(' ') : [],
          author,
          email,
          date: new Date(Number(at) * 1000),
          subject,
          // primeira linha da descrição, exibida em cinza ao lado do título
          bodyLine: (body || '').split('\n').map((l) => l.trim()).find(Boolean) || '',
          refs: parseDecorations(refs),
        };
      });
  }

  async refs() {
    const fmt = ['%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track)', '%(HEAD)'].join(FS);
    const out = await this.run(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
    const local = [];
    const remotes = {};
    const tags = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [ref, sha, upstream, track, head] = line.split(FS);
      if (ref.startsWith('refs/heads/')) {
        const ahead = /ahead (\d+)/.exec(track);
        const behind = /behind (\d+)/.exec(track);
        local.push({
          name: ref.slice(11),
          sha,
          upstream,
          ahead: ahead ? +ahead[1] : 0,
          behind: behind ? +behind[1] : 0,
          gone: track.includes('gone'),
          current: head === '*',
        });
      } else if (ref.startsWith('refs/remotes/')) {
        const rest = ref.slice(13);
        const slash = rest.indexOf('/');
        const remote = rest.slice(0, slash);
        const name = rest.slice(slash + 1);
        if (name === 'HEAD') continue;
        (remotes[remote] ||= []).push({ name, full: rest, sha });
      } else {
        tags.push({ name: ref.slice(10), sha });
      }
    }
    return { local, remotes, tags };
  }

  async remoteNames() {
    return (await this.run(['remote'])).split('\n').filter(Boolean);
  }

  async stashes() {
    // %gs é a mensagem do reflog, a que o "git stash list" mostra (muda ao renomear)
    const r = await this.raw(['stash', 'list', `--format=%H%x1f%P%x1f%gd%x1f%gs`]);
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, parents, ref, msg] = l.split(FS);
        // o primeiro pai do commit de stash é o commit em que o WIP estava
        return { sha, parent: (parents || '').split(' ')[0], ref, msg: msg || ref || '' };
      })
      .filter((s) => s.sha);
  }

  // Submódulos declarados no .gitmodules. state: 'ok', 'uninit' (ainda não
  // baixado), 'changed' (no diretório há outro commit que o registrado) ou 'conflict'.
  async submodules() {
    const r = await this.raw(['submodule', 'status']);
    if (r.code !== 0 || !r.stdout.trim()) return [];
    const urls = {};
    const cfg = await this.raw(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$']);
    const byName = {};
    for (const line of cfg.stdout.split('\n').filter(Boolean)) {
      const m = /^submodule\.(.+)\.(path|url) (.*)$/.exec(line);
      if (m) (byName[m[1]] ||= {})[m[2]] = m[3];
    }
    for (const v of Object.values(byName)) if (v.path) urls[v.path] = v.url;
    return parseSubmoduleStatus(r.stdout).map((x) => ({ ...x, url: urls[x.path] || '' }));
  }

  // O primeiro da lista é o diretório principal do repositório.
  async worktrees() {
    const r = await this.raw(['worktree', 'list', '--porcelain']);
    if (r.code !== 0) return [];
    return parseWorktrees(r.stdout);
  }

  // Nome/e-mail que o próximo commit vai usar e se vêm só deste repositório.
  async identity() {
    const get = async (args) => (await this.raw(['config', ...args])).stdout.trim();
    const [name, email, localName, localEmail] = await Promise.all([get(['user.name']), get(['user.email']), get(['--local', 'user.name']), get(['--local', 'user.email'])]);
    return { name, email, local: !!(localName || localEmail) };
  }

  async status() {
    const out = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const parts = out.split('\0');
    const staged = [];
    const unstaged = [];
    const conflicts = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry) continue;
      const x = entry[0];
      const y = entry[1];
      const file = entry.slice(3);
      let from = null;
      if (x === 'R' || x === 'C') from = parts[++i];
      const xy = x + y;
      if (['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(xy)) {
        conflicts.push({ path: file, status: 'C', xy });
        continue;
      }
      if (xy === '??') {
        unstaged.push({ path: file, status: 'A', untracked: true });
        continue;
      }
      if (x !== ' ') staged.push({ path: file, status: x, from });
      if (y !== ' ') unstaged.push({ path: file, status: y });
    }
    return { staged, unstaged, conflicts };
  }

  async commitDetails(sha) {
    // %G? só confere a assinatura deste commit (no log inteiro seria lento)
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%G?', '%GS', '%B'].join(FS);
    const meta = await this.run(['show', '-s', `--format=${fmt}`, sha]);
    const [h, parents, an, ae, at, cn, ce, ct, sig, signer, body] = meta.split(FS);
    const parentList = parents ? parents.split(' ') : [];
    const files = await this.commitFiles(sha, parentList);
    return {
      sha: h,
      parents: parentList,
      author: an,
      email: ae,
      date: new Date(+at * 1000),
      committer: cn,
      committerEmail: ce,
      commitDate: new Date(+ct * 1000),
      signature: sig && sig !== 'N' ? { status: sig, signer } : null,
      message: body.trim(),
      files,
    };
  }

  // Arquivos alterados entre dois commits quaisquer (comparação A → B).
  async compareFiles(a, b) {
    return this.commitFiles(b, [a]);
  }

  async commitFiles(sha, parents) {
    const args = parents.length
      ? ['diff', '--name-status', '-z', '-M', parents[0], sha]
      : ['show', '--format=', '--name-status', '-z', '-M', sha];
    const parts = (await this.run(args)).split('\0').filter((p) => p !== '');
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const st = parts[i].replace(/^\n/, '');
      const code = st[0];
      if (code === 'R' || code === 'C') {
        files.push({ status: code, from: parts[++i], path: parts[++i] });
      } else {
        files.push({ status: code, path: parts[++i] });
      }
    }
    return files;
  }

  // kind: 'unstaged' | 'staged' | 'untracked' | 'commit'
  // from: caminho antigo, quando o arquivo foi renomeado no commit
  // ignoreWs: esconde mudanças que são só espaço (git diff -w)
  async diff(kind, file, sha, parents, from, { ignoreWs = false } = {}) {
    const paths = from && from !== file ? [from, file] : [file];
    const ws = ignoreWs ? ['-w'] : [];
    let r;
    if (kind === 'unstaged') r = await this.raw(['diff', '--no-color', '--no-ext-diff', ...ws, '--', file]);
    else if (kind === 'staged') r = await this.raw(['diff', '--cached', '--no-color', '--no-ext-diff', ...ws, '--', file]);
    else if (kind === 'untracked') r = await this.raw(['diff', '--no-color', '--no-index', ...ws, '--', '/dev/null', file]);
    else if (parents && parents.length)
      r = await this.raw(['diff', '--no-color', '--no-ext-diff', '-M', ...ws, parents[0], sha, '--', ...paths]);
    else r = await this.raw(['show', '--no-color', '--format=', ...ws, sha, '--', file]);
    return parseDiff(r.stdout);
  }

  // Commits que mexeram no arquivo, seguindo renomeações; `path` é o nome do
  // arquivo naquele commit e `from` o nome anterior quando ele foi renomeado.
  async fileHistory(file) {
    const fmt = RS + ['%H', '%P', '%an', '%ae', '%at', '%s'].join(FS);
    const r = await this.raw(['log', '--follow', '-M', '--name-status', `--format=${fmt}`, '--', file]);
    if (r.code !== 0) throw new GitError(['log'], r);
    return r.stdout
      .split(RS)
      .filter((x) => x.trim())
      .map((rec) => {
        const [head, ...rest] = rec.split('\n');
        const [sha, parents, author, email, at, subject] = head.split(FS);
        const st = rest.find((l) => /^[A-Z]/.test(l)) || '';
        const cols = st.split('\t');
        return {
          sha,
          parents: parents ? parents.split(' ') : [],
          author,
          email,
          date: new Date(Number(at) * 1000),
          subject,
          status: st[0] || 'M',
          path: cols[cols.length - 1] || file,
          from: cols.length > 2 ? cols[1] : null,
        };
      });
  }

  // rev omitido = arquivo do diretório de trabalho (linhas sem commit aparecem como tal)
  async blame(file, rev) {
    const r = await this.raw(['blame', '--porcelain', ...(rev ? [rev] : []), '--', file]);
    if (r.code !== 0) throw new GitError(['blame'], r);
    return parseBlame(r.stdout);
  }

  async applyPatch(patch, { cached = true, reverse = false } = {}) {
    const args = ['apply', '--whitespace=nowarn', '--unidiff-zero'];
    if (cached) args.push('--cached');
    if (reverse) args.push('-R');
    args.push('-');
    return this.run(args, patch);
  }
}

const UNCOMMITTED = '0'.repeat(40);

// Saída de `git blame --porcelain`: cada linha traz o commit; os dados do
// commit (autor, data, resumo) vêm só na primeira vez que ele aparece.
function parseBlame(text) {
  const commits = {};
  const lines = [];
  let cur = null;
  for (const l of text.split('\n')) {
    if (l.startsWith('\t')) {
      lines.push({ sha: cur, text: l.slice(1) });
      continue;
    }
    const m = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
    if (m) {
      cur = m[1];
      commits[cur] ||= { sha: cur, uncommitted: cur === UNCOMMITTED };
      continue;
    }
    if (!cur) continue;
    const sp = l.indexOf(' ');
    const key = sp < 0 ? l : l.slice(0, sp);
    const val = sp < 0 ? '' : l.slice(sp + 1);
    const c = commits[cur];
    if (key === 'author') c.author = val;
    else if (key === 'author-mail') c.email = val.replace(/^<|>$/g, '');
    else if (key === 'author-time') c.date = new Date(Number(val) * 1000);
    else if (key === 'summary') c.summary = val;
  }
  return { commits, lines };
}

function parseSubmoduleStatus(text) {
  const state = { ' ': 'ok', '-': 'uninit', '+': 'changed', U: 'conflict' };
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = /^([ +\-U])([0-9a-f]+) (\S+)(?: \((.*)\))?$/.exec(l);
      return m && { state: state[m[1]], sha: m[2], path: m[3], describe: m[4] || '' };
    })
    .filter(Boolean);
}

function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) out.push((cur = { path: line.slice(9), branch: null, sha: '', detached: false, locked: false, prunable: false, bare: false }));
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.sha = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return out;
}

// Página web do repositório a partir da URL do remoto (https, ssh ou scp),
// para montar o link de um commit no GitHub, GitLab ou Bitbucket.
function remoteWeb(url) {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/|ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/|[^@\s]+@([^:/]+):)(.+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  if (!m) return null;
  const host = (m[1] || m[2] || m[3]).toLowerCase();
  const path = m[4].replace(/^\/+/, '');
  const kind = host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : host.includes('bitbucket') ? 'bitbucket' : null;
  if (!kind || !path.includes('/')) return null;
  const base = `https://${host}/${path}`;
  const name = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' }[kind];
  const commit = { github: (sha) => `${base}/commit/${sha}`, gitlab: (sha) => `${base}/-/commit/${sha}`, bitbucket: (sha) => `${base}/commits/${sha}` }[kind];
  return { kind, name, base, commitUrl: commit };
}

function parseDecorations(raw) {
  if (!raw) return [];
  return raw
    .split(', ')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('HEAD -> ')) return { type: 'head', name: r.slice(19) };
      if (r === 'HEAD') return { type: 'detached', name: 'HEAD' };
      if (r.startsWith('tag: refs/tags/')) return { type: 'tag', name: r.slice(15) };
      if (r.startsWith('refs/heads/')) return { type: 'local', name: r.slice(11) };
      if (r.startsWith('refs/remotes/') && !r.endsWith('/HEAD')) return { type: 'remote', name: r.slice(13) };
      return null;
    })
    .filter(Boolean);
}

// Divide a saída do git diff em arquivos > hunks > linhas, guardando o cabeçalho
// bruto de cada arquivo para reconstruir patches parciais (stage por hunk).
function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ') || (line.startsWith('diff ') && !file)) {
      file = { header: [line], hunks: [], binary: false };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith('@@')) {
        // cai para o tratamento de hunk abaixo
      } else {
        if (line.startsWith('Binary files')) file.binary = true;
        file.header.push(line);
        continue;
      }
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      hunk = {
        header: line,
        oldStart: m ? +m[1] : 0,
        newStart: m ? +m[3] : 0,
        context: m ? m[5] : '',
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    if (line === '' && i === lines.length - 1) continue;
    const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line[0] === '\\' ? 'meta' : 'ctx';
    hunk.lines.push({ type, text: line.slice(1), raw: line });
  }
  for (const f of files) {
    let o = 0;
    let n = 0;
    for (const h of f.hunks) {
      o = h.oldStart;
      n = h.newStart;
      for (const l of h.lines) {
        if (l.type === 'ctx') {
          l.old = o++;
          l.new = n++;
        } else if (l.type === 'del') l.old = o++;
        else if (l.type === 'add') l.new = n++;
      }
    }
  }
  return files;
}

function hunkPatch(file, hunk) {
  return [...file.header, hunk.header, ...hunk.lines.map((l) => l.raw), ''].join('\n');
}

// Patch só com as linhas escolhidas (`picked(hunk, line)`), para stage/unstage/
// descarte por linha. Aplicado para frente (stage), uma remoção não escolhida
// vira contexto e uma adição não escolhida some; ao contrário (unstage e
// descarte, com -R) é o inverso. Assim o lado que o git confere no índice ou no
// diretório continua idêntico ao arquivo de verdade.
function linesPatch(file, picked, { reverse = false } = {}) {
  const out = [...file.header];
  let any = false;
  for (const hk of file.hunks) {
    const lines = [];
    let oldN = 0;
    let newN = 0;
    let changed = false;
    let dropped = false;
    for (const l of hk.lines) {
      if (l.type === 'meta') {
        if (!dropped) lines.push(l.raw);
        continue;
      }
      dropped = false;
      const keep = l.type === 'ctx' || picked(hk, l);
      if (l.type === 'ctx' || keep) {
        lines.push(l.raw);
        if (l.type !== 'add') oldN++;
        if (l.type !== 'del') newN++;
        if (l.type !== 'ctx') changed = true;
      } else if ((l.type === 'del') !== reverse) {
        // fica como estava: vira contexto
        lines.push(' ' + l.text);
        oldN++;
        newN++;
      } else dropped = true;
    }
    if (!changed) continue;
    any = true;
    out.push(`@@ -${hk.oldStart},${oldN} +${hk.newStart},${newN} @@${hk.context}`, ...lines);
  }
  return any ? out.join('\n') + '\n' : null;
}

// Atribui colunas (lanes) a cada commit e produz as arestas desenhadas por linha.
// `lanes[i]` guarda o SHA esperado naquela coluna; colunas liberadas viram null e
// são reaproveitadas, mantendo as linhas estáveis verticalmente.
function layoutGraph(commits) {
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  let lanes = [];
  let maxLanes = 1;
  const rows = [];
  for (const c of commits) {
    const before = lanes.slice();
    let col = lanes.indexOf(c.sha);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
    }
    const merging = [];
    lanes.forEach((h, i) => {
      if (h === c.sha && i !== col) {
        merging.push(i);
        lanes[i] = null;
      }
    });
    const parents = c.parents.filter((p) => index.has(p));
    lanes[col] = parents[0] || null;
    const parentCols = [];
    if (parents[0]) parentCols.push(col);
    for (const p of parents.slice(1)) {
      let pc = lanes.indexOf(p);
      if (pc === -1) {
        pc = lanes.indexOf(null);
        if (pc === -1) pc = lanes.length;
        lanes[pc] = p;
      }
      parentCols.push(pc);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const after = lanes.slice();
    const pass = [];
    before.forEach((h, i) => {
      if (h && h !== c.sha && after[i] === h) pass.push(i);
    });
    const incoming = before[col] === c.sha ? [col] : [];
    rows.push({ col, incoming: incoming.concat(merging), parentCols, pass, isMerge: parents.length > 1 });
    maxLanes = Math.max(maxLanes, before.length, after.length, col + 1);
    lanes = after;
  }
  return { rows, maxLanes };
}

// Nome da branch "dona" de cada commit: a etiqueta que abre a linha do grafo
// desce pelo primeiro pai; linhas abertas por um merge herdam o nome citado na
// mensagem ("Merge branch 'x'", "Merge pull request #n from user/x").
function mergeSourceName(subject) {
  let m = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject);
  if (m) return m[1].replace(/^origin\//, '');
  m = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  if (m) return m[1];
  return null;
}

function branchOwners(commits, rows) {
  const owners = new Array(commits.length);
  const laneOwner = [];
  commits.forEach((c, i) => {
    const g = rows[i];
    const ref =
      c.refs.find((r) => r.type === 'head') || c.refs.find((r) => r.type === 'local') || c.refs.find((r) => r.type === 'remote');
    let own = ref ? (ref.type === 'remote' ? ref.name.slice(ref.name.indexOf('/') + 1) : ref.name) : laneOwner[g.col];
    owners[i] = own || null;
    for (const k of g.incoming) if (k !== g.col) laneOwner[k] = undefined;
    laneOwner[g.col] = g.parentCols.includes(g.col) ? own : undefined;
    const fromMerge = mergeSourceName(c.subject);
    for (const j of g.parentCols) if (j !== g.col && laneOwner[j] === undefined) laneOwner[j] = fromMerge || undefined;
  });
  return owners;
}

window.GitLayer = { Repo, GitError, parseDiff, parseBlame, parseSubmoduleStatus, parseWorktrees, remoteWeb, hunkPatch, linesPatch, layoutGraph, branchOwners, LOG_PAGE };
