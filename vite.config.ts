import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import { dataUrls, EF_ASSETS } from './src/domain/banners.ts';
import {
  embedBytes,
  embedTag,
  operatorEmbed,
  operatorPreview,
  previewTags,
  scheduleEmbed,
  schedulePreview,
  seasonEmbed,
  seasonPreview,
  SITE_URL,
  weaponEmbed,
  weaponPreview,
  type ComponentEmbed,
  type Preview,
  type ShareOperator,
  type ShareWeapon,
} from './src/domain/share.ts';
import { seasonsInOrder, type SeasonIndex } from './src/domain/contracts.ts';
import { isScheduleBanner, isWeaponBanner, legacyEventLinks, scheduleLinks, type Schedule } from './src/domain/schedule.ts';
import { itemShortLinks, itemSlugs, WIKI_ALIASES } from './src/domain/wiki.ts';

/**
 * The app's pages; each gets its own copy of index.html in the build. The old
 * paths (operators, arsenal, stats, pulls) stay so old links open and the app
 * moves them to today's.
 */
const PAGES = [
  'database',
  'database/operators',
  'database/arsenals',
  'banner',
  'banner/headhunting',
  'banner/arsenal',
  'banner/stats',
  'essences',
  'aic',
  'contracts',
  'rotations',
  'rotations/parser',
  'rotations/sim',
  'rotations/transcript',
  'achievements',
  'archives',
  'story',
  'settings',
  'pulls',
  'operators',
  'arsenal',
  'stats',
];

/** Fallback for the banner and event pages when ef-assets can't be reached (the app's own schedule snapshot). */
const SCHEDULE_SNAPSHOT = 'src/data/schedule.snapshot.json';

/** Fallback for the per-item pages when ef-assets can't be reached; refreshed by local builds. */
const WIKI_SNAPSHOT = 'src/data/wiki-share.snapshot.json';

interface WikiShare {
  operators: Record<string, ShareOperator>;
  weapons: Record<string, ShareWeapon>;
}

/** The fields share.ts uses, so the snapshot stays small. */
function slim(ops: Record<string, ShareOperator>, wpns: Record<string, ShareWeapon>): WikiShare {
  const operators: WikiShare['operators'] = {};
  for (const [id, o] of Object.entries(ops)) {
    const { name, rarity, class: cls, element, weapon, faction, tags, page } = o;
    const skills = o.skills.map(({ name, type, description }) => ({ name, type, description }));
    operators[id] = { name, rarity, class: cls, element, weapon, faction, tags, page, skills };
  }
  const weapons: WikiShare['weapons'] = {};
  for (const [id, w] of Object.entries(wpns)) {
    const { name, rarity, type, source, page, skills } = w;
    const atk = w.stats?.baseAtk.at(-1);
    weapons[id] = {
      name,
      rarity,
      type,
      source,
      page,
      skills: skills.map(({ name, tag, text, values }) => ({ name, tag, text, values })),
      ...(atk != null ? { stats: { levels: [w.stats!.levels.at(-1)!], baseAtk: [atk] } } : {}),
    };
  }
  return { operators, weapons };
}

/** An ef-assets file (assets.itjustlogs.dev, then raw.githubusercontent). */
async function fetchAsset<T>(path: string): Promise<T> {
  let error: unknown;
  for (const url of dataUrls(path)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return (await res.json()) as T;
      error = new Error(`${res.status} ${res.statusText}`);
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

/** False only when the image is known to be missing (new items reach ef-assets later). */
async function imageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return res.status !== 404;
  } catch {
    return true;
  }
}

/**
 * When ef-assets can't be reached: a scheduled deploy (which exists only to
 * refresh these pages) fails, so the last good deploy stays live instead of
 * one built from stale snapshots, without newer pages or any contract pages.
 * Local and push builds fall back, loudly.
 */
function unavailable(what: string, e: unknown, fallback: string): void {
  if (process.env.GITHUB_EVENT_NAME === 'schedule') throw new Error(`[item-pages] ef-assets ${what} unavailable (${e}); failing the scheduled build so the last deploy stays live`);
  console.warn(`\n[item-pages] WARNING: ef-assets ${what} unavailable (${e}); ${fallback}. Pages newer than that will be missing.\n`);
}

/** The wiki data from ef-assets, or the snapshot if it can't be fetched. */
async function loadWiki(): Promise<WikiShare> {
  try {
    const [o, w] = await Promise.all([
      fetchAsset<{ operators: Record<string, ShareOperator> }>('wiki/operators.json'),
      fetchAsset<{ weapons: Record<string, ShareWeapon> }>('wiki/weapons.json'),
    ]);
    const data = slim(o.operators, w.weapons);
    // Keep the fallback current on the owner's machine (CI builds are thrown away).
    if (!process.env.CI) writeFileSync(WIKI_SNAPSHOT, `${JSON.stringify(data, null, 1)}\n`);
    return data;
  } catch (e) {
    unavailable('wiki data', e, `using ${WIKI_SNAPSHOT}`);
    return JSON.parse(readFileSync(WIKI_SNAPSHOT, 'utf8')) as WikiShare;
  }
}

/** The banner schedule from ef-assets (refreshed every few days), or the app's snapshot. */
async function loadSchedule(): Promise<Schedule> {
  try {
    return await fetchAsset<Schedule>('schedule.json');
  } catch (e) {
    unavailable('schedule', e, `using ${SCHEDULE_SNAPSHOT}`);
    return JSON.parse(readFileSync(SCHEDULE_SNAPSHOT, 'utf8')) as Schedule;
  }
}

/** Contingency Contract seasons from ef-assets; without them the pages keep the site's own preview. */
async function loadSeasons(): Promise<SeasonIndex['seasons']> {
  try {
    return (await fetchAsset<SeasonIndex>('cc/index.json')).seasons;
  } catch (e) {
    unavailable('contract seasons', e, 'building no /contracts/<season> pages');
    return [];
  }
}

const PREVIEW_TAG = /\s*<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+|description|theme-color)"[^>]*>/g;

/**
 * index.html with the default preview tags swapped for `p`'s, plus Discord's
 * component embed (which Discord shows instead; the tags are its fallback).
 */
function withPreview(index: string, p: Preview, embed: ComponentEmbed, title: string, wiki = true): string {
  // Wiki data gets the wiki's credit; schedule art is shown large, portraits as thumbnails.
  const tags = [previewTags({ ...p, siteName: wiki ? 'ItJustLogs · endfield.wiki.gg' : 'ItJustLogs', large: !wiki }), embedTag(embed)].filter(Boolean).join('\n    ');
  // Function replacers: wiki text may hold `$&`, `` $` `` or `$'`, which a replacement string would expand.
  const titleTag = `<title>${title.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)} · ItJustLogs</title>`;
  return index
    .replace(PREVIEW_TAG, '')
    .replace(/<title>[^<]*<\/title>/, () => titleTag)
    .replace('</head>', () => `  ${tags}\n  </head>`);
}

/** Page ids and keys that are safe as a file name (no `..`, slashes or odd characters). */
const SAFE_ID = /^[\w-]+$/;

/** Old paths kept only so old links open; the app moves them on, so the sitemap leaves them out. */
const LEGACY_PAGES = new Set(['pulls', 'operators', 'arsenal', 'stats']);
/** Page folders that are old addresses of another page (same preview), left out of the sitemap. */
const LEGACY_DIRS = new Set(['operators/info', 'arsenal/info', 'events']);

/** sitemap.xml for the built pages (absolute URLs on SITE_URL). */
function sitemap(paths: string[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const urls = [...new Set(paths)].map((p) => `  <url><loc>${esc(`${SITE_URL}${p}`)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * GitHub Pages only serves files, so clean paths like /database need a file
 * there: copy index.html into a folder per page. Deeper paths
 * (/banner/headhunting/<poolId>) fall back to 404.html, which is the same app.
 *
 * Operator and weapon info pages get a file each
 * (database/operators/<name>.html, which Pages serves at the clean path) with
 * that item's link-preview tags and Discord component embed, since Discord
 * and friends read the raw HTML and run no script. The old addresses
 * (operators/info/<chr id>.html) get the same page, so old links still
 * unfurl. A new operator needs a rebuild to get one; until then
 * its link still works through 404.html, with the generic preview.
 * Each scheduled banner's Pulls card (banner/headhunting/<name>.html) gets
 * its banner's preview too.
 * Each short link (/si, /lunar-calling; see itemShortLinks) gets a copy of its
 * item's page at the site root.
 */
function pageCopies(): Plugin {
  let outDir = 'dist';
  return {
    name: 'page-copies',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const indexFile = join(outDir, 'index.html');
      for (const page of PAGES) {
        mkdirSync(join(outDir, page), { recursive: true });
        copyFileSync(indexFile, join(outDir, page, 'index.html'));
      }
      copyFileSync(indexFile, join(outDir, '404.html'));

      const index = readFileSync(indexFile, 'utf8');
      const [wiki, schedule, seasons] = await Promise.all([loadWiki(), loadSchedule(), loadSeasons()]);
      const ops = Object.entries(wiki.operators);
      // Game ids the wiki files under another id get the same page.
      for (const [game, wikiKey] of Object.entries(WIKI_ALIASES)) if (wiki.operators[wikiKey]) ops.push([game, wiki.operators[wikiKey]]);
      // Database pages are named by the item (database/operators/si), else by id; the old id pages point there.
      const slugOf = (links: Map<string, string>) => {
        const out = new Map<string, string>();
        for (const [slug, id] of links) if (!out.has(id)) out.set(id, slug);
        return out;
      };
      const opSlug = slugOf(itemSlugs(wiki.operators, 'char'));
      const wpnSlug = slugOf(itemSlugs(wiki.weapons, 'weap'));
      const pages: { dir: string; id: string; name: string; p: Preview; embed: (p: Preview) => ComponentEmbed; fromWiki?: boolean }[] = [];
      for (const [id, o] of ops) {
        const slug = opSlug.get(WIKI_ALIASES[id] ?? id) ?? id;
        const page = { name: o.name, p: operatorPreview(id, o, slug), embed: (p: Preview) => operatorEmbed(o, p) };
        pages.push({ dir: 'operators/info', id, ...page });
        if (!WIKI_ALIASES[id]) pages.push({ dir: 'database/operators', id: slug, ...page });
      }
      for (const [id, w] of Object.entries(wiki.weapons)) {
        const slug = wpnSlug.get(id) ?? id;
        const page = { name: w.name, p: weaponPreview(id, w, slug), embed: (p: Preview) => weaponEmbed(w, p) };
        pages.push({ dir: 'arsenal/info', id, ...page }, { dir: 'database/arsenals', id: slug, ...page });
      }
      // Every banner and event in the schedule: /banners/<name>, /event/<id>.
      const links = scheduleLinks(schedule);
      const schedulePages = [...links].map(([item, path]) => {
        const [, dir, id] = path.split('/');
        return { dir, id, name: item.name, p: schedulePreview(item, path), embed: (p: Preview) => scheduleEmbed(item, p), fromWiki: false };
      });
      pages.push(...schedulePages);
      // Each banner's Pulls card: banner/headhunting/<name>, with the banner's preview.
      for (const [item, path] of links) {
        if (!isScheduleBanner(item) || !item.poolId || !path.startsWith('/banners/')) continue;
        const dir = `banner/${isWeaponBanner(item.kind) ? 'arsenal' : 'headhunting'}`;
        const id = path.slice('/banners/'.length);
        pages.push({ dir, id, name: item.name, p: schedulePreview(item, `/${dir}/${id}`), embed: (p: Preview) => scheduleEmbed(item, p), fromWiki: false });
      }
      // LEGACY, to be removed with legacyEventLinks: the old /events/<name> pages,
      // same preview (pointing at /event/<id>) so old links still unfurl.
      for (const [e, path] of legacyEventLinks(schedule)) {
        const [, dir, id] = path.split('/');
        const to = links.get(e)!;
        if (to !== path) pages.push({ dir, id, name: e.name, p: schedulePreview(e, to), embed: (p: Preview) => scheduleEmbed(e, p), fromWiki: false });
      }
      // Contingency Contract: /contracts/<season>, and /contracts itself with the season it leads with.
      const seasonPage = (dir: string, id: string, s: (typeof seasons)[number], path: string, name: string) =>
        pages.push({ dir, id, name, p: seasonPreview(s, path), embed: (p: Preview) => seasonEmbed(s, p), fromWiki: false });
      for (const s of seasons) seasonPage('contracts', s.id, s, `/contracts/${s.id}`, s.fullName);
      const lead = seasonsInOrder(seasons, Date.now(), 'americas')[0];
      if (lead) seasonPage('contracts', 'index', lead, '/contracts', 'Contingency Contract');
      const missing: string[] = [];
      let largest = 0;
      const unsafe = pages.filter((x) => !SAFE_ID.test(x.id));
      if (unsafe.length) console.warn(`[item-pages] WARNING: skipped pages with unsafe ids: ${unsafe.map((x) => JSON.stringify(`${x.dir}/${x.id}`)).join(', ')}`);
      const safe = pages.filter((x) => SAFE_ID.test(x.id));
      await Promise.all(
        safe.map(async ({ dir, id, name, p, embed, fromWiki = true }) => {
          if (p.image && !(await imageExists(p.image))) {
            missing.push(id);
            p = { ...p, image: '' };
          }
          const e = embed(p);
          largest = Math.max(largest, embedBytes(e));
          mkdirSync(join(outDir, dir), { recursive: true });
          writeFileSync(join(outDir, dir, `${id}.html`), withPreview(index, p, e, name, fromWiki));
        }),
      );
      // Short links (/si, /lunar-calling): the same page at the root, which Pages serves from si.html.
      const shortLinks = itemShortLinks(wiki.operators, wiki.weapons);
      for (const [slug, t] of shortLinks) {
        if (!SAFE_ID.test(slug) || !SAFE_ID.test(t.id)) {
          console.warn(`[item-pages] WARNING: skipped short link with unsafe key: ${JSON.stringify(slug)} → ${JSON.stringify(t.id)}`);
          shortLinks.delete(slug);
          continue;
        }
        copyFileSync(join(outDir, t.kind === 'weap' ? 'arsenal/info' : 'operators/info', `${t.id}.html`), join(outDir, `${slug}.html`));
      }
      // sitemap.xml (public/robots.txt points to it): the clean paths and every built page, without the
      // legacy addresses and the short links (copies of a page listed under its own path).
      const paths = [
        '/',
        ...PAGES.filter((page) => !LEGACY_PAGES.has(page)).map((page) => `/${page}`),
        ...safe.filter((x) => !LEGACY_DIRS.has(x.dir)).map((x) => (x.id === 'index' ? `/${x.dir}` : `/${x.dir}/${x.id}`)),
      ];
      writeFileSync(join(outDir, 'sitemap.xml'), sitemap(paths));
      console.log(`[item-pages] sitemap.xml: ${new Set(paths).size} URLs`);
      const n = [...shortLinks.values()].filter((t) => t.kind === 'weap').length;
      console.log(`[item-pages] short links: ${shortLinks.size - n} operator, ${n} weapon (/${[...shortLinks.keys()].slice(0, 3).join(', /')}...)`);
      console.log(`[item-pages] largest component embed: ${largest} bytes`);
      console.log(`[item-pages] ${ops.length} operator and ${Object.keys(wiki.weapons).length} weapon pages for ${SITE_URL}`);
      console.log(`[item-pages] ${schedulePages.length} banner and event pages`);
      if (missing.length) console.log(`[item-pages] no image yet, previews without one: ${missing.sort().join(', ')}`);
    },
  };
}

/**
 * The production Content-Security-Policy, as a <meta> in index.html (GitHub
 * Pages can't send headers). Builds only: the dev server needs inline
 * scripts for HMR. Every page copy (pageCopies) is made from the built
 * index.html, so it carries the same policy. A new external origin (a CDN,
 * an API) must be added here, or the browser blocks it.
 *
 * Where each origin is used:
 * - assets.itjustlogs.dev: ef-assets (Cloudflare Pages), its pictures, videos and data
 *   files (domain/banners.ts) and the CSS masks.
 * - raw.githubusercontent.com: the same ef-assets files on GitHub, the fallback (mirrorUrl).
 * - cdn.jsdelivr.net: Tesseract.js with its worker, core (WebAssembly) and language data
 *   (ui/screenReader.ts), HiGHS (ui/aicWorker.ts). Scripts and fetches only.
 * - web-static.hg-cdn.com: event art the official schedule links to (schedule.json `art`).
 * - accounts.google.com/gsi/, www.googleapis.com, oauth2.googleapis.com: Google
 *   sign-in and Drive sync (drive.ts); Google's documented GIS policy plus token revoke.
 * - fonts.googleapis.com, fonts.gstatic.com: Jost, Geist Mono and Material Symbols; also
 *   fetched (connect-src) to inline them into copied banner card pictures (ui/cardImage.ts).
 * - blob: and data: are the player's own files (pictures, videos, backups), and
 *   Tesseract's worker is a blob: script.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Every inline script must be covered by its hash (a src or JSON script needs none).
        const hashes = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
          .filter(([, attrs = '', body]) => !/\ssrc=/.test(attrs) && !/type="application\/(ld\+)?json"/.test(attrs) && body.trim())
          .map(([, , body]) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
        const jsdelivr = 'https://cdn.jsdelivr.net';
        const raw = 'https://raw.githubusercontent.com';
        const assets = new URL(EF_ASSETS).origin;
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')} ${jsdelivr} https://accounts.google.com/gsi/client 'wasm-unsafe-eval'`,
          "worker-src 'self' blob:",
          `connect-src 'self' ${assets} ${raw} ${jsdelivr} https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com blob: data:`,
          `img-src 'self' data: blob: ${assets} ${raw} https://web-static.hg-cdn.com`,
          `media-src 'self' blob: ${assets} ${raw}`,
          "font-src 'self' https://fonts.gstatic.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
          'frame-src https://accounts.google.com/gsi/',
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ]
          .map((d) => d.replace(/\s+/g, ' '))
          .join('; ');
        // Right after the charset, before anything it governs.
        const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        if (!/<meta charset="UTF-8" \/>/.test(html)) throw new Error('[csp] index.html has no <meta charset="UTF-8" /> to put the policy after');
        return html.replace(/<meta charset="UTF-8" \/>/, (m) => `${m}\n    ${tag}`);
      },
    },
  };
}

/** Which build this is, shown in the footer: the commit (CI's, else the local one) and the UTC minute it was built. */
function buildId(): string {
  let sha = process.env.GITHUB_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'local';
    }
  }
  return `${sha.slice(0, 7)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  // Absolute asset paths: pages live at /operators/ etc., and the site is
  // served from the root of its own domain (itjustlogs.dev).
  base: '/',
  plugins: [contentSecurityPolicy(), pageCopies()],
  server: {
    port: 5173,
    strictPort: true,
    // fixtures/ holds real pull history; never serve it (the dev server may be reachable from the LAN).
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/fixtures/**'] },
  },
  test: {
    // Scratch tests (src/domain/sim/dbg*, gitignored) read a local ef-assets clone: run them on purpose with DBG=1.
    exclude: [...configDefaults.exclude, ...(process.env.DBG ? [] : ['src/**/dbg*'])],
  },
});
