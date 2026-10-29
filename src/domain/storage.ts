/**
 * The operator page's storage box (ui/pages/art.ts storageBox): what the
 * player keeps for each operator. Files are kept as uploaded (IndexedDB, one
 * Drive file each, art.ts); their names, and notes and links, are small, so
 * they live in settings (`storeItems`), which sync and go in backups.
 *
 * Every item's key is `art:<operator id>:<time><random>` (base-36 time, as
 * store.ts saveArt makes them), so items of any kind sort by when they were
 * added. More kinds fit in as more `StoredItem` variants.
 */

/** A note, a link, or a file's name and size (the file itself is in IndexedDB under the same key). */
export type StoredItem = { kind: 'note'; text: string } | { kind: 'link'; url: string; title?: string } | { kind: 'file'; name: string; size?: number };

export interface StorageMeta {
  storeItems?: Record<string, StoredItem>;
  /** Links kept before the storage box: keys, their links in `artSources` (moved into `storeItems` on load). */
  artLinks?: string[];
  artSources?: Record<string, string>;
}

/** A new item key for an operator, sortable by time like picture keys. */
export const itemKey = (opId: string, now = Date.now(), random = Math.random()): string =>
  `art:${opId}:${now.toString(36)}${random.toString(36).slice(2, 6).padEnd(4, '0')}`;

/** When an item was added, from its key (0 if the key isn't one of ours). */
export function keyTime(key: string): number {
  const id = key.slice(key.lastIndexOf(':') + 1);
  const t = parseInt(id.slice(0, -4), 36);
  return Number.isFinite(t) ? t : 0;
}

/** An operator's notes and links, each with its key. */
export function itemsOf(s: StorageMeta, opId: string): { key: string; item: StoredItem }[] {
  return Object.entries(s.storeItems ?? {})
    .filter(([key]) => key.startsWith(`art:${opId}:`))
    .map(([key, item]) => ({ key, item }));
}

/** Newest first. */
export const newestFirst = <T extends { key: string }>(list: T[]): T[] => [...list].sort((a, b) => keyTime(b.key) - keyTime(a.key));

/** The settings change that saves an item (new or edited). Blank notes and links without an address aren't kept. */
export function savedItem(s: StorageMeta, key: string, item: StoredItem): StorageMeta {
  const clean: StoredItem | null =
    item.kind === 'file'
      ? item
      : item.kind === 'note'
      ? item.text.trim()
        ? { kind: 'note', text: item.text.replace(/\s+$/, '') }
        : null
      : item.url.trim()
        ? { kind: 'link', url: item.url.trim(), ...(item.title?.trim() ? { title: item.title.trim() } : {}) }
        : null;
  if (!clean) return removedItem(s, key);
  return { storeItems: { ...s.storeItems, [key]: clean } };
}

/** The settings change that deletes an item. */
export function removedItem(s: StorageMeta, key: string): StorageMeta {
  const { [key]: _gone, ...storeItems } = s.storeItems ?? {};
  return { storeItems };
}

/**
 * Settings with links kept the old way (`artLinks` + `artSources`) as link
 * items, same keys. Returns `s` itself when there's nothing to move, so old
 * saves and synced settings load unchanged otherwise.
 */
export function withStorageItems<T extends StorageMeta>(s: T): T {
  if (!s.artLinks?.length) return s;
  const storeItems = { ...s.storeItems };
  const artSources = { ...s.artSources };
  for (const key of s.artLinks) {
    const url = artSources[key];
    if (url && !storeItems[key]) storeItems[key] = { kind: 'link', url };
    delete artSources[key];
  }
  const { artLinks: _old, ...rest } = s;
  return { ...rest, storeItems, artSources } as T;
}
