import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { EF_ASSETS, EF_ASSETS_CDN } from './src/domain/banners.ts';
import {
  embedBytes,
  embedTag,
  operatorEmbed,
  operatorPreview,
  previewTags,
  scheduleEmbed,
  schedulePreview,
  SITE_URL,
  weaponEmbed,
  weaponPreview,
  type ComponentEmbed,
  type Preview,
  type ShareOperator,
  type ShareWeapon,
} from './src/domain/share.ts';
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
  'rotations',
  'rotations/parser',
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

/** An ef-assets file (raw.githubusercontent, then jsDelivr). */
async function fetchAsset<T>(path: string): Promise<T> {
  let error: unknown;
  for (const base of [EF_ASSETS, EF_ASSETS_CDN]) {
    try {
      const res = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(20000) });
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
    console.warn(`[item-pages] ef-assets wiki data unavailable (${e}); using ${WIKI_SNAPSHOT}`);
    return JSON.parse(readFileSync(WIKI_SNAPSHOT, 'utf8')) as WikiShare;
  }
}

/** The banner schedule from ef-assets (refreshed every few days), or the app's snapshot. */
async function loadSchedule(): Promise<Schedule> {
  try {
    return await fetchAsset<Schedule>('schedule.json');
  } catch (e) {
    console.warn(`[item-pages] ef-assets schedule unavailable (${e}); using ${SCHEDULE_SNAPSHOT}`);
    return JSON.parse(readFileSync(SCHEDULE_SNAPSHOT, 'utf8')) as Schedule;
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
  return index
    .replace(PREVIEW_TAG, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${title.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)} · ItJustLogs</title>`)
    .replace('</head>', `  ${tags}\n  </head>`);
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
      const [wiki, schedule] = await Promise.all([loadWiki(), loadSchedule()]);
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
      const missing: string[] = [];
      let largest = 0;
      await Promise.all(
        pages.map(async ({ dir, id, name, p, embed, fromWiki = true }) => {
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
      for (const [slug, t] of shortLinks) copyFileSync(join(outDir, t.kind === 'weap' ? 'arsenal/info' : 'operators/info', `${t.id}.html`), join(outDir, `${slug}.html`));
      const n = [...shortLinks.values()].filter((t) => t.kind === 'weap').length;
      console.log(`[item-pages] short links: ${shortLinks.size - n} operator, ${n} weapon (/${[...shortLinks.keys()].slice(0, 3).join(', /')}...)`);
      console.log(`[item-pages] largest component embed: ${largest} bytes`);
      console.log(`[item-pages] ${ops.length} operator and ${Object.keys(wiki.weapons).length} weapon pages for ${SITE_URL}`);
      console.log(`[item-pages] ${schedulePages.length} banner and event pages`);
      if (missing.length) console.log(`[item-pages] no image yet, previews without one: ${missing.sort().join(', ')}`);
    },
  };
}

export default defineConfig({
  // Absolute asset paths: pages live at /operators/ etc., and the site is
  // served from the root of its own domain (itjustlogs.dev).
  base: '/',
  plugins: [pageCopies()],
  server: {
    port: 5173,
    strictPort: true,
    // fixtures/ holds real pull history; never serve it (the dev server may be reachable from the LAN).
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/fixtures/**'] },
  },
});
