/* =============================================================
   page-sims.js — live physics backdrops for the inner-page headers

   Each page picks a model with <section class="page-hero" data-sim="…">:
     research      pore-scale Darcy flow + reactive tracer through a packed bed
     publications  electrical double layer: Brownian ions + Poisson, cycling electrodes
     news          2D wave equation through a double slit
     cv            corotational finite-element solid under an indenter
     hobbies       Gray–Scott reaction–diffusion (Turing patterns)

   A small shared core handles the canvas, terminal HUD, pointer input,
   the viridis colour map, and pausing when off-screen / reduced motion.
   ============================================================= */
(function () {
  'use strict';

  const hero = document.querySelector('.page-hero[data-sim]');
  if (!hero || !window.HTMLCanvasElement) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Shared helpers ───────────────────────────────────────────
  const VIR = [[68, 1, 84], [71, 45, 123], [59, 82, 139], [44, 114, 142], [33, 145, 140],
               [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37]];
  const VLUT = new Uint8Array(256 * 3);
  for (let n = 0; n < 256; n++) {
    const v = (n / 255) * 8, k = Math.min(7, v | 0), f = v - k;
    for (let q = 0; q < 3; q++) VLUT[n * 3 + q] = VIR[k][q] + (VIR[k + 1][q] - VIR[k][q]) * f;
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const vir = (v, a) => {
    const n = (clamp01(v) * 255) | 0;
    return `rgba(${VLUT[n * 3]},${VLUT[n * 3 + 1]},${VLUT[n * 3 + 2]},${a})`;
  };
  function rng(seed) {            // mulberry32: deterministic layouts across reloads
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Low-res field → offscreen canvas → smooth upscale onto the main canvas
  function makeField(nx, ny) {
    const off = document.createElement('canvas');
    off.width = nx; off.height = ny;
    const octx = off.getContext('2d');
    const img = octx.createImageData(nx, ny);
    return { nx, ny, off, octx, img, data: img.data };
  }
  function setPx(d, k, v, a) {    // viridis colour v∈[0,1], alpha a∈[0,1]
    const n = (clamp01(v) * 255) | 0, p = k * 4;
    d[p] = VLUT[n * 3]; d[p + 1] = VLUT[n * 3 + 1]; d[p + 2] = VLUT[n * 3 + 2]; d[p + 3] = a * 255;
  }
  function blit(ctx, fi, w, h) {
    fi.octx.putImageData(fi.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fi.off, 0, 0, w, h);
  }
  function gauss(arr, nx, ny, ci, cj, rad, amt, mask, cap) {
    const r = Math.ceil(rad * 2.5), r2 = rad * rad;
    const i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(nx - 1, Math.ceil(ci + r));
    const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(ny - 1, Math.ceil(cj + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (mask && mask[k]) continue;
        const dx = i - ci, dy = j - cj;
        arr[k] += amt * Math.exp(-(dx * dx + dy * dy) / r2);
        if (cap !== undefined && arr[k] > cap) arr[k] = cap;
      }
    }
  }
  function cursorMark(ctx, m, r) {
    if (!m.inside) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(253,231,37,0.5)';
    ctx.lineWidth = 1;
    if (r) {
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(m.x - 6, m.y); ctx.lineTo(m.x + 6, m.y);
    ctx.moveTo(m.x, m.y - 6); ctx.lineTo(m.x, m.y + 6);
    ctx.stroke();
    ctx.restore();
  }

  // ═════════════════════════════════════════════════════════════
  // research — pore-scale flow and reactive transport in a packed bed
  //   Darcy-type pressure solve in the pore space (SOR, once per layout) gives
  //   face fluxes on a staggered (MAC) grid, so no flux ever points into a grain.
  //   ∂c/∂t + u·∇c = D∇²c with first-order consumption on grain walls,
  //   advected with MacCormack (2nd order, limited) to keep pulses sharp.
  //   Tracers use Pollock-style face-velocity interpolation + RK2.
  // ═════════════════════════════════════════════════════════════
  function poreSim(env) {
    const h = 4, KAP = 0.03, KR = 0.005, NP = 320, U_MEAN = 0.45;
    let nx, ny, solid, wall, fu, fv, ux, uy, c, c2, c3, cmin, cmax, grains, fi, eps = 0, Pe = 0, cin = 0;
    let px, py, pa, chx, chy;
    const R = rng(11);

    // Particle velocity (cells/step): linear between the two x-faces and the two y-faces of its cell
    function pvel(x, y, out) {
      const gx = x / h, gy = y / h;
      const i = Math.min(nx - 1, Math.max(0, gx | 0)), j = Math.min(ny - 1, Math.max(0, gy | 0));
      const k = j * nx + i, a = gx - i, b = gy - j;
      const uL = i > 0 ? fu[k - 1] : fu[k], uR = fu[k];
      const vT = j > 0 ? fv[k - nx] : 0, vB = fv[k];
      out[0] = uL + (uR - uL) * a; out[1] = vT + (vB - vT) * b;
      return solid[k];
    }
    const isSolidAt = (x, y) => solid[Math.min(ny - 1, Math.max(0, (y / h) | 0)) * nx + Math.min(nx - 1, Math.max(0, (x / h) | 0))];
    const v1 = [0, 0], v2 = [0, 0];

    // Semi-Lagrangian pass; dir = +1 forward in time, −1 backward (for MacCormack)
    function advect(src, dst, dir, track) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (solid[k]) { dst[k] = 0; continue; }
          let x = i - dir * ux[k], y = j - dir * uy[k];
          if (x < 0) { dst[k] = dir > 0 ? cin : src[k]; if (track) { cmin[k] = -1; } continue; }
          if (x > nx - 1.001) x = nx - 1.001;
          if (y < 0) y = 0; else if (y > ny - 1.001) y = ny - 1.001;
          const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, q = y0 * nx + x0;
          if (solid[q] || solid[q + 1] || solid[q + nx] || solid[q + nx + 1]) {
            const kn = Math.round(y) * nx + Math.round(x);   // next to a grain: nearest pore value
            dst[k] = solid[kn] ? src[k] : src[kn];
            if (track) cmin[k] = -1;                       // no high-order correction here
            continue;
          }
          const a = src[q], b = src[q + 1], cc = src[q + nx], d = src[q + nx + 1];
          dst[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
          if (track) { cmin[k] = Math.min(a, b, cc, d); cmax[k] = Math.max(a, b, cc, d); }
        }
      }
    }

    return {
      hint: '# packed bed of catalyst grains · move to inject tracer · click to dose',
      cmd: './pore_flow --darcy --surface-reaction',
      prewarm: 480,
      init() {
        const W = env.W, H = env.H;
        nx = Math.ceil(W / h); ny = Math.ceil(H / h);
        const N = nx * ny;
        solid = new Uint8Array(N); wall = new Uint8Array(N);
        fu = new Float32Array(N); fv = new Float32Array(N);
        ux = new Float32Array(N); uy = new Float32Array(N);
        c = new Float32Array(N); c2 = new Float32Array(N); c3 = new Float32Array(N);
        cmin = new Float32Array(N); cmax = new Float32Array(N);
        fi = makeField(nx, ny);

        // Random sequential packing of non-overlapping grains (≥ 8 px throats)
        const r0 = rng(7);
        grains = [];
        for (let n = 0; n < 7000; n++) {
          const r = 7 + r0() * 17;
          const x = 28 + r0() * (W - 28), y = -0.4 * r + r0() * (H + 0.8 * r);
          let ok = true;
          for (const g of grains) {
            const dx = g.x - x, dy = g.y - y, m = g.r + r + 8;
            if (dx * dx + dy * dy < m * m) { ok = false; break; }
          }
          if (ok) grains.push({ x, y, r });
        }
        for (const g of grains) {
          const i0 = Math.max(0, Math.floor((g.x - g.r) / h)), i1 = Math.min(nx - 1, Math.ceil((g.x + g.r) / h));
          const j0 = Math.max(0, Math.floor((g.y - g.r) / h)), j1 = Math.min(ny - 1, Math.ceil((g.y + g.r) / h));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const dx = (i + 0.5) * h - g.x, dy = (j + 0.5) * h - g.y;
            if (dx * dx + dy * dy < g.r * g.r) solid[j * nx + i] = 1;
          }
        }
        let pores = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (solid[k]) continue;
          pores++;
          if ((i > 0 && solid[k - 1]) || (i < nx - 1 && solid[k + 1]) ||
              (j > 0 && solid[k - nx]) || (j < ny - 1 && solid[k + nx])) wall[k] = 1;
        }
        eps = pores / N;

        // Pressure: ∇²p = 0 in the pores, p = 1 | 0 at inlet | outlet, no flux on grains and side walls
        const p = new Float32Array(N);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) p[j * nx + i] = 1 - i / (nx - 1);
        for (let it = 0; it < 700; it++) {
          for (let j = 0; j < ny; j++) {
            for (let i = 1; i < nx - 1; i++) {
              const k = j * nx + i;
              if (solid[k]) continue;
              let s = 0, n = 0;
              if (!solid[k - 1]) { s += p[k - 1]; n++; }
              if (!solid[k + 1]) { s += p[k + 1]; n++; }
              if (j > 0 && !solid[k - nx]) { s += p[k - nx]; n++; }
              if (j < ny - 1 && !solid[k + nx]) { s += p[k + nx]; n++; }
              if (n) p[k] += 1.9 * (s / n - p[k]);
            }
          }
        }
        // Face fluxes (zero on any face touching a grain), then cell-centred averages
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (solid[k]) continue;
          if (i < nx - 1 && !solid[k + 1]) fu[k] = p[k] - p[k + 1];
          if (j < ny - 1 && !solid[k + nx]) fv[k] = p[k] - p[k + nx];
        }
        for (let j = 0; j < ny; j++) { const k = j * nx + nx - 1; if (!solid[k]) fu[k] = fu[k - 1]; }  // outflow face
        let sum = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (solid[k]) continue;
          ux[k] = 0.5 * ((i > 0 ? fu[k - 1] : fu[k]) + fu[k]);
          uy[k] = 0.5 * ((j > 0 ? fv[k - nx] : 0) + fv[k]);
          sum += Math.hypot(ux[k], uy[k]);
        }
        const S = U_MEAN / (sum / pores || 1), cl = v => Math.max(-0.95, Math.min(0.95, v * S));
        for (let k = 0; k < N; k++) { fu[k] = cl(fu[k]); fv[k] = cl(fv[k]); ux[k] = cl(ux[k]); uy[k] = cl(uy[k]); }
        const dMean = grains.reduce((a, g) => a + 2 * g.r, 0) / (grains.length || 1) / h;
        Pe = (U_MEAN * dMean) / KAP;

        px = new Float32Array(NP); py = new Float32Array(NP); pa = new Float32Array(NP);
        chx = new Float32Array(NP); chy = new Float32Array(NP);
        for (let q = 0; q < NP; q++) this.spawn(q, true);
      },
      spawn(q, anywhere) {
        for (let tries = 0; tries < 60; tries++) {
          const x = anywhere ? R() * env.W : 1 + R() * 8, y = R() * env.H;
          if (!isSolidAt(x, y)) { px[q] = chx[q] = x; py[q] = chy[q] = y; pa[q] = 0; return; }
        }
        px[q] = chx[q] = 2; py[q] = chy[q] = env.H / 2; pa[q] = 0;
      },
      step() {
        const m = env.mouse, t = env.t;
        // Pulsed inlet: a sharp slug of tracer every ~8 s on top of a weak background feed
        const s = Math.sin(t * 0.8);
        const ramp = clamp01((s - 0.55) / 0.3);
        cin = 0.06 + 0.94 * ramp * ramp * (3 - 2 * ramp);
        if (m.inside && m.speed > 0.5) gauss(c, nx, ny, m.x / h, m.y / h, 2.5, 0.14 * Math.min(1, m.speed / 6), solid, 1.5);

        // MacCormack: forward, backward, correct, then limit to the forward stencil's range
        advect(c, c2, 1, true);
        advect(c2, c3, -1, false);
        for (let k = 0; k < c.length; k++) {
          if (solid[k] || cmin[k] < 0) continue;
          let v = c2[k] + 0.5 * (c[k] - c3[k]);
          if (v < cmin[k]) v = cmin[k]; else if (v > cmax[k]) v = cmax[k];
          c2[k] = v;
        }
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (solid[k]) { c[k] = 0; continue; }
            const ck = c2[k];
            const a = i > 0 && !solid[k - 1] ? c2[k - 1] : ck, b = i < nx - 1 && !solid[k + 1] ? c2[k + 1] : ck;
            const d = j > 0 && !solid[k - nx] ? c2[k - nx] : ck, e = j < ny - 1 && !solid[k + nx] ? c2[k + nx] : ck;
            let v = ck + KAP * (a + b + d + e - 4 * ck);
            if (wall[k]) v *= 1 - KR;              // consumed at the catalyst surface
            c[k] = v;
          }
        }

        // Tracers: RK2 on the face-interpolated velocity, plus a little Brownian motion
        for (let q = 0; q < NP; q++) {
          pvel(px[q], py[q], v1);
          pvel(px[q] + 0.5 * v1[0] * h, py[q] + 0.5 * v1[1] * h, v2);
          const bx = (R() - 0.5) * 0.3, by = (R() - 0.5) * 0.3;
          let x = px[q] + v2[0] * h, y = py[q] + v2[1] * h;
          if (!isSolidAt(x + bx, y + by)) { x += bx; y += by; }
          if (!isSolidAt(x, y)) { px[q] = x; py[q] = y; }
          else if (!isSolidAt(x, py[q])) px[q] = x;           // slide along the grain
          else if (!isSolidAt(px[q], y)) py[q] = y;
          pa[q]++;
          if (pa[q] % 60 === 0) {                              // stalled at a stagnation point? recycle it
            const moved = Math.hypot(px[q] - chx[q], py[q] - chy[q]);
            chx[q] = px[q]; chy[q] = py[q];
            if (moved < 3) { this.spawn(q, false); continue; }
          }
          if (px[q] > env.W - 2 || py[q] < 0 || py[q] > env.H) this.spawn(q, false);
        }
      },
      click(x, y) { gauss(c, nx, ny, x / h, y / h, 6, 1.2, solid, 1.5); },
      draw(ctx) {
        const d = fi.data;
        for (let k = 0; k < c.length; k++) {
          if (solid[k]) { d[k * 4 + 3] = 0; continue; }
          const v = Math.min(1, c[k] / 0.7);
          setPx(d, k, 0.04 + 0.96 * v, 0.1 + 0.82 * Math.sqrt(v));
        }
        blit(ctx, fi, nx * h, ny * h);

        ctx.beginPath();
        for (const g of grains) { const r = g.r - 1.5; ctx.moveTo(g.x + r, g.y); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); }
        ctx.fillStyle = 'rgba(24,21,42,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(53,183,121,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        for (let q = 0; q < NP; q++) {
          pvel(px[q], py[q], v1);
          ctx.moveTo(px[q], py[q]);
          ctx.lineTo(px[q] - v1[0] * h * 4, py[q] - v1[1] * h * 4);
        }
        ctx.strokeStyle = 'rgba(253,231,37,0.7)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        cursorMark(ctx, env.mouse, 0);
      },
      stat() { return `porosity=${eps.toFixed(2)}  Pe=${Pe.toFixed(0)}  c_in=${cin.toFixed(2)}  t=${env.t.toFixed(1)}s `; },
    };
  }

  // ═════════════════════════════════════════════════════════════
  // publications — electrical double layer in a cycling supercapacitor
  //   Brownian dynamics of cations and anions between two blocking electrodes:
  //     dx = D q E dt + √(2D dt) ξ        (Einstein relation, φ in kT/e)
  //   with E = −∇φ from Poisson's equation  ∇²φ = −ρ/ε  solved every step on a
  //   grid (cloud-in-cell charge, SOR). Counter-ions condense at each electrode,
  //   screening the bulk over the Debye length; the cell voltage cycles so the
  //   layers discharge and re-form with opposite sign.
  // ═════════════════════════════════════════════════════════════
  const SEG = [null, [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 3, 2], [0, 2], [3, 0],
               [3, 0], [0, 2], [0, 3, 2, 1], [0, 1], [3, 1], [2, 1], [3, 2], null];
  function contour(ctx, f, nx, ny, lvl, h) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i, a = f[k], b = f[k + 1], c = f[k + nx + 1], d = f[k + nx];
        const idx = (a > lvl ? 8 : 0) | (b > lvl ? 4 : 0) | (c > lvl ? 2 : 0) | (d > lvl ? 1 : 0);
        const seg = SEG[idx];
        if (!seg) continue;
        for (let s = 0; s < seg.length; s += 2) {
          for (let e = 0; e < 2; e++) {
            let x, y;
            switch (seg[s + e]) {
              case 0: x = i + (lvl - a) / (b - a); y = j; break;
              case 1: x = i + 1; y = j + (lvl - b) / (c - b); break;
              case 2: x = i + (lvl - d) / (c - d); y = j + 1; break;
              default: x = i; y = j + (lvl - a) / (d - a);
            }
            x = (x + 0.5) * h; y = (y + 0.5) * h;
            e ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
        }
      }
    }
  }

  function edlSim(env) {
    // Units: lengths in px, time in sub-steps. Drift = MOB·q·E, noise variance = 2·DN per step,
    // so the thermal energy is kT = DN/MOB in potential units (Einstein relation).
    // SIGMA sets the double-layer capacitance: target counter-charge per px of electrode.
    const HX = 6, V0 = 12, MOB = 3, DN = 0.3, KT = DN / MOB, SUB = 4, STERN = 11, BAR = 7, PERIOD = 36,
          QPROBE = 20, SIGMA = 0.25, BAND = 40;
    const LEVELS = [-0.8, -0.55, -0.3, 0.3, 0.55, 0.8];
    let nx, ny, hy, phi, phiS, rho, Ex, Ey, fi, K = 1, V = 0, qEDL = 0, lamD = 0;
    let n, ix, iy, iq, sx, sy, probeSign = 1;

    const gn = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;   // ≈ N(0, 1)

    function solvePoisson(iters) {
      // ∇²φ = −K ρ, φ = +V/2 on the top electrode and −V/2 on the bottom, periodic in x (SOR, warm-started)
      const ax = 1 / (HX * HX), ay = 1 / (hy * hy), den = 2 * ax + 2 * ay;
      for (let i = 0; i < nx; i++) { phi[i] = V / 2; phi[(ny - 1) * nx + i] = -V / 2; }
      for (let it = 0; it < iters; it++) {
        for (let j = 1; j < ny - 1; j++) {
          const r = j * nx;
          for (let i = 0; i < nx; i++) {
            const k = r + i, w = i > 0 ? k - 1 : r + nx - 1, e = i < nx - 1 ? k + 1 : r;
            const tgt = (ax * (phi[w] + phi[e]) + ay * (phi[k - nx] + phi[k + nx]) + K * rho[k]) / den;
            phi[k] += 1.8 * (tgt - phi[k]);
          }
        }
      }
      for (let j = 0; j < ny; j++) {
        const r = j * nx, jm = j > 0 ? j - 1 : j, jp = j < ny - 1 ? j + 1 : j;
        for (let i = 0; i < nx; i++) {
          const k = r + i, w = i > 0 ? k - 1 : r + nx - 1, e = i < nx - 1 ? k + 1 : r;
          Ex[k] = (phi[w] - phi[e]) / (2 * HX);
          Ey[k] = (phi[jm * nx + i] - phi[jp * nx + i]) / ((jp - jm) * hy);
        }
      }
    }
    function deposit() {         // cloud-in-cell charge density on the nodes
      rho.fill(0);
      const area = HX * hy, m = env.mouse;
      const add = (x, y, q) => {
        const gx = x / HX, gy = y / hy;
        let i0 = Math.floor(gx); const j0 = Math.min(ny - 2, Math.max(0, Math.floor(gy)));
        const fx = gx - i0, fy = Math.min(1, Math.max(0, gy - j0));
        i0 = ((i0 % nx) + nx) % nx; const i1 = (i0 + 1) % nx;
        q /= area;
        rho[j0 * nx + i0] += q * (1 - fx) * (1 - fy); rho[j0 * nx + i1] += q * fx * (1 - fy);
        rho[(j0 + 1) * nx + i0] += q * (1 - fx) * fy; rho[(j0 + 1) * nx + i1] += q * fx * fy;
      };
      for (let p = 0; p < n; p++) add(ix[p], iy[p], iq[p]);
      if (m.inside) add(m.x, Math.min(env.H - STERN, Math.max(STERN, m.y)), probeSign * QPROBE);
    }
    function field(x, y, out) {
      const gx = x / HX, gy = y / hy;
      let i0 = Math.floor(gx); const j0 = Math.min(ny - 2, Math.max(0, Math.floor(gy)));
      const fx = gx - i0, fy = Math.min(1, Math.max(0, gy - j0));
      i0 = ((i0 % nx) + nx) % nx; const i1 = (i0 + 1) % nx;
      const a = j0 * nx + i0, b = j0 * nx + i1, c = a + nx, d = b + nx;
      out[0] = (Ex[a] * (1 - fx) + Ex[b] * fx) * (1 - fy) + (Ex[c] * (1 - fx) + Ex[d] * fx) * fy;
      out[1] = (Ey[a] * (1 - fx) + Ey[b] * fx) * (1 - fy) + (Ey[c] * (1 - fx) + Ey[d] * fx) * fy;
    }
    const E = [0, 0];

    return {
      hint: '# yellow = cations, white = anions · hover = charged probe · click flips its sign',
      cmd: './edl_brownian --poisson --cycling',
      prewarm: 300,
      init() {
        const W = env.W, H = env.H;
        nx = Math.max(8, Math.round(W / HX)); ny = Math.max(8, Math.round(H / 6) + 1);
        hy = H / (ny - 1);
        const N = nx * ny;
        phi = new Float32Array(N); phiS = new Float32Array(N); rho = new Float32Array(N); Ex = new Float32Array(N); Ey = new Float32Array(N);
        fi = makeField(nx, ny);
        const pairs = Math.round(Math.min(900, Math.max(150, (W * (H - 2 * STERN)) / 450)));
        n = 2 * pairs;
        ix = new Float32Array(n); iy = new Float32Array(n); iq = new Int8Array(n);
        sx = new Float32Array(n); sy = new Float32Array(n);
        for (let p = 0; p < n; p++) {
          ix[p] = sx[p] = Math.random() * W;
          iy[p] = sy[p] = STERN + Math.random() * (H - 2 * STERN);
          iq[p] = p % 2 ? -1 : 1;
        }
        // Compact-layer estimate: a drop of V0/2 across ~STERN px holds SIGMA charge per px  →  K
        K = V0 / 2 / (SIGMA * (STERN + 3));
        lamD = Math.sqrt(KT / (2 * K * (pairs / (W * (H - 2 * STERN)))));   // resulting Debye length
      },
      step() {
        const H = env.H, W = env.W;
        V = V0 * Math.tanh(2.5 * Math.sin((2 * Math.PI * env.t) / PERIOD));   // charge / discharge cycle
        for (let s = 0; s < SUB; s++) {
          deposit();
          solvePoisson(s ? 5 : 10);
          const amp = Math.sqrt(2 * DN);
          for (let p = 0; p < n; p++) {
            field(ix[p], iy[p], E);
            let dx = MOB * iq[p] * E[0], dy = MOB * iq[p] * E[1];    // electromigration
            if (dx > 3) dx = 3; else if (dx < -3) dx = -3;
            if (dy > 3) dy = 3; else if (dy < -3) dy = -3;
            let x = ix[p] + dx + amp * gn(), y = iy[p] + dy + amp * gn();
            if (y < STERN) y = 2 * STERN - y; else if (y > H - STERN) y = 2 * (H - STERN) - y;   // closest approach
            if (y < STERN || y > H - STERN) y = Math.min(H - STERN, Math.max(STERN, y));
            if (x < 0) x += W; else if (x >= W) x -= W;
            ix[p] = x; iy[p] = y;
          }
        }
        // Net ionic charge held in the bottom double layer (within 3 λ_D of the electrode)
        let q = 0;
        for (let p = 0; p < n; p++) if (iy[p] > H - STERN - BAND) q += iq[p];
        qEDL = q;
        for (let k = 0; k < phi.length; k++) phiS[k] += 0.08 * (phi[k] - phiS[k]);   // display: average out ion shot noise
      },
      click() { probeSign = -probeSign; },
      draw(ctx) {
        const W = env.W, H = env.H, d = fi.data;
        for (let k = 0; k < phiS.length; k++) {      // screened bulk stays dark; the double layers glow
          const a = Math.min(1, Math.abs(phiS[k]) / (V0 / 2));
          setPx(d, k, 0.5 + phiS[k] / V0, 0.06 + 0.7 * a * a);
        }
        blit(ctx, fi, nx * HX, H);

        // Equipotentials: bunched in the double layers, sparse in the screened bulk
        ctx.save();
        ctx.scale(1, hy / HX);
        ctx.beginPath();
        for (const f of LEVELS) contour(ctx, phiS, nx, ny, f * V0 / 2, HX);
        ctx.restore();
        ctx.strokeStyle = 'rgba(230,230,238,0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ions (drawn at a lightly smoothed position so thermal jitter reads as motion, not noise)
        const cat = new Path2D(), an = new Path2D();
        for (let p = 0; p < n; p++) {
          if (Math.abs(ix[p] - sx[p]) > W / 2) { sx[p] = ix[p]; sy[p] = iy[p]; }
          sx[p] += 0.35 * (ix[p] - sx[p]); sy[p] += 0.35 * (iy[p] - sy[p]);
          (iq[p] > 0 ? cat : an).rect(sx[p] - 1.2, sy[p] - 1.2, 2.4, 2.4);
        }
        ctx.fillStyle = 'rgba(253,231,37,0.85)'; ctx.fill(cat);
        ctx.fillStyle = 'rgba(230,230,238,0.75)'; ctx.fill(an);

        // Electrodes, coloured by their potential, with surface-charge signs
        const top = 0.5 + V / (2 * V0), bot = 0.5 - V / (2 * V0);
        ctx.fillStyle = vir(top, 0.75); ctx.fillRect(0, 0, W, BAR);
        ctx.fillStyle = vir(bot, 0.75); ctx.fillRect(0, H - BAR, W, BAR);
        if (Math.abs(V) > 0.5) {
          ctx.beginPath();
          for (let x = 14; x < W; x += 28) {
            for (const [yc, sgn] of [[BAR / 2, Math.sign(V)], [H - BAR / 2, -Math.sign(V)]]) {
              ctx.moveTo(x - 2.5, yc); ctx.lineTo(x + 2.5, yc);
              if (sgn > 0) { ctx.moveTo(x, yc - 2.5); ctx.lineTo(x, yc + 2.5); }
            }
          }
          ctx.strokeStyle = 'rgba(13,11,24,0.85)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        // Probe
        const m = env.mouse;
        if (m.inside) {
          const y = Math.min(H - STERN, Math.max(STERN, m.y));
          ctx.save();
          ctx.strokeStyle = probeSign > 0 ? 'rgba(253,231,37,0.8)' : 'rgba(230,230,238,0.8)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(m.x, y, 18, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(m.x - 4, y); ctx.lineTo(m.x + 4, y);
          if (probeSign > 0) { ctx.moveTo(m.x, y - 4); ctx.lineTo(m.x, y + 4); }
          ctx.stroke();
          ctx.restore();
        }
      },
      stat() {
        const volts = (V / KT) * 0.0257;   // kT/e ≈ 25.7 mV at room temperature
        return `V_cell=${volts >= 0 ? '+' : ''}${volts.toFixed(2)}V  λ_D=${lamD.toFixed(1)}px  q_EDL=${qEDL >= 0 ? '+' : ''}${qEDL}e  ions=${n}  t=${env.t.toFixed(1)}s `;
      },
    };
  }

  // ═════════════════════════════════════════════════════════════
  // news — scalar wave equation u_tt = c²∇²u through a double slit
  //   Leapfrog in time, sponge layers at the edges, reflecting barrier.
  // ═════════════════════════════════════════════════════════════
  function waveSim(env) {
    const h = 4, C2 = 0.04, LAM = 14, OMEGA = (2 * Math.PI * Math.sqrt(C2)) / LAM;   // period ≈ 70 frames ≈ 1.2 s
    let nx, ny, u, u0, u1, wall, sig, fi, A = 0.4, src, bx, nextDrop = 1, energy = 0, tt = 0;
    const R = rng(3);

    return {
      hint: '# a source, a wall, two slits · drag to make ripples · click to drop a stone',
      cmd: './wave_eq --double-slit --absorbing-bc',
      prewarm: 500,
      init() {
        const W = env.W;
        nx = Math.ceil(W / h); ny = Math.ceil(env.H / h);
        const N = nx * ny;
        u = new Float32Array(N); u0 = new Float32Array(N); u1 = new Float32Array(N);
        wall = new Uint8Array(N); sig = new Float32Array(N);
        fi = makeField(nx, ny);
        bx = Math.round(nx * (W < 700 ? 0.5 : 0.69));
        const mid = ny / 2, off = Math.max(8, ny * 0.23), half = 2;
        for (let j = 0; j < ny; j++) {
          const open = Math.abs(j - (mid - off)) <= half || Math.abs(j - (mid + off)) <= half;
          if (!open) { wall[j * nx + bx] = 1; wall[j * nx + bx + 1] = 1; }
        }
        const SPG = 12;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const dd = Math.min(i, j, nx - 1 - i, ny - 1 - j);
          sig[j * nx + i] = dd < SPG ? 0.12 * ((SPG - dd) / SPG) ** 2 : 0;
        }
        src = { i: Math.max(14, bx - Math.max(20, Math.round(nx * 0.11))), j: mid };
      },
      step() {
        const m = env.mouse;
        for (let sub = 0; sub < 1; sub++) {
          tt++;
          for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
              const k = j * nx + i;
              if (wall[k]) { u1[k] = 0; continue; }
              const lap = u[k - 1] + u[k + 1] + u[k - nx] + u[k + nx] - 4 * u[k], s = sig[k];
              u1[k] = ((2 * u[k] - (1 - s) * u0[k] + C2 * lap) / (1 + s)) * 0.9995;
            }
          }
          gauss(u1, nx, ny, src.i, src.j, 1.6, 0.05 * Math.sin(OMEGA * tt));
          const tmp = u0; u0 = u; u = u1; u1 = tmp;
        }
        if (env.t > nextDrop) {      // occasional raindrops on the far side
          nextDrop = env.t + 2.5 + R() * 2.5;
          gauss(u, nx, ny, bx + 6 + R() * (nx - bx - 18), 6 + R() * (ny - 12), 1.6, -1.0);
        }
        if (m.inside && m.speed > 0.5) gauss(u, nx, ny, m.x / h, m.y / h, 1.8, -0.12 * Math.min(1, m.speed / 8), wall);
        let mx = 0, e = 0;
        for (let k = 0; k < u.length; k++) { const a = Math.abs(u[k]); if (a > mx) mx = a; e += u[k] * u[k]; }
        energy = e / u.length;
        A = 0.99 * A + 0.01 * Math.max(0.25, mx * 0.6);
      },
      click(x, y) { gauss(u, nx, ny, x / h, y / h, 2.6, -2.2, wall); },
      draw(ctx) {
        const d = fi.data;
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (wall[k]) { d[k * 4 + 3] = 0; continue; }
            const v = Math.max(-1, Math.min(1, u[k] / A));
            const gx = i > 0 && i < nx - 1 ? (u[k - 1] - u[k + 1]) / A : 0;
            const light = Math.max(0.75, Math.min(1.3, 1 + 0.5 * gx));
            const n = ((0.5 + 0.5 * v) * 255) | 0, p = k * 4;
            d[p] = Math.min(255, VLUT[n * 3] * light);
            d[p + 1] = Math.min(255, VLUT[n * 3 + 1] * light);
            d[p + 2] = Math.min(255, VLUT[n * 3 + 2] * light);
            d[p + 3] = Math.min(1, Math.abs(v) * 1.15 + Math.abs(gx) * 0.3) * 0.72 * 255;
          }
        }
        blit(ctx, fi, nx * h, ny * h);

        ctx.fillStyle = 'rgba(53,183,121,0.55)';
        for (let j = 0; j < ny; j++) if (wall[j * nx + bx]) ctx.fillRect(bx * h, j * h, 2 * h, h + 0.5);
        ctx.strokeStyle = 'rgba(253,231,37,0.6)';
        ctx.beginPath(); ctx.arc((src.i + 0.5) * h, (src.j + 0.5) * h, 4 + Math.sin(OMEGA * tt), 0, Math.PI * 2); ctx.stroke();
        cursorMark(ctx, env.mouse, 0);
      },
      stat() { return `λ=${LAM * h}px  c=${Math.sqrt(C2).toFixed(2)}h/Δt  slits=2  E=${(energy * 1e3).toFixed(2)}e-3 `; },
    };
  }

  // ═════════════════════════════════════════════════════════════
  // cv — 2D finite-element solid (linear triangles, fixed-corotated
  //   hyperelasticity), explicit dynamics. Bottom edge clamped, sides on
  //   rollers. The cursor is a rigid circular indenter; colour = von Mises.
  // ═════════════════════════════════════════════════════════════
  function solidSim(env) {
    const S0 = 30, MU = 0.022, LAMBDA = 0.045, SUB = 8, DAMP = 0.982, RIND = 36, NB = 48, GRAV = 0.035;
    let nn, nt, X, Y, x, y, vx, vy, fx, fy, fix, tri, Dm, A0, vm, edges, nodesFixed;
    let vmScale = 0.02, vmMax = 0;
    const ind = { x: -1e4, y: -1e4, on: false };
    const buckets = Array.from({ length: NB }, () => []);

    return {
      hint: '# elastic block, clamped at the base · the cursor is an indenter · click to strike',
      cmd: './fem_solid --corotational --explicit',
      prewarm: 90,
      init() {
        const W = env.W, H = env.H, rowH = S0 * Math.sqrt(3) / 2;
        const nr = Math.ceil(H / rowH) + 1, nc = Math.ceil(W / S0) + 2;
        nn = nr * nc;
        X = new Float32Array(nn); Y = new Float32Array(nn);
        fix = new Uint8Array(nn);
        for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
          const n = j * nc + i;
          X[n] = (i + (j % 2) * 0.5 - 0.5) * S0;
          Y[n] = H - j * rowH + 2;
          fix[n] = j === 0 ? 1 : i === 0 || i === nc - 1 ? 2 : 0;
        }
        x = X.slice(); y = Y.slice();
        vx = new Float32Array(nn); vy = new Float32Array(nn);
        fx = new Float32Array(nn); fy = new Float32Array(nn);
        const T = [];
        for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nc - 1; i++) {
          const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
          if (j % 2 === 0) T.push(a, b, c, b, d, c); else T.push(a, d, c, a, b, d);
        }
        nt = T.length / 3;
        tri = new Int32Array(T); Dm = new Float32Array(nt * 4); A0 = new Float32Array(nt); vm = new Float32Array(nt);
        const es = new Set();
        for (let e = 0; e < nt; e++) {
          let [a, b, c] = [tri[3 * e], tri[3 * e + 1], tri[3 * e + 2]];
          let d00 = X[b] - X[a], d01 = X[c] - X[a], d10 = Y[b] - Y[a], d11 = Y[c] - Y[a];
          let det = d00 * d11 - d01 * d10;
          if (det < 0) {                       // enforce a consistent orientation
            tri[3 * e + 1] = c; tri[3 * e + 2] = b; [b, c] = [c, b];
            d00 = X[b] - X[a]; d01 = X[c] - X[a]; d10 = Y[b] - Y[a]; d11 = Y[c] - Y[a];
            det = -det;
          }
          A0[e] = det / 2;
          Dm[4 * e] = d11 / det; Dm[4 * e + 1] = -d01 / det; Dm[4 * e + 2] = -d10 / det; Dm[4 * e + 3] = d00 / det;
          for (const [p, q] of [[a, b], [b, c], [c, a]]) es.add(p < q ? p * nn + q : q * nn + p);
        }
        edges = Int32Array.from([...es].flatMap(k => [Math.floor(k / nn), k % nn]));
        nodesFixed = [];
        for (let n = 0; n < nn; n++) if (fix[n] === 1) nodesFixed.push(n);
        ind.x = env.W * 0.7; ind.y = env.H * 0.5;
      },
      step() {
        const m = env.mouse, t = env.t, W = env.W, H = env.H;
        const tx = m.inside ? m.x : W * (0.62 + 0.13 * Math.sin(0.23 * t)),
              ty = m.inside ? m.y : H * (0.5 + 0.32 * Math.sin(0.41 * t + 1));
        for (let sub = 0; sub < SUB; sub++) {
          ind.x += (tx - ind.x) * 0.06; ind.y += (ty - ind.y) * 0.06;
          fx.fill(0); fy.fill(0);
          const last = sub === SUB - 1;
          if (last) vmMax = 0;
          for (let e = 0; e < nt; e++) {
            const a = tri[3 * e], b = tri[3 * e + 1], c = tri[3 * e + 2];
            const s00 = x[b] - x[a], s01 = x[c] - x[a], s10 = y[b] - y[a], s11 = y[c] - y[a];
            const i00 = Dm[4 * e], i01 = Dm[4 * e + 1], i10 = Dm[4 * e + 2], i11 = Dm[4 * e + 3];
            // Deformation gradient F = Ds · Dm⁻¹
            const F00 = s00 * i00 + s01 * i10, F01 = s00 * i01 + s01 * i11;
            const F10 = s10 * i00 + s11 * i10, F11 = s10 * i01 + s11 * i11;
            // Rotation from the 2D polar decomposition, J = det F
            const th = Math.atan2(F10 - F01, F00 + F11), cr = Math.cos(th), sr = Math.sin(th);
            const J = F00 * F11 - F01 * F10;
            // First Piola–Kirchhoff stress: P = 2μ(F − R) + λ(J − 1)·cof(F)
            const lj = LAMBDA * (J - 1);
            const P00 = 2 * MU * (F00 - cr) + lj * F11, P01 = 2 * MU * (F01 + sr) - lj * F10;
            const P10 = 2 * MU * (F10 - sr) - lj * F01, P11 = 2 * MU * (F11 - cr) + lj * F00;
            // Nodal forces: H = −A₀ · P · Dm⁻ᵀ
            const A = A0[e];
            const h00 = -A * (P00 * i00 + P01 * i01), h01 = -A * (P00 * i10 + P01 * i11);
            const h10 = -A * (P10 * i00 + P11 * i01), h11 = -A * (P10 * i10 + P11 * i11);
            fx[b] += h00; fy[b] += h10; fx[c] += h01; fy[c] += h11;
            fx[a] -= h00 + h01; fy[a] -= h10 + h11;
            if (last) {              // Cauchy stress σ = P Fᵀ / J → von Mises
              const iJ = 1 / (J > 0.2 ? J : 0.2);
              const sxx = (P00 * F00 + P01 * F01) * iJ, syy = (P10 * F10 + P11 * F11) * iJ, sxy = (P00 * F10 + P01 * F11) * iJ;
              const v = Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy);
              vm[e] = v; if (v > vmMax) vmMax = v;
            }
          }
          for (let n = 0; n < nn; n++) {
            if (fix[n] === 1) continue;
            vx[n] = (vx[n] + fx[n]) * DAMP; vy[n] = (vy[n] + fy[n] + GRAV) * DAMP;   // self-weight
            if (fix[n] === 2) vx[n] = 0;
            x[n] += vx[n]; y[n] += vy[n];
            const dx = x[n] - ind.x, dy = y[n] - ind.y, d2 = dx * dx + dy * dy;
            if (d2 < RIND * RIND && d2 > 1e-6) {            // contact: project onto the indenter
              const d = Math.sqrt(d2), s = RIND / d;
              x[n] = ind.x + dx * s; y[n] = ind.y + dy * s;
              vx[n] *= 0.4; vy[n] *= 0.4;
            }
          }
        }
        vmScale = 0.95 * vmScale + 0.05 * Math.max(0.012, vmMax * 0.5);
      },
      click(cx, cy) {
        for (let n = 0; n < nn; n++) {
          if (fix[n] === 1) continue;
          const dx = x[n] - cx, dy = y[n] - cy, d = Math.hypot(dx, dy);
          if (d < 150 && d > 1) { const s = 4 * (1 - d / 150) / d; vx[n] += dx * s; vy[n] += dy * s; }
        }
      },
      draw(ctx) {
        for (const b of buckets) b.length = 0;
        for (let e = 0; e < nt; e++) buckets[Math.min(NB - 1, (Math.sqrt(vm[e] / vmScale) * (NB - 1)) | 0)].push(e);
        for (let b = 0; b < NB; b++) {
          const list = buckets[b];
          if (!list.length) continue;
          const v = b / (NB - 1);
          ctx.fillStyle = vir(v, (0.12 + 0.6 * v).toFixed(3));
          ctx.beginPath();
          for (const e of list) {
            const a = tri[3 * e], p = tri[3 * e + 1], c = tri[3 * e + 2];
            ctx.moveTo(x[a], y[a]); ctx.lineTo(x[p], y[p]); ctx.lineTo(x[c], y[c]); ctx.closePath();
          }
          ctx.fill();
        }
        ctx.beginPath();
        for (let q = 0; q < edges.length; q += 2) { ctx.moveTo(x[edges[q]], y[edges[q]]); ctx.lineTo(x[edges[q + 1]], y[edges[q + 1]]); }
        ctx.strokeStyle = 'rgba(230,230,238,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Clamped base: hatching, like a support in a free-body diagram
        const H = env.H;
        ctx.beginPath();
        ctx.moveTo(0, H - 0.5); ctx.lineTo(env.W, H - 0.5);
        for (let xx = 4; xx < env.W; xx += 10) { ctx.moveTo(xx, H - 0.5); ctx.lineTo(xx - 6, H + 6); }
        ctx.strokeStyle = 'rgba(253,231,37,0.4)';
        ctx.stroke();

        // Indenter
        ctx.save();
        ctx.fillStyle = 'rgba(13,11,24,0.55)';
        ctx.strokeStyle = 'rgba(253,231,37,0.65)';
        ctx.beginPath(); ctx.arc(ind.x, ind.y, RIND - 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ind.x - 6, ind.y); ctx.lineTo(ind.x + 6, ind.y);
        ctx.moveTo(ind.x, ind.y - 6); ctx.lineTo(ind.x, ind.y + 6);
        ctx.stroke();
        ctx.restore();
      },
      stat() { return `nodes=${nn}  elements=${nt}  max σ_vm/μ=${(vmMax / MU).toFixed(2)}  t=${env.t.toFixed(1)}s `; },
    };
  }

  // ═════════════════════════════════════════════════════════════
  // hobbies — Gray–Scott reaction–diffusion (U + 2V → 3V, V → P)
  //   Feed rate f varies across the banner, sweeping through spots,
  //   worms and labyrinths; a slow "rinse" band keeps it from settling.
  // ═════════════════════════════════════════════════════════════
  function turingSim(env) {
    const h = 4, DU = 1.0, DV = 0.5, KILL = 0.0615, ITER = 10;
    let nx, ny, U, V, U2, V2, fcol, fi, iter = 0, fShown = 0;
    const R = rng(5);

    function seed(ci, cj, r) {
      for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++)
        for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
          if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
          const k = j * nx + i;
          U[k] = 0.5 + 0.1 * R(); V[k] = 0.25 + 0.1 * R();
        }
    }

    return {
      hint: '# Turing patterns, the maths behind spots & stripes · move to seed · click for a colony',
      cmd: `./gray_scott --k=${KILL} --f=0.026..0.058`,
      prewarm: 160,
      init() {
        nx = Math.ceil(env.W / h); ny = Math.ceil(env.H / h);
        const N = nx * ny;
        U = new Float32Array(N).fill(1); V = new Float32Array(N);
        U2 = new Float32Array(N); V2 = new Float32Array(N);
        fcol = new Float32Array(nx);
        fi = makeField(nx, ny);
        for (let n = 0; n < Math.max(12, nx / 7); n++) seed((R() * nx) | 0, (R() * ny) | 0, 2 + ((R() * 3) | 0));
      },
      step() {
        const m = env.mouse;
        // Spatial feed gradient plus a rinse band that sweeps left→right every ~45 s
        const band = ((env.t / 45) % 1) * (nx + 60) - 30;
        for (let i = 0; i < nx; i++) {
          const g = Math.exp(-(((i - band) / 10) ** 2));
          fcol[i] = 0.026 + 0.032 * (i / nx) - 0.02 * g;
        }
        if (m.inside && m.speed > 0.5) seed((m.x / h) | 0, (m.y / h) | 0, 2);
        for (let it = 0; it < ITER; it++) {
          for (let j = 0; j < ny; j++) {
            const jm = (j > 0 ? j - 1 : ny - 1) * nx, jp = (j < ny - 1 ? j + 1 : 0) * nx, j0 = j * nx;
            for (let i = 0; i < nx; i++) {
              const im = i > 0 ? i - 1 : nx - 1, ip = i < nx - 1 ? i + 1 : 0, k = j0 + i;
              const u = U[k], v = V[k];
              const lu = 0.2 * (U[j0 + im] + U[j0 + ip] + U[jm + i] + U[jp + i]) +
                         0.05 * (U[jm + im] + U[jm + ip] + U[jp + im] + U[jp + ip]) - u;
              const lv = 0.2 * (V[j0 + im] + V[j0 + ip] + V[jm + i] + V[jp + i]) +
                         0.05 * (V[jm + im] + V[jm + ip] + V[jp + im] + V[jp + ip]) - v;
              const uvv = u * v * v, f = fcol[i];
              U2[k] = u + DU * lu - uvv + f * (1 - u);
              V2[k] = v + DV * lv + uvv - (KILL + f) * v;
            }
          }
          let tmp = U; U = U2; U2 = tmp; tmp = V; V = V2; V2 = tmp;
          iter++;
        }
        fShown = fcol[Math.min(nx - 1, Math.max(0, ((m.inside ? m.x : env.W * 0.75) / h) | 0))];
      },
      click(x, y) {
        const ci = (x / h) | 0, cj = (y / h) | 0;
        for (let n = 0; n < 7; n++) seed(ci + ((R() - 0.5) * 16) | 0, cj + ((R() - 0.5) * 12) | 0, 3);
      },
      draw(ctx) {
        const d = fi.data;
        for (let k = 0; k < V.length; k++) {
          const v = Math.min(1, V[k] / 0.38);
          setPx(d, k, v, v < 0.04 ? 0 : Math.min(0.8, (v - 0.04) * 1.5));
        }
        blit(ctx, fi, nx * h, ny * h);
        cursorMark(ctx, env.mouse, 10);
      },
      stat() { return `f=${fShown.toFixed(4)}  k=${KILL}  Du/Dv=${DU / DV}  iter=${iter} `; },
    };
  }

  // ═════════════════════════════════════════════════════════════
  // Core: canvas, HUD, input, lifecycle
  // ═════════════════════════════════════════════════════════════
  const SIMS = { research: poreSim, publications: edlSim, news: waveSim, cv: solidSim, hobbies: turingSim };
  const factory = SIMS[hero.dataset.sim];
  if (!factory) return;

  const env = { W: 0, H: 0, t: 0, frame: 0,
    mouse: { x: -1e4, y: -1e4, vx: 0, vy: 0, speed: 0, inside: false, last: 0 } };
  const sim = factory(env);

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const shade = document.createElement('div');
  shade.className = 'hero-shade';
  const hud = document.createElement('div');
  hud.className = 'sim-hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML = `<div class="cmt"></div><div><span class="prompt">$</span> <span class="cmd"></span></div>` +
                  `<div><span class="stat"></span><span class="cursor"></span></div>`;
  hud.querySelector('.cmt').textContent = sim.hint;
  hud.querySelector('.cmd').textContent = sim.cmd;
  const hudStat = hud.querySelector('.stat');
  hero.prepend(shade);
  hero.prepend(canvas);
  hero.appendChild(hud);
  hero.classList.add('hero-live');
  const ctx = canvas.getContext('2d');

  function frameOnce(stepIt) {
    if (stepIt) { env.t += 1 / 60; sim.step(); }
    ctx.clearRect(0, 0, env.W, env.H);
    sim.draw(ctx);
    if (env.frame % 10 === 0) hudStat.textContent = sim.stat();
    const m = env.mouse;
    m.vx *= 0.85; m.vy *= 0.85; m.speed = Math.hypot(m.vx, m.vy);
  }

  function resize() {
    const r = hero.getBoundingClientRect();
    env.W = r.width; env.H = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(env.W * dpr);
    canvas.height = Math.round(env.H * dpr);
    canvas.style.width = env.W + 'px';
    canvas.style.height = env.H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    env.t = 0;
    sim.init();
    for (let n = 0; n < (sim.prewarm || 0); n++) { env.t += 1 / 60; sim.step(); }
    frameOnce(false);
  }

  let running = false, raf = 0, onScreen = true;
  function loop() {
    raf = 0;
    if (!running) return;
    env.frame++;
    frameOnce(true);
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

  function local(e) {
    const r = hero.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  hero.addEventListener('pointermove', e => {
    const [x, y] = local(e), m = env.mouse;
    if (m.inside) { m.vx = 0.5 * m.vx + 0.5 * (x - m.x); m.vy = 0.5 * m.vy + 0.5 * (y - m.y); }
    m.speed = Math.hypot(m.vx, m.vy);
    m.x = x; m.y = y; m.inside = true; m.last = performance.now();
    if (reduceMotion) frameOnce(false);
  });
  hero.addEventListener('pointerleave', () => {
    const m = env.mouse;
    m.inside = false; m.x = m.y = -1e4; m.vx = m.vy = m.speed = 0;
    if (reduceMotion) frameOnce(false);
  });
  hero.addEventListener('pointerdown', e => {
    if (e.target.closest('a, button')) return;
    const [x, y] = local(e);
    sim.click(x, y);
    if (reduceMotion) { for (let n = 0; n < 30; n++) { env.t += 1 / 60; sim.step(); } frameOnce(false); }
  });

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

  const r0 = hero.getBoundingClientRect();
  lastW = r0.width; lastH = r0.height;
  resize();
  start();
})();
