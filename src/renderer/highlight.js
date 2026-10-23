'use strict';

// Realce de sintaxe leve para o diff, linha a linha: comentários, strings,
// números, palavras-chave, funções e variáveis. O estado (comentário de bloco
// ou string de várias linhas aberta) passa de uma linha para a seguinte.
// Também calcula as palavras que mudaram entre uma linha removida e a adicionada.

(() => {
  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

  const C_KW =
    'if else for while do switch case default break continue return goto try catch finally throw new delete this class struct enum union typedef const static void public private protected virtual override final abstract interface extends implements package import using namespace true false null nullptr sizeof volatile extern inline template typename auto int long short char float double bool boolean byte unsigned signed string var let func fn go defer chan select map range type impl trait pub mut match loop where self super crate mod use as in is val when object fun data sealed suspend async await yield get set';

  const LANGS = {
    js: {
      line: ['//'],
      block: ['/*', '*/'],
      strings: ['"', "'"],
      multi: ['`'],
      kw: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set from as null undefined true false interface type enum implements private public protected readonly declare namespace abstract',
    },
    php: {
      line: ['//', '#'],
      block: ['/*', '*/'],
      strings: ['"', "'"],
      vars: '$',
      kw: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield null true false self parent int string bool float void mixed',
    },
    py: {
      line: ['#'],
      strings: ['"', "'"],
      multi: ['"""', "'''"],
      kw: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self',
    },
    c: { line: ['//'], block: ['/*', '*/'], strings: ['"', "'"], multi: ['`'], kw: C_KW },
    css: { block: ['/*', '*/'], strings: ['"', "'"], kw: 'important media import from to and not only screen', at: true },
    html: { block: ['<!--', '-->'], strings: ['"', "'"], tags: true, kw: '' },
    json: { strings: ['"'], kw: 'true false null' },
    sql: {
      line: ['--'],
      block: ['/*', '*/'],
      strings: ["'", '"'],
      ci: true,
      kw: 'select from where and or not insert into values update set delete create table alter drop index view join left right inner outer full cross on group by order having limit offset as distinct union all null is in like between case when then else end primary key foreign references default exists begin commit rollback transaction procedure function returns return declare if count sum avg min max asc desc',
    },
    sh: { line: ['#'], strings: ['"', "'"], vars: '$', kw: 'if then else elif fi for while until do done case esac function return in export local readonly echo exit source alias set unset shift' },
    rb: { line: ['#'], strings: ['"', "'"], vars: '@', kw: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor' },
    yaml: { line: ['#'], strings: ['"', "'"], kw: 'true false null yes no on off', keys: true },
  };
  for (const l of Object.values(LANGS)) l.kwSet = words(l.kw);

  const EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', vue: 'html', svelte: 'html',
    php: 'php', phtml: 'php',
    py: 'py', pyw: 'py',
    c: 'c', h: 'c', cc: 'c', cpp: 'c', hpp: 'c', cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', rs: 'c', swift: 'c', dart: 'c', scala: 'c', groovy: 'c', gradle: 'c',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    html: 'html', htm: 'html', xml: 'html', svg: 'html', xaml: 'html', blade: 'html',
    json: 'json', jsonc: 'js',
    sql: 'sql',
    sh: 'sh', bash: 'sh', zsh: 'sh', env: 'sh',
    rb: 'rb', rake: 'rb',
    yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml',
  };

  function langOf(path) {
    const name = String(path || '').split('/').pop().toLowerCase();
    if (name === 'dockerfile' || name === 'makefile') return 'sh';
    if (name.endsWith('.blade.php')) return 'php';
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return EXT[ext] || null;
  }

  // Devolve [inicio, fim, classe] de cada trecho realçado e o estado para a próxima linha.
  function tokenize(line, lang, state) {
    const L = LANGS[lang];
    const st = { ...(state || {}) };
    const tokens = [];
    if (!L) return { tokens, state: st };
    const n = line.length;
    const push = (s, e, c) => c && e > s && tokens.push([s, e, c]);
    let i = 0;
    while (i < n) {
      if (st.block || st.str) {
        const close = st.block || st.str;
        const end = line.indexOf(close, i);
        const cls = st.block ? 'cm' : 'st';
        if (end < 0) {
          push(i, n, cls);
          return { tokens, state: st };
        }
        push(i, end + close.length, cls);
        i = end + close.length;
        st.block = st.str = null;
        continue;
      }
      const ch = line[i];
      const rest = line.slice(i);
      if (L.line && L.line.some((p) => line.startsWith(p, i)) && !(ch === '#' && lang === 'php' && line[i + 1] === '[')) {
        push(i, n, 'cm');
        break;
      }
      if (L.block && line.startsWith(L.block[0], i)) {
        st.block = L.block[1];
        push(i, i + L.block[0].length, 'cm');
        i += L.block[0].length;
        continue;
      }
      const multi = L.multi && L.multi.find((q) => line.startsWith(q, i));
      if (multi) {
        st.str = multi;
        push(i, i + multi.length, 'st');
        i += multi.length;
        continue;
      }
      if (L.strings && L.strings.includes(ch)) {
        let j = i + 1;
        while (j < n && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        push(i, Math.min(n, j + 1), L.keys && line.slice(j + 1).trimStart().startsWith(':') ? 'at' : 'st');
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(ch) && !/[\w$@]/.test(line[i - 1] || '')) {
        const m = /^(0x[0-9a-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)/i.exec(rest);
        push(i, i + m[0].length, 'nu');
        i += m[0].length;
        continue;
      }
      if (L.vars && ch === L.vars && /[A-Za-z_{@]/.test(line[i + 1] || '')) {
        const m = /^[$@]@?\{?[A-Za-z_]\w*\}?/.exec(rest);
        if (m) {
          push(i, i + m[0].length, 'va');
          i += m[0].length;
          continue;
        }
      }
      if (L.tags && ch === '<') {
        const m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest);
        if (m) {
          push(i, i + m[0].length, 'kw');
          i += m[0].length;
          continue;
        }
      }
      if (L.at && ch === '@') {
        const m = /^@[\w-]+/.exec(rest);
        push(i, i + m[0].length, 'kw');
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const w = /^[A-Za-z_][\w-]*/.exec(rest)[0].replace(/-+$/, '');
        const word = lang === 'css' || lang === 'html' || lang === 'yaml' ? w : w.replace(/-.*/, '');
        const next = line.slice(i + word.length).trimStart()[0];
        const key = L.ci ? word.toLowerCase() : word;
        let cls = null;
        if (L.kwSet.has(key)) cls = 'kw';
        else if (L.keys && next === ':' && !line.slice(0, i).trim()) cls = 'at';
        else if ((L.tags || L.at) && (next === '=' || next === ':')) cls = 'at';
        else if (next === '(' && !L.tags) cls = 'fn';
        else if (/^[A-Z][a-z]/.test(word) && !L.ci && !L.tags) cls = 'ty';
        push(i, i + word.length, cls);
        i += word.length;
        continue;
      }
      i++;
    }
    return { tokens, state: st };
  }

  // Trechos que mudaram entre a linha antiga e a nova, por palavra (LCS).
  // Devolve [trechosAntigos, trechosNovos], cada um uma lista de [inicio, fim].
  function wordDiff(a, b) {
    const split = (s) => {
      const out = [];
      const re = /\s+|\w+|[^\w\s]/g;
      let m;
      while ((m = re.exec(s))) out.push([m.index, m.index + m[0].length, m[0]]);
      return out;
    };
    const ta = split(a);
    const tb = split(b);
    if (!ta.length || !tb.length || ta.length * tb.length > 40000) return [[], []];
    const dp = Array.from({ length: ta.length + 1 }, () => new Uint16Array(tb.length + 1));
    for (let i = ta.length - 1; i >= 0; i--)
      for (let j = tb.length - 1; j >= 0; j--) dp[i][j] = ta[i][2] === tb[j][2] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    // pouca coisa em comum: a linha mudou inteira, destacar palavras só polui
    if (dp[0][0] * 2 < Math.min(ta.length, tb.length)) return [[], []];
    const ra = [];
    const rb = [];
    const add = (list, t) => {
      const last = list[list.length - 1];
      if (last && last[1] === t[0]) last[1] = t[1];
      else list.push([t[0], t[1]]);
    };
    let i = 0;
    let j = 0;
    while (i < ta.length && j < tb.length) {
      if (ta[i][2] === tb[j][2]) {
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) add(ra, ta[i++]);
      else add(rb, tb[j++]);
    }
    while (i < ta.length) add(ra, ta[i++]);
    while (j < tb.length) add(rb, tb[j++]);
    const real = (list, s) => list.filter(([x, y]) => s.slice(x, y).trim());
    return [real(ra, a), real(rb, b)];
  }

  // Monta os nós da linha juntando o realce de sintaxe e as palavras alteradas.
  function codeNodes(text, tokens, marks) {
    const cuts = new Set([0, text.length]);
    for (const [s, e] of tokens) cuts.add(s).add(e);
    for (const [s, e] of marks || []) cuts.add(s).add(e);
    const pts = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((x, y) => x - y);
    const nodes = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [s, e] = [pts[k], pts[k + 1]];
      if (e <= s) continue;
      const tok = tokens.find(([ts, te]) => ts <= s && e <= te);
      const marked = (marks || []).some(([ms, me]) => ms <= s && e <= me);
      const piece = text.slice(s, e);
      if (!tok && !marked) {
        nodes.push(document.createTextNode(piece));
        continue;
      }
      const span = document.createElement('span');
      span.className = [tok ? 'hl-' + tok[2] : '', marked ? 'wd' : ''].filter(Boolean).join(' ');
      span.textContent = piece;
      nodes.push(span);
    }
    return nodes;
  }

  window.Highlight = { langOf, tokenize, wordDiff, codeNodes };
})();
