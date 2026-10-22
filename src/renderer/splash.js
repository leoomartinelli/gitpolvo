'use strict';

// Tela de abertura: o polvo puxa bloquinhos com os tentáculos.
// Fica no mínimo 2 s; se o app ainda estiver carregando, continua até terminar.

(() => {
  const root = document.getElementById('splash');
  if (!root) return;

  const MIN_MS = 2000;
  const loop = root.dataset.loop === '1';
  const stage = root.querySelector('.splash-stage');
  const NS = 'http://www.w3.org/2000/svg';

  const TENTACLES = [
    { attach: [78, 140], rest: [34, 200], c1: [60, 170], c2: [40, 175], color: '#e3b341' },
    { attach: [100, 150], rest: [82, 222], c1: [95, 185], c2: [80, 200], color: '#34d1bf' },
    { attach: [128, 154], rest: [128, 226], c1: [128, 190], c2: [128, 205], color: '#e0675f' },
    { attach: [156, 150], rest: [174, 222], c1: [161, 185], c2: [176, 200], color: '#a463f2' },
    { attach: [178, 140], rest: [222, 200], c1: [196, 170], c2: [216, 175], color: '#5b8def' },
  ];

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'splash-art');
  svg.setAttribute('viewBox', '-72 -36 400 340');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <defs>
      <linearGradient id="splash-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#34d1bf"/>
        <stop offset="1" stop-color="#1b8f84"/>
      </linearGradient>
    </defs>
    <g class="splash-tents"></g>
    <g class="splash-blocks"></g>
    <g class="splash-body">
      <path d="M128 36 C178 36 196 76 196 108 C196 140 168 156 128 156 C88 156 60 140 60 108 C60 76 78 36 128 36 Z" fill="url(#splash-g)"/>
      <g class="splash-eyes">
        <circle cx="106" cy="104" r="12" fill="#1b1e24"/>
        <circle cx="150" cy="104" r="12" fill="#1b1e24"/>
        <circle cx="110" cy="100" r="4" fill="#fff"/>
        <circle cx="154" cy="100" r="4" fill="#fff"/>
      </g>
    </g>`;
  stage.append(svg);

  const tentG = svg.querySelector('.splash-tents');
  const blockG = svg.querySelector('.splash-blocks');

  const items = TENTACLES.map((t, i) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'url(#splash-g)');
    path.setAttribute('stroke-width', '15');
    path.setAttribute('stroke-linecap', 'round');
    tentG.append(path);

    const block = document.createElementNS(NS, 'rect');
    block.setAttribute('width', '20');
    block.setAttribute('height', '20');
    block.setAttribute('rx', '4');
    block.setAttribute('stroke', 'rgba(255,255,255,0.28)');
    block.setAttribute('stroke-width', '1.2');
    block.setAttribute('fill', t.color);
    blockG.append(block);

    const reach = stretch(t.attach, t.rest, 1.72);
    return { ...t, path, block, reach, phaseOff: i * 95 };
  });

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerp2(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }
  function clamp(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function stretch(attach, rest, k) {
    return [attach[0] + (rest[0] - attach[0]) * k, attach[1] + (rest[1] - attach[1]) * k];
  }
  function mixCtrl(attach, restCtrl, restTip, tip) {
    const rx = restTip[0] - attach[0];
    const ry = restTip[1] - attach[1];
    const tx = tip[0] - attach[0];
    const ty = tip[1] - attach[1];
    const rlen = Math.hypot(rx, ry) || 1;
    const scale = Math.hypot(tx, ty) / rlen;
    const da = Math.atan2(ty, tx) - Math.atan2(ry, rx);
    const cx = restCtrl[0] - attach[0];
    const cy = restCtrl[1] - attach[1];
    const cos = Math.cos(da);
    const sin = Math.sin(da);
    return [attach[0] + (cx * cos - cy * sin) * scale, attach[1] + (cx * sin + cy * cos) * scale];
  }
  function wave(attach, tip, now, i) {
    const nx = -(tip[1] - attach[1]);
    const ny = tip[0] - attach[0];
    const len = Math.hypot(nx, ny) || 1;
    const a = Math.sin(now * 0.0032 + i * 0.9) * 7;
    return [(nx / len) * a, (ny / len) * a];
  }

  function poseAt(now, it, i) {
    const local = now - it.phaseOff;
    // montagem: aparece longe, tentáculo alcança, puxa até a pose do ícone
    if (local < 2200) {
      const u = local / 2200;
      let tipT;
      if (u < 0.16) tipT = 1;
      else if (u < 0.62) tipT = 1 - ease((u - 0.16) / 0.46);
      else tipT = 0;
      const tip = lerp2(it.rest, it.reach, tipT);
      const vis = u < 0.12 ? ease(u / 0.12) : 1;
      return { tip, block: tip, scale: vis, absorb: 0 };
    }

    // depois: a cada ciclo um tentáculo busca outro bloquinho e engole
    const cycle = 2200;
    const t = (local - 2200 + i * 180) % cycle;
    const rest = it.rest;
    const far = stretch(it.attach, it.rest, 1.85 + 0.08 * Math.sin(i + now * 0.0004));
    if (t < 400) return { tip: rest, block: rest, scale: 1, absorb: 0 };
    if (t < 750) {
      const e = ease((t - 400) / 350);
      const tip = lerp2(rest, far, e);
      return { tip, block: far, scale: e, absorb: 0 };
    }
    if (t < 1600) {
      const e = ease((t - 750) / 850);
      const p = lerp2(far, it.attach, e);
      const tip = e < 0.72 ? lerp2(far, rest, e / 0.72) : lerp2(rest, it.attach, (e - 0.72) / 0.28);
      return { tip, block: p, scale: 1 - e * 0.35, absorb: e };
    }
    const e = ease((t - 1600) / 600);
    const tip = lerp2(it.attach, rest, e);
    return { tip, block: it.attach, scale: 0, absorb: 1 };
  }

  function draw(now) {
    items.forEach((it, i) => {
      const p = poseAt(now, it, i);
      const w = wave(it.attach, p.tip, now, i);
      const c1 = mixCtrl(it.attach, it.c1, it.rest, p.tip);
      const c2 = mixCtrl(it.attach, it.c2, it.rest, p.tip);
      it.path.setAttribute(
        'd',
        `M${it.attach[0]} ${it.attach[1]} C${c1[0] + w[0]} ${c1[1] + w[1]} ${c2[0] + w[0] * 0.4} ${c2[1] + w[1] * 0.4} ${p.tip[0]} ${p.tip[1]}`
      );
      const s = Math.max(0, p.scale);
      const size = 20 * (1 - p.absorb * 0.5);
      it.block.setAttribute('width', String(size));
      it.block.setAttribute('height', String(size));
      it.block.setAttribute('x', p.block[0] - size / 2);
      it.block.setAttribute('y', p.block[1] - size / 2);
      it.block.setAttribute('transform', `rotate(${12 + i * 15} ${p.block[0]} ${p.block[1]})`);
      it.block.setAttribute('opacity', String(s));
    });
  }

  let running = true;
  const t0 = performance.now();
  function tick(now) {
    draw(now - t0);
    if (running) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const minWait = new Promise((r) => setTimeout(r, MIN_MS));
  function hide() {
    if (loop || !running || root.classList.contains('out')) return;
    root.classList.add('out');
    setTimeout(() => {
      running = false;
      root.remove();
    }, 480);
  }

  window.polvoSplash = {
    waitFor(p) {
      Promise.all([minWait, Promise.resolve(p)]).then(hide, hide);
    },
  };
})();
