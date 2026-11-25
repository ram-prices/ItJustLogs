#!/usr/bin/env node
/**
 * Refreshes src/data/medals.snapshot.json and src/data/findings.snapshot.json
 * (the Achievements and Archives pages) from ef-assets: its wiki/medals.json
 * and wiki/findings.json (snapshotted weekly from endfield.wiki.gg by its
 * scripts/wiki-collections.mjs), with every picture pointed at ef-assets'
 * own copy (collections/, its scripts/collection-pictures.py), so the site
 * never loads pictures from the wiki. A picture ef-assets has no copy of yet
 * is left out rather than linked to the wiki.
 *
 * Medals and archives the wiki doesn't list yet come from the game files
 * (`source: "game"`, merged in by ef-assets), with their pictures the same way.
 *
 *   node scripts/wiki-collections.mjs   (EF_ASSETS_DIR=<ef-assets clone> to read a local clone)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EF_ASSETS = 'https://raw.githubusercontent.com/ram-prices/ef-assets/main';

/** EF_ASSETS_DIR: read the files from a local ef-assets clone (its root) instead; pictures still link to GitHub. */
const DIR = process.env.EF_ASSETS_DIR;

async function json(path) {
  if (DIR) return JSON.parse(readFileSync(join(DIR, path), 'utf8'));
  const r = await fetch(`${EF_ASSETS}/${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const [medals, findings, copies] = await Promise.all([json('wiki/medals.json'), json('wiki/findings.json'), json('collections/index.json')]);
/** A wiki picture's ef-assets copy, else nothing. */
const copy = (url) => (url && copies[url] ? `${EF_ASSETS}/collections/${copies[url]}` : undefined);

let left = 0;
for (const m of medals.medals) {
  const images = {};
  for (const [k, url] of Object.entries(m.images ?? {})) {
    if (copy(url)) images[k] = copy(url);
    else left++;
  }
  m.images = images;
}
for (const f of findings.findings) {
  for (const k of ['icon', 'image']) {
    if (!f[k]) continue;
    const c = copy(f[k]);
    if (c) f[k] = c;
    else {
      delete f[k];
      left++;
    }
  }
}
writeFileSync('src/data/medals.snapshot.json', JSON.stringify(medals, null, 1) + '\n');
writeFileSync('src/data/findings.snapshot.json', JSON.stringify(findings, null, 1) + '\n');
// Home's Collection widget counts from these ids alone, without loading the snapshots (collectionIds.test.ts).
writeFileSync('src/data/collectionIds.json', JSON.stringify({ medals: medals.medals.map((x) => x.id), findings: findings.findings.map((x) => x.id) }) + '\n');
console.log(`medals: ${medals.medals.length}, archive: ${findings.findings.length}${left ? `; ${left} pictures without an ef-assets copy yet, left out` : ''}`);
