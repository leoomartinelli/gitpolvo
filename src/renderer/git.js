'use strict';

// Camada de acesso ao Git: cada função executa o binário git via IPC e devolve
// estruturas já interpretadas para a interface.

const FS = '\x1f';
const RS = '\x1e';
const LOG_LIMIT = 3000;

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
    if (await probe('REBASE_HEAD')) return 'rebase';
    if (await probe('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await probe('REVERT_HEAD')) return 'revert';
    return 'clean';
  }

  async log() {
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D', '%b'].join(FS) + RS;
    const r = await this.raw(['log', '--decorate=full', '--exclude=refs/stash', '--all', '--date-order', `-n${LOG_LIMIT}`, `--format=${fmt}`]);
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
    const r = await this.raw(['stash', 'list', `--format=%H%x1f%gd%x1f%s`]);
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, ref, msg] = l.split(FS);
        return { sha, ref, msg: msg || ref || '' };
      })
      .filter((s) => s.sha);
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
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join(FS);
    const meta = await this.run(['show', '-s', `--format=${fmt}`, sha]);
    const [h, parents, an, ae, at, cn, ce, ct, body] = meta.split(FS);
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
      message: body.trim(),
      files,
    };
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
  async diff(kind, file, sha, parents) {
    let r;
    if (kind === 'unstaged') r = await this.raw(['diff', '--no-color', '--no-ext-diff', '--', file]);
    else if (kind === 'staged') r = await this.raw(['diff', '--cached', '--no-color', '--no-ext-diff', '--', file]);
    else if (kind === 'untracked') r = await this.raw(['diff', '--no-color', '--no-index', '--', '/dev/null', file]);
    else if (parents && parents.length)
      r = await this.raw(['diff', '--no-color', '--no-ext-diff', '-M', parents[0], sha, '--', file]);
    else r = await this.raw(['show', '--no-color', '--format=', sha, '--', file]);
    return parseDiff(r.stdout);
  }

  async applyPatch(patch, { cached = true, reverse = false } = {}) {
    const args = ['apply', '--whitespace=nowarn', '--unidiff-zero'];
    if (cached) args.push('--cached');
    if (reverse) args.push('-R');
    args.push('-');
    return this.run(args, patch);
  }
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

window.GitLayer = { Repo, GitError, parseDiff, hunkPatch, layoutGraph, branchOwners };
