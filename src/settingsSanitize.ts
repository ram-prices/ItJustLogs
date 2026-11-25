import type { StoredItem } from './domain/storage';
import type { HomeWidget, Settings } from './store';

/**
 * Settings come in from outside: localStorage, a backup file, Google Drive.
 * A crafted file could put markup or a `javascript:` link where the UI
 * expects a widget size or a web address, so every way in goes through
 * `sanitizeSettings` (store.ts loadSettings, state.ts updateSettings). It
 * only drops or defaults values of the wrong shape; valid settings come out
 * unchanged. Pure, no DOM: tested in settingsSanitize.test.ts.
 */

/** Home's widget types (ui/pages/homeWidgets.ts WIDGETS is typed by this list, so they stay the same). */
const HOME_WIDGET_TYPES = ['banners', 'events', 'contracts', 'upcoming', 'timeline', 'pity', 'sixes', 'latest', 'stats', 'progress', 'character', 'note', 'spacer'] as const;
export type HomeWidgetType = (typeof HOME_WIDGET_TYPES)[number];

const SIZES = [4, 6, 8, 12] as const;
const ID = /^[\w-]+$/;
/** Operator ids and art keys (`art:<operator>:<id>`, 'full'). */
const KEY = /^[\w:.-]+$/;

/** A web address (http or https), or null if it isn't one. */
export function webUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isWeb = (v: unknown): v is string => typeof v === 'string' && webUrl(v) !== null;
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

function widget(v: unknown): HomeWidget | null {
  if (!isObj(v)) return null;
  if (typeof v.type !== 'string' || !(HOME_WIDGET_TYPES as readonly string[]).includes(v.type)) return null;
  if (typeof v.id !== 'string' || !ID.test(v.id)) return null;
  const w: HomeWidget = { id: v.id, type: v.type, size: (SIZES as readonly unknown[]).includes(v.size) ? (v.size as HomeWidget['size']) : 12 };
  for (const k of ['under', 'newRow', 'hideTitle', 'bare', 'shadow', 'hideBasic', 'reruns'] as const) if (typeof v[k] === 'boolean') w[k] = v[k] as boolean;
  if (v.align === 'left' || v.align === 'center' || v.align === 'right') w.align = v.align;
  if (isInt(v.col) && v.col >= 1 && v.col <= 12) w.col = v.col;
  if (typeof v.height === 'number' && Number.isFinite(v.height) && v.height >= 0) w.height = v.height;
  for (const k of ['char', 'weap'] as const) if (isInt(v[k]) && (v[k] as number) >= 0) w[k] = v[k] as number;
  for (const k of ['op', 'pic'] as const) if (typeof v[k] === 'string' && KEY.test(v[k] as string)) w[k] = v[k] as string;
  const facts = strings(v.facts);
  if (facts) w.facts = facts;
  if (typeof v.ambient === 'boolean' || v.ambient === 'picture' || v.ambient === 'card') w.ambient = v.ambient;
  if (v.artStyle === 'avatar' || v.artStyle === 'banner' || v.artStyle === 'background') w.artStyle = v.artStyle;
  for (const k of ['title', 'note', 'text'] as const) if (typeof v[k] === 'string') w[k] = v[k] as string;
  return w;
}

function storedItem(v: unknown): StoredItem | null {
  if (!isObj(v)) return null;
  if (v.kind === 'note') return typeof v.text === 'string' ? { kind: 'note', text: v.text } : null;
  if (v.kind === 'link') {
    if (!isWeb(v.url)) return null;
    return { kind: 'link', url: v.url, ...(typeof v.title === 'string' ? { title: v.title } : {}) };
  }
  if (v.kind === 'file') {
    if (typeof v.name !== 'string') return null;
    return { kind: 'file', name: v.name, ...(typeof v.size === 'number' && Number.isFinite(v.size) ? { size: v.size } : {}) };
  }
  return null;
}

/**
 * Settings (whole or a patch) with Home's layout, the storage box's links and
 * the picture sources checked: a widget of an unknown type or with a bad id
 * is dropped, a bad size becomes full width, wrong-shaped fields go, and a
 * link that isn't http(s) is dropped. Anything else is passed through as is.
 */
export function sanitizeSettings<T extends Partial<Settings>>(s: T): T {
  if (!isObj(s)) return {} as T;
  const out: Record<string, unknown> = { ...s };
  if ('home' in s) {
    if (Array.isArray(s.home)) out.home = s.home.map(widget).filter((w): w is HomeWidget => w !== null);
    else delete out.home;
  }
  if ('homePhone' in s) {
    const p: unknown = s.homePhone;
    const order = isObj(p) ? strings(p.order) : undefined;
    if (isObj(p) && order) {
      const hidden = strings(p.hidden);
      out.homePhone = { order, ...(hidden ? { hidden } : {}) };
    } else delete out.homePhone;
  }
  if ('artSources' in s) {
    const src: unknown = s.artSources;
    if (isObj(src)) out.artSources = Object.fromEntries(Object.entries(src).filter(([, url]) => isWeb(url)));
    else delete out.artSources;
  }
  if ('storeItems' in s) {
    const items: unknown = s.storeItems;
    if (isObj(items))
      out.storeItems = Object.fromEntries(
        Object.entries(items)
          .map(([k, v]) => [k, storedItem(v)] as const)
          .filter(([, v]) => v !== null),
      );
    else delete out.storeItems;
  }
  if ('artLinks' in s) {
    const links = strings(s.artLinks);
    if (links) out.artLinks = links;
    else delete out.artLinks;
  }
  return out as T;
}
