/* =============================================================
   hero-sim.js — interactive adaptive-mesh backdrop for the homepage hero

   Physics: a concentration field c(x, t) obeying
        ∂c/∂t + u·∇c = D ∇²c − k c + s(x, t)
   solved on a uniform grid (semi-Lagrangian advection, explicit diffusion).

   Flow: the velocity comes from a stream function, u = ∂ψ/∂y, v = −∂ψ/∂x, so it
   is divergence-free by construction. The profile photo is a solid cylinder:
        ψ = (1 − R²/r²) · (ψ_free + ψ_wake)
   vanishes on r = R, making the photo's edge a streamline (no penetration).
   For uniform ψ_free this is exactly potential flow past a cylinder; ψ_free adds
   a gentle meander and ψ_wake sheds alternating vortices behind the body.

   Mesh: a quadtree (deal.II-style, hanging nodes allowed). A cell is split when
   c varies by more than `tol` inside it, when it straddles the obstacle wall,
   or when it is near the cursor. `tol` self-tunes to keep the leaf count near a budget.
   ============================================================= */
(function () {
  'use strict';

  const hero = document.querySelector('.hero');
  if (!hero || !window.HTMLCanvasElement) return;
  const photo = hero.querySelector('.hero-photo img');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── DOM ──────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const shade = document.createElement('div');
  shade.className = 'hero-shade';
  const hud = document.createElement('div');
  hud.className = 'sim-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML =
    '<div class="cmt"># move the cursor to stir &amp; inject · click to release a pulse</div>' +
    '<div><span class="prompt">$</span> ./advect_diffuse --adaptive --obstacle=photo</div>' +
    '<div><span class="stat"></span><span class="cursor"></span></div>';
  const hudStat = hud.querySelector('.stat');
  hero.prepend(shade);
  hero.prepend(canvas);
  hero.appendChild(hud);
  hero.classList.add('hero-live');
  const ctx = canvas.getContext('2d');

  // ── Parameters ───────────────────────────────────────────────
  const H      = 6;          // grid spacing (CSS px) = finest mesh cell
  const LMAX   = 4;          // refinement levels; root cells are H·2^LMAX = 96 px
  const ROOT   = 1 << LMAX;  // grid cells per root-cell edge
  const U0     = 0.32;       // free-stream speed (cells / step)
  const KAPPA  = 0.06;       // diffusion number D·dt/h² (explicit; stable < 0.25)
  const DECAY  = 0.9985;     // first-order consumption per step
  const BUDGET = 2400;       // target number of mesh cells
  const CURSOR_R = 54;       // radius (px) of finest refinement around the cursor
  const SHED_EVERY = 1.6;    // seconds between shed wake vortices

  // ── State ────────────────────────────────────────────────────
  let W = 0, HT = 0, nx = 0, ny = 0, dpr = 1;
  let c, c2, psi, ux, uy, F, solid, pyr = [], sources = [];
  let rowT, colT;
  let t = 0, tol = 0.12, frame = 0, maxLevel = 0, nextShed = 0, shedSign = 1;
  let scale = 0.3;            // running colour-bar maximum (auto-ranged like a contour plot)
  const ob = { x: 0, y: 0, r: 0 };   // obstacle in px
  const vortices = [];        // {i, j, g}
  const leaves = [];          // flat: x, y, size, mean, level
  const mouse = { x: -1e4, y: -1e4, vx: 0, vy: 0, inside: false, last: 0 };

  // ── Colour map: viridis, fading to transparent at zero (64 buckets) ──
  const STOPS = [
    [0.00, [13, 11, 24, 0.00]],
    [0.10, [68, 1, 84, 0.40]],
    [0.30, [59, 82, 139, 0.52]],
    [0.50, [33, 145, 140, 0.60]],
    [0.75, [94, 201, 98, 0.68]],
    [1.00, [253, 231, 37, 0.78]],
  ];
  const NB = 64;
  const LUT = Array.from({ length: NB }, (_, b) => {
    const v = b / (NB - 1);
    let k = 0;
    while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
    const [v0, a] = STOPS[k], [v1, bb] = STOPS[k + 1];
    const f = (v - v0) / (v1 - v0);
    const m = a.map((x, i) => x + (bb[i] - x) * f);
    return `rgba(${m[0] | 0},${m[1] | 0},${m[2] | 0},${m[3].toFixed(3)})`;
  });
  const buckets = Array.from({ length: NB }, () => []);

  // ── Obstacle: the photo's circle, measured without CSS transforms ──
  function measureObstacle() {
    ob.r = 0;
    if (!photo || !photo.offsetWidth) return;
    let x = 0, y = 0, el = photo;
    while (el && el !== hero) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    if (el !== hero) return;
    ob.x = x + photo.offsetWidth / 2;
    ob.y = y + photo.offsetHeight / 2;
    ob.r = photo.offsetWidth / 2 + 7;   // include the ring
  }

  // ── Setup / resize ───────────────────────────────────────────
  function resize() {
    const r = hero.getBoundingClientRect();
    W = r.width; HT = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(HT * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = HT + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    nx = Math.ceil(W / (H * ROOT)) * ROOT;
    ny = Math.ceil(HT / (H * ROOT)) * ROOT;
    const N = nx * ny;
    c = new Float32Array(N); c2 = new Float32Array(N);
    psi = new Float32Array(N); ux = new Float32Array(N); uy = new Float32Array(N);
    F = new Float32Array(N); solid = new Uint8Array(N);
    rowT = new Float32Array(ny); colT = new Float32Array(nx);
    vortices.length = 0;

    pyr = [];
    for (let l = 0, sx = nx, sy = ny; l <= LMAX; l++, sx >>= 1, sy >>= 1) {
      pyr.push({ nx: sx, ny: sy,
        min: new Float32Array(sx * sy), max: new Float32Array(sx * sy), sum: new Float32Array(sx * sy) });
    }

    // Wall factor F = 1 − R²/r² (0 inside the body) and the solid mask
    measureObstacle();
    const oi = ob.x / H - 0.5, oj = ob.y / H - 0.5, R = ob.r / H, R2 = R * R;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!R) { F[k] = 1; continue; }
        const d2 = (i - oi) ** 2 + (j - oj) ** 2;
        F[k] = d2 > R2 ? 1 - R2 / d2 : 0;
        solid[k] = d2 <= R2 ? 1 : 0;
      }
    }

    // Reaction sites upstream of the photo so plumes split around it
    const rel = ob.r ? [[-1.9, -0.05], [-1.5, 0.6], [-2.6, -0.65]] : [[-4, 0], [-3, 0.6], [-2, -0.6]];
    const bx = ob.r ? ob.x : W * 0.8, by = ob.r ? ob.y : HT * 0.5, br = ob.r || 110;
    sources = rel.map(([fx, fy], k) => ({
      i: Math.max(W * 0.06, bx + fx * br) / H,
      j: Math.min(HT * 0.92, Math.max(HT * 0.08, by + fy * br)) / H,
      ph: k * 2.1, w: 0.7 + 0.25 * k,
    }));

    for (let n = 0; n < 300; n++) stepSim();   // pre-warm so the first frame isn't empty
    buildPyramid(); buildMesh(); render();
  }

  // ── Physics ──────────────────────────────────────────────────
  function deposit(ci, cj, rad, amt) {
    const r = Math.ceil(rad * 2.5), r2 = rad * rad;
    const i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(nx - 1, Math.ceil(ci + r));
    const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(ny - 1, Math.ceil(cj + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (solid[k]) continue;
        const dx = i - ci, dy = j - cj;
        c[k] = Math.min(1.4, c[k] + amt * Math.exp(-(dx * dx + dy * dy) / r2));
      }
    }
  }

  function updateFlow() {
    const oi = ob.x / H - 0.5, oj = ob.y / H - 0.5, R = ob.r / H;

    // Free stream + meander, written as a stream function and re-zeroed at the
    // body centre so the wall factor doesn't add a spurious circulation.
    const m1 = -U0 * 0.2 / 0.05, m2 = U0 * 0.08 / 0.03;
    const ref = m1 * Math.cos(0.05 * oj + 0.6 * t) + m2 * Math.cos(0.03 * oi - 0.5 * t);
    for (let j = 0; j < ny; j++) rowT[j] = U0 * (j - oj) + m1 * Math.cos(0.05 * j + 0.6 * t);
    for (let i = 0; i < nx; i++) colT[i] = m2 * Math.cos(0.03 * i - 0.5 * t);
    for (let j = 0, k = 0; j < ny; j++) {
      const rt = rowT[j] - ref;
      for (let i = 0; i < nx; i++, k++) psi[k] = rt + colT[i];
    }

    // Wake: alternating Gaussian vortices shed from the rear of the body
    if (R) {
      if (t >= nextShed) {
        nextShed = t + SHED_EVERY;
        shedSign = -shedSign;
        vortices.push({ i: oi + 1.25 * R, j: oj + shedSign * 0.42 * R, g: -shedSign * 0.75 * U0 * R * 0.55 });
      }
      const sig = 0.55 * R, s2 = sig * sig, reach = Math.ceil(2.8 * sig);
      for (let q = vortices.length - 1; q >= 0; q--) {
        const v = vortices[q];
        v.i += 0.8 * U0; v.j += (oj - v.j) * 0.002; v.g *= 0.996;
        if (v.i - reach > nx) { vortices.splice(q, 1); continue; }
        const i0 = Math.max(0, Math.floor(v.i - reach)), i1 = Math.min(nx - 1, Math.ceil(v.i + reach));
        const j0 = Math.max(0, Math.floor(v.j - reach)), j1 = Math.min(ny - 1, Math.ceil(v.j + reach));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const dx = i - v.i, dy = j - v.j;
            psi[j * nx + i] += v.g * Math.exp(-(dx * dx + dy * dy) / s2);
          }
        }
      }
    }

    // ψ ← F·ψ, then u = ∂ψ/∂y, v = −∂ψ/∂x (central differences)
    for (let k = 0; k < psi.length; k++) psi[k] *= F[k];
    for (let j = 0; j < ny; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < ny - 1 ? j + 1 : j, dj = jp - jm;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (solid[k]) { ux[k] = uy[k] = 0; continue; }
        const im = i > 0 ? i - 1 : i, ip = i < nx - 1 ? i + 1 : i;
        let u = (psi[jp * nx + i] - psi[jm * nx + i]) / dj;
        let v = -(psi[j * nx + ip] - psi[j * nx + im]) / (ip - im);
        if (u > 1.2) u = 1.2; else if (u < -1.2) u = -1.2;
        if (v > 1.2) v = 1.2; else if (v < -1.2) v = -1.2;
        ux[k] = u; uy[k] = v;
      }
    }
  }

  function stepSim() {
    t += 1 / 60;
    updateFlow();

    // Sources
    for (const s of sources) deposit(s.i, s.j, 2.8, 0.07 * (0.5 + 0.5 * Math.sin(t * s.w + s.ph)));
    const mi = mouse.x / H, mj = mouse.y / H;
    const speed = Math.hypot(mouse.vx, mouse.vy);
    const active = mouse.inside && performance.now() - mouse.last < 400;
    if (active) deposit(mi, mj, 2.5, 0.02 + Math.min(0.08, speed * 0.06));

    // Semi-Lagrangian advection (cursor adds a Gaussian-weighted drag, damped at the wall)
    const R2 = 81, stir = mouse.inside && speed > 0.01;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (solid[k]) { c2[k] = 0; continue; }
        let uu = ux[k], vv = uy[k];
        if (stir) {
          const dx = i - mi, dy = j - mj, d2 = dx * dx + dy * dy;
          if (d2 < 4 * R2) { const g = Math.exp(-d2 / R2) * F[k]; uu += mouse.vx * g; vv += mouse.vy * g; }
        }
        let x = i - uu, y = j - vv;
        if (x < 0) { c2[k] = 0; continue; }               // clean inflow on the left
        if (x > nx - 1.001) x = nx - 1.001;
        if (y < 0) y = 0; else if (y > ny - 1.001) y = ny - 1.001;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, p = y0 * nx + x0;
        c2[k] = (c[p] * (1 - fx) + c[p + 1] * fx) * (1 - fy) +
                (c[p + nx] * (1 - fx) + c[p + nx + 1] * fx) * fy;
      }
    }

    // Explicit diffusion (zero-flux at the domain edges and on the body) + consumption
    for (let j = 0; j < ny; j++) {
      const jm = j > 0 ? -nx : 0, jp = j < ny - 1 ? nx : 0;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (solid[k]) { c[k] = 0; continue; }
        const ck = c2[k];
        const km = i > 0 ? k - 1 : k, kp = i < nx - 1 ? k + 1 : k, kd = k + jm, ku = k + jp;
        const a = solid[km] ? ck : c2[km], b = solid[kp] ? ck : c2[kp];
        const d = solid[kd] ? ck : c2[kd], e = solid[ku] ? ck : c2[ku];
        c[k] = (ck + KAPPA * (a + b + d + e - 4 * ck)) * DECAY;
      }
    }

    mouse.vx *= 0.9; mouse.vy *= 0.9;
  }

  // ── Mesh ─────────────────────────────────────────────────────
  // Min / max / sum pyramid so each quadtree cell's indicator is O(1)
  function buildPyramid() {
    const L0 = pyr[0];
    L0.min.set(c); L0.max.set(c); L0.sum.set(c);
    for (let l = 1; l <= LMAX; l++) {
      const a = pyr[l - 1], b = pyr[l];
      for (let j = 0; j < b.ny; j++) {
        for (let i = 0; i < b.nx; i++) {
          const p = 2 * j * a.nx + 2 * i, q = p + a.nx, k = j * b.nx + i;
          let mn = a.min[p], mx = a.max[p];
          if (a.min[p + 1] < mn) mn = a.min[p + 1]; if (a.max[p + 1] > mx) mx = a.max[p + 1];
          if (a.min[q] < mn) mn = a.min[q];         if (a.max[q] > mx) mx = a.max[q];
          if (a.min[q + 1] < mn) mn = a.min[q + 1]; if (a.max[q + 1] > mx) mx = a.max[q + 1];
          b.min[k] = mn; b.max[k] = mx;
          b.sum[k] = a.sum[p] + a.sum[p + 1] + a.sum[q] + a.sum[q + 1];
        }
      }
    }
  }

  function refine(pl, i, j) {           // pl: pyramid level (LMAX = root, 0 = finest)
    const size = H << pl, x = i * size, y = j * size;
    if (x >= W || y >= HT) return;
    const P = pyr[pl], k = j * P.nx + i;
    const cx = x + size / 2, cy = y + size / 2;
    let wall = false;
    if (ob.r) {
      const d = Math.hypot(cx - ob.x, cy - ob.y), half = size * 0.71;
      if (d + half < ob.r) return;                 // entirely inside the body: not meshed
      wall = d - half < ob.r;                      // straddles the wall: refine to the finest level
    }
    if (pl > 0) {
      let split = wall || P.max[k] - P.min[k] > tol * scale;   // jump indicator, relative to colour range
      if (!split && mouse.inside) {
        const dx = cx - mouse.x, dy = cy - mouse.y;
        const rr = 40 + size * 1.2;      // graded rings: finer cells closer to the cursor
        split = dx * dx + dy * dy < rr * rr;
      }
      if (split) {
        refine(pl - 1, 2 * i, 2 * j);     refine(pl - 1, 2 * i + 1, 2 * j);
        refine(pl - 1, 2 * i, 2 * j + 1); refine(pl - 1, 2 * i + 1, 2 * j + 1);
        return;
      }
    }
    leaves.push(x, y, size, P.sum[k] / (1 << (2 * pl)), LMAX - pl);
  }

  function buildMesh() {
    leaves.length = 0;
    const top = pyr[LMAX];
    for (let j = 0; j < top.ny; j++) for (let i = 0; i < top.nx; i++) refine(LMAX, i, j);
    const n = leaves.length / 5;
    tol *= n > BUDGET ? 1.04 : 0.99;     // keep the mesh near its cell budget
    tol = Math.min(0.6, Math.max(0.04, tol));
    scale = 0.95 * scale + 0.05 * Math.max(0.2, pyr[0].max.reduce((m, v) => (v > m ? v : m), 0));
    maxLevel = 0;
    for (let q = 4; q < leaves.length; q += 5) if (leaves[q] > maxLevel) maxLevel = leaves[q];
  }

  // ── Rendering ────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, W, HT);

    // Cell fills, batched by colour bucket
    for (const b of buckets) b.length = 0;
    for (let q = 0; q < leaves.length; q += 5) {
      const b = Math.min(NB - 1, (leaves[q + 3] / scale * (NB - 1)) | 0);
      if (b > 0) buckets[b].push(q);
    }
    for (let b = 1; b < NB; b++) {
      const list = buckets[b];
      if (!list.length) continue;
      ctx.fillStyle = LUT[b];
      ctx.beginPath();
      for (const q of list) ctx.rect(leaves[q], leaves[q + 1], leaves[q + 2], leaves[q + 2]);
      ctx.fill();
    }

    // Mesh edges: coarse cells brighter, finest cells faint so they don't read as graph paper
    ctx.lineWidth = 1;
    for (const [lo, hi, a] of [[0, 2, 0.24], [3, 3, 0.15], [4, 4, 0.09]]) {
      ctx.beginPath();
      for (let q = 0; q < leaves.length; q += 5) {
        const lv = leaves[q + 4];
        if (lv >= lo && lv <= hi) ctx.rect(leaves[q] + 0.5, leaves[q + 1] + 0.5, leaves[q + 2], leaves[q + 2]);
      }
      ctx.strokeStyle = `rgba(53,183,121,${a})`;
      ctx.stroke();
    }

    // Nodes on refined cells
    ctx.beginPath();
    for (let q = 0; q < leaves.length; q += 5) {
      if (leaves[q + 4] >= 2) ctx.rect(leaves[q] - 0.25, leaves[q + 1] - 0.25, 1.5, 1.5);
    }
    ctx.fillStyle = 'rgba(253,231,37,0.32)';
    ctx.fill();

    // Reaction sites
    ctx.strokeStyle = 'rgba(253,231,37,0.55)';
    for (const s of sources) {
      ctx.beginPath();
      ctx.arc(s.i * H, s.j * H, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cursor: refinement radius + crosshair
    if (mouse.inside) {
      ctx.save();
      ctx.strokeStyle = 'rgba(253,231,37,0.5)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, CURSOR_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mouse.x - 6, mouse.y); ctx.lineTo(mouse.x + 6, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 6); ctx.lineTo(mouse.x, mouse.y + 6);
      ctx.stroke();
      ctx.restore();
    }

    if (frame % 10 === 0) {
      hudStat.textContent =
        `t=${t.toFixed(1)}s  cells=${leaves.length / 5}  max_level=${maxLevel}  tol=${tol.toFixed(3)} `;
    }
  }

  // ── Loop ─────────────────────────────────────────────────────
  let running = false, raf = 0, onScreen = true;
  function loop() {
    raf = 0;
    if (!running) return;
    frame++;
    stepSim(); buildPyramid(); buildMesh(); render();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (reduceMotion || running || !onScreen || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // ── Input ────────────────────────────────────────────────────
  function local(e) {
    const r = hero.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  hero.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    if (mouse.inside) {
      const cl = v => Math.max(-1.5, Math.min(1.5, v));
      mouse.vx = cl(0.5 * mouse.vx + 0.5 * ((x - mouse.x) / H) * 0.35);
      mouse.vy = cl(0.5 * mouse.vy + 0.5 * ((y - mouse.y) / H) * 0.35);
    }
    mouse.x = x; mouse.y = y; mouse.inside = true; mouse.last = performance.now();
    if (reduceMotion) { buildMesh(); render(); }
  });
  hero.addEventListener('pointerleave', () => {
    mouse.inside = false; mouse.x = mouse.y = -1e4; mouse.vx = mouse.vy = 0;
    if (reduceMotion) { buildMesh(); render(); }
  });
  hero.addEventListener('pointerdown', e => {
    if (e.target.closest('a, button')) return;
    const [x, y] = local(e);
    deposit(x / H, y / H, 6, 0.9);
    if (reduceMotion) { buildPyramid(); buildMesh(); render(); }
  });

  // Pause when off-screen or the tab is hidden
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      onScreen ? start() : stop();
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  let resizeTimer = 0, lastW = 0, lastH = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = hero.getBoundingClientRect();
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      resize();
    }, 150);
  };
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(hero);
  else window.addEventListener('resize', onResize);
  // The photo may load after this script (layout shift): re-measure once it has
  if (photo && !photo.complete) photo.addEventListener('load', () => { lastW = 0; onResize(); }, { once: true });

  const r0 = hero.getBoundingClientRect();
  lastW = r0.width; lastH = r0.height;
  resize();
  start();
})();
