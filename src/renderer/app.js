'use strict';

(() => {
  const { Repo, hunkPatch, linesPatch, remoteWeb, layoutGraph, branchOwners, LOG_PAGE } = window.GitLayer;
  const { h, toast, form, prompt, confirmBox, choices, palette, openModal } = window.UI;
  const V = window.Views;
  const polvo = window.polvo;

  const ICON = '../../assets/icon.svg';

  // ======================================================================
  // Aba de repositório
  // ======================================================================
  class RepoTab {
    constructor(app, root) {
      this.app = app;
      this.kind = 'repo';
      this.repo = new Repo(root);
      this.title = this.repo.name;
      this.data = {};
      this.commits = [];
      this.layout = { rows: [], maxLanes: 1 };
      this.selected = 'WIP';
      this.selectedDetails = null;
      this.multi = []; // commits marcados com Ctrl/Shift+clique (2 ou mais)
      this.compare = null; // { a, b, labelA, labelB, files, counts } da comparação aberta
      this.logLimit = LOG_PAGE;
      this.filters = null; // branches escondidas/solo no grafo, lidas das configurações
      this.editDrafts = {}; // edições não salvas do editor embutido, por arquivo
      this.opLog = []; // operações feitas nesta sessão, com os comandos git de cada uma
      this.undoStack = []; // ações que o botão Desfazer sabe reverter (só nesta sessão)
      this.redoStack = [];
      this.view = { type: 'graph' };
      this.collapsed = {};
      this.commitDraft = { summary: '', description: '', amend: false };
      this.fileView = { mode: 'path', desc: false, all: false };
      this.treeCollapsed = new Set();
      this.treeCache = new Map();
      this.search = '';
      this.busy = null;
      this.fetching = false;
      this.backgroundFetch = false;
      this.skipAutoFetch = false;
      this.page = h('div', { class: 'tab-page' });
      V.buildLayout(this);
      polvo.repo.watch(root);
    }

    dispose() {
      polvo.repo.unwatch(this.repo.root);
    }

    // ---------- carga de dados ----------
    async refresh() {
      if (this.refreshing) {
        this.refreshAgain = true;
        return;
      }
      this.refreshing = true;
      try {
        const r = this.repo;
        if (!this.filters) this.filters = await this.loadFilters();
        if (!this.pinned) this.pinned = ((await polvo.settings.get()).pinnedBranches || {})[this.repo.root] || [];
        const log = r.log({ limit: this.logLimit, hidden: this.filters.hidden, solo: this.filters.solo });
        const [head, refs, stashes, status, commits, state, submodules, worktrees, identity, hooks, template] = await Promise.all([
          r.head(),
          r.refs(),
          r.stashes(),
          r.status(),
          log,
          r.state(),
          r.submodules(),
          r.worktrees(),
          r.identity(),
          polvo.hooks(r.root),
          polvo.commitTemplate(r.root),
        ]);
        const headSha = (await r.raw(['rev-parse', 'HEAD'])).stdout.trim();
        // nada mudou desde a última leitura: só confere o diff aberto, sem redesenhar
        const signature = JSON.stringify([head, refs, stashes, status, state, headSha, submodules, worktrees, identity, hooks, template, commits.map((c) => c.sha + c.refs.map((x) => x.name).join())]);
        if (signature === this.signature) {
          if (this.view.type === 'diff') this.reloadDiff();
          return;
        }
        this.signature = signature;
        this.data = { head, refs, stashes, status, state, submodules, worktrees, identity, hooks, template };
        if (state !== 'clean' && !this.commitDraft.summary) await this.prefillSequencerMessage();
        this.commits = commits;
        this.layout = layoutGraph(commits);
        this.owners = branchOwners(commits, this.layout.rows);
        this.shaIndex = new Map(commits.map((c, i) => [c.sha, i]));
        this.hasMoreCommits = commits.length >= this.logLimit;
        this.multi = this.multi.filter((sha) => this.shaIndex.has(sha));
        if (this.multi.length < 2) this.multi = [];
        this.headSha = headSha;
        if (this.github === undefined) this.github = await this.detectGithub();
        if (this.web === undefined) this.web = await this.detectWeb();
        this._rowItems = null;
        this.rowItems(); // já reserva as colunas extras dos stashes antes de medir o grafo
        if (this.selected !== 'WIP' && !this.shaIndex.has(this.selected) && !this.selectedIsStash) this.selected = 'WIP';
        this.render();
        if (this.view.type === 'diff') this.reloadDiff();
        if (this.compare) this.loadCompare();
      } catch (e) {
        toast('Erro ao ler o repositório:\n' + e.message, 'error');
      } finally {
        this.refreshing = false;
        if (this.refreshAgain) {
          this.refreshAgain = false;
          await this.refresh();
        }
      }
    }

    // Rolar até o fim do grafo lê mais uma página de commits.
    async loadMoreCommits() {
      if (this.loadingMore || !this.hasMoreCommits || this.refreshing) return;
      this.loadingMore = true;
      this.logLimit += LOG_PAGE;
      try {
        await this.refresh();
      } finally {
        this.loadingMore = false;
      }
    }

    // ---------- filtros do grafo (esconder / solo) ----------
    // Refs completas (refs/heads/x, refs/remotes/origin/x) ou o remoto inteiro
    // (refs/remotes/origin/*), guardadas por repositório nas configurações.
    async loadFilters() {
      const s = await polvo.settings.get();
      const f = (s.graphFilters || {})[this.repo.root] || {};
      return { hidden: f.hidden || [], solo: f.solo || [] };
    }

    async saveFilters() {
      const s = await polvo.settings.get();
      const all = { ...(s.graphFilters || {}) };
      if (this.filters.hidden.length || this.filters.solo.length) all[this.repo.root] = this.filters;
      else delete all[this.repo.root];
      await polvo.settings.set({ graphFilters: all });
    }

    isHidden(ref) {
      const hidden = this.filters?.hidden || [];
      return hidden.includes(ref) || (ref.startsWith('refs/remotes/') && hidden.includes(ref.replace(/^(refs\/remotes\/[^/]+\/).*$/, '$1*')));
    }

    isSolo(ref) {
      return !!this.filters?.solo.includes(ref);
    }

    async setFilters(change) {
      change(this.filters);
      await this.saveFilters();
      this.signature = null; // redesenha mesmo se os commits visíveis forem os mesmos
      await this.refresh();
    }

    toggleHidden(ref) {
      return this.setFilters((f) => {
        const i = f.hidden.indexOf(ref);
        if (i >= 0) f.hidden.splice(i, 1);
        else f.hidden.push(ref);
      });
    }

    toggleSolo(ref) {
      return this.setFilters((f) => {
        const i = f.solo.indexOf(ref);
        if (i >= 0) f.solo.splice(i, 1);
        else f.solo.push(ref);
      });
    }

    clearFilters() {
      return this.setFilters((f) => {
        f.hidden = [];
        f.solo = [];
      });
    }

    // Liga/desliga cada remoto no grafo (usado no ⚙ do grafo e no cabeçalho "Remoto").
    remotesFilterMenu() {
      const remotes = Object.keys(this.data.refs?.remotes || {});
      if (!remotes.length) return [{ label: 'Nenhum remoto', disabled: true, action: () => {} }];
      const glob = (r) => `refs/remotes/${r}/*`;
      const anyShown = remotes.some((r) => !this.isHidden(glob(r)));
      return [
        { label: 'Branches remotas no grafo', disabled: true, action: () => {} },
        ...remotes.map((r) => ({ label: (this.isHidden(glob(r)) ? '\u2003' : '✓ ') + r, action: () => this.toggleHidden(glob(r)) })),
        '-',
        {
          label: anyShown ? 'Esconder todas as remotas (só locais)' : 'Mostrar todas as remotas',
          action: () =>
            this.setFilters((f) => {
              f.hidden = f.hidden.filter((x) => !x.startsWith('refs/remotes/'));
              if (anyShown) f.hidden.push(...remotes.map(glob));
            }),
        },
      ];
    }

    refFilterMenu(ref, { canHide = true } = {}) {
      return [
        canHide && { label: this.isHidden(ref) ? 'Mostrar no grafo' : 'Esconder no grafo', action: () => this.toggleHidden(ref) },
        { label: this.isSolo(ref) ? 'Sair do solo' : 'Solo (mostrar só esta no grafo)', action: () => this.toggleSolo(ref) },
      ];
    }

    // owner/repo do primeiro remoto hospedado no GitHub (origin tem prioridade),
    // usado para buscar a foto de perfil da conta ligada a cada commit.
    async detectGithub() {
      const out = (await this.repo.raw(['remote', '-v'])).stdout;
      const remotes = out.split('\n').filter((l) => l.endsWith('(fetch)'));
      remotes.sort((a, b) => (b.startsWith('origin\t') ? 1 : 0) - (a.startsWith('origin\t') ? 1 : 0));
      for (const line of remotes) {
        const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?\s/.exec(line + ' ');
        if (m) return { owner: m[1], repo: m[2] };
      }
      return null;
    }

    // Site do primeiro remoto reconhecido (origin primeiro), para os links de commit.
    async detectWeb() {
      const out = (await this.repo.raw(['remote', '-v'])).stdout;
      const urls = out
        .split('\n')
        .filter((l) => l.endsWith('(fetch)'))
        .sort((a, b) => (b.startsWith('origin\t') ? 1 : 0) - (a.startsWith('origin\t') ? 1 : 0))
        .map((l) => l.split('\t')[1].replace(/\s+\(fetch\)$/, ''));
      for (const u of urls) {
        const web = remoteWeb(u);
        if (web) return web;
      }
      return null;
    }

    // Itens "abrir/copiar link" do commit no site do remoto.
    webMenu(sha) {
      if (!this.web) return [];
      const url = this.web.commitUrl(sha);
      return [
        { label: `Abrir commit no ${this.web.name}`, action: () => polvo.openExternal(url) },
        { label: 'Copiar link do commit', action: () => this.copy(url) },
      ];
    }

    // Todos os arquivos versionados no commit (para "Ver todos os arquivos").
    async treeFiles(sha) {
      if (!this.treeCache.has(sha)) {
        const out = await this.repo.run(['ls-tree', '-r', '--name-only', '-z', sha]);
        this.treeCache.set(sha, out.split('\0').filter(Boolean));
      }
      return this.treeCache.get(sha);
    }

    avatarCtx(sha) {
      return this.github ? { ...this.github, sha } : null;
    }

    hasWip() {
      const s = this.data.status;
      return !!s && (s.staged.length || s.unstaged.length || s.conflicts.length || !this.commits.length);
    }

    hasDirtyWorktree() {
      const s = this.data.status;
      return !!s && (s.staged.length || s.unstaged.length || s.conflicts.length);
    }

    wipCount() {
      const s = this.data.status;
      if (!s) return 0;
      return new Set([...s.staged, ...s.unstaged, ...s.conflicts].map((f) => f.path)).size;
    }

    rowItems() {
      if (this._rowItems) return this._rowItems;
      const items = [];
      // Cada stash fica logo acima do commit de onde saiu; os de base fora do
      // histórico carregado aparecem só na lista da esquerda.
      const stashesAt = new Map();
      for (const s of this.data.stashes || []) {
        const idx = this.shaIndex?.get(s.parent);
        if (idx == null) continue;
        if (!stashesAt.has(idx)) stashesAt.set(idx, []);
        stashesAt.get(idx).push(s);
      }
      const headIdx = this.shaIndex?.get(this.headSha);
      const wipLine = this.hasWip() && this.commits.length && headIdx === 0;
      if (this.hasWip() && this.commits.length) {
        const col = headIdx != null ? this.layout.rows[headIdx].col : 0;
        items.push({ type: 'wip', g: { col, lineDown: wipLine } });
      }
      this.commits.forEach((c, i) => {
        let g = this.layout.rows[i];
        const stashes = stashesAt.get(i);
        if (stashes) {
          // linhas que já atravessam o espaço entre o commit anterior e este
          const pass = [...new Set([...g.pass, ...g.incoming])];
          const wipPass = wipLine && i === 0 ? g.col : null;
          const busy = new Set(pass);
          if (wipPass != null) busy.add(wipPass);
          let lane = g.col;
          if (busy.has(lane)) for (lane = 0; busy.has(lane); lane++);
          this.layout.maxLanes = Math.max(this.layout.maxLanes, lane + 1);
          stashes.forEach((s, k) =>
            items.push({
              type: 'stash',
              stash: s,
              g: { col: lane, pass, wipPass, lineUp: k > 0, toCol: k === stashes.length - 1 ? g.col : lane },
              searchText: `${s.msg || ''} ${s.ref || ''}`.toLowerCase(),
            })
          );
          if (!g.incoming.includes(g.col)) g = { ...g, stashIn: true };
        }
        items.push({ type: 'commit', c, g, owner: this.owners[i], searchText: `${c.subject}\n${c.bodyLine}\n${c.author}\n${c.email}\n${c.sha}`.toLowerCase() });
      });
      return (this._rowItems = items);
    }

    // ---------- renderização ----------
    render() {
      V.renderToolbar(this);
      V.renderBanner(this);
      V.renderLeft(this);
      this.renderCenter();
      if (this.selected === 'WIP') V.renderRight(this);
      else this.loadDetails(this.selected);
    }

    renderCenter() {
      if (this.view.type === 'diff') V.renderDiff(this);
      else if (this.view.type === 'history') V.renderHistory(this);
      else if (this.view.type === 'blame') V.renderBlame(this);
      else if (this.view.type === 'edit') V.renderEditor(this);
      else if (this.view.type === 'conflict') V.renderConflict(this);
      else V.renderGraph(this);
    }

    setBusy(label) {
      this.busy = label;
      V.renderToolbar(this);
    }

    // Executa uma operação Git com indicador de progresso, mensagem de erro e
    // atualização da tela ao final.
    // undoHead: 'soft' | 'keep' registra no Desfazer a volta da branch para onde
    // estava, se a operação moveu o HEAD e terminou sem conflito.
    async op(label, fn, { success, quiet, undoHead, undoLabel } = {}) {
      this.setBusy(label + '...');
      const entry = { label, at: new Date(), commands: [], ok: false, error: '' };
      this.repo.onCommand = (c) => entry.commands.push(c);
      try {
        const before = undoHead ? await this.headState() : null;
        await fn();
        entry.ok = true;
        if (success) toast(success);
        if (before) await this.recordHeadMove(undoLabel || label, before, undoHead);
        return true;
      } catch (e) {
        entry.error = e.message;
        if (!quiet) toast(`${label} falhou:\n${e.message}`, 'error');
        return false;
      } finally {
        this.repo.onCommand = null;
        this.opLog.unshift(entry);
        this.opLog.length = Math.min(this.opLog.length, 200);
        this.busy = null;
        await this.refresh();
        // se nada mudou o refresh não redesenha, e o polvo de "trabalhando" ficaria na barra
        V.renderToolbar(this);
      }
    }

    // ---------- desfazer / refazer ----------
    // Cada entrada sabe se desfazer e se refazer; antes de agir ela confere se o
    // repositório ainda está como ficou depois da ação, senão recusa.
    record(entry) {
      this.undoStack.push(entry);
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack = [];
      V.renderToolbar(this);
    }

    async undo() {
      const e = this.undoStack.pop();
      if (!e) {
        // sem histórico: desfaz o último commit, e o Refazer passa a trazê-lo de volta
        const n = this.undoStack.length;
        await this.undoCommit();
        if (this.undoStack.length > n) {
          const done = this.undoStack.pop();
          this.redoStack.push({ label: done.label, undo: done.redo, redo: done.undo });
        }
        return V.renderToolbar(this);
      }
      if (await this.op(`Desfazer ${e.label}`, () => e.undo(), { success: `Desfeito: ${e.label}` })) this.redoStack.push(e);
      V.renderToolbar(this);
    }

    async redo() {
      const e = this.redoStack.pop();
      if (!e) return toast('Nada para refazer.');
      if (await this.op(`Refazer ${e.label}`, () => e.redo(), { success: `Refeito: ${e.label}` })) this.undoStack.push(e);
      V.renderToolbar(this);
    }

    async headState() {
      const [sha, head] = await Promise.all([this.repo.raw(['rev-parse', '-q', '--verify', 'HEAD']), this.repo.head()]);
      return { sha: sha.stdout.trim(), branch: head.branch };
    }

    async expectHead(state) {
      const now = await this.headState();
      if (now.sha !== state.sha || now.branch !== state.branch) throw new Error('O repositório mudou desde essa ação. Não dá para voltar com segurança.');
    }

    async recordHeadMove(label, before, mode) {
      const after = await this.headState();
      if (!before.sha || !after.sha || before.sha === after.sha || before.branch !== after.branch) return;
      if ((await this.repo.state()) !== 'clean') return;
      const flag = mode === 'soft' ? '--soft' : '--keep';
      this.record({
        label,
        undo: async () => {
          await this.expectHead(after);
          await this.repo.run(['reset', flag, before.sha]);
        },
        redo: async () => {
          await this.expectHead(before);
          await this.repo.run(['reset', flag, after.sha]);
        },
      });
    }

    // Troca de branch: desfazer volta para onde estava.
    recordSwitch(label, from, to) {
      const go = (st) => this.repo.run(st.branch ? ['switch', st.branch] : ['switch', '--detach', st.sha]);
      this.record({
        label,
        undo: async () => {
          await this.expectHead(to);
          await go(from);
        },
        redo: async () => {
          await this.expectHead(from);
          await go(to);
        },
      });
    }

    // Descartes guardam o patch do que sumiu; desfazer aplica de novo no diretório.
    recordDiscard(label, patch) {
      if (!patch) return;
      this.record({
        label,
        undo: () => this.repo.applyPatch(patch, { cached: false }),
        redo: () => this.repo.applyPatch(patch, { cached: false, reverse: true }),
      });
    }

    async discardPatch(paths, untracked) {
      const parts = [];
      const tracked = paths.filter((p) => !untracked.includes(p));
      if (tracked.length) parts.push((await this.repo.raw(['diff', '--binary', '--no-color', '--no-ext-diff', '--', ...tracked])).stdout);
      for (const p of untracked) parts.push((await this.repo.raw(['diff', '--binary', '--no-color', '--no-index', '--', '/dev/null', p])).stdout);
      const patch = parts.filter(Boolean).join('');
      return patch || null;
    }

    // ---------- seleção ----------
    select(id) {
      this.selected = id;
      this.selectedIsStash = false;
      this.multi = [];
      this.compare = null;
      if (this.view.type !== 'graph' && !(id === 'WIP' && this.view.kind !== 'commit')) {
        this.view = { type: 'graph' };
        this.renderCenter();
      } else V.renderGraphRows(this);
      if (id === 'WIP') {
        this.selectedDetails = null;
        V.renderRight(this);
      } else this.loadDetails(id);
    }

    async selectSha(sha) {
      const find = () => this.rowItems().findIndex((it) => it.type === 'commit' && it.c.sha.startsWith(sha));
      let idx = find();
      // commit antigo: vai lendo mais páginas até achar (ou acabar o histórico)
      while (idx < 0 && this.hasMoreCommits && !this.refreshing) {
        const before = this.commits.length;
        this.logLimit += LOG_PAGE;
        await this.refresh();
        if (this.commits.length === before) break;
        idx = find();
      }
      if (idx < 0) {
        const filtered = this.filters && (this.filters.hidden.length || this.filters.solo.length);
        return toast(filtered ? 'Commit escondido pelo filtro do grafo.' : 'Commit fora do histórico carregado.');
      }
      this.select(this.rowItems()[idx].c.sha);
      V.scrollToRow(this, idx);
    }

    selectStash(stash) {
      this.selected = stash.sha;
      this.selectedIsStash = true;
      this.multi = [];
      this.compare = null;
      this.view = { type: 'graph' };
      this.renderCenter();
      this.loadDetails(stash.sha);
    }

    // Passar o mouse numa branch destaca os commits da linha dela no grafo: do
    // topo descendo pelo primeiro pai enquanto continua na mesma coluna.
    hoverBranch(sha) {
      const set = new Set();
      let i = this.shaIndex?.get(sha);
      const col = i != null ? this.layout.rows[i].col : null;
      while (i != null && this.layout.rows[i].col === col && !set.has(this.commits[i].sha)) {
        set.add(this.commits[i].sha);
        const p = this.commits[i].parents[0];
        i = p ? this.shaIndex.get(p) : null;
      }
      this.hoverSet = set.size ? set : null;
      V.renderGraphRows(this);
    }

    clearHover() {
      if (!this.hoverSet) return;
      this.hoverSet = null;
      V.renderGraphRows(this);
    }

    isSelected(sha) {
      if (this.multi.length) return this.multi.includes(sha);
      return !this.compare && this.selected === sha;
    }

    // Ctrl+clique marca/desmarca; Shift+clique marca o intervalo desde o último clique.
    clickCommit(sha, e) {
      if (e && (e.ctrlKey || e.metaKey)) return this.toggleMulti(sha);
      if (e && e.shiftKey && this.shaIndex.has(this.selected)) return this.rangeMulti(sha);
      this.select(sha);
    }

    toggleMulti(sha) {
      const m = this.multi.length ? this.multi.slice() : this.shaIndex.has(this.selected) ? [this.selected] : [];
      const i = m.indexOf(sha);
      if (i >= 0) m.splice(i, 1);
      else m.push(sha);
      if (m.length < 2) return this.select(m[0] || sha);
      this.selected = sha;
      this.setMulti(m);
    }

    rangeMulti(sha) {
      const a = this.shaIndex.get(this.selected);
      const b = this.shaIndex.get(sha);
      const m = this.commits.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.sha);
      if (m.length < 2) return this.select(sha);
      this.setMulti(m);
    }

    // do mais novo para o mais antigo, na ordem do grafo
    multiCommits() {
      return this.multi.map((sha) => this.commits[this.shaIndex.get(sha)]).sort((x, y) => this.shaIndex.get(x.sha) - this.shaIndex.get(y.sha));
    }

    setMulti(m) {
      this.multi = m;
      this.compare = null;
      if (m.length === 2) {
        const [newer, older] = this.multiCommits();
        this.compare = { a: older.sha, b: newer.sha, labelA: older.sha.slice(0, 7), labelB: newer.sha.slice(0, 7), files: null };
        this.loadCompare();
      }
      if (this.view.type !== 'graph') {
        this.view = { type: 'graph' };
        this.renderCenter();
      } else V.renderGraphRows(this);
      V.renderRight(this);
    }

    clearMulti() {
      this.select(this.shaIndex.has(this.selected) ? this.selected : 'WIP');
    }

    // ---------- comparação ----------
    // Mostra no painel direito o que muda de A para B (dois commits ou refs quaisquer).
    compareRefs(a, b, labelA = a, labelB = b) {
      this.multi = [];
      this.compare = { a, b, labelA, labelB, files: null };
      if (this.view.type !== 'graph') {
        this.view = { type: 'graph' };
        this.renderCenter();
      } else V.renderGraphRows(this);
      V.renderRight(this);
      return this.loadCompare();
    }

    swapCompare() {
      const c = this.compare;
      if (!c) return;
      if (this.multi.length) {
        Object.assign(c, { a: c.b, b: c.a, labelA: c.labelB, labelB: c.labelA, files: null });
        V.renderRight(this);
        return this.loadCompare();
      }
      return this.compareRefs(c.b, c.a, c.labelB, c.labelA);
    }

    async loadCompare() {
      const c = this.compare;
      if (!c) return;
      try {
        const [files, counts] = await Promise.all([
          this.repo.compareFiles(c.a, c.b),
          this.repo.run(['rev-list', '--left-right', '--count', `${c.a}...${c.b}`]),
        ]);
        const [onlyA, onlyB] = counts.trim().split(/\s+/).map(Number);
        Object.assign(c, { files, onlyA, onlyB, error: null });
      } catch (e) {
        c.error = e.message;
      }
      if (this.compare === c) V.renderRight(this);
    }

    // Abre a paleta para escolher a outra branch/tag da comparação.
    pickCompare(ref) {
      const refs = this.data.refs;
      const items = [];
      const add = (name, group) => name !== ref && items.push({ label: name, group, action: () => this.compareRefs(name, ref) });
      for (const b of refs.local) add(b.name, 'local');
      for (const list of Object.values(refs.remotes)) for (const b of list) add(b.full, 'remoto');
      for (const t of refs.tags) add(t.name, 'tag');
      palette(items, `Comparar ${ref} com...`);
    }

    async loadDetails(sha) {
      const token = (this.detailsToken = Symbol());
      try {
        const d = await this.repo.commitDetails(sha);
        if (token !== this.detailsToken) return;
        this.selectedDetails = d;
        V.renderRight(this);
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    move(delta) {
      const items = this.rowItems();
      let idx = items.findIndex((it) => {
        if (it.type === 'wip') return this.selected === 'WIP';
        if (it.type === 'stash') return this.selected === it.stash.sha;
        return it.c.sha === this.selected;
      });
      idx = Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx) + delta));
      const it = items[idx];
      if (!it) return;
      if (it.type === 'wip') this.select('WIP');
      else if (it.type === 'stash') this.selectStash(it.stash);
      else this.select(it.c.sha);
      V.scrollToRow(this, idx);
    }

    setSearch(q) {
      this.search = q;
      V.renderGraphRows(this);
    }

    nextMatch(dir) {
      const q = this.search.trim().toLowerCase();
      if (!q) return;
      const items = this.rowItems();
      const cur = items.findIndex((it) => (it.type === 'commit' && it.c.sha === this.selected) || (it.type === 'stash' && it.stash.sha === this.selected));
      for (let k = 1; k <= items.length; k++) {
        const i = (cur + dir * k + items.length * 2) % items.length;
        const it = items[i];
        if (it.type === 'commit' && it.searchText.includes(q)) {
          this.select(it.c.sha);
          V.scrollToRow(this, i);
          return;
        }
        if (it.type === 'stash' && it.searchText.includes(q)) {
          this.selectStash(it.stash);
          V.scrollToRow(this, i);
          return;
        }
      }
      toast('Nenhum commit encontrado.');
    }

    // ---------- diff ----------
    async openDiff(kind, file, sha, parents, label) {
      this.view = { type: 'diff', kind, file, sha, parents, label, loading: true, files: [] };
      this.renderCenter();
      if (this.selected === 'WIP') V.renderRight(this);
      else V.renderRight(this);
      await this.reloadDiff();
    }

    async reloadDiff() {
      const v = this.view;
      if (v.type !== 'diff') return;
      let kind = v.kind;
      // depois de stage/unstage o arquivo pode ter mudado de lista
      if (kind !== 'commit') {
        const st = this.data.status;
        const inUn = st.unstaged.find((f) => f.path === v.file);
        const inSt = st.staged.find((f) => f.path === v.file);
        if (kind === 'staged' && !inSt && inUn) kind = inUn.untracked ? 'untracked' : 'unstaged';
        else if ((kind === 'unstaged' || kind === 'untracked') && !inUn && inSt) kind = 'staged';
        else if (!inUn && !inSt) {
          this.closeView();
          return;
        }
      }
      const files = await this.repo.diff(kind, v.file, v.sha, v.parents, null, { ignoreWs: V.diffPrefs.ignoreWs });
      if (this.view !== v) return;
      const diffSig = JSON.stringify(files);
      if (kind === v.kind && !v.loading && diffSig === v.diffSig) return;
      v.diffSig = diffSig;
      Object.assign(v, { kind, files, loading: false, picked: new Set(), lastPick: null });
      this.renderCenter();
      V.renderRight(this);
    }

    // Relê o diff aberto (ex.: depois de trocar "Ignorar espaços").
    reloadView() {
      const v = this.view;
      if (v.type === 'diff') {
        v.diffSig = null;
        return this.reloadDiff();
      }
      if (v.type === 'history') {
        const e = v.entries.find((x) => x.sha === v.sel);
        if (e) return this.historySelect(e);
      }
      this.renderCenter();
    }

    async closeView() {
      const v = this.view;
      if (v.type === 'edit' && v.content !== v.original) {
        if (!(await confirmBox('Edição não salva', `Descartar as mudanças em "${v.file}"?`, 'Descartar'))) return;
        delete this.editDrafts[v.file];
      }
      this.view = { type: 'graph' };
      this.renderCenter();
      V.renderRight(this);
    }

    // ---------- editor embutido ----------
    // Se a pessoa saiu do editor sem salvar, a edição fica guardada e volta ao
    // reabrir o arquivo, desde que ele não tenha mudado no disco nesse meio-tempo.
    async openEditor(file) {
      const disk = await polvo.readFile(this.repo.root, file);
      if (disk == null) return toast(`Não foi possível ler "${file}".`, 'error');
      if (disk.includes('\0')) return toast('Arquivo binário: abra no editor externo.', 'error');
      const draft = this.editDrafts[file];
      const restored = draft && draft.original === disk;
      this.view = { type: 'edit', file, original: disk, content: restored ? draft.content : disk };
      if (restored) toast('Edição não salva restaurada.');
      this.renderCenter();
    }

    async saveEdit() {
      const v = this.view;
      if (v.type !== 'edit') return;
      const disk = await polvo.readFile(this.repo.root, v.file);
      if (disk != null && disk !== v.original && !(await confirmBox('Arquivo mudou', `"${v.file}" foi alterado fora do GitPolvo desde que você abriu. Salvar por cima?`, 'Salvar mesmo assim'))) return;
      await polvo.writeFile(this.repo.root, v.file, v.content);
      v.original = v.content;
      delete this.editDrafts[v.file];
      toast(`${v.file} salvo`);
      this.renderCenter();
      this.refresh();
    }

    // Editor de fora: o comando das preferências ou, sem ele, VS Code / programa padrão.
    async openInEditor(file) {
      const s = this.app.settings || (await polvo.settings.get());
      const ok = await polvo.openEditor(this.repo.root, file, s.editorCmd || '');
      if (!ok) toast(s.editorCmd ? `Não consegui rodar "${s.editorCmd}". Confira o editor nas Preferências.` : 'Não encontrei um editor para abrir o arquivo. Escolha um nas Preferências.', 'error');
    }

    // ---------- blame ----------
    // rev omitido = arquivo como está no diretório de trabalho.
    async openBlame(file, rev) {
      const v = (this.view = { type: 'blame', file, rev, loading: true, lines: [], commits: {} });
      this.renderCenter();
      try {
        Object.assign(v, await this.repo.blame(file, rev));
      } catch (e) {
        v.error = e.message;
      }
      if (this.view !== v) return;
      v.loading = false;
      this.renderCenter();
    }

    // Clique numa linha do blame: mostra o commit no grafo.
    blameGoTo(c) {
      this.closeView();
      if (c.uncommitted) return this.select('WIP');
      this.selectSha(c.sha);
    }

    // ---------- histórico de um arquivo ----------
    async openHistory(file) {
      const v = (this.view = { type: 'history', file, loading: true, entries: [], sel: null, files: [] });
      this.renderCenter();
      try {
        v.entries = await this.repo.fileHistory(file);
      } catch (e) {
        toast(e.message, 'error');
      }
      if (this.view !== v) return;
      v.loading = false;
      if (v.entries.length) return this.historySelect(v.entries[0]);
      this.renderCenter();
    }

    async historySelect(entry) {
      const v = this.view;
      if (v.type !== 'history') return;
      Object.assign(v, { sel: entry.sha, files: [], diffLoading: true });
      this.renderCenter();
      const files = await this.repo.diff('commit', entry.path, entry.sha, entry.parents, entry.from, { ignoreWs: V.diffPrefs.ignoreWs });
      if (this.view !== v || v.sel !== entry.sha) return;
      Object.assign(v, { files, diffLoading: false });
      this.renderCenter();
    }

    // ---------- stage / commit ----------
    stage(paths) {
      return this.op('Stage', () => this.repo.run(['add', '-A', '--', ...paths]));
    }

    unstage(paths) {
      if (!this.commits.length) return this.op('Unstage', () => this.repo.run(['rm', '--cached', '-r', '-q', '--', ...paths]));
      return this.op('Unstage', () => this.repo.run(['restore', '--staged', '--', ...paths]));
    }

    stageAll() {
      return this.op('Stage em tudo', () => this.repo.run(['add', '-A']));
    }

    unstageAll() {
      if (!this.commits.length) return this.op('Unstage em tudo', () => this.repo.run(['rm', '--cached', '-r', '-q', '.']));
      return this.op('Unstage em tudo', () => this.repo.run(['reset', '-q']));
    }

    async discard(f) {
      if (!(await confirmBox('Descartar alterações', `Descartar as alterações em "${f.path}"?\nDá para voltar pelo botão Desfazer enquanto o GitPolvo estiver aberto.`, 'Descartar'))) return;
      const patch = await this.discardPatch([f.path], f.untracked ? [f.path] : []);
      const ok = f.untracked
        ? await this.op('Descartar', () => this.repo.run(['clean', '-f', '-q', '--', f.path]))
        : await this.op('Descartar', () => this.repo.run(['restore', '--worktree', '--', f.path]));
      if (ok) this.recordDiscard(`descarte de ${f.path}`, patch);
    }

    async discardAll() {
      if (!(await confirmBox('Descartar tudo', 'Descartar TODAS as alterações não preparadas, incluindo arquivos novos?\nDá para voltar pelo botão Desfazer enquanto o GitPolvo estiver aberto.', 'Descartar tudo'))) return;
      const un = this.data.status.unstaged;
      const patch = await this.discardPatch(un.map((f) => f.path), un.filter((f) => f.untracked).map((f) => f.path));
      const ok = await this.op('Descartar tudo', async () => {
        await this.repo.run(['restore', '--worktree', '.']).catch(() => {});
        await this.repo.run(['clean', '-fd', '-q']);
      });
      if (ok) this.recordDiscard('descartar tudo', patch);
    }

    stageHunk(file, hunk) {
      return this.op('Stage do hunk', () => this.repo.applyPatch(hunkPatch(file, hunk), { cached: true }));
    }

    unstageHunk(file, hunk) {
      return this.op('Unstage do hunk', () => this.repo.applyPatch(hunkPatch(file, hunk), { cached: true, reverse: true }));
    }

    async discardHunk(file, hunk) {
      if (!(await confirmBox('Descartar hunk', 'Descartar este trecho de alterações?', 'Descartar'))) return;
      const patch = hunkPatch(file, hunk);
      if (await this.op('Descartar hunk', () => this.repo.applyPatch(patch, { cached: false, reverse: true }))) this.recordDiscard('descarte do hunk', patch);
    }

    // Linhas marcadas no diff (Set de objetos de linha em view.picked).
    async linesAction(action) {
      const v = this.view;
      const file = v.files && v.files[0];
      if (!file || !v.picked || !v.picked.size) return;
      const reverse = action !== 'stage';
      const patch = linesPatch(file, (_hk, l) => v.picked.has(l), { reverse });
      if (!patch) return;
      const n = v.picked.size;
      if (action === 'discard') {
        if (!(await confirmBox('Descartar linhas', `Descartar ${n} linha(s) marcada(s)?`, 'Descartar'))) return;
        if (await this.op('Descartar linhas', () => this.repo.applyPatch(patch, { cached: false, reverse: true }))) this.recordDiscard(`descarte de ${n} linha(s)`, patch);
        return;
      }
      return this.op(action === 'stage' ? 'Stage das linhas' : 'Unstage das linhas', () => this.repo.applyPatch(patch, { cached: true, reverse }));
    }

    togglePick(line, hunk, range) {
      const v = this.view;
      v.picked ||= new Set();
      if (range && v.lastPick && v.lastPick.hunk === hunk) {
        const a = hunk.lines.indexOf(v.lastPick.line);
        const b = hunk.lines.indexOf(line);
        for (const l of hunk.lines.slice(Math.min(a, b), Math.max(a, b) + 1)) if (l.type === 'add' || l.type === 'del') v.picked.add(l);
      } else if (v.picked.has(line)) v.picked.delete(line);
      else v.picked.add(line);
      v.lastPick = { line, hunk };
    }

    async ignore(file) {
      const current = (await polvo.readFile(this.repo.root, '.gitignore')) || '';
      const sep = current && !current.endsWith('\n') ? '\n' : '';
      await polvo.writeFile(this.repo.root, '.gitignore', current + sep + file + '\n');
      toast(`"${file}" adicionado ao .gitignore`);
      this.refresh();
    }

    // Durante merge/revert/cherry-pick o git deixa a mensagem sugerida em MERGE_MSG.
    async prefillSequencerMessage() {
      const rel = (await this.repo.raw(['rev-parse', '--git-path', 'MERGE_MSG'])).stdout.trim();
      const text = await polvo.readFile(this.repo.root, rel);
      if (!text) return;
      const lines = text.split('\n').filter((l) => !l.startsWith('#'));
      const [summary, ...rest] = lines;
      this.commitDraft.summary = (summary || '').trim();
      this.commitDraft.description = rest.join('\n').trim();
    }

    async lastCommitMessage() {
      return (await this.repo.raw(['log', '-1', '--format=%B'])).stdout.trim();
    }

    async commit() {
      const d = this.commitDraft;
      const msg = d.summary.trim() + (d.description.trim() ? '\n\n' + d.description.trim() : '');
      if (!d.summary.trim()) return;
      const args = ['commit', '-q', '-F', '-'];
      if (d.amend) args.push('--amend');
      if (d.noVerify) args.push('--no-verify');
      const ok = await this.op('Commit', () => this.repo.run(args, msg), { undoHead: 'soft', undoLabel: `${d.amend ? 'amend' : 'commit'} "${d.summary.trim()}"` });
      if (ok) {
        this.commitDraft = { summary: '', description: '', amend: false };
        V.renderRight(this);
      }
    }

    async undoCommit() {
      if (!this.commits.length) return;
      const st = this.data.state;
      if (st !== 'clean') return toast('Finalize ou aborte a operação em andamento primeiro.', 'error');
      const head = this.commits.find((c) => c.sha === this.headSha);
      if (head && head.parents.length === 0) return toast('O primeiro commit do repositório não pode ser desfeito por aqui.', 'error');
      if (!(await confirmBox('Desfazer commit', `Desfazer o último commit "${head ? head.subject : 'HEAD'}"?\nAs alterações dele voltam para a área de preparação.`, 'Desfazer'))) return;
      return this.op('Desfazer commit', () => this.repo.run(['reset', '--soft', 'HEAD~1']), { undoHead: 'soft', undoLabel: `commit "${head ? head.subject : 'HEAD'}"` });
    }

    // ---------- branches ----------
    // Duplo clique: se o remoto está à frente, troca para a branch (se
    // preciso) e puxa para o local ficar igual ao remoto. Senão, só checkout.
    pullIfBehind(local) {
      return !!(local && local.current && local.behind);
    }

    // Sem commit, o git leva o WIP para a outra branch. Se a pessoa commit/push
    // depois, o trabalho da branch anterior sobe sem ela ter pedido.
    async confirmSwitchWithWip(toName) {
      if (this.data.status?.conflicts?.length) {
        toast('Resolva os conflitos antes de trocar de branch.', 'error');
        return null;
      }
      if (!this.hasDirtyWorktree()) return 'bring';
      const from = this.data.head.branch || 'HEAD';
      const n = this.wipCount();
      const pick = await choices(
        'Alterações sem commit',
        `Há ${n} arquivo(s) alterado(s) em "${from}".\nSe você trocar para "${toName}" levando essas alterações, elas passam a valer nessa branch. Um commit ou push depois mistura os dois trabalhos.`,
        [
          { id: 'cancel', label: 'Cancelar' },
          { id: 'stash', label: 'Guardar no stash e trocar' },
          { id: 'bring', label: 'Levar as alterações', primary: true },
        ]
      );
      return !pick || pick === 'cancel' ? null : pick;
    }

    async stashThenSwitch(name) {
      const ok = await this.op('Stash', () => this.repo.run(['stash', 'push', '--include-untracked', '-m', `WIP antes de ${name}`]), { success: 'Alterações guardadas no stash' });
      if (ok) this.collapsed.stashes = false;
      return ok;
    }

    async checkout(name) {
      const b = this.data.refs.local.find((x) => x.name === name);
      if (b?.current) return b.behind ? this.pull() : undefined;
      const how = await this.confirmSwitchWithWip(name);
      if (!how) return;
      if (how === 'stash' && !(await this.stashThenSwitch(name))) return;
      const behind = !!(b && b.behind);
      const from = await this.headState();
      const ok = await this.op(`Checkout de ${name}`, () => this.repo.run(['switch', name]), { success: behind ? undefined : `Agora em ${name}` });
      if (ok) this.recordSwitch(`checkout de ${name}`, from, await this.headState());
      if (ok && behind) return this.pull();
    }

    async checkoutRemote(full) {
      const name = full.slice(full.indexOf('/') + 1);
      const local = this.data.refs.local.find((b) => b.name === name);
      if (local) return this.checkout(name);
      const how = await this.confirmSwitchWithWip(name);
      if (!how) return;
      if (how === 'stash' && !(await this.stashThenSwitch(name))) return;
      const from = await this.headState();
      const ok = await this.op(`Checkout de ${full}`, () => this.repo.run(['switch', '--track', '-c', name, full]), { success: `Branch ${name} criada rastreando ${full}` });
      if (ok) this.recordSwitch(`checkout de ${full}`, from, await this.headState());
      return ok;
    }

    async checkoutCommit(sha) {
      if (!(await confirmBox('Checkout de commit', `Fazer checkout de ${sha.slice(0, 7)}? Você ficará em modo "detached HEAD".`, 'Checkout'))) return;
      const from = await this.headState();
      const ok = await this.op('Checkout', () => this.repo.run(['switch', '--detach', sha]));
      if (ok) this.recordSwitch(`checkout de ${sha.slice(0, 7)}`, from, await this.headState());
      return ok;
    }

    async createBranch(from) {
      const r = await form('Nova branch', [
        { name: 'name', label: 'Nome da branch', placeholder: 'feature/minha-branch' },
        { name: 'checkout', label: 'Fazer checkout depois de criar', type: 'checkbox', value: true },
      ], { ok: 'Criar', message: from ? `A partir de ${from.slice(0, 12)}` : 'A partir do HEAD atual' });
      if (!r || !r.name.trim()) return;
      const name = r.name.trim().replace(/\s+/g, '-');
      const base = from || 'HEAD';
      const before = await this.headState();
      const ok = await this.op('Criar branch', () => this.repo.run(r.checkout ? ['switch', '-c', name, base] : ['branch', name, base]), { success: `Branch ${name} criada` });
      if (!ok) return ok;
      const sha = (await this.repo.run(['rev-parse', `refs/heads/${name}`])).trim();
      const after = await this.headState();
      this.record({
        label: `criação da branch ${name}`,
        undo: async () => {
          if (r.checkout) {
            await this.expectHead(after);
            await this.repo.run(before.branch ? ['switch', before.branch] : ['switch', '--detach', before.sha]);
          }
          await this.repo.run(['branch', '-D', name]);
        },
        redo: async () => {
          await this.repo.run(['branch', name, sha]);
          if (r.checkout) await this.repo.run(['switch', name]);
        },
      });
      return ok;
    }

    async renameBranch(name) {
      const nn = await prompt('Renomear branch', 'Novo nome', name, { ok: 'Renomear' });
      if (!nn || nn === name) return;
      const ok = await this.op('Renomear branch', () => this.repo.run(['branch', '-m', name, nn]));
      if (ok)
        this.record({
          label: `renomear ${name} para ${nn}`,
          undo: () => this.repo.run(['branch', '-m', nn, name]),
          redo: () => this.repo.run(['branch', '-m', name, nn]),
        });
      return ok;
    }

    async deleteBranch(name) {
      if (!(await confirmBox('Excluir branch', `Excluir a branch local "${name}"?`, 'Excluir'))) return;
      const sha = (await this.repo.run(['rev-parse', `refs/heads/${name}`])).trim();
      const entry = {
        label: `exclusão da branch ${name}`,
        undo: () => this.repo.run(['branch', name, sha]),
        redo: () => this.repo.run(['branch', '-D', name]),
      };
      if (await this.op('Excluir branch', () => this.repo.run(['branch', '-d', name]), { quiet: true })) return this.record(entry);
      if (await confirmBox('Branch não mesclada', `"${name}" tem commits que não estão em outra branch. Excluir mesmo assim?\nDá para voltar pelo botão Desfazer enquanto o GitPolvo estiver aberto.`, 'Forçar exclusão'))
        if (await this.op('Excluir branch', () => this.repo.run(['branch', '-D', name]))) this.record(entry);
    }

    // mode: undefined (fast-forward quando der), 'no-ff', 'ff-only' ou 'squash'
    async merge(name, mode) {
      const cur = this.data.head.branch || 'HEAD';
      if (mode === 'squash') return this.squashMerge(name);
      const flag = mode === 'no-ff' ? ['--no-ff'] : mode === 'ff-only' ? ['--ff-only'] : [];
      return this.op(`Merge de ${name} em ${cur}`, async () => {
        const r = await this.repo.raw(['merge', '--no-edit', ...flag, name]);
        if (r.code !== 0) {
          if (/CONFLICT/.test(r.stdout + r.stderr)) {
            toast('Merge com conflitos. Resolva os arquivos marcados no painel à direita.', 'error');
            this.selected = 'WIP';
            return;
          }
          throw new Error(r.stderr || r.stdout);
        }
        toast(`Merge de ${name} concluído`);
      }, { undoHead: 'keep', undoLabel: `merge de ${name}` });
    }

    async mergeOptions(name) {
      const cur = this.data.head.branch || 'HEAD';
      const r = await form(
        `Merge de ${name} em ${cur}`,
        [
          {
            name: 'mode',
            label: 'Como juntar',
            value: 'default',
            options: [
              { value: 'default', label: 'Padrão: avança a branch se der (fast-forward), senão cria um commit de merge' },
              { value: 'no-ff', label: 'Sempre criar um commit de merge (--no-ff)' },
              { value: 'ff-only', label: 'Só avançar a branch; recusa se precisar de commit de merge (--ff-only)' },
              { value: 'squash', label: 'Squash: junta tudo num commit novo, que você revisa antes (--squash)' },
            ],
          },
        ],
        { ok: 'Merge' }
      );
      if (r) return this.merge(name, r.mode === 'default' ? undefined : r.mode);
    }

    // As mudanças de `name` ficam preparadas, com a mensagem sugerida no painel.
    async squashMerge(name) {
      const cur = this.data.head.branch || 'HEAD';
      const ok = await this.op(`Squash de ${name} em ${cur}`, async () => {
        const r = await this.repo.raw(['merge', '--squash', name]);
        if (r.code !== 0 && !/CONFLICT/.test(r.stdout + r.stderr)) throw new Error(r.stderr || r.stdout);
        if (r.code !== 0) toast('O squash gerou conflitos. Resolva os arquivos e faça o commit.', 'error');
      });
      if (!ok) return;
      const subjects = (await this.repo.raw(['log', '--reverse', '--format=- %s', `HEAD..${name}`])).stdout.trim();
      this.commitDraft = { summary: `Squash de ${name}`, description: subjects, amend: false };
      this.select('WIP'); // o painel já mostra o preparado e a mensagem sugerida
    }

    // branch omitida = branch atual; senão o git faz checkout dela antes do rebase.
    async rebase(onto, branch) {
      const cur = branch || this.data.head.branch || 'HEAD';
      if (!(await confirmBox('Rebase', `Reaplicar os commits de "${cur}" sobre "${onto}"?`, 'Rebase'))) return;
      return this.op(`Rebase de ${cur} sobre ${onto}`, async () => {
        const r = await this.repo.raw(['rebase', onto, ...(branch ? [branch] : [])]);
        if (r.code !== 0) {
          if (/CONFLICT|could not apply/i.test(r.stdout + r.stderr)) {
            toast('Rebase parou por conflito. Resolva e clique em "Continuar" na faixa amarela.', 'error');
            this.selected = 'WIP';
            return;
          }
          throw new Error(r.stderr || r.stdout);
        }
      }, { undoHead: 'keep', undoLabel: `rebase de ${cur} sobre ${onto}` });
    }

    // ---------- arrastar branch sobre branch ----------
    async dropRef(src, dst, x, y) {
      const cur = this.data.head.branch;
      const fullRef = (r) => (r.type === 'local' ? 'refs/heads/' : 'refs/remotes/') + r.name;
      const short = (r) => (r.type === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name);
      const remoteOf = (r) => r.name.slice(0, r.name.indexOf('/'));
      const [srcSha, dstSha] = await Promise.all([fullRef(src), fullRef(dst)].map(async (r) => (await this.repo.raw(['rev-parse', r])).stdout.trim()));
      const canFF = srcSha !== dstSha && (await this.repo.raw(['merge-base', '--is-ancestor', dstSha, srcSha])).code === 0;
      const items = [];
      if (dst.type === 'local') {
        if (canFF) items.push({ label: `Fast-forward de ${dst.name} até ${src.name}`, action: () => this.fastForward(dst.name, src) });
        items.push({ label: `Merge de ${src.name} em ${dst.name}`, action: () => this.mergeInto(src.name, dst.name) });
        if (src.type === 'local') items.push({ label: `Rebase de ${src.name} sobre ${dst.name}`, action: () => this.rebase(dst.name, src.name === cur ? undefined : src.name) });
        if (src.type === 'local' && dst.name !== cur) {
          // move a branch de destino para o mesmo commit da origem
          items.push({ label: `Resetar ${dst.name} para ${src.name}`, danger: true, action: () => this.resetBranchTo(dst.name, src.name) });
        }
      } else if (src.type === 'local') {
        items.push({ label: `Push de ${src.name} para ${dst.name}`, action: () => this.pushTo(src.name, remoteOf(dst), short(dst)) });
        const b = this.data.refs.local.find((l) => l.name === src.name);
        if (!b || b.upstream !== dst.name) items.push({ label: `Definir ${dst.name} como upstream de ${src.name}`, action: () => this.op('Definir upstream', () => this.repo.run(['branch', '-u', dst.name, src.name]), { success: `${src.name} agora acompanha ${dst.name}` }) });
      } else {
        items.push({ label: `Merge de ${src.name} em ${dst.name}`, disabled: true, action: () => {} });
      }
      if (this.github && short(src) !== short(dst)) {
        items.push('-', { label: `Abrir pull request: ${short(src)} → ${short(dst)}`, action: () => this.openPullRequest(short(src), short(dst)) });
      }
      items.push('-', { label: 'Cancelar', action: () => {} });
      UI.showMenu(x, y, items);
    }

    async mergeInto(src, dst) {
      if (dst !== this.data.head.branch) {
        const how = await this.confirmSwitchWithWip(dst);
        if (!how) return;
        if (how === 'stash' && !(await this.stashThenSwitch(dst))) return;
        const ok = await this.op(`Checkout de ${dst}`, () => this.repo.run(['switch', dst]));
        if (!ok) return;
      }
      return this.merge(src);
    }

    fastForward(dst, src) {
      const srcRef = (src.type === 'local' ? 'refs/heads/' : 'refs/remotes/') + src.name;
      if (dst === this.data.head.branch) return this.op(`Fast-forward de ${dst}`, () => this.repo.run(['merge', '--ff-only', srcRef]), { success: `${dst} avançou até ${src.name}`, undoHead: 'keep' });
      // atualiza a branch sem precisar de checkout; o git recusa se não for fast-forward
      return this.op(`Fast-forward de ${dst}`, () => this.repo.run(['fetch', '.', `${srcRef}:refs/heads/${dst}`]), { success: `${dst} avançou até ${src.name}` });
    }

    async resetBranchTo(dst, src) {
      if (!(await confirmBox('Resetar branch', `Mover "${dst}" para o mesmo commit de "${src}"?\nOs commits que só existem em "${dst}" deixam de fazer parte dela.`, 'Resetar'))) return;
      return this.op(`Reset de ${dst}`, () => this.repo.run(['branch', '-f', dst, src]));
    }

    async pushTo(src, remote, remoteBranch) {
      return this.op(`Push de ${src}`, async () => {
        const r = await this.repo.raw(['push', remote, `refs/heads/${src}:refs/heads/${remoteBranch}`]);
        if (r.code === 0) return toast(`${src} enviada para ${remote}/${remoteBranch}`);
        if (!/rejected|non-fast-forward|fetch first/i.test(r.stderr)) throw new Error(r.stderr || r.stdout);
        this.busy = null;
        if (!(await confirmBox('Push rejeitado', `${remote}/${remoteBranch} tem commits que ${src} não tem.\nForçar o push (with-lease)?`, 'Forçar push'))) return;
        const r2 = await this.repo.raw(['push', '--force-with-lease', remote, `refs/heads/${src}:refs/heads/${remoteBranch}`]);
        if (r2.code !== 0) throw new Error(r2.stderr);
        toast('Push forçado concluído');
      });
    }

    openPullRequest(src, dst) {
      const { owner, repo } = this.github;
      polvo.openExternal(`https://github.com/${owner}/${repo}/compare/${encodeURIComponent(dst)}...${encodeURIComponent(src)}?expand=1`);
    }

    sequencer(action) {
      const cmd = this.data.state;
      const env = action === 'continue' ? ['-c', 'core.editor=true'] : [];
      return this.op(`${cmd} --${action}`, () => this.repo.run([...env, cmd, `--${action}`]));
    }

    cherryPick(sha) {
      return this.op('Cherry-pick', async () => {
        const r = await this.repo.raw(['cherry-pick', sha]);
        if (r.code !== 0) {
          if (/conflict/i.test(r.stdout + r.stderr)) return toast('Cherry-pick com conflitos. Resolva e clique em "Continuar".', 'error');
          throw new Error(r.stderr || r.stdout);
        }
      }, { undoHead: 'keep', undoLabel: `cherry-pick de ${sha.slice(0, 7)}` });
    }

    async revert(sha) {
      if (!(await confirmBox('Reverter commit', `Criar um novo commit que desfaz ${sha.slice(0, 7)}?`, 'Reverter'))) return;
      return this.op('Revert', async () => {
        const r = await this.repo.raw(['revert', '--no-edit', sha]);
        if (r.code !== 0) {
          if (/conflict/i.test(r.stdout + r.stderr)) return toast('Revert com conflitos. Resolva e clique em "Continuar".', 'error');
          throw new Error(r.stderr || r.stdout);
        }
      }, { undoHead: 'keep', undoLabel: `revert de ${sha.slice(0, 7)}` });
    }

    // Aplica do mais antigo para o mais novo, como estavam no histórico.
    async cherryPickMany(list) {
      const shas = list.map((c) => c.sha).reverse();
      if (!(await confirmBox('Cherry-pick', `Aplicar ${shas.length} commits em "${this.data.head.branch || 'HEAD'}"?`, 'Cherry-pick'))) return;
      return this.op('Cherry-pick', async () => {
        const r = await this.repo.raw(['cherry-pick', ...shas]);
        if (r.code !== 0) {
          if (/conflict/i.test(r.stdout + r.stderr)) return toast('Cherry-pick com conflitos. Resolva e clique em "Continuar".', 'error');
          throw new Error(r.stderr || r.stdout);
        }
        this.select('WIP');
      }, { undoHead: 'keep', undoLabel: `cherry-pick de ${shas.length} commits` });
    }

    // Desfaz do mais novo para o mais antigo, um commit de revert para cada.
    async revertMany(list) {
      const shas = list.map((c) => c.sha);
      if (!(await confirmBox('Reverter commits', `Criar ${shas.length} commits que desfazem os selecionados?`, 'Reverter'))) return;
      return this.op('Revert', async () => {
        const r = await this.repo.raw(['revert', '--no-edit', ...shas]);
        if (r.code !== 0) {
          if (/conflict/i.test(r.stdout + r.stderr)) return toast('Revert com conflitos. Resolva e clique em "Continuar".', 'error');
          throw new Error(r.stderr || r.stdout);
        }
        this.select('WIP');
      }, { undoHead: 'keep', undoLabel: `revert de ${shas.length} commits` });
    }

    // ---------- patches ----------
    // list: commits do mais novo para o mais antigo (como multiCommits)
    async savePatch(list) {
      const shas = list.map((c) => c.sha).reverse();
      const range = shas.length === 1 ? ['-1', shas[0]] : [`${shas[0]}^..${shas[shas.length - 1]}`];
      // commits soltos (não seguidos) viram um patch cada, concatenados em ordem
      const seguidos = shas.length === 1 || (await this.repo.raw(['rev-list', '--count', ...range])).stdout.trim() === String(shas.length);
      const out = seguidos
        ? await this.repo.run(['format-patch', '--stdout', ...range])
        : (await Promise.all(shas.map((sha) => this.repo.run(['format-patch', '--stdout', '-1', sha])))).join('');
      const name = shas.length === 1 ? `${list[0].subject.replace(/[^\w\-]+/g, '-').slice(0, 50).replace(/-+$/, '')}.patch` : `${shas.length}-commits.patch`;
      const saved = await polvo.saveText('Salvar patch', name, out);
      if (saved) toast(`Patch salvo em ${saved}`);
    }

    // Patch de "git format-patch" vira commits (git am); um diff comum só altera os arquivos.
    async applyPatchFile() {
      const f = await polvo.openText('Aplicar patch');
      if (!f) return;
      const isMail = /^From [0-9a-f]{40} /m.test(f.content);
      const ok = await this.op(isMail ? 'Aplicar patch (commits)' : 'Aplicar patch', async () => {
        const r = await this.repo.raw(isMail ? ['am', '--3way'] : ['apply', '--3way', '--whitespace=nowarn'], f.content);
        if (r.code === 0) return;
        if (isMail) await this.repo.raw(['am', '--abort']);
        throw new Error((r.stderr || r.stdout).trim());
      }, { success: isMail ? 'Commits do patch aplicados' : 'Patch aplicado no diretório de trabalho', undoHead: isMail ? 'keep' : undefined, undoLabel: 'aplicar patch' });
      if (ok && !isMail) this.select('WIP');
    }

    // ---------- rebase interativo ----------
    // Reaplica os commits depois de `base` conforme o plano montado na janela:
    // o git lê a lista pronta (sequence.editor copia o arquivo) e os rewords
    // viram um "exec git commit --amend" logo depois do pick.
    async interactiveRebase(base) {
      const commits = await this.rebaseCommits(base);
      if (!commits) return;
      const branch = this.data.head.branch;
      const plan = await V.rebaseEditor(this, commits, { branch, base: base.slice(0, 7) });
      if (!plan) return;
      return this.runRebasePlan(base, plan, `rebase interativo de ${branch}`);
    }

    // Commits de `base` (exclusivo) até o HEAD, do mais antigo para o mais novo.
    // Avisa e devolve null quando não dá para reorganizar.
    async rebaseCommits(base) {
      if (this.data.state !== 'clean') return toast('Finalize ou aborte a operação em andamento primeiro.', 'error'), null;
      const branch = this.data.head.branch;
      if (!branch) return toast('Faça checkout de uma branch antes (agora está em detached HEAD).', 'error'), null;
      if ((await this.repo.raw(['merge-base', '--is-ancestor', base, 'HEAD'])).code !== 0) return toast(`Esse commit não faz parte da branch ${branch}.`, 'error'), null;
      const out = await this.repo.run(['log', '--reverse', `--format=%H%x1f%P%x1f%an%x1f%B%x1e`, `${base}..HEAD`]);
      const commits = out
        .split('\x1e')
        .map((x) => x.replace(/^\n/, ''))
        .filter(Boolean)
        .map((rec) => {
          const [sha, parents, author, message] = rec.split('\x1f');
          return { sha, parents: parents.split(' ').filter(Boolean), author, message: message.trim() };
        });
      if (!commits.length) return toast('Não há commits depois desse para reorganizar.'), null;
      if (commits.some((c) => c.parents.length > 1)) return toast('Há commits de merge depois desse. Por aqui só dá para reescrever o histórico quando não há merge no caminho.', 'error'), null;
      return commits;
    }

    // Reaplica os commits depois de `base` conforme o plano (mais antigo primeiro):
    // o git lê a lista pronta (sequence.editor copia o arquivo) e os rewords
    // viram um "exec git commit --amend" logo depois do pick.
    async runRebasePlan(base, plan, label) {
      const gitDir = await this.repo.gitDir();
      const q = (p) => `'${p.replace(/'/g, `'\\''`)}'`;
      const todo = [];
      let n = 0;
      for (const step of plan) {
        if (step.action === 'reword' && step.message.trim() && step.message.trim() !== step.original) {
          const file = `polvo-rebase-msg-${++n}`;
          await polvo.writeFile(gitDir, file, step.message.trim() + '\n');
          todo.push(`pick ${step.sha}`, `exec git commit --amend --only --allow-empty -q -F ${q(gitDir + '/' + file)}`);
        } else todo.push(`${step.action === 'reword' ? 'pick' : step.action} ${step.sha}`);
      }
      await polvo.writeFile(gitDir, 'polvo-rebase-todo', todo.join('\n') + '\n');
      const name = label[0].toUpperCase() + label.slice(1);
      return this.op(name, async () => {
        const r = await this.repo.raw(['-c', `sequence.editor=cp ${q(gitDir + '/polvo-rebase-todo')}`, '-c', 'core.editor=true', 'rebase', '-i', '--autostash', base]);
        if (r.code !== 0) {
          if (/CONFLICT|could not apply/i.test(r.stdout + r.stderr)) {
            toast('Rebase parou por conflito. Resolva e clique em "Continuar" na faixa amarela.', 'error');
            this.selected = 'WIP';
            return;
          }
          throw new Error(r.stderr || r.stdout);
        }
        toast(`${name} concluído`);
      }, { undoHead: 'keep', undoLabel: label });
    }

    // Troca a mensagem de um commit: o último vai por amend; um antigo, por um
    // rebase que reaplica os commits seguintes.
    async rewordCommit(c) {
      if (this.data.state !== 'clean') return toast('Finalize ou aborte a operação em andamento primeiro.', 'error');
      const isHead = c.sha === this.headSha;
      if (!isHead && !c.parents.length) return toast('Não dá para editar a mensagem do primeiro commit do repositório por aqui.', 'error');
      // confere antes de pedir a mensagem, para não perder o que a pessoa digitou
      const base = c.parents[0];
      const commits = isHead ? null : await this.rebaseCommits(base);
      if (!isHead && !commits) return;
      if (!isHead && !commits.some((x) => x.sha === c.sha)) return toast(`Esse commit não faz parte da branch ${this.data.head.branch}.`, 'error');
      const full = (await this.repo.run(['log', '-1', '--format=%B', c.sha])).trim();
      const message = await V.messageEditor('Editar mensagem do commit', full, {
        ok: 'Salvar mensagem',
        message: isHead
          ? 'Troca só a mensagem do último commit (amend). Se ele já foi enviado, o próximo push vai precisar ser forçado.'
          : 'Reaplica os commits depois deste para trocar a mensagem. Isso reescreve o histórico: se já foram enviados, o próximo push vai precisar ser forçado.',
      });
      if (message == null || message === full) return;
      const label = `mensagem de ${c.sha.slice(0, 7)}`;
      if (isHead) return this.op('Editar mensagem', () => this.repo.run(['commit', '--amend', '--only', '--allow-empty', '-q', '-F', '-'], message), { undoHead: 'soft', undoLabel: label });
      const plan = commits.map((x) => (x.sha === c.sha ? { sha: x.sha, action: 'reword', message, original: '' } : { sha: x.sha, action: 'pick', message: x.message, original: x.message }));
      return this.runRebasePlan(base, plan, label);
    }

    // Junta commits seguidos da branch atual num só, com a mensagem escolhida.
    async squashCommits(list) {
      const n = list.length;
      const oldest = list[n - 1];
      if (!oldest.parents.length) return toast('O primeiro commit do repositório não pode entrar no squash.', 'error');
      const base = oldest.parents[0];
      const commits = await this.rebaseCommits(base);
      if (!commits) return;
      const chosen = new Set(list.map((c) => c.sha));
      const idx = commits.map((c, i) => (chosen.has(c.sha) ? i : -1)).filter((i) => i >= 0);
      if (idx.length !== n) return toast(`Só dá para juntar commits da branch ${this.data.head.branch}.`, 'error');
      if (idx[n - 1] - idx[0] !== n - 1) return toast('Escolha commits seguidos, sem outros no meio.', 'error');
      const message = await V.messageEditor(`Juntar ${n} commits`, idx.map((i) => commits[i].message).join('\n\n'), {
        ok: 'Juntar',
        message: 'Mensagem do commit que fica no lugar deles. Isso reescreve o histórico: se já foram enviados, o próximo push vai precisar ser forçado.',
      });
      if (message == null) return;
      const plan = commits.map((c, i) =>
        i === idx[0] ? { sha: c.sha, action: 'reword', message, original: '' } : { sha: c.sha, action: chosen.has(c.sha) ? 'fixup' : 'pick', message: c.message, original: c.message }
      );
      return this.runRebasePlan(base, plan, `squash de ${n} commits`);
    }

    async reset(sha) {
      const r = await form(
        'Reset da branch atual',
        [
          {
            name: 'mode',
            label: 'Modo',
            value: 'mixed',
            options: [
              { value: 'soft', label: 'Soft — mantém alterações preparadas' },
              { value: 'mixed', label: 'Mixed — mantém alterações no diretório' },
              { value: 'hard', label: 'Hard — DESCARTA todas as alterações' },
            ],
          },
        ],
        { ok: 'Reset', message: `Mover ${this.data.head.branch || 'HEAD'} para ${sha.slice(0, 7)}.` }
      );
      if (!r) return;
      if (r.mode === 'hard' && !(await confirmBox('Reset hard', 'As alterações não commitadas saem do diretório. Dá para voltar pelo botão Desfazer enquanto o GitPolvo estiver aberto. Continuar?', 'Sim, descartar'))) return;
      // no hard, guarda as alterações num stash solto para o Desfazer conseguir trazer de volta
      const saved = r.mode === 'hard' && this.hasDirtyWorktree() ? (await this.repo.run(['stash', 'create'])).trim() : '';
      const before = await this.headState();
      const ok = await this.op('Reset', () => this.repo.run(['reset', `--${r.mode}`, sha]));
      const after = await this.headState();
      if (ok && before.sha && before.sha !== after.sha)
        this.record({
          label: `reset ${r.mode} para ${sha.slice(0, 7)}`,
          undo: async () => {
            await this.expectHead(after);
            await this.repo.run(['reset', `--${r.mode}`, before.sha]);
            if (saved) await this.repo.run(['stash', 'apply', saved]);
          },
          redo: async () => {
            await this.expectHead(before);
            await this.repo.run(['reset', `--${r.mode}`, after.sha]);
          },
        });
      return ok;
    }

    async createTag(sha) {
      const r = await form('Nova tag', [
        { name: 'name', label: 'Nome da tag', placeholder: 'v1.0.0' },
        { name: 'message', label: 'Mensagem (deixe vazio para tag leve)' },
      ], { ok: 'Criar', message: `No commit ${sha === 'HEAD' ? 'HEAD' : sha.slice(0, 7)}` });
      if (!r || !r.name.trim()) return;
      const args = r.message.trim() ? ['tag', '-a', r.name.trim(), '-m', r.message.trim(), sha] : ['tag', r.name.trim(), sha];
      const name = r.name.trim();
      const ok = await this.op('Criar tag', () => this.repo.run(args), { success: `Tag ${name} criada` });
      if (ok) {
        const obj = (await this.repo.run(['rev-parse', `refs/tags/${name}`])).trim();
        this.record({ label: `criação da tag ${name}`, undo: () => this.repo.run(['tag', '-d', name]), redo: () => this.repo.run(['update-ref', `refs/tags/${name}`, obj]) });
      }
      return ok;
    }

    async deleteTag(name) {
      if (!(await confirmBox('Excluir tag', `Excluir a tag local "${name}"?`, 'Excluir'))) return;
      // guarda o objeto da tag (anotada ou não) para o Desfazer recriar igual
      const obj = (await this.repo.run(['rev-parse', `refs/tags/${name}`])).trim();
      const ok = await this.op('Excluir tag', () => this.repo.run(['tag', '-d', name]));
      if (ok) this.record({ label: `exclusão da tag ${name}`, undo: () => this.repo.run(['update-ref', `refs/tags/${name}`, obj]), redo: () => this.repo.run(['tag', '-d', name]) });
      return ok;
    }

    async pushTag(name) {
      const remote = await this.pickRemote();
      if (!remote) return;
      return this.op('Push da tag', () => this.repo.run(['push', remote, `refs/tags/${name}`]), { success: `Tag ${name} enviada para ${remote}` });
    }

    // ---------- submódulos ----------
    submoduleMenu(m) {
      return [
        m.state !== 'uninit' && { label: 'Abrir em nova aba', action: () => this.openSubmodule(m) },
        { label: m.state === 'uninit' ? 'Baixar (update --init)' : 'Atualizar para o commit registrado', action: () => this.updateSubmodules([m.path]) },
        { label: 'Sincronizar URL do .gitmodules', action: () => this.op('Sincronizar submódulo', () => this.repo.run(['submodule', 'sync', '--', m.path]), { success: `URL de ${m.path} sincronizada` }) },
        '-',
        m.state !== 'uninit' && { label: 'Abrir pasta', action: () => polvo.reveal(this.repo.root + '/' + m.path) },
        m.url && { label: 'Copiar URL', action: () => this.copy(m.url) },
      ];
    }

    openSubmodule(m) {
      if (m.state === 'uninit') return toast(`${m.path} ainda não foi baixado. Use "Baixar" no menu dele.`);
      return this.app.openRepo(this.repo.root + '/' + m.path);
    }

    // paths omitido = todos, inclusive os aninhados
    updateSubmodules(paths) {
      const label = paths ? `Atualizar ${paths.join(', ')}` : 'Atualizar submódulos';
      return this.op(label, () => this.repo.run(['submodule', 'update', '--init', '--recursive', ...(paths ? ['--', ...paths] : [])]), { success: 'Submódulos atualizados' });
    }

    // ---------- worktrees ----------
    // Outra pasta com outra branch do mesmo repositório, aberta numa aba própria.
    async createWorktree(branch) {
      const local = this.data.refs.local.map((b) => b.name);
      const used = new Set((this.data.worktrees || []).map((w) => w.branch).filter(Boolean));
      const free = local.filter((n) => !used.has(n));
      const parent = this.repo.root.replace(/\/[^/]+$/, '');
      const suggest = (b) => `${parent}/${this.repo.name}-${(b || 'nova').replace(/[^\w.-]+/g, '-')}`;
      const r = await form(
        'Novo worktree',
        [
          {
            name: 'branch',
            label: 'Branch',
            value: branch && free.includes(branch) ? branch : '__new__',
            options: [{ value: '__new__', label: 'Criar uma branch nova...' }, ...free.map((n) => ({ value: n, label: n }))],
          },
          { name: 'newName', label: 'Nome da branch nova (se for criar)', placeholder: 'feature/minha-branch' },
          { name: 'path', label: 'Pasta do worktree', value: suggest(branch), browse: true },
          { name: 'open', label: 'Abrir em nova aba depois de criar', type: 'checkbox', value: true },
        ],
        { ok: 'Criar', message: `Uma pasta separada com outra branch de ${this.repo.name}, para trabalhar nas duas ao mesmo tempo. Branches já abertas em outro worktree não aparecem.` }
      );
      if (!r) return;
      const isNew = r.branch === '__new__';
      const name = isNew ? r.newName.trim().replace(/\s+/g, '-') : r.branch;
      if (!name) return toast('Escolha a branch ou digite o nome da nova.', 'error');
      const dir = r.path.trim() || suggest(name);
      const ok = await this.op('Criar worktree', () => this.repo.run(['worktree', 'add', ...(isNew ? ['-b', name, dir] : [dir, name])]), { success: `Worktree de ${name} criado em ${dir}` });
      if (ok && r.open) this.app.openRepo(dir);
    }

    async removeWorktree(w) {
      if (!(await confirmBox('Remover worktree', `Remover a pasta "${w.path}"?\nA branch ${w.branch || ''} continua existindo; só a pasta sai.`, 'Remover'))) return;
      // a aba aberta nessa pasta deixaria de funcionar
      const closeTabs = () => this.app.tabs.filter((t) => t.kind === 'repo' && t.repo.root === w.path).forEach((t) => this.app.closeTab(t));
      const r = await this.repo.raw(['worktree', 'remove', w.path]);
      if (r.code === 0) {
        closeTabs();
        toast('Worktree removido');
        return this.refresh();
      }
      if (/modified or untracked|contains modified/i.test(r.stderr) && (await confirmBox('Worktree com alterações', `"${w.path}" tem alterações sem commit. Remover mesmo assim? Elas serão perdidas.`, 'Remover e perder'))) {
        const ok = await this.op('Remover worktree', () => this.repo.run(['worktree', 'remove', '--force', w.path]));
        if (ok) closeTabs();
        return ok;
      }
      if (r.code !== 0 && !/modified or untracked|contains modified/i.test(r.stderr)) toast(`Remover worktree falhou:\n${r.stderr.trim()}`, 'error');
    }

    worktreeMenu(w, isMain) {
      const here = w.path === this.repo.root;
      return [
        !here && { label: 'Abrir em nova aba', action: () => this.app.openRepo(w.path) },
        { label: 'Abrir pasta', action: () => polvo.reveal(w.path) },
        { label: 'Copiar caminho', action: () => this.copy(w.path) },
        w.prunable && { label: 'Limpar worktrees que sumiram (prune)', action: () => this.op('Limpar worktrees', () => this.repo.run(['worktree', 'prune'])) },
        !isMain && !here && '-',
        !isMain && !here && { label: 'Remover worktree...', danger: true, action: () => this.removeWorktree(w) },
      ];
    }

    // ---------- identidade e perfis ----------
    // Aplica um perfil só neste repositório (git config --local); null volta para a identidade geral.
    async useProfile(p) {
      const set = (k, v) => (v ? this.repo.run(['config', '--local', k, v]) : this.repo.raw(['config', '--local', '--unset', k]));
      const before = this.data.identity;
      const prev = { name: (await this.repo.raw(['config', '--local', 'user.name'])).stdout.trim(), email: (await this.repo.raw(['config', '--local', 'user.email'])).stdout.trim() };
      const apply = async (x) => {
        await set('user.name', x ? x.name : '');
        await set('user.email', x ? x.email : '');
      };
      const ok = await this.op('Trocar identidade', () => apply(p), { success: p ? `Commits deste repositório como ${p.name} <${p.email}>` : 'Usando a identidade geral do Git' });
      if (ok) this.record({ label: `identidade (${before.name})`, undo: () => apply(prev.name || prev.email ? prev : null), redo: () => apply(p) });
    }

    async identityMenu(x, y) {
      const s = (this.app.settings = await polvo.settings.get());
      const profiles = s.profiles || [];
      const id = this.data.identity || {};
      const isCur = (p) => p.name === id.name && p.email === id.email;
      UI.showMenu(x, y, [
        { label: 'Commitar neste repositório como:', disabled: true, action: () => {} },
        ...profiles.map((p) => ({ label: `${isCur(p) ? '✓ ' : '\u2003'}${p.label || p.name} — ${p.email}`, action: () => this.useProfile(p) })),
        !profiles.length && { label: '\u2003(nenhum perfil salvo)', disabled: true, action: () => {} },
        id.local && { label: 'Usar a identidade geral do Git', action: () => this.useProfile(null) },
        '-',
        { label: 'Gerenciar perfis...', action: () => this.app.editProfiles() },
        { label: 'Preferências...', action: () => this.app.openPreferences() },
      ]);
    }

    // ---------- favoritas, ferramentas externas e modelo de commit ----------
    async togglePin(name) {
      const i = this.pinned.indexOf(name);
      if (i >= 0) this.pinned.splice(i, 1);
      else this.pinned.push(name);
      const s = await polvo.settings.get();
      await polvo.settings.set({ pinnedBranches: { ...(s.pinnedBranches || {}), [this.repo.root]: this.pinned } });
      V.renderLeft(this);
    }

    // Ferramenta de merge do git (merge.tool): o GitPolvo espera ela fechar.
    mergeTool(file) {
      return this.op('Ferramenta de merge', async () => {
        const r = await this.repo.raw(['-c', 'mergetool.keepBackup=false', 'mergetool', '--no-prompt', '--', file]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || 'A ferramenta de merge terminou com erro. Configure uma nas Preferências.');
        if (this.view.type === 'conflict') this.view = { type: 'graph' };
      });
    }

    // Ferramenta de diff do git (diff.tool) para o diff aberto; não mexe no repositório.
    async diffTool(v) {
      const range = v.kind === 'staged' ? ['--cached'] : v.kind === 'commit' ? (v.parents?.length ? [v.parents[0], v.sha] : [`${v.sha}^!`]) : [];
      toast('Abrindo a ferramenta de diff...');
      const r = await this.repo.raw(['difftool', '--no-prompt', ...range, '--', v.file]);
      if (r.code !== 0) toast(`Ferramenta de diff falhou:\n${(r.stderr || r.stdout).trim() || 'Configure uma nas Preferências.'}`, 'error');
    }

    // Modelo deste repositório: fica em .git/polvo-commit-template e vira o commit.template local.
    async editTemplate() {
      const text = await V.messageEditor('Modelo de mensagem de commit', this.data.template || '', {
        ok: 'Salvar modelo',
        message: 'Texto que já vem no campo de mensagem a cada commit neste repositório. Linhas começando com # não entram no commit. Deixe vazio para não usar modelo.',
        allowEmpty: true,
      });
      if (text == null) return;
      const gitDir = await this.repo.gitDir();
      const file = gitDir + '/polvo-commit-template';
      await polvo.writeFile(gitDir, 'polvo-commit-template', text ? text + '\n' : '');
      if (text) await this.repo.run(['config', '--local', 'commit.template', file]);
      else await this.repo.raw(['config', '--local', '--unset', 'commit.template']);
      const d = this.commitDraft;
      if (d.templateUsed && d.summary === d.templateSummary && d.description === d.templateDescription) this.commitDraft = { summary: '', description: '', amend: false };
      toast(text ? 'Modelo salvo' : 'Modelo removido');
      this.refresh();
    }

    // ---------- remotos ----------
    async pickRemote() {
      const remotes = await this.repo.remoteNames();
      if (!remotes.length) {
        toast('Nenhum remoto configurado. Adicione um em "Remoto +" no painel esquerdo.', 'error');
        return null;
      }
      if (remotes.length === 1) return remotes[0];
      const r = await form('Escolher remoto', [{ name: 'remote', label: 'Remoto', value: remotes.includes('origin') ? 'origin' : remotes[0], options: remotes.map((x) => ({ value: x, label: x })) }]);
      return r ? r.remote : null;
    }

    fetch() {
      this.skipAutoFetch = false;
      return this.op('Fetch', () => this.repo.run(['fetch', '--all', '--prune', '--tags']), { success: 'Fetch concluído' });
    }

    // Fetch de fundo: não mostra o polvo de loading na branch (o manual continua mostrando).
    async fetchSilent({ background } = {}) {
      if (this.fetching || this.busy) return;
      if (background && this.skipAutoFetch) return;
      this.fetching = true;
      this.backgroundFetch = !!background;
      try {
        await this.repo.run(['fetch', '--all', '--prune', '--tags']);
        this.skipAutoFetch = false;
      } catch {
        // automático: offline ou sem credencial não deve cobrir o grafo
      } finally {
        this.backgroundFetch = false;
        this.fetching = false;
        if (!this.busy) await this.refresh();
      }
    }

    // Ao abrir a guia, e a cada 5 s enquanto ela está em foco.
    async fetchOnOpen({ background } = {}) {
      if (this.busy || this.fetching || this.app.settings?.autoFetch === false) return;
      if (background && this.skipAutoFetch) return;
      try {
        const remotes = await this.repo.remoteNames();
        if (!remotes.length || this.busy || this.fetching) return;
        return this.fetchSilent({ background });
      } catch {
        // sem remoto ou git indisponível: a tela local já foi carregada
      }
    }

    async pull(mode) {
      const head = this.data.head;
      if (head.detached) return toast('Não é possível fazer pull em detached HEAD.', 'error');
      const b = this.data.refs.local.find((x) => x.current);
      if (!b || !b.upstream) return toast(`A branch "${head.branch}" não tem upstream. Faça push primeiro para criar.`, 'error');
      const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase';
      return this.op('Pull', async () => {
        const r = await this.repo.raw(['pull', flag, '--no-edit']);
        if (r.code !== 0) {
          if (/CONFLICT/.test(r.stdout + r.stderr)) return toast('Pull gerou conflitos. Resolva os arquivos e faça commit.', 'error');
          throw new Error(r.stderr || r.stdout);
        }
        toast(/Already up to date/i.test(r.stdout) ? 'Já está atualizado' : 'Pull concluído');
      }, { undoHead: 'keep', undoLabel: 'pull' });
    }

    pushRemote(b) {
      if (!b?.upstream) return null;
      const remotes = Object.keys(this.data.refs.remotes || {});
      const hit = remotes.sort((a, c) => c.length - a.length).find((r) => b.upstream === r || b.upstream.startsWith(r + '/'));
      return hit || b.upstream.split('/')[0];
    }

    async askPushUpstream(branch) {
      const remotes = await this.repo.remoteNames();
      if (!remotes.length) {
        toast('Nenhum remoto configurado. Adicione um em "Remoto +" no painel esquerdo.', 'error');
        return null;
      }
      const bar = this.els.pushAsk;
      if (!bar) return this.pickRemote().then((remote) => (remote ? { remote, dest: branch } : null));
      if (this._pushAskDone) this._pushAskDone(null);
      return new Promise((resolve) => {
        let settled = false;
        const done = (val) => {
          if (settled) return;
          settled = true;
          this._pushAskDone = null;
          bar.classList.add('hidden');
          bar.innerHTML = '';
          resolve(val);
        };
        this._pushAskDone = done;
        const def = remotes.includes('origin') ? 'origin' : remotes[0];
        const sel = h('select', {}, remotes.map((r) => h('option', { value: r, selected: r === def }, r)));
        const input = h('input', { value: branch, spellcheck: 'false' });
        const submit = () => {
          const dest = input.value.trim();
          if (!dest) return toast('Informe o nome da branch no remoto.', 'error');
          done({ remote: sel.value, dest });
        };
        const formEl = h(
          'form',
          {
            class: 'push-ask-form',
            onsubmit: (e) => {
              e.preventDefault();
              submit();
            },
          },
          h('span', {}, `Qual remoto/branch a "${branch}" deve usar para push e pull?`),
          sel,
          h('span', { class: 'push-ask-slash' }, '/'),
          input,
          h('button', { type: 'submit', class: 'btn small primary' }, 'Enviar'),
          h('button', { type: 'button', class: 'btn small', onclick: () => done(null) }, 'Cancelar')
        );
        bar.innerHTML = '';
        bar.append(formEl);
        bar.classList.remove('hidden');
        input.focus();
        input.select();
      });
    }

    async push(force) {
      const head = this.data.head;
      if (head.detached) return toast('Não é possível fazer push em detached HEAD.', 'error');
      const b = this.data.refs.local.find((x) => x.current);
      let args;
      if (b && b.upstream) {
        const remote = this.pushRemote(b);
        const dest = remote && b.upstream.startsWith(remote + '/') ? b.upstream.slice(remote.length + 1) : head.branch;
        args = ['push', remote, `${head.branch}:${dest}`];
      } else {
        const picked = await this.askPushUpstream(head.branch);
        if (!picked) return;
        args = ['push', '-u', picked.remote, `${head.branch}:${picked.dest}`];
      }
      if (force) args.push('--force-with-lease');
      return this.op('Push', async () => {
        const r = await this.repo.raw(args);
        if (r.code !== 0) {
          if (/rejected|non-fast-forward|fetch first/i.test(r.stderr)) {
            this.busy = null;
            const choice = await form('Push rejeitado', [], {
              ok: 'Forçar push (with-lease)',
              message: 'O remoto tem commits que você não tem localmente.\nFaça Pull primeiro, ou force o push (sobrescreve o remoto se ninguém mais alterou desde o seu último fetch).',
            });
            if (choice) {
              const r2 = await this.repo.raw([...args, '--force-with-lease']);
              if (r2.code !== 0) throw new Error(r2.stderr);
              return toast('Push forçado concluído');
            }
            return;
          }
          throw new Error(r.stderr || r.stdout);
        }
        toast(`Push de ${head.branch} concluído`);
      });
    }

    async addRemote() {
      const r = await form('Adicionar remoto', [
        { name: 'name', label: 'Nome', value: (await this.repo.remoteNames()).length ? '' : 'origin' },
        { name: 'url', label: 'URL', placeholder: 'git@github.com:usuario/repo.git' },
      ], { ok: 'Adicionar' });
      if (!r || !r.name.trim() || !r.url.trim()) return;
      const ok = await this.op('Adicionar remoto', () => this.repo.run(['remote', 'add', r.name.trim(), r.url.trim()]));
      if (ok) this.fetch();
    }

    async editRemoteUrl(name) {
      const url = (await this.repo.run(['remote', 'get-url', name])).trim();
      const next = await prompt(`URL de ${name}`, 'Endereço do repositório (https ou ssh)', url, { ok: 'Salvar' });
      if (!next || next === url) return;
      const ok = await this.op('Editar remoto', () => this.repo.run(['remote', 'set-url', name, next]), { success: `${name} agora aponta para ${next}` });
      if (ok) {
        this.web = undefined; // o site do commit pode ter mudado
        this.github = undefined;
        this.record({ label: `URL de ${name}`, undo: () => this.repo.run(['remote', 'set-url', name, url]), redo: () => this.repo.run(['remote', 'set-url', name, next]) });
      }
    }

    async renameRemote(name) {
      const next = await prompt('Renomear remoto', 'Novo nome', name, { ok: 'Renomear' });
      if (!next || next === name) return;
      const ok = await this.op('Renomear remoto', () => this.repo.run(['remote', 'rename', name, next]), { success: `Remoto ${name} agora é ${next}` });
      if (ok) this.record({ label: `renomear remoto ${name}`, undo: () => this.repo.run(['remote', 'rename', next, name]), redo: () => this.repo.run(['remote', 'rename', name, next]) });
    }

    async removeRemote(name) {
      if (!(await confirmBox('Remover remoto', `Remover o remoto "${name}" (não apaga nada no servidor)?`, 'Remover'))) return;
      return this.op('Remover remoto', () => this.repo.run(['remote', 'remove', name]));
    }

    async deleteRemoteBranch(remote, name) {
      if (!(await confirmBox('Excluir branch remota', `Excluir "${name}" em "${remote}"? Isso apaga a branch no servidor.`, 'Excluir no servidor'))) return;
      return this.op('Excluir branch remota', () => this.repo.run(['push', remote, '--delete', name]));
    }

    // ---------- stash ----------
    // what: undefined (tudo), 'staged' (só o preparado) ou uma lista de caminhos
    async stash(what) {
      if (!this.hasDirtyWorktree()) return toast('Não há alterações para guardar.');
      if (what === 'staged' && !this.data.status.staged.length) return toast('Nada preparado para guardar.');
      const title = what === 'staged' ? 'Stash do que está preparado' : Array.isArray(what) ? `Stash de ${what.length} arquivo(s)` : 'Stash';
      const msg = await prompt(title, 'Mensagem (opcional)', '', { ok: 'Guardar' });
      if (msg === null) return;
      const args = ['stash', 'push', '--include-untracked'];
      if (what === 'staged') args.splice(2, 1, '--staged');
      if (msg) args.push('-m', msg);
      if (Array.isArray(what)) args.push('--', ...what);
      return this.op('Stash', () => this.repo.run(args), { success: 'Alterações guardadas no stash' });
    }

    // Janela para escolher quais arquivos alterados vão para o stash.
    async stashPick() {
      const st = this.data.status;
      const paths = [...new Set([...st.staged, ...st.unstaged].map((f) => f.path))];
      if (!paths.length) return toast('Não há alterações para guardar.');
      const r = await form('Stash de arquivos escolhidos', paths.map((p, i) => ({ name: 'f' + i, type: 'checkbox', label: p, value: false })), { ok: 'Continuar', wide: true });
      if (!r) return;
      const chosen = paths.filter((_, i) => r['f' + i]);
      if (chosen.length) return this.stash(chosen);
    }

    stashOptions() {
      return [
        { label: 'Guardar tudo', action: () => this.stash() },
        { label: 'Guardar só o que está preparado', disabled: !this.data.status?.staged.length, action: () => this.stash('staged') },
        { label: 'Escolher arquivos...', action: () => this.stashPick() },
      ];
    }

    stashPop(ref) {
      if (!this.data.stashes?.length) return toast('Não há stashes.');
      return this.op('Stash pop', () => this.repo.run(['stash', 'pop', ...(ref ? [ref] : [])]));
    }

    stashApply(ref) {
      return this.op('Stash apply', () => this.repo.run(['stash', 'apply', ref]));
    }

    async stashDrop(ref) {
      if (!(await confirmBox('Excluir stash', `Excluir ${ref}?`, 'Excluir'))) return;
      return this.op('Excluir stash', () => this.repo.run(['stash', 'drop', ref]));
    }

    // ---------- conflitos ----------
    async openConflict(file) {
      const content = await polvo.readFile(this.repo.root, file);
      this.view = { type: 'conflict', file, content };
      this.renderCenter();
      V.renderRight(this);
    }

    resolveWith(file, side) {
      return this.op(`Usar versão ${side}`, async () => {
        await this.repo.run(['checkout', `--${side}`, '--', file]);
        await this.repo.run(['add', '--', file]);
        if (this.view.type === 'conflict') this.view = { type: 'graph' };
      });
    }

    async saveConflict(file, content) {
      if (/^(<<<<<<<|>>>>>>>) /m.test(content) && !(await confirmBox('Marcadores restantes', 'O resultado ainda contém marcadores de conflito. Salvar mesmo assim?', 'Salvar'))) return;
      await polvo.writeFile(this.repo.root, file, content);
      this.view = { type: 'graph' };
      return this.op('Marcar resolvido', () => this.repo.run(['add', '--', file]), { success: `${file} resolvido` });
    }

    copy(text) {
      navigator.clipboard.writeText(text);
      toast('Copiado: ' + text.slice(0, 40));
    }

    // ---------- menus ----------
    branchMenu(name) {
      const cur = this.data.head.branch;
      const isCur = name === cur;
      const b = this.data.refs.local.find((x) => x.name === name);
      return [
        !isCur && { label: b?.behind ? `Checkout e pull de ${name}` : `Checkout de ${name}`, action: () => this.checkout(name) },
        !isCur && cur && { label: `Merge de ${name} em ${cur}`, action: () => this.merge(name) },
        !isCur && cur && { label: 'Merge com opções...', action: () => this.mergeOptions(name) },
        !isCur && cur && { label: `Rebase de ${cur} sobre ${name}`, action: () => this.rebase(name) },
        isCur && { label: 'Pull', action: () => this.pull() },
        isCur && { label: 'Push', action: () => this.push() },
        '-',
        { label: 'Criar branch a partir daqui', action: () => this.createBranch(name) },
        { label: 'Criar tag aqui', action: () => this.createTag(name) },
        { label: 'Renomear...', action: () => this.renameBranch(name) },
        b && b.upstream && { label: `Upstream: ${b.upstream}`, disabled: true, action: () => {} },
        '-',
        !isCur && cur && { label: `Comparar com ${cur}`, action: () => this.compareRefs(cur, name) },
        { label: 'Comparar com...', action: () => this.pickCompare(name) },
        !isCur && { label: 'Abrir num worktree novo...', action: () => this.createWorktree(name) },
        { label: this.pinned?.includes(name) ? 'Desafixar do topo' : 'Fixar no topo da lista', action: () => this.togglePin(name) },
        ...this.refFilterMenu('refs/heads/' + name, { canHide: !isCur }),
        '-',
        { label: 'Copiar nome', action: () => this.copy(name) },
        !isCur && { label: 'Excluir branch', danger: true, action: () => this.deleteBranch(name) },
        !isCur && b?.upstream && !b.gone && { label: `Excluir local e ${b.upstream}`, danger: true, action: () => this.deleteBranches([name], { remote: true }) },
      ];
    }

    // Janela com a lista de branches locais para excluir várias de uma vez.
    async pickBranchesToDelete() {
      const cur = this.data.head.branch;
      const list = this.data.refs.local.filter((b) => !b.current);
      if (!list.length) return toast('Não há outras branches locais.');
      const merged = new Set(
        cur
          ? (await this.repo.run(['branch', '--merged', 'HEAD', '--format=%(refname:short)']))
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean)
          : []
      );
      const r = await form(
        'Excluir branches',
        [
          { section: 'Branches locais', note: cur ? `"mesclada" = todos os commits dela já estão em ${cur}.` : '' },
          ...list.map((b, i) => ({
            name: 'b' + i,
            type: 'checkbox',
            label: `${b.name}${merged.has(b.name) ? '  · mesclada' : ''}${b.upstream ? `  · ${b.gone ? 'remota já removida' : b.upstream}` : ''}`,
            value: false,
          })),
          { section: 'No servidor' },
          { name: 'remote', type: 'checkbox', label: 'Excluir também a branch remota de cada uma (não dá para desfazer)', value: false },
        ],
        { ok: 'Excluir', danger: true, wide: true }
      );
      if (!r) return;
      const names = list.filter((_, i) => r['b' + i]).map((b) => b.name);
      if (names.length) return this.deleteBranches(names, { remote: r.remote, merged });
    }

    // Exclui as locais (o Desfazer recria) e, se pedido, as remotas de cada uma.
    async deleteBranches(names, { remote = false, merged } = {}) {
      const locals = names.map((n) => this.data.refs.local.find((b) => b.name === n)).filter(Boolean);
      const remotes = remote ? locals.filter((b) => b.upstream && !b.gone) : [];
      const unmerged = merged ? locals.filter((b) => !merged.has(b.name)).length : 0;
      const msg = [
        `Excluir ${locals.length === 1 ? `a branch "${locals[0].name}"` : `${locals.length} branches locais`}?`,
        remotes.length ? `Também no servidor: ${remotes.map((b) => b.upstream).join(', ')} (isso não dá para desfazer).` : '',
        unmerged ? `${unmerged} delas têm commits que não estão em ${this.data.head.branch}.` : '',
        'As locais dá para recuperar pelo botão Desfazer enquanto o GitPolvo estiver aberto.',
      ]
        .filter(Boolean)
        .join('\n');
      if (!(await confirmBox('Excluir branches', msg, 'Excluir'))) return;
      const shas = Object.fromEntries(locals.map((b) => [b.name, b.sha]));
      const ok = await this.op('Excluir branches', async () => {
        for (const b of remotes) {
          const rm = this.pushRemote(b);
          await this.repo.run(['push', rm, '--delete', b.upstream.slice(rm.length + 1)]);
        }
        await this.repo.run(['branch', '-D', ...locals.map((b) => b.name)]);
      }, { success: locals.length === 1 ? `Branch ${locals[0].name} excluída` : `${locals.length} branches excluídas` });
      if (ok)
        this.record({
          label: locals.length === 1 ? `exclusão da branch ${locals[0].name}` : `exclusão de ${locals.length} branches`,
          undo: async () => {
            for (const [n, sha] of Object.entries(shas)) await this.repo.run(['branch', n, sha]);
          },
          redo: () => this.repo.run(['branch', '-D', ...Object.keys(shas)]),
        });
    }

    remoteBranchMenu(remote, name) {
      const full = `${remote}/${name}`;
      const cur = this.data.head.branch;
      const local = this.data.refs.local.find((b) => b.name === name);
      return [
        this.pullIfBehind(local)
          ? { label: `Pull (${local.behind} no remoto)`, action: () => this.pull() }
          : local
            ? { label: local.behind ? `Checkout e pull de ${name}` : `Checkout de ${name}`, action: () => this.checkoutRemote(full) }
            : { label: `Checkout (criar local ${name})`, action: () => this.checkoutRemote(full) },
        cur && { label: `Merge de ${full} em ${cur}`, action: () => this.merge(full) },
        cur && { label: 'Merge com opções...', action: () => this.mergeOptions(full) },
        cur && { label: `Rebase de ${cur} sobre ${full}`, action: () => this.rebase(full) },
        '-',
        cur && { label: `Comparar com ${cur}`, action: () => this.compareRefs(cur, full) },
        { label: 'Comparar com...', action: () => this.pickCompare(full) },
        ...this.refFilterMenu('refs/remotes/' + full),
        '-',
        { label: 'Copiar nome', action: () => this.copy(full) },
        { label: 'Excluir no servidor', danger: true, action: () => this.deleteRemoteBranch(remote, name) },
      ];
    }

    remoteMenu(remote) {
      return [
        { label: `Fetch de ${remote}`, action: () => this.op('Fetch', () => this.repo.run(['fetch', '--prune', remote])) },
        {
          label: this.isHidden(`refs/remotes/${remote}/*`) ? `Mostrar as branches de ${remote} no grafo` : `Esconder as branches de ${remote} no grafo`,
          action: () => this.toggleHidden(`refs/remotes/${remote}/*`),
        },
        { label: 'Copiar URL', action: async () => this.copy((await this.repo.run(['remote', 'get-url', remote])).trim()) },
        { label: 'Editar URL...', action: () => this.editRemoteUrl(remote) },
        { label: 'Renomear...', action: () => this.renameRemote(remote) },
        '-',
        { label: 'Remover remoto', danger: true, action: () => this.removeRemote(remote) },
      ];
    }

    tagMenu(name) {
      return [
        { label: `Checkout da tag ${name}`, action: () => this.checkoutCommit(name) },
        { label: 'Push da tag', action: () => this.pushTag(name) },
        { label: 'Copiar nome', action: () => this.copy(name) },
        '-',
        { label: 'Excluir tag local', danger: true, action: () => this.deleteTag(name) },
        { label: 'Excluir tag no remoto...', danger: true, action: () => this.deleteRemoteTag(name) },
      ];
    }

    async deleteRemoteTag(name) {
      const remote = await this.pickRemote();
      if (!remote) return;
      const r = await form(
        'Excluir tag no remoto',
        [{ name: 'local', type: 'checkbox', label: 'Excluir também a tag local', value: false }],
        { ok: 'Excluir no servidor', danger: true, message: `Apagar a tag "${name}" em "${remote}"? Isso não dá para desfazer pelo GitPolvo.` }
      );
      if (!r) return;
      return this.op('Excluir tag no remoto', async () => {
        await this.repo.run(['push', remote, '--delete', `refs/tags/${name}`]);
        if (r.local) await this.repo.run(['tag', '-d', name]);
      }, { success: `Tag ${name} excluída em ${remote}` });
    }

    async pushAllTags() {
      const remote = await this.pickRemote();
      if (!remote) return;
      return this.op('Push das tags', () => this.repo.run(['push', remote, '--tags']), { success: `Tags enviadas para ${remote}` });
    }

    // O git não renomeia stash: sai da lista e volta (no topo) com a mensagem nova.
    async renameStash(s) {
      const msg = await prompt('Renomear stash', 'Mensagem', s.msg.replace(/^On [^:]+: /, ''), { ok: 'Renomear' });
      if (!msg || msg === s.msg) return;
      return this.op('Renomear stash', async () => {
        await this.repo.run(['stash', 'drop', s.ref]);
        await this.repo.run(['stash', 'store', '-m', msg, s.sha]);
      }, { success: 'Stash renomeado (agora é o primeiro da lista)' });
    }

    // Branch nova no commit em que o stash foi feito, com as alterações aplicadas.
    async branchFromStash(s) {
      if (this.hasDirtyWorktree()) return toast('Faça commit ou stash das alterações atuais antes.', 'error');
      const name = await prompt('Branch a partir do stash', 'Nome da branch nova', '', { ok: 'Criar', message: 'A branch começa no commit em que o stash foi feito, com as alterações dele aplicadas. O stash sai da lista.' });
      if (!name) return;
      return this.op('Branch a partir do stash', () => this.repo.run(['stash', 'branch', name.replace(/\s+/g, '-'), s.ref]), { success: `Branch ${name} criada com as alterações do stash` });
    }

    stashMenu(s) {
      return [
        { label: 'Aplicar', action: () => this.stashApply(s.ref) },
        { label: 'Aplicar e remover (pop)', action: () => this.stashPop(s.ref) },
        { label: 'Criar branch a partir dele...', action: () => this.branchFromStash(s) },
        { label: 'Renomear...', action: () => this.renameStash(s) },
        '-',
        { label: 'Excluir', danger: true, action: () => this.stashDrop(s.ref) },
      ];
    }

    multiMenu() {
      const list = this.multiCommits();
      const n = list.length;
      return [
        n === 2 && { label: 'Comparar os dois', action: () => V.renderRight(this) },
        { label: `Juntar ${n} commits (squash)...`, action: () => this.squashCommits(list) },
        { label: `Cherry-pick de ${n} commits`, action: () => this.cherryPickMany(list) },
        { label: `Reverter ${n} commits`, action: () => this.revertMany(list) },
        '-',
        { label: 'Copiar SHAs', action: () => this.copy(list.map((c) => c.sha).join('\n')) },
        { label: `Salvar ${n} commits como patch...`, action: () => this.savePatch(list) },
        { label: 'Limpar seleção', action: () => this.clearMulti() },
      ];
    }

    commitMenu(c) {
      const cur = this.data.head.branch;
      return [
        { label: 'Checkout deste commit', action: () => this.checkoutCommit(c.sha) },
        { label: 'Criar branch aqui', action: () => this.createBranch(c.sha) },
        { label: 'Criar tag aqui', action: () => this.createTag(c.sha) },
        '-',
        { label: 'Cherry-pick', disabled: c.sha === this.headSha, action: () => this.cherryPick(c.sha) },
        { label: 'Reverter commit', action: () => this.revert(c.sha) },
        cur && { label: `Reset de ${cur} para este commit...`, action: () => this.reset(c.sha) },
        cur && c.sha !== this.headSha && { label: `Rebase interativo de ${cur} a partir daqui...`, action: () => this.interactiveRebase(c.sha) },
        cur && { label: 'Editar mensagem...', action: () => this.rewordCommit(c) },
        '-',
        c.sha !== this.headSha && { label: 'Comparar com o HEAD', action: () => this.compareRefs(c.sha, 'HEAD', c.sha.slice(0, 7), 'HEAD') },
        { label: 'Copiar SHA', action: () => this.copy(c.sha) },
        { label: 'Copiar mensagem', action: () => this.copy(c.subject) },
        { label: 'Salvar como patch...', action: () => this.savePatch([c]) },
        ...this.webMenu(c.sha),
      ];
    }
  }

  // ======================================================================
  // Aba inicial (sem repositório)
  // ======================================================================
  class WelcomeTab {
    constructor(app) {
      this.app = app;
      this.kind = 'welcome';
      this.title = 'Início';
      this.page = h('div', { class: 'tab-page' });
    }

    dispose() {}

    async refresh() {
      const s = await polvo.settings.get();
      const recent = h('div', {});
      if (!s.recent.length) recent.append(h('div', { class: 'dim' }, 'Nenhum repositório aberto ainda.'));
      for (const p of s.recent) {
        recent.append(
          h(
            'div',
            {
              class: 'recent-item',
              onclick: () => this.app.openRepo(p, this),
              oncontextmenu: (e) => {
                e.preventDefault();
                UI.showMenu(e.clientX, e.clientY, [
                  { label: 'Abrir em nova aba', action: () => this.app.openRepo(p) },
                  { label: 'Abrir pasta', action: () => polvo.reveal(p) },
                  { label: 'Remover da lista', action: async () => (await polvo.repo.removeRecent(p), this.refresh()) },
                ]);
              },
            },
            h('span', {}, '📂'),
            h('div', { class: 'r-text' }, h('div', { class: 'r-name' }, p.split('/').filter(Boolean).pop()), h('div', { class: 'r-path' }, p))
          )
        );
      }
      this.page.innerHTML = '';
      this.page.append(
        h(
          'div',
          { class: 'welcome' },
          h(
            'div',
            { class: 'welcome-inner' },
            h(
              'div',
              {},
              h('h1', {}, h('img', { src: ICON, alt: '' }), 'GitPolvo'),
              h('div', { class: 'dim' }, 'Cliente Git visual, local e independente.'),
              h(
                'div',
                { class: 'actions' },
                h('button', { class: 'btn primary', onclick: () => this.app.commandOpen(this) }, '📂  Abrir repositório'),
                h('button', { class: 'btn', onclick: () => this.app.commandClone(this) }, '⬇  Clonar repositório'),
                h('button', { class: 'btn', onclick: () => this.app.commandInit(this) }, '✚  Iniciar novo repositório')
              )
            ),
            h('div', {}, h('h3', {}, 'Recentes'), recent)
          )
        )
      );
    }

    render() {
      this.refresh();
    }
  }

  class NotesTab {
    constructor(app, md, version) {
      this.app = app;
      this.kind = 'notes';
      this.title = 'Novidades';
      this.md = md;
      this.version = version;
      this.page = h('div', { class: 'tab-page' });
    }

    dispose() {}

    refresh() {
      this.page.innerHTML = '';
      this.page.append(
        h(
          'div',
          { class: 'notes' },
          h(
            'div',
            { class: 'notes-inner' },
            h(
              'div',
              { class: 'notes-head' },
              h('img', { src: ICON, alt: '' }),
              h('div', {}, h('h1', {}, 'O que há de novo'), h('div', { class: 'dim' }, this.version ? `GitPolvo ${this.version}` : ''))
            ),
            UI.renderMarkdown(this.md),
            h('div', { class: 'notes-actions' }, h('button', { class: 'btn primary', onclick: () => this.app.closeTab(this) }, 'Fechar'))
          )
        )
      );
    }

    render() {
      this.refresh();
    }
  }

  // ======================================================================
  // Aplicação: abas, comandos, atalhos
  // ======================================================================
  class App {
    constructor() {
      this.tabs = [];
      this.closed = [];
      this.active = null;
      this.tabsEl = document.getElementById('tabs');
      this.workspace = document.getElementById('workspace');
      document.getElementById('tab-add').onclick = () => this.newTab();
      polvo.onMenu((name) => this.command(name));
      polvo.onRepoChanged((root) => {
        for (const t of this.tabs) if (t.kind === 'repo' && t.repo.root === root && !t.busy) t.refresh();
      });
      polvo.onAskpass((id, promptText, meta) => this.askpass(id, promptText, meta));
      // Rede de segurança além do watcher: relê ao voltar para a janela e,
      // enquanto ela está em foco, a cada 10 s.
      polvo.onWindowFocus(() => this.refreshActive());
      polvo.updates.onStatus((st) => this.onUpdateStatus(st));
      setInterval(() => document.hasFocus() && this.refreshActive(), 10000);

      document.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('resize', () => this.active?.kind === 'repo' && V.renderGraphRows(this.active));
    }

    // ---------- atualizações: só avisa; o usuário decide se atualiza ----------
    async onUpdateStatus(st) {
      const bar = document.getElementById('update-bar');
      const hide = () => bar.classList.add('hidden');
      const show = (...children) => {
        bar.innerHTML = '';
        bar.append(...children);
        bar.classList.remove('hidden');
      };
      const manualCheck = this.manualUpdateCheck;
      this.renderStatusUpdate(st);
      if (st.state === 'available') {
        this.manualUpdateCheck = false;
        const s = await polvo.settings.get();
        if (!manualCheck && s.skippedVersion === st.version) return;
        const later = h('button', { class: 'btn small', onclick: () => (polvo.settings.set({ skippedVersion: st.version }), hide()) }, 'Agora não');
        const go = st.manual
          ? h('button', { class: 'btn small primary', onclick: () => (polvo.openExternal(st.url), hide()) }, 'Baixar')
          : h('button', { class: 'btn small primary', onclick: () => polvo.updates.download() }, 'Atualizar');
        show(h('span', { class: 'up-ico' }, '⬆'), h('span', {}, `Nova versão ${st.version} disponível.`), later, go);
      } else if (st.state === 'downloading') {
        show(h('div', { class: 'spinner' }), h('span', {}, `Baixando atualização… ${st.percent || 0}%`));
      } else if (st.state === 'ready') {
        show(
          h('span', { class: 'up-ico' }, '✓'),
          h('span', {}, `Versão ${st.version} pronta.`),
          h('button', { class: 'btn small', onclick: hide }, 'Depois'),
          h('button', { class: 'btn small primary', onclick: () => polvo.updates.install() }, 'Reiniciar e atualizar')
        );
      } else if (st.state === 'none') {
        if (manualCheck) toast('Você já está na versão mais recente.');
        this.manualUpdateCheck = false;
      } else if (st.state === 'dev') {
        toast('Atualizações só funcionam na versão instalada.');
        this.manualUpdateCheck = false;
      } else if (st.state === 'error') {
        if (manualCheck || !bar.classList.contains('hidden')) toast('Falha ao atualizar:\n' + st.message, 'error');
        this.manualUpdateCheck = false;
        hide();
      }
    }

    // ---------- barra de status (rodapé) ----------
    async initStatusBar() {
      const right = document.querySelector('#statusbar .sb-right');
      const info = await polvo.appInfo();
      this.sbZoom = h('button', { class: 'sb-item', title: 'Zoom (clique para voltar a 100%)', onclick: () => (polvo.zoom.reset(), this.updateZoom()) });
      right.append(
        this.sbZoom,
        h('button', { class: 'sb-version', title: 'Versão instalada — clique para ver detalhes', onclick: () => this.showAbout() }, info.version)
      );
      this.updateZoom();
      // o zoom do Chromium dispara "resize" na página
      window.addEventListener('resize', () => this.updateZoom());
    }

    updateZoom() {
      if (this.sbZoom) this.sbZoom.textContent = `🔍 ${Math.round(polvo.zoom.get() * 100)}%`;
    }

    renderStatusUpdate(st) {
      const left = document.querySelector('#statusbar .sb-left');
      left.innerHTML = '';
      if (st.state === 'available') {
        this.pendingUpdate = st;
        left.append(
          h(
            'button',
            {
              class: 'sb-update',
              title: 'Clique para ver as opções de atualização',
              onclick: () => {
                this.manualUpdateCheck = true;
                this.onUpdateStatus(st);
              },
            },
            `Atualização disponível (${st.version})`
          )
        );
      } else if (st.state === 'downloading') {
        left.append(h('span', { class: 'sb-item' }, `Baixando atualização… ${st.percent || 0}%`));
      } else if (st.state === 'ready') {
        left.append(h('button', { class: 'sb-update', onclick: () => this.onUpdateStatus(st) }, `Reiniciar para atualizar (${st.version})`));
      } else if (st.state === 'error' && this.pendingUpdate) {
        // falhou ao baixar: volta a oferecer a versão
        const pending = this.pendingUpdate;
        setTimeout(() => this.renderStatusUpdate(pending), 0);
      }
    }

    checkUpdates() {
      this.manualUpdateCheck = true;
      polvo.updates.check();
    }

    refreshActive() {
      const t = this.repoTab();
      if (t && !t.busy && !document.querySelector('.modal-back')) t.refresh();
    }

    async start() {
      this.initStatusBar();
      const s = await polvo.settings.get();
      this.settings = s;
      document.documentElement.dataset.theme = s.theme || 'dark';
      UI.avatars.enabled = s.avatars !== false;
      V.setColumnPrefs(s.columns);
      V.setDiffPrefs(s.diffSplit, s.diffIgnoreWs);
      this.startAutoFetch();
      for (const p of s.openTabs || []) {
        const v = await polvo.repo.validate(p);
        if (v.ok) this.addTab(new RepoTab(this, v.root), false);
      }
      if (!this.tabs.length) this.newTab();
      else this.activate(this.tabs[Math.min(s.activeTab || 0, this.tabs.length - 1)]);
      await this.maybeOpenWhatsNew();
    }

    notesSections(md) {
      const text = String(md || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
      const parts = text.split(/^## /m);
      return parts.slice(1).map((p) => {
        const nl = p.indexOf('\n');
        const title = (nl < 0 ? p : p.slice(0, nl)).trim();
        return { title, md: '## ' + p.trim() };
      }).filter((s) => s.title);
    }

    unseenNotes(md, seen) {
      const sections = this.notesSections(md);
      const headings = sections.map((s) => s.title);
      let unseen;
      if (Array.isArray(seen)) {
        const set = new Set(seen);
        unseen = sections.filter((s) => !set.has(s.title));
      } else if (typeof seen === 'string' && seen) {
        const idx = sections.findIndex((s) => s.title === seen);
        unseen = idx < 0 ? sections : sections.slice(0, idx);
      } else {
        unseen = sections;
      }
      return {
        headings,
        md: unseen.length ? '# Novidades\n\n' + unseen.map((s) => s.md).join('\n\n') : '',
      };
    }

    async maybeOpenWhatsNew() {
      try {
        const [info, md] = await Promise.all([polvo.appInfo(), polvo.whatsNew()]);
        const s = this.settings || {};
        const { headings, md: snippet } = this.unseenNotes(md, s.seenWhatsNew);
        const firstRun = !s.lastVersion && !(s.recent && s.recent.length) && !(s.openTabs && s.openTabs.length);
        if (firstRun) {
          polvo.settings.set({ lastVersion: info.version, seenWhatsNew: headings });
          return;
        }
        if (s.lastVersion === info.version) {
          if (JSON.stringify(s.seenWhatsNew) !== JSON.stringify(headings)) polvo.settings.set({ seenWhatsNew: headings });
          return;
        }
        polvo.settings.set({ lastVersion: info.version, seenWhatsNew: headings });
        if (snippet) this.addTab(new NotesTab(this, snippet, info.version));
      } catch {
        // sem notas: segue o baile
      }
    }

    async openWhatsNew() {
      const existing = this.tabs.find((t) => t.kind === 'notes');
      if (existing) return this.activate(existing);
      const [info, md] = await Promise.all([polvo.appInfo(), polvo.whatsNew()]);
      this.addTab(new NotesTab(this, md || 'Nenhuma nota de versão ainda.', info.version));
    }

    persistTabs() {
      const repos = this.tabs.filter((t) => t.kind === 'repo').map((t) => t.repo.root);
      polvo.settings.set({ openTabs: repos, activeTab: Math.max(0, this.tabs.filter((t) => t.kind === 'repo').indexOf(this.active)) });
    }

    addTab(tab, activate = true) {
      this.tabs.push(tab);
      if (activate) this.activate(tab);
      else this.renderTabs();
      this.persistTabs();
      return tab;
    }

    newTab() {
      return this.addTab(new WelcomeTab(this));
    }

    activate(tab) {
      this.active = tab;
      this.workspace.innerHTML = '';
      this.workspace.append(tab.page);
      if (!tab.loaded) {
        tab.loaded = true;
        tab.refresh();
      } else if (tab.kind === 'repo') {
        tab.refresh();
      } else tab.render();
      if (tab.kind === 'repo') tab.fetchOnOpen();
      this.renderTabs();
      this.persistTabs();
      document.title = tab.kind === 'repo' ? `${tab.repo.name} — GitPolvo` : 'GitPolvo';
    }

    closeTab(tab) {
      const i = this.tabs.indexOf(tab);
      if (i < 0) return;
      tab.dispose();
      this.tabs.splice(i, 1);
      if (tab.kind === 'repo') this.closed.push(tab.repo.root);
      if (!this.tabs.length) this.newTab();
      else if (this.active === tab) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)]);
      else this.renderTabs();
      this.persistTabs();
    }

    renderTabs() {
      this.tabsEl.innerHTML = '';
      for (const t of this.tabs) {
        this.tabsEl.append(
          h(
            'div',
            {
              class: 'tab' + (t === this.active ? ' active' : ''),
              title: t.kind === 'repo' ? t.repo.root : '',
              onclick: () => this.activate(t),
              onauxclick: (e) => e.button === 1 && this.closeTab(t),
            },
            h('span', {}, t.kind === 'repo' ? '⑂' : t.kind === 'notes' ? '✦' : '⌂'),
            h('span', { class: 'tab-name' }, t.title),
            h(
              'button',
              {
                class: 'icon-btn tab-close',
                onclick: (e) => {
                  e.stopPropagation();
                  this.closeTab(t);
                },
              },
              '×'
            )
          )
        );
      }
    }

    async openRepo(p, replaceTab) {
      const v = await polvo.repo.validate(p);
      if (!v.ok) {
        toast(`${p}\n${v.error}`, 'error');
        return;
      }
      const existing = this.tabs.find((t) => t.kind === 'repo' && t.repo.root === v.root);
      if (existing) {
        if (replaceTab && replaceTab !== existing) this.closeTab(replaceTab);
        return this.activate(existing);
      }
      const tab = new RepoTab(this, v.root);
      if (replaceTab && this.tabs.includes(replaceTab)) {
        const i = this.tabs.indexOf(replaceTab);
        replaceTab.dispose();
        this.tabs[i] = tab;
        this.activate(tab);
        this.persistTabs();
      } else this.addTab(tab);
    }

    welcomeOrNull() {
      return this.active && this.active.kind === 'welcome' ? this.active : null;
    }

    async commandOpen(replace) {
      const dir = await polvo.pickDir('Abrir repositório');
      if (dir) this.openRepo(dir, replace || this.welcomeOrNull());
    }

    async commandClone(replace) {
      const r = await form(
        'Clonar repositório',
        [
          { name: 'url', label: 'URL do repositório', placeholder: 'https://github.com/usuario/projeto.git' },
          { name: 'parent', label: 'Pasta onde clonar', value: this.settings?.lastCloneDir || '', browse: true },
          { name: 'name', label: 'Nome da pasta (opcional)', placeholder: 'derivado da URL' },
        ],
        { ok: 'Clonar' }
      );
      if (!r || !r.url.trim() || !r.parent.trim()) return;
      const url = r.url.trim();
      const name = r.name.trim() || url.replace(/\/+$/, '').split(/[/:]/).pop().replace(/\.git$/, '');
      polvo.settings.set({ lastCloneDir: r.parent.trim() });
      this.settings.lastCloneDir = r.parent.trim();
      const close = openModal(() => h('div', { class: 'modal' }, h('h2', {}, 'Clonando...'), h('div', { class: 'busy' }, h('div', { class: 'spinner' }), url)));
      const res = await polvo.repo.clone(url, r.parent.trim(), name);
      close();
      if (res.code !== 0) return toast('Falha ao clonar:\n' + res.stderr.trim().split('\n').slice(-3).join('\n'), 'error');
      toast('Repositório clonado');
      this.openRepo(res.target, replace || this.welcomeOrNull());
    }

    async commandInit(replace) {
      const r = await form(
        'Iniciar repositório',
        [
          { name: 'parent', label: 'Pasta pai', browse: true },
          { name: 'name', label: 'Nome do repositório', placeholder: 'meu-projeto' },
          { name: 'readme', label: 'Criar README.md e commit inicial', type: 'checkbox', value: true },
        ],
        { ok: 'Criar' }
      );
      if (!r || !r.parent.trim() || !r.name.trim()) return;
      const dir = r.parent.trim().replace(/\/+$/, '') + '/' + r.name.trim();
      const res = await polvo.repo.init(dir);
      if (res.code !== 0) return toast('Falha ao iniciar:\n' + res.stderr, 'error');
      if (r.readme) {
        await polvo.writeFile(dir, 'README.md', `# ${r.name.trim()}\n`);
        await polvo.git(dir, ['add', 'README.md']);
        await polvo.git(dir, ['commit', '-q', '-m', 'Commit inicial']);
      }
      this.openRepo(dir, replace || this.welcomeOrNull());
    }

    repoTab() {
      return this.active && this.active.kind === 'repo' ? this.active : null;
    }

    // Fetch de fundo enquanto a janela está em foco, no intervalo das preferências.
    startAutoFetch() {
      clearInterval(this.fetchTimer);
      const s = this.settings || {};
      if (s.autoFetch === false) return;
      this.fetchTimer = setInterval(() => {
        if (!document.hasFocus() || document.querySelector('.modal-back')) return;
        const t = this.repoTab();
        if (t) t.fetchOnOpen({ background: true });
      }, Math.max(5, Number(s.fetchInterval) || 5) * 1000);
    }

    // ---------- perfis ----------
    async editProfiles() {
      const s = (this.settings = await polvo.settings.get());
      const t = this.repoTab();
      const seed = s.profiles && s.profiles.length ? s.profiles : t?.data.identity?.name ? [{ label: 'Principal', name: t.data.identity.name, email: t.data.identity.email }] : [];
      const profiles = await V.profilesEditor(seed);
      if (!profiles) return;
      this.settings = await polvo.settings.set({ profiles });
      toast('Perfis salvos');
    }

    // ---------- preferências ----------
    async openPreferences() {
      const t = this.repoTab();
      const cwd = t ? t.repo.root : '.';
      const cfg = async (args) => ((await polvo.git(cwd, ['config', ...args])).stdout || '').trim();
      const s = (this.settings = await polvo.settings.get());
      const [gName, gEmail, defBranch, mergeTool, diffTool] = await Promise.all([
        cfg(['--global', 'user.name']),
        cfg(['--global', 'user.email']),
        cfg(['--global', 'init.defaultBranch']),
        cfg(['--global', 'merge.tool']),
        cfg(['--global', 'diff.tool']),
      ]);
      const [lName, lEmail] = t ? await Promise.all([cfg(['--local', 'user.name']), cfg(['--local', 'user.email'])]) : ['', ''];
      const fields = [
        { section: 'Identidade no Git (todos os repositórios)' },
        { name: 'gName', label: 'Nome', value: gName, placeholder: 'Seu Nome' },
        { name: 'gEmail', label: 'E-mail', value: gEmail, placeholder: 'voce@exemplo.com' },
        ...(t
          ? [
              { section: `Só neste repositório (${t.repo.name})`, note: 'Deixe vazio para usar a identidade acima.' },
              { name: 'lName', label: 'Nome', value: lName, placeholder: gName || 'Seu Nome' },
              { name: 'lEmail', label: 'E-mail', value: lEmail, placeholder: gEmail || 'voce@exemplo.com' },
            ]
          : []),
        { section: 'Fetch automático' },
        { name: 'autoFetch', label: 'Buscar novidades dos remotos enquanto a janela está em foco', type: 'checkbox', value: s.autoFetch !== false },
        {
          name: 'fetchInterval',
          label: 'Intervalo',
          value: String(s.fetchInterval || 5),
          options: [
            { value: '5', label: 'A cada 5 segundos' },
            { value: '30', label: 'A cada 30 segundos' },
            { value: '60', label: 'A cada minuto' },
            { value: '300', label: 'A cada 5 minutos' },
          ],
        },
        { section: 'Aparência' },
        { name: 'theme', label: 'Tema', value: document.documentElement.dataset.theme || 'dark', options: [{ value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }] },
        { name: 'diffSplit', label: 'Diff', value: s.diffSplit ? 'split' : 'unified', options: [{ value: 'unified', label: 'Unificado' }, { value: 'split', label: 'Lado a lado' }] },
        { name: 'avatars', label: 'Mostrar fotos de perfil dos autores', type: 'checkbox', value: UI.avatars.enabled },
        { section: 'Editor externo', note: 'Comando usado em "Abrir no editor". Vazio: VS Code (code), se houver, senão o programa padrão do sistema. Use {arquivo} para escolher onde vai o caminho.' },
        { name: 'editorCmd', label: 'Comando', value: s.editorCmd || '', placeholder: 'code   ·   subl   ·   phpstorm   ·   gedit {arquivo}' },
        { section: 'Ferramentas de merge e diff', note: 'Programa usado em "Abrir na ferramenta de merge/diff" (o mesmo do git mergetool/difftool). Vazio: o git escolhe.' },
        { name: 'mergeTool', label: 'Merge', value: mergeTool, placeholder: 'meld · kdiff3 · vimdiff · bc' },
        { name: 'diffTool', label: 'Diff', value: diffTool, placeholder: 'meld · kdiff3 · vimdiff · bc' },
        { section: 'Novos repositórios' },
        { name: 'defBranch', label: 'Nome da branch inicial', value: defBranch, placeholder: 'main' },
      ];
      const r = await form('Preferências', fields, { ok: 'Salvar', wide: true });
      if (!r) return;
      // git config: vazio remove a chave (volta ao padrão)
      const setCfg = async (scope, key, val, old) => {
        if (val.trim() === old) return;
        if (val.trim()) await polvo.git(cwd, ['config', scope, key, val.trim()]);
        else await polvo.git(cwd, ['config', scope, '--unset', key]);
      };
      await setCfg('--global', 'user.name', r.gName, gName);
      await setCfg('--global', 'user.email', r.gEmail, gEmail);
      await setCfg('--global', 'init.defaultBranch', r.defBranch, defBranch);
      await setCfg('--global', 'merge.tool', r.mergeTool, mergeTool);
      await setCfg('--global', 'diff.tool', r.diffTool, diffTool);
      if (t) {
        await setCfg('--local', 'user.name', r.lName, lName);
        await setCfg('--local', 'user.email', r.lEmail, lEmail);
      }
      document.documentElement.dataset.theme = r.theme;
      UI.avatars.enabled = r.avatars;
      V.setDiffPrefs(r.diffSplit === 'split');
      this.settings = await polvo.settings.set({ theme: r.theme, avatars: r.avatars, diffSplit: r.diffSplit === 'split', autoFetch: r.autoFetch, fetchInterval: Number(r.fetchInterval), editorCmd: r.editorCmd.trim() });
      this.startAutoFetch();
      toast('Preferências salvas');
      if (this.active) this.active.render();
    }

    toggleTheme() {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      polvo.settings.set({ theme: next });
      const t = this.repoTab();
      if (t) V.renderGraphRows(t);
    }

    togglePanel(which) {
      const t = this.repoTab();
      if (!t) return;
      const el = t.els[which];
      el.classList.toggle('hidden');
      t.els[which + 'Resizer'].classList.toggle('hidden', el.classList.contains('hidden'));
      V.renderGraphRows(t);
    }

    commands() {
      const t = this.repoTab();
      const list = [
        ['Abrir repositório...', 'repo:open'],
        ['Clonar repositório...', 'repo:clone'],
        ['Iniciar repositório...', 'repo:init'],
        ['Nova aba', 'tab:new'],
        ['Reabrir aba fechada', 'tab:reopen'],
        ['Preferências...', 'app:prefs'],
        ['Perfis de identidade...', 'app:profiles'],
        ['Alternar tema claro/escuro', 'view:theme'],
        [UI.avatars.enabled ? 'Desligar fotos de perfil' : 'Ligar fotos de perfil', 'view:avatars'],
        ['Atualizar fotos de perfil (limpar cache)', 'view:clearAvatars'],
        ['Atalhos de teclado', 'view:shortcuts'],
        ['O que há de novo', 'help:whatsNew'],
        ['Sobre o GitPolvo', 'help:about'],
        ['Verificar atualizações', 'help:updates'],
      ];
      if (t) {
        list.push(
          ['Fetch', 'repo:fetch'],
          ['Pull', 'repo:pull'],
          ['Pull (rebase)', 'repo:pullRebase'],
          ['Push', 'repo:push'],
          ['Push forçado (with-lease)', 'repo:forcePush'],
          ['Nova branch', 'repo:branch'],
          ['Trocar de branch', 'repo:switch'],
          ['Stash', 'repo:stash'],
          ['Stash pop', 'repo:pop'],
          ['Stage em tudo', 'repo:stageAll'],
          ['Unstage em tudo', 'repo:unstageAll'],
          ['Desfazer', 'repo:undo'],
          ['Refazer', 'repo:redo'],
          ['Nova tag no HEAD', 'repo:tag'],
          ['Adicionar remoto', 'repo:addRemote'],
          ['Abrir terminal', 'repo:terminal'],
          ['Abrir pasta', 'repo:reveal'],
          ['Novo worktree...', 'repo:worktree'],
          ['Aplicar patch...', 'repo:applyPatch'],
          ['Histórico de operações', 'repo:opLog'],
          ['Modelo de mensagem de commit...', 'repo:template'],
          ['Atualizar submódulos', 'repo:submodules'],
          ['Atualizar', 'repo:refresh'],
          ['Mostrar/ocultar painel esquerdo', 'view:toggleLeft'],
          ['Mostrar/ocultar painel de detalhes', 'view:toggleRight'],
          ['Fechar aba', 'tab:close']
        );
      }
      const items = list.map(([label, cmd]) => ({ label, group: 'comando', action: () => this.command(cmd) }));
      if (t && t.data.refs) {
        for (const b of t.data.refs.local) if (!b.current) items.push({ label: `Checkout: ${b.name}`, group: 'branch', action: () => t.checkout(b.name) });
      }
      for (const p of this.settings?.recent || []) items.push({ label: `Abrir: ${p.split('/').pop()}`, group: p, action: () => this.openRepo(p) });
      return items;
    }

    paletteBranches(t) {
      const items = [];
      for (const b of t.data.refs.local) items.push({ label: b.name + (b.current ? '  (atual)' : ''), group: 'local', action: () => !b.current && t.checkout(b.name) });
      for (const [remote, list] of Object.entries(t.data.refs.remotes))
        for (const b of list) if (!t.data.refs.local.some((l) => l.name === b.name)) items.push({ label: b.full, group: 'remoto', action: () => t.checkoutRemote(b.full) });
      items.push({ label: '+ Nova branch...', group: '', action: () => t.createBranch() });
      palette(items, 'Trocar para a branch...');
    }

    async command(name) {
      const t = this.repoTab();
      const needRepo = () => {
        if (!t) toast('Abra um repositório primeiro.');
        return !!t;
      };
      switch (name) {
        case 'tab:new':
          return this.newTab();
        case 'tab:close':
          return this.active && this.closeTab(this.active);
        case 'tab:reopen': {
          const p = this.closed.pop();
          return p && this.openRepo(p);
        }
        case 'repo:open':
          return this.commandOpen();
        case 'repo:clone':
          return this.commandClone();
        case 'repo:init':
          return this.commandInit();
        case 'view:palette':
          this.settings = await polvo.settings.get();
          return palette(this.commands());
        case 'view:theme':
          return this.toggleTheme();
        case 'app:prefs':
          return this.openPreferences();
        case 'app:profiles':
          return this.editProfiles();
        case 'view:avatars':
          UI.avatars.enabled = !UI.avatars.enabled;
          polvo.settings.set({ avatars: UI.avatars.enabled });
          toast(UI.avatars.enabled ? 'Fotos de perfil ligadas' : 'Fotos de perfil desligadas');
          return this.active && this.active.render();
        case 'view:clearAvatars':
          await polvo.clearAvatars();
          UI.avatars.cache.clear();
          return this.active && this.active.render();
        case 'view:toggleLeft':
          return this.togglePanel('left');
        case 'view:toggleRight':
          return this.togglePanel('right');
        case 'view:shortcuts':
          return this.showShortcuts();
        case 'help:about':
          return this.showAbout();
        case 'help:whatsNew':
          return this.openWhatsNew();
        case 'help:updates':
          return this.checkUpdates();
        case 'edit:undo':
        case 'edit:redo': {
          const field = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
          if (field || !t) return document.execCommand(name === 'edit:undo' ? 'undo' : 'redo');
          return name === 'edit:undo' ? t.undo() : t.redo();
        }
      }
      if (!needRepo()) return;
      switch (name) {
        case 'repo:fetch':
          return t.fetch();
        case 'repo:pull':
          return t.pull();
        case 'repo:pullRebase':
          return t.pull('rebase');
        case 'repo:push':
          return t.push();
        case 'repo:forcePush':
          return (await confirmBox('Push forçado', 'Sobrescrever a branch remota (--force-with-lease)?', 'Forçar')) && t.push(true);
        case 'repo:branch':
          return t.createBranch();
        case 'repo:switch':
          return this.paletteBranches(t);
        case 'repo:stash':
          return t.stash();
        case 'repo:pop':
          return t.stashPop();
        case 'repo:stageAll':
          return t.stageAll();
        case 'repo:unstageAll':
          return t.unstageAll();
        case 'repo:undo':
          return t.undo();
        case 'repo:redo':
          return t.redo();
        case 'repo:tag':
          return t.createTag('HEAD');
        case 'repo:addRemote':
          return t.addRemote();
        case 'repo:terminal':
          return polvo.terminal(t.repo.root);
        case 'repo:reveal':
          return polvo.reveal(t.repo.root);
        case 'repo:worktree':
          return t.createWorktree();
        case 'repo:applyPatch':
          return t.applyPatchFile();
        case 'repo:opLog':
          return V.opLogModal(t);
        case 'repo:template':
          return t.editTemplate();
        case 'repo:submodules':
          return t.updateSubmodules();
        case 'repo:refresh':
          return t.refresh();
      }
    }

    onKey(e) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      const mod = e.ctrlKey || e.metaKey;
      const t = this.repoTab();
      if (document.querySelector('.modal-back')) return;
      if (mod && e.key.toLowerCase() === 'f' && t) {
        e.preventDefault();
        t.els.search.focus();
        t.els.search.select();
        return;
      }
      if (mod && e.altKey && e.key.toLowerCase() === 'f' && t) {
        e.preventDefault();
        t.els.leftFilter?.focus();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm' && t) {
        e.preventDefault();
        t.select('WIP');
        setTimeout(() => t.els.commitSummary?.focus(), 0);
        return;
      }
      if (mod && e.key === 'Tab') {
        e.preventDefault();
        const i = this.tabs.indexOf(this.active);
        const n = this.tabs.length;
        this.activate(this.tabs[(i + (e.shiftKey ? -1 : 1) + n) % n]);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const tab = this.tabs[+e.key - 1];
        if (tab) this.activate(tab);
        return;
      }
      if (t && t.view.type === 'edit' && mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        return t.saveEdit();
      }
      if (inField || !t) return;
      if (mod && !e.altKey && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        return t.redo();
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return t.undo();
      }
      if (e.key === 'Escape' && t.view.type !== 'graph') return t.closeView();
      if (e.key === 'Escape' && (t.multi.length || t.compare)) return t.clearMulti();
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        return t.move(1);
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        return t.move(-1);
      }
      if (e.key === 'Home') return t.move(-1e9);
      if (e.key === 'End') return t.move(1e9);
    }

    showShortcuts() {
      const rows = [
        ['Ctrl+P', 'Paleta de comandos'],
        ['Ctrl+O / Ctrl+N / Ctrl+I', 'Abrir / clonar / iniciar repositório'],
        ['Ctrl+T / Ctrl+W', 'Nova aba / fechar aba'],
        ['Ctrl+Tab, Ctrl+1..9', 'Trocar de aba'],
        ['Ctrl+L', 'Fetch'],
        ['Ctrl+B', 'Nova branch'],
        ['Ctrl+Shift+S / U', 'Stage / unstage em tudo'],
        ['Ctrl+Shift+M', 'Ir para a mensagem de commit'],
        ['Ctrl+Enter', 'Fazer commit (na mensagem)'],
        ['Ctrl+F', 'Buscar commits (Enter = próximo)'],
        ['Ctrl+Alt+F', 'Filtrar branches'],
        ['Ctrl+J / Ctrl+K', 'Painel esquerdo / de detalhes'],
        ['↑ ↓ / j k', 'Navegar no histórico'],
        ['Esc', 'Fechar diff ou diálogo'],
        ['F5', 'Atualizar'],
      ];
      openModal((close) =>
        h(
          'div',
          { class: 'modal' },
          h('h2', {}, 'Atalhos de teclado'),
          h('div', { class: 'shortcuts' }, rows.map(([k, d]) => [h('span', {}, h('kbd', {}, k)), h('span', {}, d)])),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Fechar'))
        )
      );
    }

    async showAbout() {
      const info = await polvo.appInfo();
      const git = await polvo.git('/', ['--version']);
      openModal((close) =>
        h(
          'div',
          { class: 'modal' },
          h('h2', {}, h('img', { src: ICON, style: { width: '28px', verticalAlign: 'middle', marginRight: '8px' } }), 'GitPolvo ', info.version),
          h(
            'div',
            { class: 'msg dim' },
            `Cliente Git visual independente.\n\n${git.stdout.trim()}\nElectron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}\n\nTodos os dados ficam na sua máquina; nenhuma conta ou telemetria.\nAs fotos de perfil são buscadas no GitHub (usando o login do GitHub CLI \`gh\`, se houver) e no Gravatar, a partir do e-mail do autor. Desligue pela paleta de comandos.`
          ),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => close() }, 'Fechar'))
        )
      );
    }

    async askpass(id, promptText, meta) {
      const tab = this.repoTab();
      if (tab && tab.backgroundFetch) {
        tab.skipAutoFetch = true;
        polvo.answerAskpass(id, { cancel: true });
        return;
      }
      const info = meta && typeof meta === 'object' ? meta : {};
      const secret = /password|passphrase|senha|token/i.test(promptText);
      const offerRemember = !!info.ssh && secret;
      const fields = [{ name: 'v', label: promptText.trim() || 'Credencial', type: secret ? 'password' : 'text' }];
      let canPersist = false;
      if (offerRemember) {
        try {
          canPersist = await polvo.cred.canPersist();
        } catch {
          canPersist = false;
        }
        fields.push({
          name: 'remember',
          label: 'Lembrar senha SSH neste computador',
          type: 'checkbox',
          value: !!info.remembered && canPersist,
          disabled: !canPersist,
        });
      }
      const message = offerRemember
        ? canPersist
          ? 'O Git está pedindo a senha SSH para acessar o remoto.\nPor padrão ela fica só enquanto o GitPolvo estiver aberto e é apagada ao fechar.'
          : 'O Git está pedindo a senha SSH para acessar o remoto.\nEla fica só enquanto o GitPolvo estiver aberto e é apagada ao fechar. O cofre do sistema não está disponível neste computador.'
        : secret
          ? 'O Git está pedindo uma credencial para acessar o remoto.\nEla fica na memória enquanto o GitPolvo estiver aberto.'
          : 'O Git está pedindo uma credencial para acessar o remoto.';
      const r = await form('Autenticação', fields, { ok: 'Enviar', message });
      const remember = offerRemember ? (canPersist ? !!(r && r.remember) : !!info.remembered) : false;
      polvo.answerAskpass(id, r ? { value: r.v, remember } : { cancel: true });
    }
  }

  const app = new App();
  window.polvoApp = app;
  const started = app.start();
  if (window.polvoSplash) window.polvoSplash.waitFor(started);
})();
