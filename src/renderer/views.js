'use strict';

// Renderização das áreas de uma aba de repositório. Cada função recebe a aba
// (RepoTab, definida em app.js) e lê o estado dela; ações chamam métodos da aba.

(() => {
  const { h, svg, laneColor, avatar, relDate, fullDate, showMenu, openModal } = window.UI;
  const HL = window.Highlight;
  const LW = 24;
  const NODE = 20; // diâmetro da foto no nó do grafo
  const CORNER = 12; // raio das dobras das linhas do grafo
  const STASH_COLOR = '#e3b341';
  const ICON_LAPTOP =
    '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3" y="3.5" width="10" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1 12.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // ícone de remoto: cubo laranja
  const ICON_CLOUD =
    '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1.6l5.6 3.1v6.6L8 14.4l-5.6-3.1V4.7z" fill="none" stroke="#f0883e" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.6 4.8L8 7.8l5.4-3M8 7.8v6.4" fill="none" stroke="#f0883e" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const ICON_TAG =
    '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 2h6l6 6-6 6-6-6z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/></svg>';
  const ICON_EYE =
    '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
  const ICON_EYE_OFF =
    '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const icon = (svgText) => h('span', { class: 'bi', html: svgText });
  const graphWidth = (maxLanes) => Math.max(64, maxLanes * LW + 10);
  const ROW_H = 28;

  const STATUS_LABEL = { A: 'Adicionado', M: 'Modificado', D: 'Removido', R: 'Renomeado', C: 'Copiado', T: 'Tipo alterado', U: 'Conflito' };

  const STATUS_SVG = {
    M: '<path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    A: '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    D: '<path d="M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    R: '<path d="M3 8h9M9 4.5L12.5 8 9 11.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    C: '<rect x="5" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10V3h7" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    T: '<path d="M3 4h10M8 4v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    U: '<path d="M8 3v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="12.5" r="1.2" fill="currentColor"/>',
  };

  function statusIcon(s) {
    return h('span', { class: `sti sti-${s}`, title: STATUS_LABEL[s] || s, html: `<svg viewBox="0 0 16 16" width="14" height="14">${STATUS_SVG[s] || STATUS_SVG.M}</svg>` });
  }

  // "pasta/sub/" esmaecido + "arquivo.ext" em destaque
  function pathLabel(p) {
    const i = p.lastIndexOf('/');
    return h('span', { class: 'fpath' }, i >= 0 ? h('span', { class: 'fdir' }, p.slice(0, i + 1)) : null, h('span', { class: 'fname' }, p.slice(i + 1)));
  }

  // ---------- estrutura ----------
  // Arrastar uma branch (etiqueta do grafo ou item da barra lateral) e soltar em
  // outra abre o menu de ações (merge, rebase, fast-forward, push, PR).
  function parseRef(raw) {
    const i = raw.indexOf(':');
    return { type: raw.slice(0, i), name: raw.slice(i + 1) };
  }

  function installRefDnD(tab, container) {
    let over = null;
    const clear = () => {
      if (over) over.classList.remove('drop-target');
      over = null;
    };
    container.addEventListener('dragstart', (e) => {
      const el = e.target.closest && e.target.closest('[data-ref]');
      if (!el) return;
      tab.dragRef = el.dataset.ref;
      e.dataTransfer.setData('application/x-polvo-ref', el.dataset.ref);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
      document.body.classList.add('ref-dragging');
    });
    container.addEventListener('dragend', (e) => {
      const el = e.target.closest && e.target.closest('[data-ref]');
      if (el) el.classList.remove('dragging');
      document.body.classList.remove('ref-dragging');
      tab.dragRef = null;
      clear();
    });
    container.addEventListener('dragover', (e) => {
      const el = e.target.closest && e.target.closest('[data-ref]');
      if (!tab.dragRef || !el || el.dataset.ref === tab.dragRef) {
        clear();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== el) {
        clear();
        over = el;
        el.classList.add('drop-target');
      }
    });
    container.addEventListener('dragleave', (e) => {
      if (over && !over.contains(e.relatedTarget)) clear();
    });
    container.addEventListener('drop', (e) => {
      const el = e.target.closest && e.target.closest('[data-ref]');
      const src = tab.dragRef || e.dataTransfer.getData('application/x-polvo-ref');
      clear();
      if (!el || !src || el.dataset.ref === src) return;
      e.preventDefault();
      tab.dropRef(parseRef(src), parseRef(el.dataset.ref), e.clientX, e.clientY);
    });
  }

  function buildLayout(tab) {
    const els = (tab.els = {});
    // clique fora fecha a lista "+N" fixada
    document.addEventListener('mousedown', (e) => {
      if (tab.moreOpen && !e.target.closest('.badge-more')) {
        tab.moreOpen = null;
        renderGraphRows(tab);
      }
    });
    els.toolbar = h('div', { class: 'toolbar' });
    els.pushAsk = h('div', { class: 'push-ask hidden' });
    els.banner = h('div', { class: 'banner hidden' });
    els.left = h('div', { class: 'left' });
    els.center = h('div', { class: 'center' });
    els.right = h('div', { class: 'right' });
    const resizer = (panel, side) => {
      const r = h('div', { class: 'resizer' });
      r.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = panel.getBoundingClientRect().width;
        const move = (ev) => {
          const dx = ev.clientX - startX;
          panel.style.width = Math.max(180, Math.min(700, startW + (side === 'left' ? dx : -dx))) + 'px';
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          if (tab.view.type === 'graph') renderGraphRows(tab);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      return r;
    };
    els.leftResizer = resizer(els.left, 'left');
    els.rightResizer = resizer(els.right, 'right');
    els.main = h('div', { class: 'main' }, els.left, els.leftResizer, els.center, els.rightResizer, els.right);
    tab.page.append(els.toolbar, els.pushAsk, els.banner, els.main);
    installRefDnD(tab, els.left);
    installRefDnD(tab, els.center);
    renderToolbar(tab);
  }

  // ---------- toolbar ----------
  // Ícones SVG de traço fino, no lugar dos caracteres Unicode.
  function tbSvg(inner) {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  const TB = {
    undo: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.35"/><path d="M4.5 4.6v5.3h5.3"/>',
    redo: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.35"/><path d="M19.5 4.6v5.3h-5.3"/>',
    pull: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    push: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    fetch: '<path d="M20.5 3.2v5h-5"/><path d="M4 12a8 8 0 0 1 13.7-5.6L20.5 8.2"/><path d="M3.5 20.8v-5h5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L3.5 15.8"/>',
    branch:
      '<circle cx="6.5" cy="5.5" r="2.2" fill="currentColor" stroke="none"/><circle cx="6.5" cy="18.5" r="2.2" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="2.2" fill="currentColor" stroke="none"/><path d="M6.5 7.7v8.6"/><path d="M6.5 9.8c0 3.6 11 1.2 11 0.7"/>',
    stash: '<path d="M4 7.5h16l-2.2 5.2H6.2z"/><path d="M5.2 14h13.6L17 20.2H7z"/>',
    pop: '<path d="M5 12h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M12 14V4"/><path d="M8 8l4-4 4 4"/>',
    terminal: '<path d="M5 8l5 4-5 4"/><path d="M12 16h7"/>',
    folder: '<path d="M3.5 7.5h5.2l1.8 2H20.5v9.2a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M3.5 7.5V6.2A1.2 1.2 0 0 1 4.7 5h4.2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    caret: '<svg viewBox="0 0 8 8" width="8" height="8"><path d="M1.6 2.6l2.4 2.8 2.4-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function tbButton(icon, label, title, onclick) {
    const ico = h('span', { class: 'ico', html: tbSvg(icon) });
    const text = Array.isArray(label) ? h('span', { class: 'tb-label' }, ...label) : label;
    return h('button', { class: 'tb-btn', title, onclick }, ico, text);
  }

  // Mini polvo da splash: tentáculos mexem e puxam os bloquinhos enquanto o Git trabalha.
  function polvoBusySvg() {
    return h(
      'span',
      {
        class: 'polvo-busy-wrap',
        html: `<svg class="polvo-busy" viewBox="20 28 216 214" aria-hidden="true">
          <g class="pb-tents">
            <g class="pb-t t1"><path d="M78 140 C60 170 40 175 34 200"/><circle class="dot" cx="34" cy="200" r="9" fill="#e3b341"/></g>
            <g class="pb-t t2"><path d="M100 150 C95 185 80 200 82 222"/><circle class="dot" cx="82" cy="222" r="9" fill="#34d1bf"/></g>
            <g class="pb-t t3"><path d="M128 154 C128 190 128 205 128 226"/><circle class="dot" cx="128" cy="226" r="9" fill="#e0675f"/></g>
            <g class="pb-t t4"><path d="M156 150 C161 185 176 200 174 222"/><circle class="dot" cx="174" cy="222" r="9" fill="#a463f2"/></g>
            <g class="pb-t t5"><path d="M178 140 C196 170 216 175 222 200"/><circle class="dot" cx="222" cy="200" r="9" fill="#5b8def"/></g>
          </g>
          <g class="pb-body">
            <path d="M128 36 C178 36 196 76 196 108 C196 140 168 156 128 156 C88 156 60 140 60 108 C60 76 78 36 128 36 Z"/>
            <g class="pb-eyes">
              <circle cx="106" cy="104" r="12" fill="#1b1e24"/>
              <circle cx="150" cy="104" r="12" fill="#1b1e24"/>
              <circle cx="110" cy="100" r="4" fill="#fff"/>
              <circle cx="154" cy="100" r="4" fill="#fff"/>
            </g>
          </g>
        </svg>`,
      }
    );
  }

  function pullOptions(tab) {
    return [
      { label: 'Pull (merge se necessário)', action: () => tab.pull('merge') },
      { label: 'Pull (somente fast-forward)', action: () => tab.pull('ff-only') },
      { label: 'Pull (rebase)', action: () => tab.pull('rebase') },
    ];
  }

  function renderToolbar(tab) {
    const t = tab.els.toolbar;
    t.innerHTML = '';
    const head = tab.data.head || {};
    const current = head.detached ? `HEAD (${head.sha})` : head.branch || '—';
    const localCur = (tab.data.refs?.local || []).find((b) => b.current);
    const pullCaret = h('span', {
      class: 'tb-caret',
      title: 'Opções de pull',
      html: TB.caret,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, pullOptions(tab));
      },
    });
    const pullBtn = tbButton(TB.pull, ['Pull' + (localCur?.behind ? ` (${localCur.behind})` : ''), pullCaret], 'Pull', () => tab.pull());
    // três grupos: identificação à esquerda, comandos centralizados, busca à direita
    const left = h('div', { class: 'tb-left' });
    const center = h('div', { class: 'tb-center' });
    const right = h('div', { class: 'tb-right' });
    t.append(left, center, right);
    left.append(
      h('div', { class: 'repo-label', title: tab.repo.root }, h('span', { class: 'lbl' }, 'repositório'), h('span', { class: 'val' }, tab.repo.name)),
      h(
        'div',
        {
          class: 'repo-label link',
          title: 'Trocar de branch',
          style: { cursor: 'pointer' },
          onclick: () => tab.app.paletteBranches(tab),
        },
        h('span', { class: 'lbl' }, 'branch'),
        h('span', { class: 'val' }, '⎇ ', current)
      )
    );
    if (tab.busy) {
      left.append(h('div', { class: 'branch-busy', role: 'status', title: tab.busy }, polvoBusySvg(), h('span', { class: 'branch-busy-msg' }, tab.busy)));
    }
    center.append(
      tbButton(
        TB.undo,
        'Desfazer',
        tab.undoStack.length ? `Desfazer ${tab.undoStack[tab.undoStack.length - 1].label} (Ctrl+Z)` : 'Desfazer último commit, mantendo as alterações (Ctrl+Z)',
        () => tab.undo()
      ),
      (() => {
        const last = tab.redoStack[tab.redoStack.length - 1];
        const b = tbButton(TB.redo, 'Refazer', last ? `Refazer ${last.label} (Ctrl+Shift+Z)` : 'Nada para refazer', () => tab.redo());
        b.disabled = !last;
        return b;
      })(),
      h('div', { class: 'tb-sep' }),
      pullBtn,
      tbButton(TB.push, 'Push' + (localCur?.ahead ? ` (${localCur.ahead})` : ''), 'Push', () => tab.push()),
      tbButton(TB.fetch, 'Fetch', 'Fetch de todos os remotos (Ctrl+L)', () => tab.fetch()),
      h('div', { class: 'tb-sep' }),
      tbButton(TB.branch, 'Branch', 'Nova branch (Ctrl+B)', () => tab.createBranch()),
      tbButton(TB.stash, 'Stash', 'Guardar alterações no stash', () => tab.stash()),
      tbButton(TB.pop, 'Pop', 'Aplicar e remover o último stash', () => tab.stashPop()),
      h('div', { class: 'tb-sep' }),
      tbButton(TB.terminal, 'Terminal', 'Abrir terminal externo nesta pasta', () => window.polvo.terminal(tab.repo.root)),
      tbButton(TB.folder, 'Pasta', 'Abrir no gerenciador de arquivos', () => window.polvo.reveal(tab.repo.root))
    );
    pullBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, pullOptions(tab));
    });
    const search = h('input', { class: 'search', placeholder: 'Buscar commits (Ctrl+F)', spellcheck: 'false' });
    search.value = tab.search || '';
    search.addEventListener('input', () => {
      tab.setSearch(search.value);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tab.nextMatch(e.shiftKey ? -1 : 1);
      if (e.key === 'Escape') {
        search.value = '';
        tab.setSearch('');
        search.blur();
      }
    });
    tab.els.search = search;
    right.append(
      search,
      h('button', { class: 'icon-btn prefs-btn', title: 'Preferências (Ctrl+,)', html: tbSvg(TB.gear), onclick: () => tab.app.openPreferences() })
    );
  }

  function renderBanner(tab) {
    const b = tab.els.banner;
    const st = tab.data.state;
    if (!st || st === 'clean') {
      b.classList.add('hidden');
      return;
    }
    const names = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };
    b.innerHTML = '';
    b.classList.remove('hidden');
    const nConf = tab.data.status?.conflicts.length || 0;
    b.append(
      ...[
      h('span', {}, `⚠ ${names[st]} em andamento`, nConf ? ` — ${nConf} arquivo(s) em conflito` : ' — sem conflitos pendentes'),
      h('span', { class: 'spacer', style: { flex: 1 } }),
      st !== 'merge' ? h('button', { class: 'btn small', onclick: () => tab.sequencer('continue') }, 'Continuar') : null,
      st === 'rebase' ? h('button', { class: 'btn small', onclick: () => tab.sequencer('skip') }, 'Pular commit') : null,
      h('button', { class: 'btn small danger', onclick: () => tab.sequencer('abort') }, 'Abortar'),
      ].filter(Boolean)
    );
  }

  // ---------- painel esquerdo ----------
  function section(tab, key, title, count, items, extraHead) {
    const collapsed = tab.collapsed[key];
    const sec = h('div', { class: 'sec' + (collapsed ? ' collapsed' : '') });
    sec.append(
      h(
        'div',
        {
          class: 'sec-head',
          onclick: () => {
            tab.collapsed[key] = !tab.collapsed[key];
            sec.classList.toggle('collapsed');
          },
        },
        h('span', { class: 'caret' }, '▾'),
        title,
        h('span', { class: 'count' }, `(${count})`),
        h('span', { class: 'grow' }),
        extraHead
      ),
      h('div', { class: 'sec-body' }, items)
    );
    return sec;
  }

  // Botão de olho na lista da esquerda: esconde/mostra a ref no grafo.
  function eyeButton(tab, ref) {
    const hidden = tab.isHidden(ref);
    return h('button', {
      class: 'eye-btn' + (hidden ? ' on' : ''),
      title: hidden ? 'Mostrar no grafo' : 'Esconder no grafo',
      html: hidden ? ICON_EYE_OFF : ICON_EYE,
      onclick: (e) => {
        e.stopPropagation();
        tab.toggleHidden(ref);
      },
      ondblclick: (e) => e.stopPropagation(),
    });
  }

  function soloMark(tab, ref) {
    return tab.isSolo(ref) ? h('span', { class: 'solo-mark', title: 'Solo: o grafo mostra só as branches marcadas' }, 'solo') : null;
  }

  function renderLeft(tab) {
    const L = tab.els.left;
    const prevScroll = L.querySelector('.sections')?.scrollTop || 0;
    L.innerHTML = '';
    const filter = h('input', { class: 'filter', placeholder: 'Filtrar (Ctrl+Alt+F)', spellcheck: 'false' });
    filter.value = tab.leftFilter || '';
    filter.addEventListener('input', () => {
      tab.leftFilter = filter.value;
      renderLeft(tab);
      const f = tab.els.left.querySelector('.filter');
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    });
    tab.els.leftFilter = filter;
    const q = (tab.leftFilter || '').toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);
    const { refs, stashes } = tab.data;
    if (!refs) return L.append(filter);

    const local = refs.local.filter((b) => match(b.name));
    const localItems = local.map((b) =>
      h(
        'div',
        {
          class: 'ref-item' + (b.current ? ' current' : '') + (tab.isHidden('refs/heads/' + b.name) ? ' ref-hidden' : ''),
          draggable: 'true',
          'data-ref': 'local:' + b.name,
          title: (b.upstream ? `${b.name} → ${b.upstream}` : b.name) + (b.behind ? (b.current ? '\nDuplo clique: pull' : '\nDuplo clique: checkout e pull') : ''),
          onclick: () => tab.selectSha(b.sha),
          ondblclick: () => tab.checkout(b.name),
          oncontextmenu: (e) => {
            e.preventDefault();
            showMenu(e.clientX, e.clientY, tab.branchMenu(b.name));
          },
        },
        h('span', {}, b.current ? '✔' : '⑂'),
        h('span', { class: 'name' }, b.name),
        h(
          'span',
          { class: 'track' },
          b.gone ? h('span', { class: 'gone', title: 'upstream removido' }, '✕') : null,
          b.behind ? `↓${b.behind} ` : '',
          b.ahead ? `↑${b.ahead}` : ''
        ),
        soloMark(tab, 'refs/heads/' + b.name),
        b.current ? h('span', { class: 'eye-slot' }) : eyeButton(tab, 'refs/heads/' + b.name)
      )
    );

    const remoteItems = [];
    let remoteCount = 0;
    for (const [remote, list] of Object.entries(refs.remotes)) {
      const shown = list.filter((b) => match(b.full));
      remoteCount += shown.length;
      if (!shown.length && q) continue;
      const key = 'remote:' + remote;
      const groupCollapsed = tab.collapsed[key];
      remoteItems.push(
        h(
          'div',
          {
            class: 'ref-item',
            onclick: () => {
              tab.collapsed[key] = !groupCollapsed;
              renderLeft(tab);
            },
            oncontextmenu: (e) => {
              e.preventDefault();
              showMenu(e.clientX, e.clientY, tab.remoteMenu(remote));
            },
          },
          h('span', {}, groupCollapsed ? '▸' : '▾'),
          h('span', { class: 'name' }, '☁ ' + remote),
          eyeButton(tab, `refs/remotes/${remote}/*`)
        )
      );
      if (!groupCollapsed) {
        for (const b of shown) {
          const local = refs.local.find((l) => l.name === b.name);
          remoteItems.push(
            h(
              'div',
              {
                class: 'ref-item sub' + (tab.isHidden('refs/remotes/' + b.full) ? ' ref-hidden' : ''),
                draggable: 'true',
                'data-ref': 'remote:' + b.full,
                title: local?.behind ? `${b.full}\nDuplo clique: ${local.current ? 'pull' : 'checkout e pull'}` : b.full,
                onclick: () => tab.selectSha(b.sha),
                ondblclick: () => tab.checkoutRemote(b.full),
                oncontextmenu: (e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, tab.remoteBranchMenu(remote, b.name));
                },
              },
              h('span', { class: 'name' }, b.name),
              soloMark(tab, 'refs/remotes/' + b.full),
              eyeButton(tab, 'refs/remotes/' + b.full)
            )
          );
        }
      }
    }

    const tags = refs.tags.filter((t) => match(t.name));
    const tagItems = tags.map((t) =>
      h(
        'div',
        {
          class: 'ref-item',
          onclick: () => tab.selectSha(t.sha),
          oncontextmenu: (e) => {
            e.preventDefault();
            showMenu(e.clientX, e.clientY, tab.tagMenu(t.name));
          },
        },
        h('span', {}, '🏷'),
        h('span', { class: 'name' }, t.name)
      )
    );

    const st = (stashes || []).filter((s) => match(s.msg));
    const stashItems = st.map((s) =>
      h(
        'div',
        {
          class: 'ref-item',
          title: s.ref,
          onclick: () => tab.selectStash(s),
          oncontextmenu: (e) => {
            e.preventDefault();
            showMenu(e.clientX, e.clientY, tab.stashMenu(s));
          },
        },
        h('span', {}, '⤓'),
        h('span', { class: 'name' }, s.msg)
      )
    );

    const add = (title, fn) =>
      h(
        'button',
        {
          class: 'icon-btn',
          title,
          onclick: (e) => {
            e.stopPropagation();
            fn();
          },
        },
        '+'
      );

    const sections = h(
      'div',
      { class: 'sections' },
      section(tab, 'local', 'Local', local.length, localItems, add('Nova branch', () => tab.createBranch())),
      section(
        tab,
        'remote',
        'Remoto',
        remoteCount,
        remoteItems,
        h(
          'span',
          { class: 'sec-tools' },
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Escolher quais remotos aparecem no grafo',
              html: ICON_EYE,
              onclick: (e) => {
                e.stopPropagation();
                showMenu(e.clientX, e.clientY, tab.remotesFilterMenu());
              },
            }
          ),
          add('Adicionar remoto', () => tab.addRemote())
        )
      ),
      section(tab, 'tags', 'Tags', tags.length, tagItems, add('Nova tag no HEAD', () => tab.createTag('HEAD'))),
      section(tab, 'stashes', 'Stashes', st.length, stashItems)
    );
    L.append(filter, sections);
    sections.scrollTop = prevScroll;
  }

  // ---------- grafo ----------
  const laneX = (i) => i * LW + LW / 2 + 5;

  // Desenha as linhas de uma linha do grafo. O nó de commits comuns é a foto do
  // autor (elemento HTML sobreposto, ver nodeAvatar); merges viram um ponto.
  function rowSvg(g, maxLanes, opts = {}) {
    const W = Math.max(graphWidth(maxLanes), opts.colWidth || 0);
    const H = ROW_H;
    const mid = H / 2;
    const X = laneX;
    const xc = X(g.col);
    const color = laneColor(g.col);
    const s = svg('svg', { width: W, height: H });
    if (opts.wip) {
      if (g.lineDown) s.append(svg('line', { x1: xc, y1: mid + NODE / 2, x2: xc, y2: H, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '3 3' }));
      s.append(svg('circle', { cx: xc, cy: mid, r: NODE / 2 - 1, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': '3 2.5' }));
      return s;
    }
    if (opts.stash) {
      // linha tracejada do stash até o commit de onde ele saiu (na linha de baixo)
      const dashed = (d, stroke) => s.append(svg('path', { d, stroke, 'stroke-width': 2, fill: 'none', 'stroke-dasharray': '3 3' }));
      for (const i of g.pass) s.append(svg('line', { x1: X(i), y1: 0, x2: X(i), y2: H, stroke: laneColor(i), 'stroke-width': 2 }));
      if (g.wipPass != null) dashed(`M ${X(g.wipPass)} 0 L ${X(g.wipPass)} ${H}`, laneColor(g.wipPass));
      if (g.lineUp) dashed(`M ${xc} 0 L ${xc} ${mid - NODE / 2}`, STASH_COLOR);
      if (g.toCol === g.col) dashed(`M ${xc} ${mid + NODE / 2} L ${xc} ${H}`, STASH_COLOR);
      else {
        const xj = X(g.toCol);
        const dir = Math.sign(xj - xc);
        const r = Math.min(CORNER, Math.abs(xj - xc), mid);
        dashed(`M ${xc + (dir * NODE) / 2} ${mid} L ${xj - dir * r} ${mid} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${xj} ${mid + r} L ${xj} ${H}`, STASH_COLOR);
      }
      s.append(svg('circle', { cx: xc, cy: mid, r: NODE / 2 - 1, fill: 'none', stroke: STASH_COLOR, 'stroke-width': 2, 'stroke-dasharray': '3 2.5' }));
      return s;
    }
    // faixa translúcida da cor da linha, do nó até a mensagem
    s.append(svg('rect', { x: xc, y: 3, width: Math.max(0, W - xc), height: H - 6, fill: color, opacity: opts.selected ? 0.45 : 0.16 }));
    if (opts.hasRefs) s.append(svg('line', { x1: 0, y1: mid, x2: xc, y2: mid, stroke: color, 'stroke-width': 1.5 }));
    else if (opts.ghost) s.append(svg('line', { class: 'ghost-line', x1: 0, y1: mid, x2: xc, y2: mid, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }));
    for (const i of g.pass) s.append(svg('line', { x1: X(i), y1: 0, x2: X(i), y2: H, stroke: laneColor(i), 'stroke-width': 2 }));
    // Cantos arredondados: trecho reto + arco de raio fixo só na dobra.
    const R = (dx) => Math.min(CORNER, Math.abs(dx), mid);
    const edge = (d, color) => s.append(svg('path', { d, stroke: color, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    for (const i of g.incoming) {
      if (i === g.col) {
        edge(`M ${xc} 0 L ${xc} ${mid}`, laneColor(i));
        continue;
      }
      // desce pela linha i e vira na horizontal até o nó
      const xi = X(i);
      const r = R(xc - xi);
      const dir = Math.sign(xc - xi);
      edge(`M ${xi} 0 L ${xi} ${mid - r} A ${r} ${r} 0 0 ${dir < 0 ? 1 : 0} ${xi + dir * r} ${mid} L ${xc} ${mid}`, laneColor(i));
    }
    for (const j of g.parentCols) {
      if (j === g.col) {
        edge(`M ${xc} ${mid} L ${xc} ${H}`, laneColor(j));
        continue;
      }
      // sai do nó na horizontal e dobra para baixo na linha j
      const xj = X(j);
      const r = R(xj - xc);
      const dir = Math.sign(xj - xc);
      edge(`M ${xc} ${mid} L ${xj - dir * r} ${mid} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${xj} ${mid + r} L ${xj} ${H}`, laneColor(j));
    }
    if (g.stashIn) s.append(svg('line', { x1: xc, y1: 0, x2: xc, y2: mid, stroke: STASH_COLOR, 'stroke-width': 2, 'stroke-dasharray': '3 3' }));
    if (g.isMerge) s.append(svg('circle', { cx: xc, cy: mid, r: 5, fill: color }));
    else s.append(svg('circle', { cx: xc, cy: mid, r: NODE / 2 + 2, fill: color }));
    return s;
  }

  function nodeAvatar(tab, c, g) {
    const el = avatar(c.author, c.email, false, tab.avatarCtx(c.sha));
    el.classList.add('node-avatar');
    el.style.left = laneX(g.col) - NODE / 2 + 'px';
    el.style.top = (ROW_H - NODE) / 2 + 'px';
    return el;
  }

  // Etiqueta esmaecida com a branch da linha, visível no hover/seleção.
  function ghostBadge(tab, owner, col) {
    if (!owner) return null;
    const color = laneColor(col);
    const refs = tab.data.refs || { local: [], remotes: {} };
    const isLocal = refs.local.some((b) => b.name === owner);
    const isRemote = Object.values(refs.remotes).some((list) => list.some((b) => b.name === owner));
    const isHead = tab.data.head && tab.data.head.branch === owner;
    return h(
      'span',
      {
        class: 'badge ghost',
        style: { background: `color-mix(in srgb, ${color} 22%, var(--bg))` },
        title: isLocal || isRemote ? `Commit na linha da branch ${owner}` : `Commit na linha da branch ${owner} (já removida)`,
      },
      isHead ? '✓ ' : '',
      h('span', { class: 'bname' }, owner),
      isLocal ? icon(ICON_LAPTOP) : null,
      isRemote ? icon(ICON_CLOUD) : null
    );
  }

  function refBadges(tab, c, col) {
    const color = laneColor(col);
    const locals = new Set(c.refs.filter((r) => r.type === 'local' || r.type === 'head').map((r) => r.name));
    const out = [];
    for (const r of c.refs) {
      if (r.type === 'remote') {
        const short = r.name.slice(r.name.indexOf('/') + 1);
        if (locals.has(short)) continue; // já representado no badge local
        out.push(
          h(
            'span',
            {
              class: 'badge remote',
              draggable: 'true',
              'data-ref': 'remote:' + r.name,
              style: { background: `color-mix(in srgb, ${color} 35%, var(--bg))` },
              title: (() => {
                const short = r.name.slice(r.name.indexOf('/') + 1);
                const local = (tab.data.refs?.local || []).find((l) => l.name === short);
                return local?.behind ? `${r.name}\nDuplo clique: ${local.current ? 'pull' : 'checkout e pull'}` : r.name;
              })(),
              ondblclick: () => tab.checkoutRemote(r.name),
              oncontextmenu: (e) => {
                e.preventDefault();
                e.stopPropagation();
                const slash = r.name.indexOf('/');
                showMenu(e.clientX, e.clientY, tab.remoteBranchMenu(r.name.slice(0, slash), r.name.slice(slash + 1)));
              },
            },
            h('span', { class: 'bname' }, r.name.slice(r.name.indexOf('/') + 1)),
            icon(ICON_CLOUD)
          )
        );
      } else if (r.type === 'tag') {
        out.push(
          h(
            'span',
            {
              class: 'badge tag',
              title: 'tag ' + r.name,
              oncontextmenu: (e) => {
                e.preventDefault();
                e.stopPropagation();
                showMenu(e.clientX, e.clientY, tab.tagMenu(r.name));
              },
            },
            icon(ICON_TAG),
            r.name
          )
        );
      } else if (r.type === 'detached') {
        out.push(h('span', { class: 'badge head', style: { background: color } }, 'HEAD'));
      } else {
        const hasRemote = c.refs.some((x) => x.type === 'remote' && x.name.endsWith('/' + r.name));
        out.push(
          h(
            'span',
            {
              class: 'badge ' + (r.type === 'head' ? 'head' : 'local'),
              draggable: 'true',
              'data-ref': 'local:' + r.name,
              style: { background: `color-mix(in srgb, ${color} ${r.type === 'head' ? 62 : 35}%, var(--bg))` },
              title: (() => {
                const local = (tab.data.refs?.local || []).find((l) => l.name === r.name);
                const extra = local?.behind
                  ? local.current
                    ? '\nDuplo clique: pull'
                    : '\nDuplo clique: checkout e pull'
                  : hasRemote
                    ? ' (sincronizada com remoto)'
                    : '';
                return r.name + extra;
              })(),
              ondblclick: () => tab.checkout(r.name),
              oncontextmenu: (e) => {
                e.preventDefault();
                e.stopPropagation();
                showMenu(e.clientX, e.clientY, tab.branchMenu(r.name));
              },
            },
            r.type === 'head' ? '✓ ' : '',
            h('span', { class: 'bname' }, r.name),
            icon(ICON_LAPTOP),
            hasRemote ? icon(ICON_CLOUD) : null
          )
        );
      }
    }
    if (out.length <= 1) return out;
    // mostra a primeira (a atual vem antes) e "+N" com as demais no hover
    out.sort((a, b) => b.classList.contains('head') - a.classList.contains('head'));
    const [first, ...rest] = out;
    return [
      first,
      h(
        'span',
        {
          class: 'badge-more' + (tab.moreOpen === c.sha ? ' open' : ''),
          title: 'Clique para fixar a lista aberta',
          // clicar fixa a lista aberta (o hover sozinho fecha ao mover o mouse)
          onmousedown: (e) => e.stopPropagation(),
          onclick: (e) => {
            if (e.target.closest('.more-pop')) return;
            e.stopPropagation();
            tab.moreOpen = tab.moreOpen === c.sha ? null : c.sha;
            renderGraphRows(tab);
          },
        },
        `+${rest.length}`,
        h('div', { class: 'more-pop' }, rest)
      ),
    ];
  }

  // Larguras das colunas Branch/Tag e Grafo: ajustáveis arrastando o cabeçalho,
  // salvas nas configurações. O grafo é recortado quando há mais linhas que cabem.
  const colPrefs = { refs: null, graph: null, show: { author: false, date: false, sha: false } };
  const OPTIONAL_COLS = [
    ['author', 'Autor'],
    ['date', 'Data'],
    ['sha', 'SHA'],
  ];

  // Diff unificado ou lado a lado e "ignorar espaços", salvos nas configurações.
  const diffPrefs = { split: false, ignoreWs: false };

  function setDiffPrefs(split, ignoreWs = diffPrefs.ignoreWs) {
    diffPrefs.split = !!split;
    diffPrefs.ignoreWs = !!ignoreWs;
  }

  function setColumnPrefs(prefs) {
    const show = { ...colPrefs.show, ...((prefs && prefs.show) || {}) };
    Object.assign(colPrefs, prefs || {}, { show });
  }

  function columnsMenu(tab, e) {
    showMenu(e.clientX, e.clientY, [
      { label: 'Colunas', disabled: true, action: () => {} },
      ...OPTIONAL_COLS.map(([key, label]) => ({
        label: (colPrefs.show[key] ? '✓ ' : '\u2003') + label,
        action: () => {
          colPrefs.show[key] = !colPrefs.show[key];
          window.polvo.settings.set({ columns: { ...colPrefs } });
          renderGraph(tab);
        },
      })),
      '-',
      ...tab.remotesFilterMenu(),
    ]);
  }

  function columnWidths(tab) {
    return {
      refs: colPrefs.refs || 170,
      graph: colPrefs.graph || Math.min(graphWidth(tab.layout.maxLanes), 200),
    };
  }

  function applyColumnWidths(tab) {
    const w = columnWidths(tab);
    tab.els.center.style.setProperty('--refs-w', w.refs + 'px');
    tab.els.center.style.setProperty('--graph-w', w.graph + 'px');
    for (const [key] of OPTIONAL_COLS) tab.els.center.classList.toggle('hide-' + key, !colPrefs.show[key]);
    return w;
  }

  function colResizer(tab, key) {
    const r = h('div', { class: 'col-resize', title: 'Arraste para ajustar a largura' });
    r.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = columnWidths(tab)[key];
      const min = key === 'refs' ? 60 : 40;
      const move = (ev) => {
        colPrefs[key] = Math.max(min, Math.min(600, start + ev.clientX - startX));
        applyColumnWidths(tab);
        renderGraphRows(tab);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        window.polvo.settings.set({ columns: { ...colPrefs } });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    r.addEventListener('dblclick', () => {
      colPrefs[key] = null;
      applyColumnWidths(tab);
      renderGraphRows(tab);
      window.polvo.settings.set({ columns: { ...colPrefs } });
    });
    return r;
  }

  // Faixa acima do grafo quando há branches escondidas ou em solo.
  function filterBar(tab) {
    const f = tab.filters;
    if (!f || (!f.hidden.length && !f.solo.length)) return null;
    const short = (r) => r.replace(/^refs\/(heads|remotes)\//, '').replace(/\/\*$/, ' (remoto inteiro)');
    const text = f.solo.length
      ? `Solo: mostrando só ${f.solo.map(short).join(', ')}`
      : f.hidden.length === 1
        ? `1 branch escondida: ${short(f.hidden[0])}`
        : `${f.hidden.length} branches escondidas`;
    return h(
      'div',
      { class: 'graph-filter-bar', title: [...f.solo, ...f.hidden].map(short).join('\n') },
      h('span', { class: 'bi', html: ICON_EYE_OFF }),
      h('span', { class: 'grow ellip' }, text),
      h('button', { class: 'btn small', onclick: () => tab.clearFilters() }, 'Mostrar tudo')
    );
  }

  function renderGraph(tab) {
    const C = tab.els.center;
    C.innerHTML = '';
    const bar = filterBar(tab);
    if (bar) C.append(bar);
    const items = tab.rowItems();
    if (!items.length) {
      C.append(h('div', { class: 'empty' }, bar ? 'Nenhum commit nas branches escolhidas.' : 'Este repositório ainda não tem commits. Faça o primeiro commit pelo painel à direita.'));
      return;
    }
    applyColumnWidths(tab);
    const head = h(
      'div',
      { class: 'graph-head' },
      h('div', { class: 'col-refs head-cell' }, 'Branch / Tag', colResizer(tab, 'refs')),
      h('div', { class: 'col-graph head-cell' }, 'Grafo', colResizer(tab, 'graph')),
      h('div', { class: 'col-msg head-cell' }, 'Mensagem do commit'),
      h('div', { class: 'col-author' }, 'Autor'),
      h('div', { class: 'col-date' }, 'Data'),
      h('div', { class: 'col-sha' }, 'SHA'),
      h('button', { class: 'icon-btn cols-btn', title: 'Escolher colunas', onclick: (e) => columnsMenu(tab, e) }, '⚙')
    );
    const scroll = h('div', { class: 'graph-scroll', tabindex: '0' });
    const inner = h('div', { class: 'graph-inner', style: { height: (items.length + (tab.hasMoreCommits ? 1 : 0)) * ROW_H + 'px' } });
    scroll.append(inner);
    scroll.addEventListener('scroll', () => renderGraphRows(tab));
    C.append(head, scroll);
    tab.els.graphScroll = scroll;
    tab.els.graphInner = inner;
    scroll.scrollTop = tab.graphScrollTop || 0;
    renderGraphRows(tab);
  }

  function renderGraphRows(tab) {
    const scroll = tab.els.graphScroll;
    const inner = tab.els.graphInner;
    if (!scroll || !inner || !inner.isConnected) return;
    tab.graphScrollTop = scroll.scrollTop;
    const items = tab.rowItems();
    const first = Math.max(0, Math.floor(scroll.scrollTop / ROW_H) - 8);
    const last = Math.min(items.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW_H) + 8);
    const gw = applyColumnWidths(tab).graph;
    const q = (tab.search || '').trim().toLowerCase();
    inner.innerHTML = '';
    for (let i = first; i < last; i++) {
      const it = items[i];
      let row;
      if (it.type === 'stash') {
        const s = it.stash;
        const hit = q && it.searchText.includes(q);
        row = h(
          'div',
          {
            class: 'g-row stash-row' + (tab.selected === s.sha ? ' selected' : '') + (q ? (hit ? ' match' : ' dimmed') : ''),
            style: { top: i * ROW_H + 'px' },
            onclick: () => tab.selectStash(s),
            oncontextmenu: (e) => {
              e.preventDefault();
              tab.selectStash(s);
              showMenu(e.clientX, e.clientY, tab.stashMenu(s));
            },
          },
          h('div', { class: 'col-refs' }, h('span', { class: 'badge stash-badge', title: s.ref }, s.ref || 'stash')),
          h('div', { class: 'col-graph' }, rowSvg(it.g, tab.layout.maxLanes, { stash: true, colWidth: gw })),
          h('div', { class: 'col-msg' }, s.msg || s.ref || 'stash'),
          h('div', { class: 'col-author' }),
          h('div', { class: 'col-date' }),
          h('div', { class: 'col-sha mono' }, (s.sha || '').slice(0, 7))
        );
      } else if (it.type === 'wip') {
        const st = tab.data.status;
        const n = st.staged.length + st.unstaged.length + st.conflicts.length;
        row = h(
          'div',
          { class: 'g-row wip-row' + (tab.selected === 'WIP' ? ' selected' : ''), style: { top: i * ROW_H + 'px' }, onclick: () => tab.select('WIP') },
          h('div', { class: 'col-refs' }),
          h('div', { class: 'col-graph' }, rowSvg(it.g, tab.layout.maxLanes, { wip: true, colWidth: gw })),
          h('div', { class: 'col-msg' }, `// WIP — ${n} arquivo(s) alterado(s)`),
          h('div', { class: 'col-author' }),
          h('div', { class: 'col-date' }),
          h('div', { class: 'col-sha' })
        );
      } else {
        const c = it.c;
        const hit = q && it.searchText.includes(q);
        const sel = tab.isSelected(c.sha);
        row = h(
          'div',
          {
            class: 'g-row' + (sel ? ' selected' : '') + (q ? (hit ? ' match' : ' dimmed') : ''),
            style: { top: i * ROW_H + 'px' },
            onclick: (e) => tab.clickCommit(c.sha, e),
            oncontextmenu: (e) => {
              e.preventDefault();
              if (tab.multi.length && sel) return showMenu(e.clientX, e.clientY, tab.multiMenu());
              tab.select(c.sha);
              showMenu(e.clientX, e.clientY, tab.commitMenu(c));
            },
          },
          h(
            'div',
            { class: 'col-refs' },
            c.refs.length ? refBadges(tab, c, it.g.col) : ghostBadge(tab, it.owner, it.g.col),
            c.refs.length || it.owner ? h('span', { class: 'ref-line' + (c.refs.length ? '' : ' ghost'), style: { background: laneColor(it.g.col) } }) : null
          ),
          h(
            'div',
            { class: 'col-graph' },
            rowSvg(it.g, tab.layout.maxLanes, { hasRefs: c.refs.length > 0, ghost: !c.refs.length && !!it.owner, selected: sel, colWidth: gw }),
            it.g.isMerge ? null : nodeAvatar(tab, c, it.g)
          ),
          h(
            'div',
            { class: 'col-msg', title: c.bodyLine ? `${c.subject}\n\n${c.bodyLine}` : c.subject, style: { borderLeftColor: laneColor(it.g.col) } },
            c.subject,
            c.bodyLine ? h('span', { class: 'msg-body' }, c.bodyLine) : null
          ),
          h('div', { class: 'col-author' }, avatar(c.author, c.email, false, tab.avatarCtx(c.sha)), h('span', { class: 'ellip' }, c.author)),
          h('div', { class: 'col-date', title: fullDate(c.date) }, relDate(c.date)),
          h('div', { class: 'col-sha mono' }, c.sha.slice(0, 7))
        );
      }
      inner.append(row);
    }
    // fim do que foi lido: mostra a linha de espera e pede a próxima página
    if (tab.hasMoreCommits && last >= items.length) {
      inner.append(h('div', { class: 'g-row more-row', style: { top: items.length * ROW_H + 'px' } }, 'Carregando mais commits...'));
      tab.loadMoreCommits();
    }
  }

  function scrollToRow(tab, index) {
    const scroll = tab.els.graphScroll;
    if (!scroll) return;
    const top = index * ROW_H;
    if (top < scroll.scrollTop) scroll.scrollTop = top;
    else if (top + ROW_H > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top - scroll.clientHeight + ROW_H * 3;
    renderGraphRows(tab);
  }

  // ---------- painel direito ----------
  function fileRow(file, { onclick, actions, selected, oncontextmenu }) {
    return h(
      'div',
      { class: 'file-row' + (selected ? ' selected' : ''), onclick, oncontextmenu, title: file.from ? `${file.from} → ${file.path}` : file.path },
      file.status ? statusIcon(file.status) : h('span', { class: 'sti' }),
      file.label ? h('span', { class: 'fpath' }, h('span', { class: 'fname' }, file.label)) : pathLabel(file.path),
      actions ? h('span', { class: 'fact' }, actions) : null
    );
  }

  // Agrupa caminhos em pastas; pastas recolhíveis, estado guardado na aba.
  function renderTree(tab, container, files, sel, open, menu) {
    const root = { dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      node.files.push({ ...f, label: parts[parts.length - 1] });
    }
    const walk = (node, prefix, depth) => {
      for (const [name, child] of node.dirs) {
        // compacta pastas com um único filho: "src/main/java"
        let label = name;
        let cur = child;
        while (cur.files.length === 0 && cur.dirs.size === 1) {
          const [n2, c2] = [...cur.dirs][0];
          label += '/' + n2;
          cur = c2;
        }
        const key = prefix + label;
        const collapsed = tab.treeCollapsed.has(key);
        container.append(
          h(
            'div',
            {
              class: 'file-row tree-dir',
              style: { paddingLeft: 8 + depth * 14 + 'px' },
              onclick: () => {
                if (collapsed) tab.treeCollapsed.delete(key);
                else tab.treeCollapsed.add(key);
                renderRight(tab);
              },
            },
            h('span', { class: 'caret' }, collapsed ? '▸' : '▾'),
            h('span', { class: 'bi folder', html: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 4h5l1.5 1.5h6.5v7.5h-13z" fill="currentColor"/></svg>' }),
            h('span', { class: 'fname' }, label)
          )
        );
        if (!collapsed) walk(cur, key + '/', depth + 1);
      }
      for (const f of node.files) {
        const row = fileRow(f, { selected: sel === f.path, onclick: () => open(f), oncontextmenu: menu && menu(f) });
        row.style.paddingLeft = 8 + depth * 14 + 'px';
        container.append(row);
      }
    };
    walk(root, '', 0);
  }

  function renderRight(tab) {
    const R = tab.els.right;
    // preserva foco/cursor do campo de commit quando o painel é redesenhado
    const active = document.activeElement;
    // só os campos de texto da mensagem (não botão nem checkbox)
    const focusKey = active && R.contains(active) && active.dataset ? active.dataset.field : null;
    const caret = focusKey ? [active.selectionStart, active.selectionEnd] : null;
    const scrollTop = R.querySelector('.panel-scroll')?.scrollTop || 0;
    R.innerHTML = '';
    if (tab.selected === 'WIP') {
      renderWip(tab, R);
      const sc = R.querySelector('.panel-scroll');
      if (sc) sc.scrollTop = scrollTop;
      if (focusKey) {
        const el = R.querySelector(`[data-field="${focusKey}"]`);
        if (el) {
          el.focus();
          if (caret[0] != null) el.setSelectionRange(caret[0], caret[1]);
        }
      }
      return;
    }
    if (tab.multi.length) return renderMulti(tab, R);
    if (tab.compare) return renderCompare(tab, R);
    if (tab.selectedDetails) return renderCommit(tab, R, tab.selectedDetails);
    R.append(h('div', { class: 'empty' }, 'Carregando...'));
  }

  // Arquivos que mudam de A para B; clicar abre o diff no centro.
  function compareSection(tab, c) {
    const sel = tab.view.type === 'diff' && tab.view.kind === 'commit' && tab.view.sha === c.b && tab.view.parents?.[0] === c.a ? tab.view.file : null;
    const wrap = h('div', { class: 'compare' });
    wrap.append(
      h(
        'div',
        { class: 'compare-head' },
        h('span', { class: 'mono strong', title: c.a }, c.labelA),
        h('span', { class: 'dim' }, '→'),
        h('span', { class: 'mono strong', title: c.b }, c.labelB),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small', title: 'Inverter a comparação', onclick: () => tab.swapCompare() }, '⇄ Inverter')
      )
    );
    if (c.error) {
      wrap.append(h('div', { class: 'empty' }, c.error));
      return wrap;
    }
    if (!c.files) {
      wrap.append(h('div', { class: 'empty' }, 'Comparando...'));
      return wrap;
    }
    if (c.onlyA != null)
      wrap.append(h('div', { class: 'dim small compare-counts' }, `${c.onlyB} commit(s) só em ${c.labelB} · ${c.onlyA} commit(s) só em ${c.labelA}`));
    wrap.append(
      h('h4', {}, `Arquivos diferentes (${c.files.length})`),
      h(
        'div',
        { class: 'file-list tall flat' },
        c.files.length
          ? c.files.map((f) => fileRow(f, { selected: sel === f.path, onclick: () => tab.openDiff('commit', f.path, c.b, [c.a], `${c.labelA} → ${c.labelB}`) }))
          : h('div', { class: 'file-row dim' }, 'Nenhuma diferença entre os dois')
      )
    );
    return wrap;
  }

  function renderCompare(tab, R) {
    R.append(
      h(
        'div',
        { class: 'commit-id' },
        'comparação',
        h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: 'Fechar comparação (Esc)', onclick: () => tab.clearMulti() }, '✕')
      ),
      h('div', { class: 'panel-scroll' }, compareSection(tab, tab.compare))
    );
  }

  function renderMulti(tab, R) {
    const list = tab.multiCommits();
    const box = h('div', { class: 'panel-scroll' });
    box.append(
      h(
        'div',
        { class: 'multi-actions' },
        h('button', { class: 'btn small', onclick: () => tab.squashCommits(list) }, `Juntar (${list.length})`),
        h('button', { class: 'btn small', onclick: () => tab.cherryPickMany(list) }, `Cherry-pick (${list.length})`),
        h('button', { class: 'btn small', onclick: () => tab.revertMany(list) }, `Reverter (${list.length})`)
      ),
      h(
        'div',
        { class: 'file-list multi-list' },
        list.map((c) =>
          h(
            'div',
            { class: 'file-row', title: c.subject, onclick: () => tab.select(c.sha) },
            avatar(c.author, c.email, false, tab.avatarCtx(c.sha)),
            h('span', { class: 'mono dim' }, c.sha.slice(0, 7)),
            h('span', { class: 'fpath' }, h('span', { class: 'fname' }, c.subject))
          )
        )
      ),
      tab.compare ? compareSection(tab, tab.compare) : h('div', { class: 'dim small hint' }, 'Selecione exatamente dois commits para comparar os arquivos entre eles.')
    );
    R.append(
      h(
        'div',
        { class: 'commit-id' },
        `${list.length} commits selecionados`,
        h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: 'Limpar seleção (Esc)', onclick: () => tab.clearMulti() }, '✕')
      ),
      box
    );
  }

  function renderWip(tab, R) {
    const st = tab.data.status;
    const sel = tab.view.type !== 'graph' ? tab.view : {};
    const scrollBox = h('div', { class: 'panel-scroll' });
    const isSel = (kind, p) => sel.file === p && (sel.kind === kind || (kind === 'unstaged' && sel.kind === 'untracked'));

    if (st.conflicts.length) {
      scrollBox.append(
        h('h4', {}, `Conflitos (${st.conflicts.length})`),
        h(
          'div',
          { class: 'file-list' },
          st.conflicts.map((f) =>
            fileRow(
              { ...f, status: 'U' },
              {
                selected: sel.type === 'conflict' && sel.file === f.path,
                onclick: () => tab.openConflict(f.path),
                oncontextmenu: (e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, [
                    { label: 'Resolver...', action: () => tab.openConflict(f.path) },
                    { label: 'Usar a minha versão (ours)', action: () => tab.resolveWith(f.path, 'ours') },
                    { label: 'Usar a versão deles (theirs)', action: () => tab.resolveWith(f.path, 'theirs') },
                    { label: 'Marcar como resolvido', action: () => tab.stage([f.path]) },
                  ]);
                },
                actions: h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: (e) => {
                      e.stopPropagation();
                      tab.stage([f.path]);
                    },
                  },
                  'Resolvido'
                ),
              }
            )
          )
        )
      );
    }

    scrollBox.append(
      h(
        'h4',
        {},
        `Não preparados (${st.unstaged.length})`,
        h('span', { class: 'grow' }),
        st.unstaged.length ? h('button', { class: 'btn small danger', onclick: () => tab.discardAll() }, 'Descartar tudo') : null,
        st.unstaged.length ? h('button', { class: 'btn small', onclick: () => tab.stageAll() }, 'Stage em tudo') : null
      ),
      h(
        'div',
        { class: 'file-list' },
        st.unstaged.length
          ? st.unstaged.map((f) =>
              fileRow(f, {
                selected: isSel('unstaged', f.path),
                onclick: () => tab.openDiff(f.untracked ? 'untracked' : 'unstaged', f.path),
                oncontextmenu: (e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, [
                    { label: 'Stage', action: () => tab.stage([f.path]) },
                    { label: 'Descartar alterações', danger: true, action: () => tab.discard(f) },
                    '-',
                    { label: 'Ignorar (adicionar ao .gitignore)', action: () => tab.ignore(f.path) },
                    /\.[^./]+$/.test(f.path) && { label: `Ignorar todos os *${f.path.match(/\.[^./]+$/)[0]}`, action: () => tab.ignore('*' + f.path.match(/\.[^./]+$/)[0]) },
                    { label: 'Copiar caminho', action: () => navigator.clipboard.writeText(f.path) },
                    !f.untracked && { label: 'Histórico do arquivo', action: () => tab.openHistory(f.path) },
                    !f.untracked && f.status !== 'D' && { label: 'Blame', action: () => tab.openBlame(f.path) },
                    f.status !== 'D' && '-',
                    f.status !== 'D' && { label: 'Editar arquivo', action: () => tab.openEditor(f.path) },
                    f.status !== 'D' && { label: 'Abrir no editor externo', action: () => tab.openInEditor(f.path) },
                  ]);
                },
                actions: h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: (e) => {
                      e.stopPropagation();
                      tab.stage([f.path]);
                    },
                  },
                  'Stage'
                ),
              })
            )
          : h('div', { class: 'file-row dim' }, 'Nenhuma alteração')
      ),
      h(
        'h4',
        {},
        `Preparados (${st.staged.length})`,
        h('span', { class: 'grow' }),
        st.staged.length ? h('button', { class: 'btn small', onclick: () => tab.unstageAll() }, 'Unstage em tudo') : null
      ),
      h(
        'div',
        { class: 'file-list' },
        st.staged.length
          ? st.staged.map((f) =>
              fileRow(f, {
                selected: isSel('staged', f.path),
                onclick: () => tab.openDiff('staged', f.path),
                oncontextmenu: (e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, [
                    { label: 'Unstage', action: () => tab.unstage([f.path]) },
                    { label: 'Histórico do arquivo', action: () => tab.openHistory(f.path) },
                    f.status !== 'D' && { label: 'Blame', action: () => tab.openBlame(f.path) },
                    f.status !== 'D' && { label: 'Editar arquivo', action: () => tab.openEditor(f.path) },
                    f.status !== 'D' && { label: 'Abrir no editor externo', action: () => tab.openInEditor(f.path) },
                  ]);
                },
                actions: h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: (e) => {
                      e.stopPropagation();
                      tab.unstage([f.path]);
                    },
                  },
                  'Unstage'
                ),
              })
            )
          : h('div', { class: 'file-row dim' }, 'Nada preparado para commit')
      )
    );

    const draft = tab.commitDraft;
    const summary = h('input', { placeholder: 'Resumo do commit', spellcheck: 'true', 'data-field': 'summary' });
    summary.value = draft.summary;
    const counter = h('span', { class: 'counter dim' });
    const updateCounter = () => {
      counter.textContent = String(72 - summary.value.length);
      counter.classList.toggle('over', summary.value.length > 72);
    };
    updateCounter();
    const desc = h('textarea', { placeholder: 'Descrição (opcional)', spellcheck: 'true', 'data-field': 'description' });
    desc.value = draft.description;
    const amend = h('input', { type: 'checkbox' });
    amend.checked = draft.amend;
    const nStaged = st.staged.length;
    const commitBtn = h('button', { class: 'btn primary', onclick: () => tab.commit() });
    const updateBtn = () => {
      const can = summary.value.trim() && (nStaged || amend.checked || tab.data.state === 'merge') && !st.conflicts.length;
      commitBtn.disabled = !can;
      commitBtn.textContent = amend.checked ? 'Corrigir último commit (amend)' : `Commit de ${nStaged} arquivo(s)`;
    };
    summary.addEventListener('input', () => {
      draft.summary = summary.value;
      updateCounter();
      updateBtn();
    });
    desc.addEventListener('input', () => {
      draft.description = desc.value;
    });
    amend.addEventListener('change', async () => {
      draft.amend = amend.checked;
      if (amend.checked && !summary.value.trim()) {
        const msg = await tab.lastCommitMessage();
        const [s, ...rest] = msg.split('\n');
        draft.summary = summary.value = s;
        draft.description = desc.value = rest.join('\n').trim();
        updateCounter();
      }
      updateBtn();
    });
    const ctrlEnter = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !commitBtn.disabled) tab.commit();
    };
    summary.addEventListener('keydown', ctrlEnter);
    desc.addEventListener('keydown', ctrlEnter);
    updateBtn();
    tab.els.commitSummary = summary;
    const box = h(
      'div',
      { class: 'commit-box' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, 'Mensagem do commit'), counter),
      summary,
      desc,
      h('label', { class: 'row dim' }, amend, 'Corrigir commit anterior (amend)'),
      commitBtn
    );
    R.append(scrollBox, box);
  }

  // Faixa "N arquivo(s) alterado(s) no diretório de trabalho" mostrada no topo do
  // painel quando um commit está selecionado e há trabalho em andamento.
  function wipNotice(tab) {
    const st = tab.data.status;
    if (!st) return null;
    const n = new Set([...st.staged, ...st.unstaged, ...st.conflicts].map((f) => f.path)).size;
    if (!n) return null;
    return h(
      'div',
      { class: 'wip-notice' },
      h('span', {}, n === 1 ? '1 arquivo alterado no diretório de trabalho' : `${n} arquivos alterados no diretório de trabalho`),
      h('button', { class: 'btn small outline', onclick: () => tab.select('WIP') }, 'Ver alterações')
    );
  }

  function renderCommit(tab, R, d) {
    const [subject, ...body] = d.message.split('\n');
    const bodyText = body.join('\n').trim();
    const sel = tab.view.type === 'diff' && tab.view.kind === 'commit' ? tab.view.file : null;
    const notice = wipNotice(tab);
    if (notice) R.append(notice);
    R.append(
      h(
        'div',
        { class: 'commit-id' },
        'commit: ',
        h('span', { class: 'mono link', title: 'Copiar SHA completo', onclick: () => tab.copy(d.sha) }, d.sha.slice(0, 7)),
        h('span', { class: 'grow' }),
        tab.selectedIsStash ? h('span', { class: 'dim' }, 'stash') : null,
        !tab.selectedIsStash && tab.web
          ? h('button', { class: 'btn small outline-dim', title: tab.web.commitUrl(d.sha), onclick: () => window.polvo.openExternal(tab.web.commitUrl(d.sha)) }, `Abrir no ${tab.web.name} ↗`)
          : null
      )
    );
    const box = h('div', { class: 'panel-scroll' });
    const counts = {};
    for (const f of d.files) counts[f.status] = (counts[f.status] || 0) + 1;
    const countLabel = { A: ['adicionado', 'adicionados'], M: ['modificado', 'modificados'], D: ['removido', 'removidos'], R: ['renomeado', 'renomeados'], C: ['copiado', 'copiados'], T: ['tipo alterado', 'tipos alterados'] };
    const sameCommitter = d.committer === d.author && +d.commitDate === +d.date;
    const when = (dt) => `${dt.toLocaleDateString('pt-BR')} @ ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const fv = tab.fileView;
    const listBox = h('div', { class: 'file-list tall flat' });
    const fillList = async () => {
      let files = d.files.map((f) => ({ ...f }));
      if (fv.all) {
        const all = await tab.treeFiles(d.sha);
        const changed = new Map(files.map((f) => [f.path, f]));
        files = all.map((p) => changed.get(p) || { path: p, status: null });
        for (const f of d.files) if (f.status === 'D') files.push({ ...f });
      }
      files.sort((a, b) => (fv.desc ? -1 : 1) * a.path.localeCompare(b.path));
      listBox.innerHTML = '';
      const open = (f) => f.status && tab.openDiff('commit', f.path, d.sha, d.parents);
      const menu = (f) => (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Histórico do arquivo', action: () => tab.openHistory(f.path) },
          f.status !== 'D' && { label: 'Blame neste commit', action: () => tab.openBlame(f.path, d.sha) },
          f.status !== 'D' && { label: 'Abrir no editor externo', action: () => tab.openInEditor(f.path) },
          { label: 'Copiar caminho', action: () => navigator.clipboard.writeText(f.path) },
        ]);
      };
      if (fv.mode === 'tree') renderTree(tab, listBox, files, sel, open, menu);
      else listBox.append(...files.map((f) => fileRow(f, { selected: sel === f.path, onclick: () => open(f), oncontextmenu: menu(f) })));
    };
    const seg = (mode, label, svgText) =>
      h(
        'button',
        {
          class: 'seg-btn' + (fv.mode === mode ? ' active' : ''),
          onclick: () => {
            fv.mode = mode;
            renderRight(tab);
          },
        },
        h('span', { class: 'bi', html: svgText }),
        label
      );
    const allBox = h('input', { type: 'checkbox' });
    allBox.checked = fv.all;
    allBox.addEventListener('change', () => {
      fv.all = allBox.checked;
      fillList();
    });
    box.append(
      h('div', { class: 'detail-msg' }, h('div', { class: 'subject' }, subject), bodyText ? h('div', { class: 'body' }, bodyText) : null),
      h('div', { class: 'grab' }),
      h(
        'div',
        { class: 'detail-author' },
        avatar(d.author, d.email, true, tab.avatarCtx(d.sha)),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'author-name', title: d.email }, d.author),
          h('div', { class: 'dim small' }, 'autoria ', h('span', { class: 'strong' }, when(d.date))),
          sameCommitter ? null : h('div', { class: 'dim small' }, 'commit por ', d.committer, ' ', h('span', { class: 'strong' }, when(d.commitDate)))
        ),
        h(
          'div',
          { class: 'dim small parents' },
          d.parents.length > 1 ? 'pais:' : 'pai:',
          d.parents.length ? d.parents.map((p) => h('span', { class: 'mono link', onclick: () => tab.selectSha(p) }, p.slice(0, 6))) : ' —'
        )
      ),
      h(
        'div',
        { class: 'file-counts' },
        Object.entries(counts).map(([k, n]) => h('span', {}, statusIcon(k), ` ${n} ${(countLabel[k] || [k, k])[n === 1 ? 0 : 1]}`))
      ),
      h(
        'div',
        { class: 'file-tools' },
        h(
          'button',
          {
            class: 'icon-btn sort-btn',
            title: fv.desc ? 'Ordem Z→A' : 'Ordem A→Z',
            onclick: () => {
              fv.desc = !fv.desc;
              renderRight(tab);
            },
          },
          fv.desc ? '↓ᶻᵃ' : '↑ᵃᶻ'
        ),
        h('span', { class: 'grow' }),
        h(
          'div',
          { class: 'seg' },
          seg('path', 'Caminho', '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6"/></svg>'),
          seg('tree', 'Árvore', '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 2v11h4M3 7h4" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="5" width="6" height="4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="11" width="6" height="4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>')
        ),
        h('label', { class: 'all-files' }, allBox, 'Ver todos os arquivos')
      ),
      listBox
    );
    fillList();
    R.append(box);
  }

  // ---------- diff ----------
  function diffModeToggle(tab) {
    const seg = (split, label) =>
      h(
        'button',
        {
          class: 'seg-btn' + (diffPrefs.split === split ? ' active' : ''),
          onclick: () => {
            diffPrefs.split = split;
            window.polvo.settings.set({ diffSplit: split });
            tab.renderCenter();
          },
        },
        label
      );
    return [
      h(
        'button',
        {
          class: 'btn small toggle' + (diffPrefs.ignoreWs ? ' on' : ''),
          title: 'Esconder mudanças que são só espaço ou indentação',
          onclick: () => {
            diffPrefs.ignoreWs = !diffPrefs.ignoreWs;
            window.polvo.settings.set({ diffIgnoreWs: diffPrefs.ignoreWs });
            tab.reloadView();
          },
        },
        diffPrefs.ignoreWs ? '✓ Ignorando espaços' : 'Ignorar espaços'
      ),
      h('div', { class: 'seg' }, seg(false, 'Unificado'), seg(true, 'Lado a lado')),
    ];
  }

  // Realce de sintaxe e palavras alteradas de cada linha de um trecho. Os dois
  // lados guardam seu próprio estado (comentário de bloco aberto etc.).
  function hunkPaint(hk, lang) {
    const info = new Map();
    let oldSt = {};
    let newSt = {};
    for (const l of hk.lines) {
      if (l.type === 'meta') continue;
      if (!lang) {
        info.set(l, { tokens: [] });
        continue;
      }
      const r = HL.tokenize(l.text, lang, l.type === 'del' ? oldSt : newSt);
      if (l.type !== 'add') oldSt = l.type === 'del' ? r.state : HL.tokenize(l.text, lang, oldSt).state;
      if (l.type !== 'del') newSt = r.state;
      info.set(l, { tokens: r.tokens });
    }
    for (const row of splitRows(hk)) {
      if (row.left?.type === 'del' && row.right?.type === 'add') {
        const [ra, rb] = HL.wordDiff(row.left.text, row.right.text);
        info.get(row.left).marks = ra;
        info.get(row.right).marks = rb;
      }
    }
    return info;
  }

  // Linhas de remoção e adição de um trecho pareadas uma ao lado da outra.
  function splitRows(hk) {
    const rows = [];
    let dels = [];
    let adds = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i] || null, right: adds[i] || null });
      dels = [];
      adds = [];
    };
    for (const l of hk.lines) {
      if (l.type === 'del') {
        if (adds.length) flush();
        dels.push(l);
      } else if (l.type === 'add') adds.push(l);
      else {
        flush();
        rows.push(l.type === 'ctx' ? { left: l, right: l } : { meta: l });
      }
    }
    flush();
    return rows;
  }

  // Corpo do diff (unificado ou lado a lado). Com `pick`, as linhas alteradas
  // ficam clicáveis para stage/unstage/descarte por linha.
  function diffBody(files, { pick, hunkActions, path } = {}) {
    const body = h('div', { class: 'diff-body' + (diffPrefs.split ? ' split' : '') });
    const lang = HL.langOf(path);
    for (const f of files) {
      if (f.binary) {
        body.append(h('div', { class: 'empty' }, 'Arquivo binário — diff não exibido.'));
        continue;
      }
      for (const hk of f.hunks) {
        const paint = hunkPaint(hk, lang);
        const cell = (l, side) => {
          if (!l) return h('div', { class: 'dl empty-side' }, h('span', { class: 'ln' }), h('span', { class: 'code' }));
          const n = side === 'left' ? l.old : side === 'right' ? l.new : null;
          const canPick = pick && (l.type === 'add' || l.type === 'del');
          const el = h(
            'div',
            { class: 'dl ' + l.type + (canPick ? ' pickable' : '') + (canPick && pick.has(l) ? ' picked' : ''), title: canPick ? 'Clique para marcar a linha (Shift: intervalo)' : null },
            side ? h('span', { class: 'ln' }, n ?? '') : [h('span', { class: 'ln' }, l.old ?? ''), h('span', { class: 'ln' }, l.new ?? '')],
            h('span', { class: 'code' }, HL.codeNodes(l.text, paint.get(l)?.tokens || [], paint.get(l)?.marks))
          );
          if (canPick) {
            el.line = l;
            el.addEventListener('click', (e) => pick.toggle(l, hk, e.shiftKey));
          }
          return el;
        };
        const lines = diffPrefs.split
          ? splitRows(hk).map((r) =>
              r.meta ? h('div', { class: 'dl meta' }, h('span', { class: 'code' }, r.meta.text)) : h('div', { class: 'split-row' }, cell(r.left, 'left'), cell(r.right, 'right'))
            )
          : hk.lines.map((l) => cell(l));
        body.append(h('div', { class: 'hunk' }, h('div', { class: 'hunk-head' }, h('span', { class: 'grow mono' }, hk.header), hunkActions ? hunkActions(f, hk) : null), lines));
      }
    }
    return body;
  }

  function renderDiff(tab) {
    const C = tab.els.center;
    const v = tab.view;
    const prevScroll = C.querySelector('.diff-body')?.scrollTop || 0;
    C.innerHTML = '';
    const actions = [];
    if (v.kind === 'unstaged' || v.kind === 'untracked') {
      actions.push(h('button', { class: 'btn small danger', onclick: () => tab.discard({ path: v.file, untracked: v.kind === 'untracked' }) }, 'Descartar arquivo'));
      actions.push(h('button', { class: 'btn small primary', onclick: () => tab.stage([v.file]) }, 'Stage arquivo'));
    } else if (v.kind === 'staged') {
      actions.push(h('button', { class: 'btn small', onclick: () => tab.unstage([v.file]) }, 'Unstage arquivo'));
    }
    const label = v.label || { unstaged: 'não preparado', untracked: 'novo arquivo', staged: 'preparado', commit: v.sha ? 'commit ' + v.sha.slice(0, 7) : '' }[v.kind];
    // barra das linhas marcadas: atualizada sem redesenhar o diff
    const pickBar = h('div', { class: 'pick-bar' });
    // com espaços ignorados o diff não bate com o arquivo, então não dá para aplicar trechos
    const linesMode = (v.kind === 'unstaged' || v.kind === 'staged') && !diffPrefs.ignoreWs;
    const updatePickBar = () => {
      pickBar.innerHTML = '';
      const n = v.picked ? v.picked.size : 0;
      const wsNote = (v.kind === 'unstaged' || v.kind === 'staged') && diffPrefs.ignoreWs;
      pickBar.classList.toggle('hidden', !linesMode && !wsNote);
      if (wsNote) return pickBar.append(h('span', { class: 'dim' }, 'Com "Ignorar espaços" ligado, o stage por linha e por hunk fica desligado.'));
      if (!linesMode) return;
      if (!n) return pickBar.append(h('span', { class: 'dim' }, 'Clique nas linhas verdes/vermelhas para escolher só algumas'));
      pickBar.append(h('span', {}, `${n} linha(s) marcada(s)`), h('span', { class: 'grow' }));
      if (v.kind === 'unstaged')
        pickBar.append(
          h('button', { class: 'btn small danger', onclick: () => tab.linesAction('discard') }, 'Descartar linhas'),
          h('button', { class: 'btn small primary', onclick: () => tab.linesAction('stage') }, 'Stage das linhas')
        );
      else pickBar.append(h('button', { class: 'btn small', onclick: () => tab.linesAction('unstage') }, 'Unstage das linhas'));
      pickBar.append(
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Desmarcar',
            onclick: () => {
              v.picked.clear();
              renderDiff(tab);
            },
          },
          '✕'
        )
      );
    };
    C.append(
      h(
        'div',
        { class: 'diff-head' },
        h('span', { class: 'path', title: v.file }, v.file),
        h('span', { class: 'dim' }, label),
        h(
          'div',
          { class: 'head-tools' },
          actions,
          diffModeToggle(tab),
          h(
            'button',
            {
              class: 'btn small',
              title: 'Histórico, blame e edição do arquivo',
              onclick: (e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const deleted = (v.files || []).some((f) => f.header.some((l) => l.startsWith('deleted file')));
                showMenu(r.left, r.bottom + 4, [
                  v.kind !== 'untracked' && { label: 'Histórico do arquivo', action: () => tab.openHistory(v.file) },
                  v.kind !== 'untracked' && v.kind !== 'staged' && { label: v.kind === 'commit' ? 'Blame neste commit' : 'Blame', action: () => tab.openBlame(v.file, v.kind === 'commit' ? v.sha : undefined) },
                  v.kind !== 'commit' && !deleted && { label: 'Editar arquivo', action: () => tab.openEditor(v.file) },
                  !deleted && { label: 'Abrir no editor externo', action: () => tab.openInEditor(v.file) },
                ]);
              },
            },
            'Arquivo ▾'
          )
        ),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => tab.closeView() }, '✕')
      ),
      pickBar
    );
    updatePickBar();
    const files = v.files || [];
    if (!files.length) {
      C.append(
        h('div', { class: 'empty' }, v.loading ? 'Carregando...' : diffPrefs.ignoreWs ? 'Só mudaram espaços ou indentação (desligue "Ignorar espaços" para ver).' : 'Sem diferenças de conteúdo (talvez apenas permissão ou renomeação).')
      );
      return;
    }
    v.picked ||= new Set();
    const pick = linesMode && {
      has: (l) => v.picked.has(l),
      toggle: (l, hk, range) => {
        tab.togglePick(l, hk, range);
        for (const el of body.querySelectorAll('.dl.pickable')) el.classList.toggle('picked', v.picked.has(el.line));
        updatePickBar();
      },
    };
    const hunkActions = (f, hk) => {
      if (diffPrefs.ignoreWs) return null;
      if (v.kind === 'unstaged')
        return [
          h('button', { class: 'btn small danger', onclick: () => tab.discardHunk(f, hk) }, 'Descartar hunk'),
          h('button', { class: 'btn small', onclick: () => tab.stageHunk(f, hk) }, 'Stage hunk'),
        ];
      if (v.kind === 'staged') return h('button', { class: 'btn small', onclick: () => tab.unstageHunk(f, hk) }, 'Unstage hunk');
      return null;
    };
    const body = diffBody(files, { pick, hunkActions, path: v.file });
    C.append(body);
    body.scrollTop = prevScroll;
  }

  // ---------- editor embutido ----------
  // Campo de texto com numeração de linhas; Tab indenta no estilo do arquivo e
  // Ctrl+S salva. O que não foi salvo fica em tab.editDrafts.
  function renderEditor(tab) {
    const C = tab.els.center;
    const v = tab.view;
    const prev = C.querySelector('.editor-area');
    const keep = prev ? [prev.scrollTop, prev.selectionStart, prev.selectionEnd, document.activeElement === prev] : null;
    C.innerHTML = '';
    const dirty = () => v.content !== v.original;
    const status = h('span', { class: 'dim' });
    const save = h('button', { class: 'btn small primary', onclick: () => tab.saveEdit() }, 'Salvar (Ctrl+S)');
    const update = () => {
      status.textContent = dirty() ? '● não salvo' : 'salvo';
      status.classList.toggle('unsaved', dirty());
      save.disabled = !dirty();
    };
    C.append(
      h(
        'div',
        { class: 'diff-head' },
        h('span', { class: 'path', title: v.file }, v.file),
        status,
        h('button', { class: 'btn small', title: 'Abrir no editor externo', onclick: () => tab.openInEditor(v.file) }, 'Abrir no editor'),
        save,
        h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => tab.closeView() }, '✕')
      )
    );
    const gutter = h('div', { class: 'editor-gutter' });
    const area = h('textarea', { class: 'editor-area', spellcheck: 'false', wrap: 'off' });
    area.value = v.content;
    const lines = () => {
      const n = area.value.split('\n').length;
      if (gutter.childElementCount === n) return;
      gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    };
    // indentação do arquivo: tab se a maioria das linhas indentadas usa tab
    const tabs = (v.original.match(/^\t/gm) || []).length;
    const spaces = (v.original.match(/^ {2,}/gm) || []).length;
    const indent = tabs > spaces ? '\t' : (/^( {2,})\S/m.exec(v.original)?.[1].length === 4 ? '    ' : '  ');
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      document.execCommand('insertText', false, indent);
    });
    area.addEventListener('input', () => {
      v.content = area.value;
      if (dirty()) tab.editDrafts[v.file] = { original: v.original, content: v.content };
      else delete tab.editDrafts[v.file];
      lines();
      update();
    });
    area.addEventListener('scroll', () => (gutter.scrollTop = area.scrollTop));
    C.append(h('div', { class: 'editor' }, gutter, area));
    lines();
    update();
    if (keep) {
      area.scrollTop = keep[0];
      area.setSelectionRange(keep[1], keep[2]);
      if (keep[3]) area.focus();
    } else area.focus();
    gutter.scrollTop = area.scrollTop;
  }

  // ---------- blame ----------
  // Cada trecho de linhas do mesmo commit leva autor, data e resumo na margem;
  // a faixa colorida fica mais forte quanto mais recente o commit.
  function renderBlame(tab) {
    const C = tab.els.center;
    const v = tab.view;
    const prev = C.querySelector('.blame-body')?.scrollTop || 0;
    C.innerHTML = '';
    C.append(
      h(
        'div',
        { class: 'diff-head' },
        h('span', { class: 'path', title: v.file }, 'Blame de ', v.file),
        h('span', { class: 'dim' }, v.rev ? 'no commit ' + v.rev.slice(0, 7) : 'como está no diretório'),
        h('button', { class: 'btn small', onclick: () => tab.openHistory(v.file) }, 'Histórico'),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => tab.closeView() }, '✕')
      )
    );
    if (v.loading) return C.append(h('div', { class: 'empty' }, 'Carregando...'));
    if (v.error) return C.append(h('div', { class: 'empty' }, v.error));
    const dates = Object.values(v.commits)
      .map((c) => +c.date || 0)
      .filter(Boolean);
    const oldest = Math.min(...dates);
    const span = Math.max(1, Math.max(...dates) - oldest);
    const body = h('div', { class: 'blame-body' });
    let prevSha = null;
    let band = 0;
    v.lines.forEach((l, i) => {
      const c = v.commits[l.sha] || { sha: l.sha };
      const start = l.sha !== prevSha;
      if (start) band++;
      prevSha = l.sha;
      const age = c.uncommitted ? 1 : ((+c.date || oldest) - oldest) / span;
      const gutter = start
        ? h(
            'div',
            { class: 'blame-info', title: c.uncommitted ? 'Ainda não commitado' : `${c.summary}\n${c.author} · ${fullDate(c.date)}\nClique para ver no grafo`, onclick: () => tab.blameGoTo(c) },
            c.uncommitted ? h('span', { class: 'blame-wip' }, 'não commitado') : [avatar(c.author, c.email, false, tab.avatarCtx(c.sha)), h('span', { class: 'ellip blame-sum' }, c.summary), h('span', { class: 'dim small' }, relDate(c.date)), h('span', { class: 'mono dim small' }, c.sha.slice(0, 7))]
          )
        : h('div', { class: 'blame-info' });
      body.append(
        h(
          'div',
          { class: 'blame-row' + (start ? ' start' : '') + (band % 2 ? ' odd' : '') },
          h('span', { class: 'blame-age', style: { opacity: String(0.15 + 0.85 * age) } }),
          gutter,
          h('span', { class: 'ln' }, i + 1),
          h('span', { class: 'code' }, l.text)
        )
      );
    });
    C.append(body);
    body.scrollTop = prev;
  }

  // ---------- histórico de um arquivo ----------
  function renderHistory(tab) {
    const C = tab.els.center;
    const v = tab.view;
    const prevList = C.querySelector('.history-list')?.scrollTop || 0;
    const prevDiff = C.querySelector('.diff-body')?.scrollTop || 0;
    C.innerHTML = '';
    C.append(
      h(
        'div',
        { class: 'diff-head' },
        h('span', { class: 'path', title: v.file }, 'Histórico de ', v.file),
        h('span', { class: 'dim' }, v.loading ? 'carregando...' : `${v.entries.length} commit(s)`),
        diffModeToggle(tab),
        v.sel
          ? h(
              'button',
              {
                class: 'btn small',
                title: 'Quem mexeu em cada linha, neste commit',
                onclick: () => {
                  const e = v.entries.find((x) => x.sha === v.sel);
                  tab.openBlame(e.path, e.sha);
                },
              },
              'Blame'
            )
          : null,
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => tab.closeView() }, '✕')
      )
    );
    if (v.loading) return C.append(h('div', { class: 'empty' }, 'Carregando...'));
    if (!v.entries.length) return C.append(h('div', { class: 'empty' }, 'Nenhum commit mexeu neste arquivo ainda.'));
    const list = h(
      'div',
      { class: 'history-list' },
      v.entries.map((e) =>
        h(
          'div',
          { class: 'history-row' + (v.sel === e.sha ? ' selected' : ''), onclick: () => tab.historySelect(e), title: e.from ? `${e.from} → ${e.path}` : e.path },
          avatar(e.author, e.email, false, tab.avatarCtx(e.sha)),
          h('span', { class: 'grow ellip' }, e.subject),
          e.from ? h('span', { class: 'dim small' }, 'renomeado') : null,
          h('span', { class: 'dim small ellip history-author' }, e.author),
          h('span', { class: 'dim small', title: fullDate(e.date) }, relDate(e.date)),
          h('span', { class: 'mono dim link', title: 'Ver no grafo', onclick: (ev) => (ev.stopPropagation(), tab.selectSha(e.sha)) }, e.sha.slice(0, 7))
        )
      )
    );
    C.append(list);
    list.scrollTop = prevList;
    const selEntry = v.entries.find((x) => x.sha === v.sel);
    const body = v.diffLoading ? h('div', { class: 'diff-body' }, h('div', { class: 'empty' }, 'Carregando...')) : diffBody(v.files, { path: selEntry?.path || v.file });
    if (!v.diffLoading && !v.files.length) body.append(h('div', { class: 'empty' }, 'Sem diferenças de conteúdo neste commit.'));
    C.append(body);
    body.scrollTop = prevDiff;
  }

  // Janela simples com um campo de mensagem (usada no squash).
  function messageEditor(title, text, { ok = 'OK', message } = {}) {
    return new Promise((resolve) => {
      openModal(
        (close) => {
          const area = h('textarea', { class: 'msg-editor', spellcheck: 'true', rows: 10 });
          area.value = text;
          const okBtn = h('button', { class: 'btn primary', onclick: () => area.value.trim() && close(area.value.trim()) }, ok);
          area.addEventListener('input', () => (okBtn.disabled = !area.value.trim()));
          area.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && okBtn.click());
          return h(
            'div',
            { class: 'modal wide' },
            h('h2', {}, title),
            message ? h('div', { class: 'msg dim' }, message) : null,
            area,
            h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Cancelar'), okBtn)
          );
        },
        { onClose: resolve }
      );
    });
  }

  // ---------- resolução de conflitos ----------
  function parseConflicts(text) {
    const segs = [];
    const lines = text.split('\n');
    let buf = [];
    let cur = null;
    for (const line of lines) {
      if (!cur && line.startsWith('<<<<<<<')) {
        if (buf.length) segs.push({ type: 'text', text: buf.join('\n') });
        buf = [];
        cur = { type: 'conflict', oursLabel: line.slice(8), ours: [], base: null, theirs: [], theirsLabel: '', stage: 'ours' };
      } else if (cur && line.startsWith('|||||||')) {
        cur.stage = 'base';
        cur.base = [];
      } else if (cur && line.startsWith('=======')) {
        cur.stage = 'theirs';
      } else if (cur && line.startsWith('>>>>>>>')) {
        cur.theirsLabel = line.slice(8);
        segs.push(cur);
        cur = null;
      } else if (cur) {
        cur[cur.stage].push(line);
      } else buf.push(line);
    }
    if (cur) buf.unshift(...['<<<<<<< ' + cur.oursLabel, ...cur.ours, '=======', ...cur.theirs]);
    segs.push({ type: 'text', text: buf.join('\n') });
    return segs;
  }

  // Linhas escolhidas de cada lado entram no resultado na ordem: as minhas e
  // depois as deles. Conflito ainda sem escolha volta com os marcadores.
  function assemble(segs) {
    return segs
      .map((s) => {
        if (s.type === 'text') return s.text;
        if (!s.touched) return ['<<<<<<< ' + s.oursLabel, ...s.ours, '=======', ...s.theirs, '>>>>>>> ' + s.theirsLabel].join('\n');
        const lines = [...s.ours.filter((_, i) => s.pick.ours.has(i)), ...s.theirs.filter((_, i) => s.pick.theirs.has(i))];
        return lines.length ? lines.join('\n') : null; // "Nenhum": o trecho some sem deixar linha vazia
      })
      .filter((t) => t !== null)
      .join('\n');
  }

  function choose(s, which) {
    s.touched = true;
    s.pick = {
      ours: new Set(which === 'ours' || which === 'both' ? s.ours.map((_, i) => i) : []),
      theirs: new Set(which === 'theirs' || which === 'both' ? s.theirs.map((_, i) => i) : []),
    };
  }

  // Trecho igual nos dois lados: mostra só as bordas.
  function contextBlock(text) {
    const lines = text.split('\n');
    const shown = lines.length > 7 ? [...lines.slice(0, 3), null, ...lines.slice(-3)] : lines;
    return h(
      'div',
      { class: 'merge-ctx' },
      shown.map((l) => (l === null ? h('div', { class: 'merge-skip' }, `… ${lines.length - 6} linhas iguais …`) : h('div', { class: 'merge-line' }, h('span', { class: 'code' }, l || ' '))))
    );
  }

  function renderConflict(tab) {
    const C = tab.els.center;
    const v = tab.view;
    const prevTop = C.querySelector('.merge-panes')?.scrollTop || 0;
    C.innerHTML = '';
    if (v.content == null) {
      C.append(h('div', { class: 'empty' }, 'Não foi possível ler o arquivo (binário ou removido). Use "ours"/"theirs" no menu do arquivo.'));
      return;
    }
    const segs = v.segs || (v.segs = parseConflicts(v.content));
    for (const s of segs) if (s.type === 'conflict' && !s.pick) s.pick = { ours: new Set(), theirs: new Set() };
    if (v.output == null) v.output = assemble(segs);
    const conflicts = segs.filter((s) => s.type === 'conflict');
    const done = conflicts.filter((s) => s.touched).length;
    const update = () => {
      v.output = assemble(segs);
      renderConflict(tab);
    };

    const panes = h('div', { class: 'merge-panes' });
    panes.append(
      h(
        'div',
        { class: 'merge-cols-head' },
        h('div', {}, 'Meu: ', h('span', { class: 'mono' }, conflicts[0]?.oursLabel || 'HEAD')),
        h('div', {}, 'Deles: ', h('span', { class: 'mono' }, conflicts[0]?.theirsLabel || ''))
      )
    );
    let n = 0;
    for (const s of segs) {
      if (s.type === 'text') {
        if (s.text) panes.append(contextBlock(s.text));
        continue;
      }
      const idx = ++n;
      const side = (which) => {
        const lines = s[which];
        const all = lines.length > 0 && lines.every((_, i) => s.pick[which].has(i));
        const head = h('input', { type: 'checkbox', title: 'Marcar todas as linhas deste lado' });
        head.checked = all;
        head.addEventListener('change', () => {
          s.touched = true;
          s.pick[which] = new Set(head.checked ? lines.map((_, i) => i) : []);
          update();
        });
        return h(
          'div',
          { class: 'merge-side ' + which },
          h('label', { class: 'merge-side-head' }, head, which === 'ours' ? 'Todas as minhas' : 'Todas as deles'),
          lines.length
            ? lines.map((l, i) => {
                const cb = h('input', { type: 'checkbox' });
                cb.checked = s.pick[which].has(i);
                cb.addEventListener('change', () => {
                  s.touched = true;
                  if (cb.checked) s.pick[which].add(i);
                  else s.pick[which].delete(i);
                  update();
                });
                return h('label', { class: 'merge-line pick' + (cb.checked ? ' on' : '') }, cb, h('span', { class: 'code' }, l || ' '));
              })
            : h('div', { class: 'merge-line dim' }, h('span', { class: 'code' }, '(nada deste lado)'))
        );
      };
      const btn = (label, which) =>
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              choose(s, which);
              update();
            },
          },
          label
        );
      panes.append(
        h(
          'div',
          { class: 'merge-block' + (s.touched ? ' done' : ''), 'data-conflict': idx },
          h(
            'div',
            { class: 'cb-head' },
            h('strong', { class: 'grow' }, `Conflito ${idx} de ${conflicts.length}`, s.touched ? ' — resolvido' : ''),
            btn('Usar meu', 'ours'),
            btn('Usar deles', 'theirs'),
            btn('Ambos', 'both'),
            btn('Nenhum', 'none'),
            s.touched
              ? h(
                  'button',
                  {
                    class: 'btn small',
                    title: 'Voltar a deixar este conflito sem escolha',
                    onclick: () => {
                      s.touched = false;
                      s.pick = { ours: new Set(), theirs: new Set() };
                      update();
                    },
                  },
                  'Desfazer'
                )
              : null
          ),
          h('div', { class: 'merge-sides' }, side('ours'), side('theirs'))
        )
      );
    }
    if (!conflicts.length) panes.append(h('div', { class: 'empty' }, 'Nenhum marcador de conflito encontrado. Revise o resultado abaixo e salve.'));

    const output = h('textarea', { spellcheck: 'false' });
    output.value = v.output;
    output.addEventListener('input', () => (v.output = output.value));
    const next = () => {
      const s = conflicts.findIndex((c) => !c.touched);
      const el = panes.querySelector(`[data-conflict="${s + 1}"]`);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    C.append(
      h(
        'div',
        { class: 'diff-head' },
        h('span', { class: 'path' }, '⚠ ', v.file),
        h('span', { class: 'dim' }, `${done} de ${conflicts.length} resolvido(s)`),
        done < conflicts.length ? h('button', { class: 'btn small', onclick: next }, 'Próximo conflito') : null,
        h('button', { class: 'btn small', onclick: () => tab.resolveWith(v.file, 'ours') }, 'Arquivo inteiro: meu'),
        h('button', { class: 'btn small', onclick: () => tab.resolveWith(v.file, 'theirs') }, 'Arquivo inteiro: deles'),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => tab.closeView() }, '✕')
      ),
      h(
        'div',
        { class: 'conflict-body' },
        panes,
        h(
          'div',
          { class: 'conflict-output' },
          h(
            'div',
            { class: 'row', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('strong', {}, 'Resultado (editável)'),
            h('span', { class: 'dim small', style: { flex: 1 } }, 'Marcar linhas acima refaz o resultado.'),
            h('button', { class: 'btn primary small', onclick: () => tab.saveConflict(v.file, output.value) }, 'Salvar e marcar resolvido')
          ),
          output
        )
      )
    );
    panes.scrollTop = prevTop;
  }

  // ---------- rebase interativo ----------
  const REBASE_ACTIONS = [
    ['pick', 'Manter'],
    ['reword', 'Editar mensagem'],
    ['squash', 'Juntar com o de baixo'],
    ['fixup', 'Juntar e descartar a mensagem'],
    ['drop', 'Remover'],
  ];

  // Janela do rebase interativo. Mostra os commits do mais novo (em cima) para o
  // mais antigo, como no grafo; devolve o plano na ordem do git (mais antigo
  // primeiro) ou null se cancelar.
  function rebaseEditor(tab, commits, { branch, base }) {
    const steps = commits
      .slice()
      .reverse()
      .map((c) => ({ ...c, action: 'pick', original: c.message, subject: c.message.split('\n')[0] }));
    return new Promise((resolve) => {
      openModal(
        (close) => {
          const list = h('div', { class: 'rebase-list' });
          const err = h('div', { class: 'rebase-error' });
          const start = h(
            'button',
            { class: 'btn primary', onclick: () => close(steps.slice().reverse().map(({ sha, action, message, original }) => ({ sha, action, message, original }))) },
            'Iniciar rebase'
          );
          const validate = () => {
            let msg = '';
            if (!steps.some((st) => st.action !== 'drop')) msg = 'Mantenha pelo menos um commit. Para descartar todos, use o Reset.';
            steps.forEach((st, i) => {
              // squash/fixup junta com o commit mantido logo abaixo
              if (!msg && (st.action === 'squash' || st.action === 'fixup') && !steps.slice(i + 1).some((x) => x.action !== 'drop'))
                msg = `${st.sha.slice(0, 7)} não tem um commit abaixo para juntar.`;
              if (!msg && st.action === 'reword' && !st.message.trim()) msg = `A mensagem de ${st.sha.slice(0, 7)} está vazia.`;
            });
            err.textContent = msg;
            start.disabled = !!msg;
          };
          let dragFrom = null;
          const move = (from, to) => {
            if (to < 0 || to >= steps.length || from === to) return;
            const [st] = steps.splice(from, 1);
            steps.splice(to, 0, st);
            render();
          };
          const render = () => {
            list.innerHTML = '';
            steps.forEach((st, i) => {
              const select = h('select', {}, REBASE_ACTIONS.map(([v, l]) => h('option', { value: v, selected: v === st.action }, l)));
              select.addEventListener('change', () => {
                st.action = select.value;
                render();
              });
              let msgEl;
              if (st.action === 'reword') {
                msgEl = h('textarea', { rows: 3, spellcheck: 'true' });
                msgEl.value = st.message;
                msgEl.addEventListener('input', () => {
                  st.message = msgEl.value;
                  validate();
                });
              } else msgEl = h('span', { class: 'ellip', title: st.message }, st.subject);
              const row = h(
                'div',
                { class: 'rebase-row act-' + st.action },
                h(
                  'span',
                  {
                    class: 'grip',
                    title: 'Arraste para reordenar',
                    draggable: 'true',
                    ondragstart: (e) => {
                      dragFrom = i;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setDragImage(row, 12, 12);
                    },
                  },
                  '⋮⋮'
                ),
                select,
                h('span', { class: 'mono dim' }, st.sha.slice(0, 7)),
                h('div', { class: 'rebase-msg' }, msgEl),
                h('span', { class: 'dim small ellip rebase-author' }, st.author),
                h('button', { class: 'icon-btn', title: 'Subir', disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
                h('button', { class: 'icon-btn', title: 'Descer', disabled: i === steps.length - 1, onclick: () => move(i, i + 1) }, '↓')
              );
              row.addEventListener('dragover', (e) => {
                if (dragFrom == null) return;
                e.preventDefault();
                row.classList.add('drop-target');
              });
              row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
              row.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = dragFrom;
                dragFrom = null;
                move(from, i);
              });
              row.addEventListener('dragend', () => (dragFrom = null));
              list.append(row);
            });
            validate();
          };
          render();
          return h(
            'div',
            { class: 'modal wide rebase-modal' },
            h('h2', {}, `Rebase interativo de ${branch}`),
            h('div', { class: 'msg' }, `${steps.length} commit(s) depois de ${base}, do mais novo (em cima) para o mais antigo. Arraste pela alça ou use as setas para mudar a ordem.`),
            h('div', { class: 'msg warn' }, 'Isso reescreve o histórico. Se esses commits já foram enviados, o próximo push vai precisar ser forçado.'),
            list,
            err,
            h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Cancelar'), start)
          );
        },
        { onClose: resolve }
      );
    });
  }

  window.Views = { setColumnPrefs, buildLayout, renderToolbar, renderBanner, renderLeft, renderGraph, renderGraphRows, scrollToRow, renderRight, renderDiff, renderConflict, renderHistory, renderBlame, renderEditor, rebaseEditor, messageEditor, setDiffPrefs, diffPrefs, ROW_H };
})();
