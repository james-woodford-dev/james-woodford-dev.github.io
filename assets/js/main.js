/* =============================================================
   main.js — Personal Academic Website
   ============================================================= */

(function () {
  'use strict';

  /* ── Theme (dark / light) ──────────────────────────────── */
  const THEME_KEY = 'theme';
  const themeToggle = document.getElementById('theme-toggle');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      themeToggle.innerHTML = theme === 'dark'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/></svg>';
    }
  }

  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme(getPreferredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
  }

  /* ── Mobile nav hamburger ───────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });
    // Close when a link is clicked
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Mark active nav link ───────────────────────────────── */
  (function markActive() {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.nav-links a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href || href === '#') return;
      try {
        // Resolve relative href against the current page URL to get an absolute path
        const resolved = new URL(href, window.location.href).pathname.replace(/\/$/, '') || '/';
        const isHome   = resolved === '/' || resolved.endsWith('/index.html');
        if (
          resolved === currentPath ||
          (!isHome && currentPath.startsWith(resolved.replace(/\.html$/, '')))
        ) {
          a.classList.add('active');
        }
      } catch (_) { /* ignore invalid hrefs */ }
    });
  })();

  /* ── Skill bar animation on scroll ─────────────────────── */
  function animateSkillBars() {
    document.querySelectorAll('.skill-fill').forEach(bar => {
      const target = bar.getAttribute('data-width');
      if (target) bar.style.width = target;
    });
  }
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { animateSkillBars(); obs.disconnect(); } });
    }, { threshold: 0.2 });
    const skillSection = document.querySelector('.skill-list');
    if (skillSection) obs.observe(skillSection);
  } else {
    animateSkillBars();
  }

  /* ── Load content.json and populate the page ───────────── */
  async function loadContent() {
    const base = document.querySelector('meta[name="base-url"]')?.content ?? '';
    try {
      const res = await fetch(base + 'data/content.json');
      if (!res.ok) return;
      applyContent(await res.json());
    } catch (_) { /* fall back to HTML defaults */ }
  }

  function applyContent(c) {
    // ── Helper: safely set textContent on an element by id ──
    function setText(id, val) {
      const el = document.getElementById(id);
      if (el && val != null) el.textContent = val;
    }

    // ── Nav brand & footer name ──────────────────────────────
    if (c.name) {
      document.querySelectorAll('.nav-brand, .footer-name').forEach(el => {
        el.textContent = c.name;
      });
    }

    // ── Social link hrefs (data-content-href="github|linkedin|scholar|email") ──
    if (c.github_username) {
      document.querySelectorAll('[data-content-href="github"]').forEach(a => {
        a.href = 'https://github.com/' + c.github_username;
      });
    }
    if (c.linkedin_profile) {
      document.querySelectorAll('[data-content-href="linkedin"]').forEach(a => {
        a.href = 'https://www.linkedin.com/in/' + c.linkedin_profile;
      });
    }
    if (c.scholar_id) {
      document.querySelectorAll('[data-content-href="scholar"]').forEach(a => {
        a.href = 'https://scholar.google.com/citations?user=' + c.scholar_id;
      });
    }
    if (c.email) {
      document.querySelectorAll('[data-content-href="email"]').forEach(a => {
        a.href = 'mailto:' + c.email;
      });
    }

    // ── Hero section (index.html) ────────────────────────────
    if (c.name)  setText('hero-name', c.name);
    if (c.title || c.department) {
      setText('hero-title',
        [c.title, c.department].filter(Boolean).join('\u00a0·\u00a0'));
    }
    if (c.university || c.city) {
      setText('hero-institution',
        [c.university, c.city].filter(Boolean).join(', '));
    }
    if (c.bio) setText('hero-bio', c.bio);

    // ── Research interests grid (index.html) ─────────────────
    const grid = document.getElementById('research-interests-grid');
    if (grid && Array.isArray(c.research_interests) && c.research_interests.length) {
      // Preserve the original fade-in delay classes for the first three cards
      const delayClasses = ['fade-in', 'fade-in fade-in-delay-1', 'fade-in fade-in-delay-2'];
      grid.innerHTML = c.research_interests.map((item, i) => `
        <div class="card ${delayClasses[i] || 'fade-in'}">
          <div class="card-icon">${item.icon || ''}</div>
          <h3 class="card-title">${item.title || ''}</h3>
          <p class="text-muted" style="font-size:0.93rem">${item.description || ''}</p>
        </div>`).join('');
    }

    // ── News items — home page snippet (index.html) ──────────
    const homeNews = document.getElementById('home-news-list');
    if (homeNews && Array.isArray(c.news) && c.news.length) {
      homeNews.innerHTML = c.news.slice(0, 3).map(item => `
        <li class="news-item">
          <span class="news-date">${item.date || ''}</span>
          <div class="news-content">
            <span class="news-badge ${item.badge_class || ''}">${item.badge_text || ''}</span>
            ${item.text || ''}
          </div>
        </li>`).join('');
    }

    // ── News items — full news page (news.html) ──────────────
    const fullNews = document.getElementById('full-news-list');
    if (fullNews && Array.isArray(c.news) && c.news.length) {
      fullNews.innerHTML = c.news.map(item => `
        <li class="news-item" data-type="${item.type || 'misc'}">
          <span class="news-date">${item.date || ''}</span>
          <div class="news-content">
            <span class="news-badge ${item.badge_class || ''}">${item.badge_text || ''}</span>
            ${item.text || ''}
          </div>
        </li>`).join('');
    }
  }

  // Run content loading on every page
  loadContent();

  /* ── Load Google Scholar data (publications page) ───────── */
  async function loadScholarData() {
    const container = document.getElementById('publications-container');
    const statsEl   = document.getElementById('scholar-stats');
    if (!container) return;

    try {
      // Determine base path (works both from root and subdirs)
      const base = document.querySelector('meta[name="base-url"]')?.content ?? '';
      const res  = await fetch(base + 'data/scholar.json');
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      renderScholarData(data, container, statsEl);
    } catch (err) {
      container.innerHTML =
        '<p class="text-muted">Could not load publications data. Please check back later.</p>';
    }
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderScholarData(data, container, statsEl) {
    // Stats
    if (statsEl && data.profile) {
      const p = data.profile;
      statsEl.innerHTML = `
        <div class="stat-box"><div class="stat-value">${escHtml(String(p.citations || 0))}</div><div class="stat-label">Citations</div></div>
        <div class="stat-box"><div class="stat-value">${escHtml(String(p.citations_5y || 0))}</div><div class="stat-label">Citations (5y)</div></div>
        <div class="stat-box"><div class="stat-value">${escHtml(String(p.h_index || 0))}</div><div class="stat-label">h-index</div></div>
        <div class="stat-box"><div class="stat-value">${escHtml(String(p.h_index_5y || 0))}</div><div class="stat-label">h-index (5y)</div></div>
        <div class="stat-box"><div class="stat-value">${escHtml(String(p.i10_index || 0))}</div><div class="stat-label">i10-index</div></div>`;
    }

    const pubs = data.publications || [];
    if (pubs.length === 0) {
      container.innerHTML = '<p class="text-muted">No publications found. Run the Scholar update script to populate this section.</p>';
      return;
    }

    const html = pubs.map((pub, i) => {
      const title   = escHtml(pub.title   || 'Untitled');
      const authors = escHtml(pub.authors || '');
      const venue   = escHtml(pub.venue   || '');
      const year    = escHtml(String(pub.year || ''));
      const cites   = pub.citations || 0;
      const url     = pub.url ? escHtml(pub.url) : '';

      return `
      <div class="pub-item">
        <div class="pub-title">
          ${url ? `<a href="${url}" target="_blank" rel="noopener">${title}</a>` : title}
        </div>
        <div class="pub-authors">${authors}</div>
        ${venue ? `<div class="pub-venue">${venue}${year ? ', ' + year : ''}</div>` : (year ? `<div class="pub-venue">${year}</div>` : '')}
        <div class="pub-tags">
          ${cites > 0 ? `<span class="tag tag-cite">📖 ${cites} citation${cites !== 1 ? 's' : ''}</span>` : ''}
          ${url ? `<a href="${url}" target="_blank" rel="noopener" class="tag">🔗 View</a>` : ''}
        </div>
      </div>`;
    }).join('');

    container.innerHTML = html;

    // Update "last updated" text
    const lastUpdated = document.getElementById('last-updated');
    if (lastUpdated && data.last_updated) {
      lastUpdated.textContent = 'Last updated: ' + data.last_updated;
    }
  }

  // Run on publications page
  loadScholarData();

  /* ── Publication year filter ─────────────────────────────── */
  const yearFilter = document.getElementById('year-filter');
  if (yearFilter) {
    yearFilter.addEventListener('change', function () {
      const val = this.value;
      document.querySelectorAll('.pub-item[data-year]').forEach(el => {
        el.style.display = (!val || el.dataset.year === val) ? '' : 'none';
      });
    });
  }

  /* ── Scroll to top button ───────────────────────────────── */
  const scrollTopBtn = document.getElementById('scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.style.opacity = window.scrollY > 400 ? '1' : '0';
      scrollTopBtn.style.pointerEvents = window.scrollY > 400 ? 'auto' : 'none';
    });
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* ── Copy email to clipboard ────────────────────────────── */
  document.querySelectorAll('[data-copy-email]').forEach(el => {
    el.addEventListener('click', () => {
      const email = el.getAttribute('data-copy-email');
      navigator.clipboard.writeText(email).then(() => {
        const orig = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => { el.textContent = orig; }, 2000);
      });
    });
  });

})();
