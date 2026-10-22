'use strict';

(() => {
  const { Repo, hunkPatch, layoutGraph, branchOwners } = window.GitLayer;
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
        const [head, refs, stashes, status, commits, state] = await Promise.all([r.head(), r.refs(), r.stashes(), r.status(), r.log(), r.state()]);
        const headSha = (await r.raw(['rev-parse', 'HEAD'])).stdout.trim();
        // nada mudou desde a última leitura: só confere o diff aberto, sem redesenhar
        const signature = JSON.stringify([head, refs, stashes, status, state, headSha, commits.map((c) => c.sha + c.refs.map((x) => x.name).join())]);
        if (signature === this.signature) {
          if (this.view.type === 'diff') this.reloadDiff();
          return;
        }
        this.signature = signature;
        this.data = { head, refs, stashes, status, state };
        if (state !== 'clean' && !this.commitDraft.summary) await this.prefillSequencerMessage();
        this.commits = commits;
        this.layout = layoutGraph(commits);
        this.owners = branchOwners(commits, this.layout.rows);
        this.shaIndex = new Map(commits.map((c, i) => [c.sha, i]));
        this.headSha = headSha;
        if (this.github === undefined) this.github = await this.detectGithub();
        this._rowItems = null;
        if (this.selected !== 'WIP' && !this.shaIndex.has(this.selected) && !this.selectedIsStash) this.selected = 'WIP';
        this.render();
        if (this.view.type === 'diff') this.reloadDiff();
      } catch (e) {
        toast('Erro ao ler o repositório:\n' + e.message, 'error');
      } finally {
        this.refreshing = false;
        if (this.refreshAgain) {
          this.refreshAgain = false;
          this.refresh();
        }
      }
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
      if (this.hasWip() && this.commits.length) {
        const headIdx = this.shaIndex.get(this.headSha);
        const col = headIdx != null ? this.layout.rows[headIdx].col : 0;
        items.push({ type: 'wip', g: { col, lineDown: headIdx === 0 } });
      }
      this.commits.forEach((c, i) =>
        items.push({ type: 'commit', c, g: this.layout.rows[i], owner: this.owners[i], searchText: `${c.subject}\n${c.bodyLine}\n${c.author}\n${c.email}\n${c.sha}`.toLowerCase() })
      );
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
      else if (this.view.type === 'conflict') V.renderConflict(this);
      else V.renderGraph(this);
    }

    setBusy(label) {
      this.busy = label;
      V.renderToolbar(this);
    }

    // Executa uma operação Git com indicador de progresso, mensagem de erro e
    // atualização da tela ao final.
    async op(label, fn, { success, quiet } = {}) {
      this.setBusy(label + '...');
      try {
        await fn();
        if (success) toast(success);
        return true;
      } catch (e) {
        if (!quiet) toast(`${label} falhou:\n${e.message}`, 'error');
        return false;
      } finally {
        this.busy = null;
        await this.refresh();
      }
    }

    // ---------- seleção ----------
    select(id) {
      this.selected = id;
      this.selectedIsStash = false;
      if (this.view.type !== 'graph' && !(id === 'WIP' && this.view.kind !== 'commit')) {
        this.view = { type: 'graph' };
        this.renderCenter();
      } else V.renderGraphRows(this);
      if (id === 'WIP') {
        this.selectedDetails = null;
        V.renderRight(this);
      } else this.loadDetails(id);
    }

    selectSha(sha) {
      const idx = this.rowItems().findIndex((it) => it.type === 'commit' && it.c.sha.startsWith(sha));
      if (idx < 0) return toast('Commit fora do histórico carregado.');
      this.select(this.rowItems()[idx].c.sha);
      V.scrollToRow(this, idx);
    }

    selectStash(stash) {
      this.selected = stash.sha;
      this.selectedIsStash = true;
      this.view = { type: 'graph' };
      this.renderCenter();
      this.loadDetails(stash.sha);
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
      let idx = items.findIndex((it) => (it.type === 'wip' ? this.selected === 'WIP' : it.c.sha === this.selected));
      idx = Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx) + delta));
      const it = items[idx];
      if (!it) return;
      this.select(it.type === 'wip' ? 'WIP' : it.c.sha);
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
      const cur = items.findIndex((it) => it.type === 'commit' && it.c.sha === this.selected);
      for (let k = 1; k <= items.length; k++) {
        const i = (cur + dir * k + items.length * 2) % items.length;
        const it = items[i];
        if (it.type === 'commit' && it.searchText.includes(q)) {
          this.select(it.c.sha);
          V.scrollToRow(this, i);
          return;
        }
      }
      toast('Nenhum commit encontrado.');
    }

    // ---------- diff ----------
    async openDiff(kind, file, sha, parents) {
      this.view = { type: 'diff', kind, file, sha, parents, loading: true, files: [] };
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
      const files = await this.repo.diff(kind, v.file, v.sha, v.parents);
      if (this.view !== v) return;
      const diffSig = JSON.stringify(files);
      if (kind === v.kind && !v.loading && diffSig === v.diffSig) return;
      v.diffSig = diffSig;
      Object.assign(v, { kind, files, loading: false });
      this.renderCenter();
      V.renderRight(this);
    }

    closeView() {
      this.view = { type: 'graph' };
      this.renderCenter();
      V.renderRight(this);
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
      if (!(await confirmBox('Descartar alterações', `Descartar as alterações em "${f.path}"? Isso não pode ser desfeito.`, 'Descartar'))) return;
      if (f.untracked) return this.op('Descartar', () => this.repo.run(['clean', '-f', '-q', '--', f.path]));
      return this.op('Descartar', () => this.repo.run(['restore', '--worktree', '--', f.path]));
    }

    async discardAll() {
      if (!(await confirmBox('Descartar tudo', 'Descartar TODAS as alterações não preparadas, incluindo arquivos novos? Isso não pode ser desfeito.', 'Descartar tudo'))) return;
      return this.op('Descartar tudo', async () => {
        await this.repo.run(['restore', '--worktree', '.']).catch(() => {});
        await this.repo.run(['clean', '-fd', '-q']);
      });
    }

    stageHunk(file, hunk) {
      return this.op('Stage do hunk', () => this.repo.applyPatch(hunkPatch(file, hunk), { cached: true }));
    }

    unstageHunk(file, hunk) {
      return this.op('Unstage do hunk', () => this.repo.applyPatch(hunkPatch(file, hunk), { cached: true, reverse: true }));
    }

    async discardHunk(file, hunk) {
      if (!(await confirmBox('Descartar hunk', 'Descartar este trecho de alterações? Isso não pode ser desfeito.', 'Descartar'))) return;
      return this.op('Descartar hunk', () => this.repo.applyPatch(hunkPatch(file, hunk), { cached: false, reverse: true }));
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
      const ok = await this.op('Commit', () => this.repo.run(args, msg));
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
      return this.op('Desfazer commit', () => this.repo.run(['reset', '--soft', 'HEAD~1']));
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
      return this.op('Stash', () => this.repo.run(['stash', 'push', '--include-untracked', '-m', `WIP antes de ${name}`]), { success: 'Alterações guardadas no stash' });
    }

    async checkout(name) {
      const b = this.data.refs.local.find((x) => x.name === name);
      if (b?.current) return b.behind ? this.pull() : undefined;
      const how = await this.confirmSwitchWithWip(name);
      if (!how) return;
      if (how === 'stash' && !(await this.stashThenSwitch(name))) return;
      const behind = !!(b && b.behind);
      const ok = await this.op(`Checkout de ${name}`, () => this.repo.run(['switch', name]), { success: behind ? undefined : `Agora em ${name}` });
      if (ok && behind) return this.pull();
    }

    async checkoutRemote(full) {
      const name = full.slice(full.indexOf('/') + 1);
      const local = this.data.refs.local.find((b) => b.name === name);
      if (local) return this.checkout(name);
      const how = await this.confirmSwitchWithWip(name);
      if (!how) return;
      if (how === 'stash' && !(await this.stashThenSwitch(name))) return;
      return this.op(`Checkout de ${full}`, () => this.repo.run(['switch', '--track', '-c', name, full]), { success: `Branch ${name} criada rastreando ${full}` });
    }

    async checkoutCommit(sha) {
      if (!(await confirmBox('Checkout de commit', `Fazer checkout de ${sha.slice(0, 7)}? Você ficará em modo "detached HEAD".`, 'Checkout'))) return;
      return this.op('Checkout', () => this.repo.run(['switch', '--detach', sha]));
    }

    async createBranch(from) {
      const r = await form('Nova branch', [
        { name: 'name', label: 'Nome da branch', placeholder: 'feature/minha-branch' },
        { name: 'checkout', label: 'Fazer checkout depois de criar', type: 'checkbox', value: true },
      ], { ok: 'Criar', message: from ? `A partir de ${from.slice(0, 12)}` : 'A partir do HEAD atual' });
      if (!r || !r.name.trim()) return;
      const name = r.name.trim().replace(/\s+/g, '-');
      const base = from || 'HEAD';
      return this.op('Criar branch', () => this.repo.run(r.checkout ? ['switch', '-c', name, base] : ['branch', name, base]), { success: `Branch ${name} criada` });
    }

    async renameBranch(name) {
      const nn = await prompt('Renomear branch', 'Novo nome', name, { ok: 'Renomear' });
      if (!nn || nn === name) return;
      return this.op('Renomear branch', () => this.repo.run(['branch', '-m', name, nn]));
    }

    async deleteBranch(name) {
      if (!(await confirmBox('Excluir branch', `Excluir a branch local "${name}"?`, 'Excluir'))) return;
      const ok = await this.op('Excluir branch', () => this.repo.run(['branch', '-d', name]), { quiet: true });
      if (ok) return;
      if (await confirmBox('Branch não mesclada', `"${name}" tem commits que não estão em outra branch. Excluir mesmo assim?`, 'Forçar exclusão'))
        return this.op('Excluir branch', () => this.repo.run(['branch', '-D', name]));
    }

    async merge(name) {
      const cur = this.data.head.branch || 'HEAD';
      return this.op(`Merge de ${name} em ${cur}`, async () => {
        const r = await this.repo.raw(['merge', '--no-edit', name]);
        if (r.code !== 0) {
          if (/CONFLICT/.test(r.stdout + r.stderr)) {
            toast('Merge com conflitos. Resolva os arquivos marcados no painel à direita.', 'error');
            this.selected = 'WIP';
            return;
          }
          throw new Error(r.stderr || r.stdout);
        }
        toast(`Merge de ${name} concluído`);
      });
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
      });
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
      if (dst === this.data.head.branch) return this.op(`Fast-forward de ${dst}`, () => this.repo.run(['merge', '--ff-only', srcRef]), { success: `${dst} avançou até ${src.name}` });
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
      });
    }

    async revert(sha) {
      if (!(await confirmBox('Reverter commit', `Criar um novo commit que desfaz ${sha.slice(0, 7)}?`, 'Reverter'))) return;
      return this.op('Revert', async () => {
        const r = await this.repo.raw(['revert', '--no-edit', sha]);
        if (r.code !== 0) {
          if (/conflict/i.test(r.stdout + r.stderr)) return toast('Revert com conflitos. Resolva e clique em "Continuar".', 'error');
          throw new Error(r.stderr || r.stdout);
        }
      });
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
      if (r.mode === 'hard' && !(await confirmBox('Reset hard', 'Todas as alterações não commitadas serão perdidas. Continuar?', 'Sim, descartar'))) return;
      return this.op('Reset', () => this.repo.run(['reset', `--${r.mode}`, sha]));
    }

    async createTag(sha) {
      const r = await form('Nova tag', [
        { name: 'name', label: 'Nome da tag', placeholder: 'v1.0.0' },
        { name: 'message', label: 'Mensagem (deixe vazio para tag leve)' },
      ], { ok: 'Criar', message: `No commit ${sha === 'HEAD' ? 'HEAD' : sha.slice(0, 7)}` });
      if (!r || !r.name.trim()) return;
      const args = r.message.trim() ? ['tag', '-a', r.name.trim(), '-m', r.message.trim(), sha] : ['tag', r.name.trim(), sha];
      return this.op('Criar tag', () => this.repo.run(args), { success: `Tag ${r.name.trim()} criada` });
    }

    async deleteTag(name) {
      if (!(await confirmBox('Excluir tag', `Excluir a tag local "${name}"?`, 'Excluir'))) return;
      return this.op('Excluir tag', () => this.repo.run(['tag', '-d', name]));
    }

    async pushTag(name) {
      const remote = await this.pickRemote();
      if (!remote) return;
      return this.op('Push da tag', () => this.repo.run(['push', remote, `refs/tags/${name}`]), { success: `Tag ${name} enviada para ${remote}` });
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

    // Fetch de fundo: não trava a barra com "Fetch..." (o manual continua com spinner).
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
      if (this.busy || this.fetching) return;
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
      });
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

    async removeRemote(name) {
      if (!(await confirmBox('Remover remoto', `Remover o remoto "${name}" (não apaga nada no servidor)?`, 'Remover'))) return;
      return this.op('Remover remoto', () => this.repo.run(['remote', 'remove', name]));
    }

    async deleteRemoteBranch(remote, name) {
      if (!(await confirmBox('Excluir branch remota', `Excluir "${name}" em "${remote}"? Isso apaga a branch no servidor.`, 'Excluir no servidor'))) return;
      return this.op('Excluir branch remota', () => this.repo.run(['push', remote, '--delete', name]));
    }

    // ---------- stash ----------
    async stash() {
      if (!this.hasWip()) return toast('Não há alterações para guardar.');
      const msg = await prompt('Stash', 'Mensagem (opcional)', '', { ok: 'Guardar' });
      if (msg === null) return;
      const args = ['stash', 'push', '--include-untracked'];
      if (msg) args.push('-m', msg);
      return this.op('Stash', () => this.repo.run(args), { success: 'Alterações guardadas no stash' });
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
        !isCur && cur && { label: `Rebase de ${cur} sobre ${name}`, action: () => this.rebase(name) },
        isCur && { label: 'Pull', action: () => this.pull() },
        isCur && { label: 'Push', action: () => this.push() },
        '-',
        { label: 'Criar branch a partir daqui', action: () => this.createBranch(name) },
        { label: 'Criar tag aqui', action: () => this.createTag(name) },
        { label: 'Renomear...', action: () => this.renameBranch(name) },
        b && b.upstream && { label: `Upstream: ${b.upstream}`, disabled: true, action: () => {} },
        '-',
        { label: 'Copiar nome', action: () => this.copy(name) },
        !isCur && { label: 'Excluir branch', danger: true, action: () => this.deleteBranch(name) },
      ];
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
        cur && { label: `Rebase de ${cur} sobre ${full}`, action: () => this.rebase(full) },
        '-',
        { label: 'Copiar nome', action: () => this.copy(full) },
        { label: 'Excluir no servidor', danger: true, action: () => this.deleteRemoteBranch(remote, name) },
      ];
    }

    remoteMenu(remote) {
      return [
        { label: `Fetch de ${remote}`, action: () => this.op('Fetch', () => this.repo.run(['fetch', '--prune', remote])) },
        { label: 'Copiar URL', action: async () => this.copy((await this.repo.run(['remote', 'get-url', remote])).trim()) },
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
      ];
    }

    stashMenu(s) {
      return [
        { label: 'Aplicar', action: () => this.stashApply(s.ref) },
        { label: 'Aplicar e remover (pop)', action: () => this.stashPop(s.ref) },
        '-',
        { label: 'Excluir', danger: true, action: () => this.stashDrop(s.ref) },
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
        '-',
        { label: 'Copiar SHA', action: () => this.copy(c.sha) },
        { label: 'Copiar mensagem', action: () => this.copy(c.subject) },
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
      setInterval(() => {
        if (!document.hasFocus() || document.querySelector('.modal-back')) return;
        const t = this.repoTab();
        if (t) t.fetchOnOpen({ background: true });
      }, 5000);
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
      for (const p of s.openTabs || []) {
        const v = await polvo.repo.validate(p);
        if (v.ok) this.addTab(new RepoTab(this, v.root), false);
      }
      if (!this.tabs.length) this.newTab();
      else this.activate(this.tabs[Math.min(s.activeTab || 0, this.tabs.length - 1)]);
      await this.maybeOpenWhatsNew();
    }

    notesFingerprint(md) {
      const m = /^##\s+(.+)$/m.exec(String(md || '').replace(/<!--[\s\S]*?-->/g, ''));
      return m ? m[1].trim() : '';
    }

    async maybeOpenWhatsNew() {
      try {
        const [info, md] = await Promise.all([polvo.appInfo(), polvo.whatsNew()]);
        const s = this.settings || {};
        const fp = this.notesFingerprint(md);
        const firstRun = !s.lastVersion && !(s.recent && s.recent.length) && !(s.openTabs && s.openTabs.length);
        if (s.lastVersion === info.version || firstRun) {
          if (firstRun) polvo.settings.set({ lastVersion: info.version, seenWhatsNew: fp });
          return;
        }
        polvo.settings.set({ lastVersion: info.version, seenWhatsNew: fp });
        if (md && md.replace(/<!--[\s\S]*?-->/g, '').trim()) this.addTab(new NotesTab(this, md, info.version));
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
          ['Desfazer último commit', 'repo:undo'],
          ['Nova tag no HEAD', 'repo:tag'],
          ['Adicionar remoto', 'repo:addRemote'],
          ['Abrir terminal', 'repo:terminal'],
          ['Abrir pasta', 'repo:reveal'],
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
          return t.undoCommit();
        case 'repo:tag':
          return t.createTag('HEAD');
        case 'repo:addRemote':
          return t.addRemote();
        case 'repo:terminal':
          return polvo.terminal(t.repo.root);
        case 'repo:reveal':
          return polvo.reveal(t.repo.root);
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
      if (inField || !t) return;
      if (e.key === 'Escape' && t.view.type !== 'graph') return t.closeView();
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
