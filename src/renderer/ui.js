'use strict';

// Utilitários de interface: criação de elementos, toasts, menu de contexto,
// modais (prompt/confirm/formulário) e paleta de comandos.

const LANE_COLORS = ['#1e90ff', '#00b8c4', '#a463f2', '#e8590c', '#e6b800', '#e64980', '#2fbf71', '#7c5cff', '#ff8a3d', '#4dabf7'];

function laneColor(i) {
  return LANE_COLORS[i % LANE_COLORS.length];
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

function hashColor(str) {
  let x = 0;
  for (const ch of str || '') x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${x % 360} 55% 45%)`;
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Fotos de perfil: o processo principal busca e guarda em cache; aqui guardamos
// o resultado por e-mail (data URL, null = sem foto, Promise = buscando).
const avatars = { enabled: true, cache: new Map() };

function avatarImg(src) {
  return h('img', { src, alt: '', draggable: 'false' });
}

// ctx opcional { owner, repo, sha } permite consultar a API do GitHub.
function avatar(name, email, big, ctx) {
  const el = h('span', { class: 'avatar' + (big ? ' big' : ''), style: { background: hashColor(email || name) }, title: `${name} <${email}>` });
  const key = (email || '').trim().toLowerCase();
  const cached = avatars.cache.get(key);
  if (avatars.enabled && typeof cached === 'string') {
    el.append(avatarImg(cached));
    return el;
  }
  el.append(initials(name));
  if (!avatars.enabled || !key || cached === null) return el;
  el.dataset.avatarEmail = key;
  if (!cached) {
    avatars.cache.set(
      key,
      window.polvo.avatar(key, ctx).then((img) => {
        avatars.cache.set(key, img || null);
        if (!img) return;
        for (const node of document.querySelectorAll('.avatar[data-avatar-email]')) {
          if (node.dataset.avatarEmail !== key) continue;
          node.textContent = '';
          node.append(avatarImg(img));
        }
      })
    );
  }
  return el;
}

function relDate(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)} h atrás`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d atrás`;
  return d.toLocaleDateString('pt-BR');
}

function fullDate(d) {
  return d.toLocaleString('pt-BR');
}

function toast(msg, kind) {
  const el = h('div', { class: 'toast' + (kind === 'error' ? ' error' : '') }, msg);
  document.getElementById('toasts').append(el);
  el.addEventListener('click', () => el.remove());
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 3500);
}

// ---------- menu de contexto ----------
const ctx = document.getElementById('ctxmenu');

function showMenu(x, y, items) {
  ctx.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      ctx.append(h('div', { class: 'cm-sep' }));
      continue;
    }
    ctx.append(
      h(
        'div',
        {
          class: 'cm-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : ''),
          onclick: () => {
            hideMenu();
            it.action();
          },
        },
        it.label
      )
    );
  }
  ctx.classList.remove('hidden');
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  ctx.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
}

function hideMenu() {
  ctx.classList.add('hidden');
}

document.addEventListener('mousedown', (e) => {
  if (!ctx.contains(e.target)) hideMenu();
});
window.addEventListener('blur', hideMenu);

// ---------- modais ----------
const modalRoot = document.getElementById('modal-root');

function openModal(build, { onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = (val) => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose(val);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(null);
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close(null);
  });
  back.append(build(close));
  modalRoot.append(back);
  const first = back.querySelector('input, textarea, select, button.primary');
  if (first) setTimeout(() => first.focus(), 0);
  return close;
}

// fields: [{ name, label, value, type, placeholder, options, browse }]
function form(title, fields, { ok = 'OK', danger = false, message } = {}) {
  return new Promise((resolve) => {
    openModal(
      (close) => {
        const inputs = {};
        const submit = () => {
          const out = {};
          for (const [k, el] of Object.entries(inputs)) out[k] = el.type === 'checkbox' ? el.checked : el.value;
          close(out);
        };
        const body = h('form', {
          class: 'modal',
          onsubmit: (e) => {
            e.preventDefault();
            submit();
          },
        });
        body.append(h('h2', {}, title));
        if (message) body.append(h('div', { class: 'msg' }, message));
        for (const f of fields) {
          let input;
          if (f.options) {
            input = h('select', {}, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
          } else if (f.type === 'checkbox') {
            input = h('input', { type: 'checkbox', disabled: !!f.disabled });
            input.checked = !!f.value;
            input.disabled = !!f.disabled;
            inputs[f.name] = input;
            body.append(h('label', { class: 'check' + (f.disabled ? ' disabled' : '') }, input, f.label));
            continue;
          } else {
            input = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', spellcheck: 'false' });
            input.value = f.value || '';
          }
          inputs[f.name] = input;
          const control = f.browse
            ? h(
                'div',
                { class: 'row' },
                input,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    onclick: async () => {
                      const dir = await window.polvo.pickDir(f.label);
                      if (dir) input.value = dir;
                    },
                  },
                  'Procurar...'
                )
              )
            : input;
          body.append(h('label', {}, f.label, control));
        }
        body.append(
          h(
            'div',
            { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancelar'),
            h('button', { type: 'submit', class: 'btn primary' + (danger ? ' danger-bg' : '') }, ok)
          )
        );
        return body;
      },
      { onClose: resolve }
    );
  });
}

async function prompt(title, label, value, opts) {
  const r = await form(title, [{ name: 'v', label, value }], opts);
  return r ? r.v.trim() : null;
}

function confirmBox(title, message, ok = 'Confirmar') {
  return form(title, [], { ok, message }).then((r) => r !== null);
}

function choices(title, message, buttons) {
  return new Promise((resolve) => {
    openModal(
      (close) =>
        h(
          'div',
          { class: 'modal' },
          h('h2', {}, title),
          message ? h('div', { class: 'msg' }, message) : null,
          h(
            'div',
            { class: 'actions' },
            ...buttons.map((b) =>
              h(
                'button',
                {
                  class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger-bg' : ''),
                  onclick: () => close(b.id),
                },
                b.label
              )
            )
          )
        ),
      { onClose: resolve }
    );
  });
}

// ---------- paleta de comandos ----------
function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - idx;
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += found === ti ? 2 : 1;
    ti = found + 1;
  }
  return score;
}

function palette(items, placeholder = 'Digite um comando...') {
  openModal((close) => {
    const input = h('input', { placeholder, spellcheck: 'false' });
    const list = h('div', { class: 'items' });
    let shown = [];
    let active = 0;
    const render = () => {
      const q = input.value.trim();
      shown = items
        .map((it) => ({ it, s: fuzzyScore(q, it.label + ' ' + (it.group || '')) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.it);
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      shown.forEach((it, i) =>
        list.append(
          h(
            'div',
            {
              class: 'pal-item' + (i === active ? ' active' : ''),
              onmousemove: () => {
                if (active !== i) {
                  active = i;
                  render();
                }
              },
              onclick: () => run(it),
            },
            it.label,
            it.group ? h('span', { class: 'grp' }, it.group) : null
          )
        )
      );
      const a = list.children[active];
      if (a) a.scrollIntoView({ block: 'nearest' });
    };
    const run = (it) => {
      close();
      it.action();
    };
    input.addEventListener('input', () => {
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') active = Math.min(active + 1, shown.length - 1);
      else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
      else if (e.key === 'Enter' && shown[active]) return run(shown[active]);
      else return;
      e.preventDefault();
      render();
    });
    render();
    return h('div', { class: 'modal palette' }, input, list);
  });
}

function inlineMd(s) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[1];
    if (tok.startsWith('**')) out.push(h('strong', {}, tok.slice(2, -2)));
    else if (tok.startsWith('`')) out.push(h('code', {}, tok.slice(1, -1)));
    else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      out.push(
        h(
          'a',
          {
            href: mm[2],
            onclick: (e) => {
              e.preventDefault();
              if (window.polvo) window.polvo.openExternal(mm[2]);
            },
          },
          mm[1]
        )
      );
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function renderMarkdown(md) {
  const root = h('div', { class: 'md' });
  const lines = String(md || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let list = null;
  const flush = () => {
    if (list) {
      root.append(list);
      list = null;
    }
  };
  for (const line of lines) {
    if (/^# /.test(line)) {
      flush();
      root.append(h('h1', {}, ...inlineMd(line.slice(2))));
    } else if (/^## /.test(line)) {
      flush();
      root.append(h('h2', {}, ...inlineMd(line.slice(3))));
    } else if (/^### /.test(line)) {
      flush();
      root.append(h('h3', {}, ...inlineMd(line.slice(4))));
    } else if (/^[-*] /.test(line)) {
      if (!list) list = h('ul', {});
      list.append(h('li', {}, ...inlineMd(line.slice(2))));
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      root.append(h('p', {}, ...inlineMd(line)));
    }
  }
  flush();
  return root;
}

window.UI = { h, svg, laneColor, hashColor, avatar, avatars, relDate, fullDate, toast, showMenu, hideMenu, openModal, form, prompt, confirmBox, choices, palette, renderMarkdown };
