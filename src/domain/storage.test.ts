import { describe, expect, it } from 'vitest';
import { withoutRetiredPlaces } from './artMeta';
import { itemKey, itemsOf, keyTime, newestFirst, removedItem, savedItem, withStorageItems, type StorageMeta } from './storage';

const op = 'chr_0025_ardelia';

describe('storage box items', () => {
  it('keys sort by when they were made, like picture keys', () => {
    const a = itemKey(op, 1_793_000_000_000, 0.123);
    const b = itemKey(op, 1_793_000_500_000, 0.5);
    expect(a.startsWith(`art:${op}:`)).toBe(true);
    expect(keyTime(a)).toBe(1_793_000_000_000);
    expect(keyTime('art:chr_0025_ardelia:mvrhdrri5q80')).toBe(parseInt('mvrhdrri', 36));
    expect(newestFirst([{ key: a }, { key: b }]).map((x) => x.key)).toEqual([b, a]);
  });

  it('creates, edits and deletes a note, keeping its line breaks', () => {
    const key = itemKey(op, 1, 0.1);
    let s: StorageMeta = {};
    s = { ...s, ...savedItem(s, key, { kind: 'note', text: 'Line one\nLine <two> & three\n\n' }) };
    expect(itemsOf(s, op)).toEqual([{ key, item: { kind: 'note', text: 'Line one\nLine <two> & three' } }]);
    s = { ...s, ...savedItem(s, key, { kind: 'note', text: 'Edited' }) };
    expect(s.storeItems?.[key]).toEqual({ kind: 'note', text: 'Edited' });
    s = { ...s, ...removedItem(s, key) };
    expect(itemsOf(s, op)).toEqual([]);
  });

  it('a link keeps an optional title; blank items are not kept', () => {
    const key = itemKey(op, 2, 0.2);
    expect(savedItem({}, key, { kind: 'link', url: ' https://example.com/a ', title: '  ' }).storeItems?.[key]).toEqual({ kind: 'link', url: 'https://example.com/a' });
    expect(savedItem({}, key, { kind: 'link', url: 'https://example.com/a', title: 'Guide' }).storeItems?.[key]).toEqual({ kind: 'link', url: 'https://example.com/a', title: 'Guide' });
    const s: StorageMeta = { storeItems: { [key]: { kind: 'note', text: 'x' } } };
    expect(savedItem(s, key, { kind: 'note', text: '   ' }).storeItems).toEqual({});
  });

  it('a file keeps its name and size; deleting it drops them', () => {
    const key = itemKey(op, 4, 0.4);
    const s = { ...savedItem({}, key, { kind: 'file', name: 'Rotation notes.pdf', size: 52_000 }) };
    expect(itemsOf(s, op)).toEqual([{ key, item: { kind: 'file', name: 'Rotation notes.pdf', size: 52_000 } }]);
    expect(removedItem(s, key).storeItems).toEqual({});
  });

  it("only lists the operator's own items", () => {
    const s: StorageMeta = { storeItems: { [itemKey(op, 3, 0.3)]: { kind: 'note', text: 'a' }, [itemKey('chr_0005_chen', 3, 0.3)]: { kind: 'note', text: 'b' } } };
    expect(itemsOf(s, op).map((x) => x.item)).toEqual([{ kind: 'note', text: 'a' }]);
  });

  it('old saves: links kept as artLinks become link items with the same keys; pictures are untouched', () => {
    const link = 'art:chr_0025_ardelia:mvrhdrri5q80';
    const pic = 'art:chr_0025_ardelia:mvrhgug0vl83';
    const old = { theme: 'dark', artLinks: [link], artSources: { [link]: 'https://x.com/u/status/5', [pic]: 'https://x.com/u/status/6' }, artPlaces: { [pic]: ['banner'] } };
    const now = withStorageItems(old);
    expect(now).toEqual({ theme: 'dark', storeItems: { [link]: { kind: 'link', url: 'https://x.com/u/status/5' } }, artSources: { [pic]: 'https://x.com/u/status/6' }, artPlaces: { [pic]: ['banner'] } });
    const clean = { storeItems: {} };
    expect(withStorageItems(clean)).toBe(clean);
  });

  it('round-trips a note and a link through sync (settings file to another device and back)', () => {
    const note = itemKey(op, 10, 0.1);
    const link = itemKey(op, 11, 0.2);
    let a: StorageMeta & { theme?: string } = { theme: 'dark' };
    a = { ...a, ...savedItem(a, note, { kind: 'note', text: 'Rotation:\n  skill → ult\n日本語' }) };
    a = { ...a, ...savedItem(a, link, { kind: 'link', url: 'https://endfield.wiki.gg/', title: 'Wiki' }) };
    // Drive holds the settings as JSON; the other device merges them in as sync.ts does, then normalizes.
    const load = (mine: object, remote: object) => withStorageItems(withoutRetiredPlaces({ ...mine, ...JSON.parse(JSON.stringify(remote)) }));
    let b = load({ theme: 'light' }, a);
    expect(itemsOf(b, op)).toEqual(itemsOf(a, op));
    // An edit and a delete on that device come back the same way.
    b = { ...b, ...savedItem(b, note, { kind: 'note', text: 'Changed' }) };
    b = { ...b, ...removedItem(b, link) };
    a = load(a, b);
    expect(itemsOf(a, op)).toEqual([{ key: note, item: { kind: 'note', text: 'Changed' } }]);
  });
});
