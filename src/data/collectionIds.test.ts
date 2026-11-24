import { describe, expect, it } from 'vitest';
import ids from './collectionIds.json';
import medals from './medals.snapshot.json';
import findings from './findings.snapshot.json';

/**
 * Home's Collection widget counts from collectionIds.json so it doesn't load
 * the snapshots. After refreshing them (scripts/wiki-collections.mjs), rebuild it:
 * node -e "const fs=require('fs');const m=require('./src/data/medals.snapshot.json'),f=require('./src/data/findings.snapshot.json');fs.writeFileSync('src/data/collectionIds.json',JSON.stringify({medals:m.medals.map(x=>x.id),findings:f.findings.map(x=>x.id)})+'\n')"
 */
describe('collectionIds.json', () => {
  it('lists every medal id of the snapshot, in order', () => {
    expect(ids.medals).toEqual(medals.medals.map((m) => m.id));
  });
  it('lists every finding id of the snapshot, in order', () => {
    expect(ids.findings).toEqual(findings.findings.map((f) => f.id));
  });
});
