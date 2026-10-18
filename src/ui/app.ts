import { DATA_ROUTES, ROUTES, state, subscribe, updateSettings, type Route } from '../state';
import { installTooltips } from './charts';
import { ICONS, installImageFallback, toast } from './common';
import { dashboardView, handleDashboardClick } from './dashboard';
import { EXPORTER_SOURCE, guideView, scriptBlock } from './guide';
import { fmtDate, fmtInt, html, raw, render, type Html } from './html';
import { handlePlannerInput, plannerView } from './planner';
import { handleSettingsAction, handleSettingsChange, importText, settingsView } from './settings';
import { statsView } from './stats';

const NAV: { route: Route; label: string }[] = [
  { route: 'operators', label: 'Operators' },
  { route: 'arsenal', label: 'Arsenal' },
  { route: 'stats', label: 'Stats' },
  { route: 'planner', label: 'Planner' },
  { route: 'guide', label: 'Get data' },
  { route: 'settings', label: 'Settings' },
];

function currentRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  if (!ROUTES.includes(r)) return state.analysis ? 'operators' : 'guide';
  if (!state.analysis && DATA_ROUTES.includes(r)) return 'guide';
  return r;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let root: HTMLElement;
let lastRoute: Route | null = null;

function applyTheme(): void {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function nextTheme(): void {
  const order = ['system', 'light', 'dark'] as const;
  const t = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  updateSettings({ theme: t });
  toast(`Theme: ${t === 'system' ? 'follow system' : t}`);
}

function shell(route: Route): Html {
  const has = !!state.analysis;
  const themeIcon = { system: ICONS.system, light: ICONS.sun, dark: ICONS.moon }[state.settings.theme];
  return html`
    <header class="topbar">
      <div class="wrap topbar-inner">
        <a class="logo" href="#/"><span class="logo-mark" aria-hidden="true"></span>ItJustLogs</a>
        <nav class="nav" aria-label="Sections">
          ${NAV.map(
            (n) =>
              html`<a href="#/${n.route}" ${n.route === route ? raw('aria-current="page"') : ''} ${!has && DATA_ROUTES.includes(n.route) ? raw('aria-disabled="true" tabindex="-1"') : ''}>${n.label}</a>`,
          )}
        </nav>
        <div class="topbar-actions">
          <button class="btn btn-icon" data-action="cycle-theme" title="Theme: ${state.settings.theme}" aria-label="Change theme (now ${state.settings.theme})">${raw(themeIcon)}</button>
          <button class="btn ${has ? '' : 'btn-primary'}" data-action="import">${raw(ICONS.upload)}<span>Import</span></button>
        </div>
      </div>
    </header>
    <div class="wrap">
      ${has && ['operators', 'arsenal', 'stats'].includes(route) ? profile() : ''}
      <main id="main">${page(route)}</main>
    </div>
    <footer>
      <div class="wrap">
        ItJustLogs is a fan-made tracker for Arknights: Endfield. It is not affiliated with Gryphline or Hypergryph, and
        game assets belong to them. Your data stays in your browser.
      </div>
    </footer>
    <div class="drop-overlay" aria-hidden="true"><div>Drop your pull history to import it</div></div>
    <input type="file" accept=".json,application/json" data-file-input hidden />
  `;
}

function profile(): Html {
  const a = state.analysis!;
  const name = state.settings.displayName || 'Endministrator';
  const header = state.images.header;
  return html`<section class="profile">
    <div class="profile-art" style="${header ? `background-image:url('${header}')` : ''}"></div>
    <div class="profile-body">
      ${state.images.avatar
        ? html`<img class="avatar" src="${state.images.avatar}" alt="" />`
        : html`<div class="avatar" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</div>`}
      <div>
        <div class="profile-name">${name}</div>
        <div class="profile-meta">Pulling since ${fmtDate(a.firstTs)} · last pull ${fmtDate(a.lastTs)}</div>
      </div>
      <div class="profile-facts">
        <div class="fact"><b class="num">${fmtInt(a.char.pulls + a.weap.pulls)}</b><span>Total pulls</span></div>
        <div class="fact"><b class="num">${fmtInt(a.char.sixStars + a.weap.sixStars)}</b><span>6★ pulled</span></div>
        <div class="fact"><b class="num">${fmtInt(a.char.uniqueItems)}</b><span>Unique operators</span></div>
        <div class="fact"><b class="num">${fmtInt(a.weap.uniqueItems)}</b><span>Unique weapons</span></div>
      </div>
    </div>
  </section>`;
}

function page(route: Route): Html {
  const a = state.analysis;
  if (route === 'guide' && !a) return welcome();
  switch (route) {
    case 'operators':
      return dashboardView('char', a!);
    case 'arsenal':
      return dashboardView('weap', a!);
    case 'stats':
      return statsView(a!);
    case 'planner':
      return plannerView(a!);
    case 'settings':
      return settingsView();
    case 'guide':
      return guideView();
  }
}

function welcome(): Html {
  return html`<section class="hero">
      <h1>Your Endfield pulls, logged.</h1>
      <p>See your pity, your 50/50 record and how lucky each 6★ was, across every banner and patch. It all runs in your
        browser, and nothing is uploaded.</p>
      <div class="dropzone">
        <button class="btn btn-primary" data-action="import">${raw(ICONS.upload)} Choose a pull history file</button>
        <p>…or drop it here, or press <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste it.</p>
      </div>
      <div class="steps">
        <div class="card step"><b>1</b><p>Open your Headhunting history in-game once.</p></div>
        <div class="card step"><b>2</b><p>Paste the exporter below into Windows PowerShell, then press <kbd>Enter</kbd> until it starts.</p></div>
        <div class="card step"><b>3</b><p>Come back and press <kbd>Ctrl</kbd>+<kbd>V</kbd>. Done.</p></div>
      </div>
    </section>
    <div class="prose" style="margin:0 auto">
      ${scriptBlock()}
      <p>Want to know exactly what the script does first? <a href="#/guide" data-action="full-guide">Read the full guide</a>.</p>
    </div>`;
}

let showFullGuide = false;

function draw(): void {
  applyTheme();
  const route = currentRoute();
  if (route === 'guide' && !state.analysis && showFullGuide) {
    render(root, shell(route));
    render(root.querySelector('#main')!, guideView());
  } else {
    render(root, shell(route));
  }
  if (route !== lastRoute) scrollTo({ top: 0 });
  lastRoute = route;
  document.title = `${NAV.find((n) => n.route === route)?.label ?? 'Home'} · ItJustLogs`;
}

// ---------------------------------------------------------------------------
// Import: file picker, drag & drop anywhere, paste anywhere
// ---------------------------------------------------------------------------

async function importFile(file: File): Promise<void> {
  try {
    await importText(await file.text(), file.name);
    if (!DATA_ROUTES.includes(currentRoute())) location.hash = '#/operators';
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function installImport(): void {
  let depth = 0;
  const overlay = () => root.querySelector('.drop-overlay');
  addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    overlay()?.classList.add('on');
  });
  addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      overlay()?.classList.remove('on');
    }
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay()?.classList.remove('on');
    const file = e.dataTransfer?.files[0];
    if (file) void importFile(file);
  });
  addEventListener('paste', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable]')) return;
    const file = e.clipboardData?.files[0];
    const text = e.clipboardData?.getData('text') ?? '';
    if (file) void importFile(file);
    else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      e.preventDefault();
      importText(text, 'The pasted text')
        .then(() => {
          if (!DATA_ROUTES.includes(currentRoute())) location.hash = '#/operators';
        })
        .catch((err) => toast((err as Error).message, 'error'));
    } else if (text.trim()) {
      toast('That doesn’t look like pull history. Run the exporter first, then paste.', 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Delegated events
// ---------------------------------------------------------------------------

function installEvents(): void {
  root.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    const action = actionEl?.dataset.action;
    if (!action) return;
    switch (action) {
      case 'import':
        root.querySelector<HTMLInputElement>('[data-file-input]')!.click();
        return;
      case 'cycle-theme':
        nextTheme();
        return;
      case 'full-guide':
        e.preventDefault();
        showFullGuide = true;
        draw();
        return;
      case 'copy-script':
        try {
          await navigator.clipboard.writeText(EXPORTER_SOURCE);
          toast('Script copied. Paste it into Windows PowerShell.');
        } catch {
          toast('Could not copy automatically. Select the script text and copy it.', 'error');
        }
        return;
    }
    if (state.analysis && handleDashboardClick(target, state.analysis)) return;
    await handleSettingsAction(action, actionEl!);
  });

  root.addEventListener('input', (e) => {
    if (state.analysis) handlePlannerInput(e.target as HTMLElement, state.analysis);
  });

  root.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-file-input]')) {
      const file = el.files?.[0];
      el.value = '';
      if (file) await importFile(file);
      return;
    }
    if (el.closest('[data-planner]')) {
      if (el.tagName === 'SELECT' && state.analysis) handlePlannerInput(el, state.analysis);
      return;
    }
    await handleSettingsChange(el);
  });

  addEventListener('hashchange', () => {
    showFullGuide = false;
    draw();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

export function mount(el: HTMLElement): void {
  root = el;
  installImageFallback();
  installTooltips();
  installImport();
  installEvents();
  subscribe(draw);
  draw();
}
