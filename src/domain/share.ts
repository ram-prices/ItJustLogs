/**
 * Operator and weapon summaries for sharing: the link preview (Open Graph
 * tags written into a page per item at build time, see vite.config.ts) and
 * the longer "Copy to Discord" text on the info pages. No DOM, so the build
 * can use it too (imports carry .ts extensions for Vite's config loader).
 */
import { EF_ASSETS_CDN } from './banners.ts';
import { isScheduleBanner, isWeaponBanner, KIND_LABEL, SERVER_LABEL, timeOn, type ScheduleItem, type Server, type ServerTimes } from './schedule.ts';
import { fmtSkillValue, parseMarkup, splitPlaceholders, wikiId, type WikiOperator, type WikiWeapon, type WikiWeaponSkill } from './wiki.ts';

export const SITE_URL = 'https://itjustlogs.dev';

/**
 * Discord's link preview limits, in UTF-8 bytes (· is 2, ★ and – are 3);
 * longer text is trimmed. See docs.discord.com/developers/link-previews.
 */
export const PREVIEW_BYTES = 350;
export const TITLE_BYTES = 70;
/** Discord's message limit. */
export const DISCORD_CHARS = 2000;

/** The preview's side bar: operators take their element's colour (the dark theme's .wk-* colours)... */
const ELEMENT_COLOR: Record<string, string> = { Physical: '#dfbb92', Heat: '#ff853f', Cryo: '#00c0cb', Nature: '#9cd54a', Electric: '#fdc038' };
/** ...and weapons, which have none, their rarity's (the dark theme's --r6..--r3). */
const RARITY_COLOR: Record<number, string> = { 6: '#ff7a3d', 5: '#ffbb33', 4: '#a07cff', 3: '#6aa8ff' };

/** The fields the previews use, so the build's fallback snapshot can stay small. */
export type ShareOperator = Pick<WikiOperator, 'name' | 'rarity' | 'class' | 'element' | 'weapon' | 'faction' | 'tags' | 'page'> & {
  skills: { name: string; type: string; variant?: string; description?: string }[];
};
export type ShareWeapon = Pick<WikiWeapon, 'name' | 'rarity' | 'type' | 'source' | 'page'> & {
  skills: Pick<WikiWeaponSkill, 'name' | 'tag' | 'text' | 'values'>[];
  stats?: WikiWeapon['stats'];
};

export interface Preview {
  title: string;
  description: string;
  image: string;
  url: string;
  color: string;
}

export const operatorUrl = (id: string): string => `${SITE_URL}/operators/info/${encodeURIComponent(id)}`;
export const weaponUrl = (id: string): string => `${SITE_URL}/arsenal/info/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// Wiki markup → text
// ---------------------------------------------------------------------------

/** A placeholder's values over all ranks: "12–33.6", or one number if they don't change. */
function range(values: number[] | undefined): string {
  if (!values?.length) return '–';
  const lo = fmtSkillValue(values[0]);
  const hi = fmtSkillValue(values.at(-1));
  return lo === hi ? lo : `${lo}–${hi}`;
}

const fill = (text: string, values?: number[][]): string =>
  values ? splitPlaceholders(text).map((p) => (typeof p === 'number' ? range(values[p]) : p)).join('') : text;

/** Escapes Discord markdown in wiki text. */
const md = (s: string): string => s.replace(/[\\*_~|`]/g, '\\$&');

/** The wiki's highlight classes for element damage ("Heat DMG"). */
const MARK_ELEMENT: Record<string, string> = { phys: 'Physical', heat: 'Heat', cryo: 'Cryo', elec: 'Electric', nature: 'Nature' };

/** Healing. The wiki's heal class also wraps heal formulas, so only the words get it. */
const HEAL_EMOJI = '💚';

/** Physical statuses, which share Physical's emoji. */
const PHYSICAL_STATUS = /^(Lift(s|ed)?|Knock(ed)? Down|Breach(es|ed)?|Crush(es|ed)?|Vulnerability)\b/;

/** Arts: every element but Physical. */
const ARTS_EMOJI = '✨';
/** Arts terms in plain text ("gains Arts DMG"), leaving loose uses ("the Arts that") alone. */
const ARTS_TERM = /\bArts (DMG( Dealt| Taken)?|Intensity|Infliction|Reactions?|Burst|Susceptibility|Amp)\b/g;
/** Element damage in plain text, as weapon skills write it ("Heat DMG Dealt"). */
const ELEMENT_TERM = /\b(Physical|Heat|Cryo|Electric|Nature) DMG( Dealt| Taken)?\b/g;

/**
 * Invisible markers around a term that got an emoji, so wikiText can bold it
 * after escaping the text around it (or just drop them).
 */
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
const term = (emoji: string, text: string): string => `${emoji} ${OPEN}${text}${CLOSE}`;
const unmark = (s: string, bold: boolean): string => s.split(OPEN).join(bold ? '**' : '').split(CLOSE).join(bold ? '**' : '');

/** A highlighted term with its emoji in front: "🔥 Heat DMG", "❄️ Cryo Infliction", "💥 Lift", "✨ Arts Burst", "💚 HP Treatment". */
function withEmoji(cls: string, text: string): string {
  if (cls === 'heal') return /treatment/i.test(text) ? term(HEAL_EMOJI, text) : text;
  const el = MARK_ELEMENT[cls] ?? Object.keys(ELEMENT_EMOJI).find((e) => text.startsWith(`${e} `));
  if (el) return term(ELEMENT_EMOJI[el], text);
  if (cls === 'muted') return text;
  if (PHYSICAL_STATUS.test(text)) return term(ELEMENT_EMOJI.Physical, text);
  return /\bArts\b/.test(text) ? term(ARTS_EMOJI, text) : text;
}

/** Plain text gets emojis for the terms the wiki often leaves unhighlighted: healing, Arts and element damage. */
const plainEmoji = (text: string): string =>
  text
    .replace(/\bHP treatments?\b/gi, (m) => term(HEAL_EMOJI, m))
    .replace(ARTS_TERM, (m) => term(ARTS_EMOJI, m))
    .replace(ELEMENT_TERM, (m, el: string) => term(ELEMENT_EMOJI[el], m));

/**
 * Wiki markup as plain text (`discord` false: one line, no muted footnotes)
 * or Discord markdown (bold kept, footnotes in italics, line breaks kept).
 * Element, Arts, physical status and healing terms get their emoji either
 * way, and in Discord markdown the term is bolded too ("🔥 **Heat DMG**").
 */
export function wikiText(s: string, values: number[][] | undefined, discord: boolean): string {
  const out = parseMarkup(s)
    .map((seg) => {
      if (seg.kind === 'break') return discord ? '\n' : ' ';
      const filled = fill(seg.text, values);
      const text = seg.kind === 'mark' ? withEmoji(seg.cls, filled) : plainEmoji(filled);
      const muted = seg.kind === 'mark' && seg.cls === 'muted';
      if (!discord) return muted ? '' : unmark(text, false);
      // Already bold or italic: no bold inside it.
      if (seg.kind === 'bold') return `**${md(unmark(text, false))}**`;
      if (muted) return `*${md(unmark(text, false))}*`;
      return unmark(md(text), true);
    })
    .join('');
  return discord ? out.replace(/[ \t]+\n/g, '\n').trim() : out.replace(/\s+/g, ' ').trim();
}

const chars = (s: string): number => s.length;
const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;

/** Shortens to `max` (characters, or what `size` measures) at a word boundary, with an ellipsis. */
export function clip(s: string, max: number, size: (s: string) => number = chars): string {
  if (size(s) <= max) return s;
  let cut = s.slice(0, max);
  while (cut && size(`${cut}…`) > max) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  return `${(space > cut.length * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:·–-]+$/, '')}…`;
}

/** Adds lines after `head` while they fit in a preview description. */
function fitLines(head: string[], rest: string[]): string {
  const lines = [...head];
  for (const line of rest) {
    if (utf8Bytes([...lines, line].join('\n')) > PREVIEW_BYTES) break;
    lines.push(line);
  }
  return clip(lines.join('\n'), PREVIEW_BYTES, utf8Bytes);
}

/**
 * Shares `budget` (characters, or what `size` measures) between texts: short
 * ones keep everything, the rest are clipped evenly.
 */
function fitAll(texts: string[], budget: number, size: (s: string) => number = chars): string[] {
  const sizes = texts.map(size);
  const limit = new Array<number>(texts.length).fill(0);
  let left = Math.max(0, budget);
  const order = texts.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  order.forEach((i, n) => {
    limit[i] = Math.min(sizes[i], Math.floor(left / (order.length - n)));
    left -= limit[i];
  });
  return texts.map((t, i) => (limit[i] ? clip(t, limit[i], size) : ''));
}

/** Arcane lists each skill once per stance; previews name each once. */
const uniqueSkills = <T extends { name: string; type: string }>(skills: T[]): T[] =>
  skills.filter((s, i) => skills.findIndex((x) => x.name === s.name && x.type === s.type) === i);

/**
 * A skill's description for Discord, without the "SKILL DESCRIPTION:" label
 * (the skill's name is right above it). Other labels, like "COMBO TRIGGER:",
 * say something and stay.
 */
const skillText = (description: string | undefined): string =>
  description ? wikiText(description.replace(/\*\*SKILL DESCRIPTION:\*\*\s*/g, ''), undefined, true) : '';

/**
 * A skill's description in the operator summaries. Basic attacks show only
 * their name: the basic, dive and finisher text is the same on everyone.
 */
const summaryText = (s: { type: string; description?: string }): string => (s.type !== 'Basic Attack' ? skillText(s.description) : '');

const stars = (n: number): string => `${n}★`;

/** Unicode, not server emoji: a link preview has no app or server to take custom ones from. */
const ELEMENT_EMOJI: Record<string, string> = { Physical: '💥', Heat: '🔥', Cryo: '❄️', Electric: '⚡', Nature: '🌿' };
/** "🔥 Heat"; an element without an emoji stays plain text. */
const element = (e: string): string => (ELEMENT_EMOJI[e] ? `${ELEMENT_EMOJI[e]} ${e}` : e);

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export function operatorPreview(id: string, o: ShareOperator): Preview {
  const facts = [element(o.element), o.weapon, o.faction].filter(Boolean).join(' · ');
  const skills = uniqueSkills(o.skills).map((s) => `${s.type}: ${s.name}`);
  return {
    title: clip(`${o.name} · ${stars(o.rarity)} ${o.class}`, TITLE_BYTES, utf8Bytes),
    description: fitLines([facts, ...(o.tags.length ? [o.tags.join(' · ')] : [])], skills),
    image: `${EF_ASSETS_CDN}/operators/${wikiId(id)}.webp`,
    url: operatorUrl(id),
    color: ELEMENT_COLOR[o.element] ?? RARITY_COLOR[o.rarity] ?? RARITY_COLOR[6],
  };
}

const footer = (url: string): string => `-# Data from endfield.wiki.gg, CC BY-SA 4.0 · <${url}>`;

/** Every skill with its description, fitted under Discord's message limit. */
export function operatorDiscord(id: string, o: ShareOperator): string {
  const head = [
    `**${md(o.name)}** · ${stars(o.rarity)} ${md(o.class)}`,
    [md(element(o.element)), md(o.weapon), ...(o.faction ? [md(o.faction)] : [])].join(' · '),
    ...(o.tags.length ? [`-# ${o.tags.map(md).join(' · ')}`] : []),
  ].join('\n');
  const tail = footer(operatorUrl(id));
  const skills = uniqueSkills(o.skills);
  const titles = skills.map((s) => `**${md(s.type)} · ${md(s.name)}**`);
  const bodies = skills.map(summaryText);
  const fixed = [head, ...titles, tail].join('\n\n').length + titles.length * 2;
  const fitted = fitAll(bodies, DISCORD_CHARS - fixed);
  const parts = titles.map((t, i) => (fitted[i] ? `${t}\n${fitted[i]}` : t));
  return clip([head, ...parts, tail].join('\n\n'), DISCORD_CHARS);
}

/** One skill, for copying from its card. */
export function operatorSkillDiscord(id: string, o: ShareOperator, skill: ShareOperator['skills'][number]): string {
  const text = [
    `**${md(o.name)}** · ${md(skill.type)} · **${md(skill.name)}**`,
    skillText(skill.description),
    footer(operatorUrl(id)),
  ].filter(Boolean);
  return clip(text.join('\n'), DISCORD_CHARS);
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const baseAtk = (w: ShareWeapon): number | null => w.stats?.baseAtk.at(-1) ?? null;

export function weaponPreview(id: string, w: ShareWeapon): Preview {
  const atk = baseAtk(w);
  const head = `${stars(w.rarity)} ${w.type}${atk != null ? ` · Base ATK ${atk}` : ''}`;
  const skills = w.skills.map((s) => (s.text ? `${s.name}: ${wikiText(s.text, s.values, false)}` : s.name));
  // The stat skills are short; the last one, the weapon's own, is clipped to fit.
  const lines = [head, skills.slice(0, -1).join(' · '), skills.at(-1) ?? ''];
  return {
    title: clip(`${w.name} · ${stars(w.rarity)} ${w.type}`, TITLE_BYTES, utf8Bytes),
    description: clip(lines.filter(Boolean).join('\n'), PREVIEW_BYTES, utf8Bytes),
    image: `${EF_ASSETS_CDN}/arsenals/${id}.webp`,
    url: weaponUrl(id),
    color: RARITY_COLOR[w.rarity] ?? RARITY_COLOR[6],
  };
}

export function weaponDiscord(id: string, w: ShareWeapon): string {
  const atk = baseAtk(w);
  const lines = [
    `**${md(w.name)}** · ${stars(w.rarity)} ${md(w.type)}`,
    [atk != null ? `Base ATK ${atk}` : '', w.source ? md(w.source) : ''].filter(Boolean).join(' · '),
    ...w.skills.map((s) => `**${md(s.name)}**${s.text ? ` ${wikiText(s.text, s.values, true)}` : ''}`),
    `-# Skill values at ranks 1–9`,
    footer(weaponUrl(id)),
  ].filter(Boolean);
  return clip(lines.join('\n'), DISCORD_CHARS);
}

// ---------------------------------------------------------------------------
// Component embeds: Discord's custom link preview, shown instead of the Open
// Graph one (docs.discord.com/developers/link-previews/component-embeds)
// ---------------------------------------------------------------------------

/** Discord's limit for a component embed payload, in bytes as served. */
export const EMBED_BYTES = 3000;

type Component = Record<string, unknown>;
export interface ComponentEmbed {
  component: Component;
}

const textDisplay = (content: string): Component => ({ type: 10, content });
const separator: Component = { type: 14, spacing: 1 };
/**
 * The wiki credit (CC BY-SA asks for a link to the source), linked to the
 * item's wiki page. Brackets in the URL are encoded so they can't end the link.
 */
const credit = (page: string | undefined, before = ''): Component =>
  textDisplay(
    `-# ${before}Data from ${page ? `[endfield.wiki.gg](${page.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : 'endfield.wiki.gg'}, CC BY-SA 4.0`,
  );

/** The name and facts, with the portrait beside them when ef-assets has one. */
const header = (content: string, image: string): Component =>
  image ? { type: 9, components: [textDisplay(content)], accessory: { type: 11, media: { url: image } } } : textDisplay(content);

/** The payload as written into the page: `<` escaped so it can't end the script element. */
export const embedJson = (e: ComponentEmbed): string => JSON.stringify(e).replace(/</g, '\\u003c');
export const embedBytes = (e: ComponentEmbed): number => utf8Bytes(embedJson(e));
/** Bytes a string takes inside the payload (quotes, backslashes and \n are escaped). */
const jsonBytes = (s: string): number => utf8Bytes(JSON.stringify(s).replace(/</g, '\\u003c')) - 2;

const container = (p: Preview, parts: Component[]): ComponentEmbed => ({
  component: { type: 17, accent_color: parseInt(p.color.slice(1), 16), components: parts },
});

/** Builds with `bodies` clipped evenly until the payload fits Discord's limit. */
function fitEmbed(bodies: string[], build: (bodies: string[]) => ComponentEmbed): ComponentEmbed {
  let budget = EMBED_BYTES - embedBytes(build(bodies.map(() => '')));
  for (;;) {
    const e = build(fitAll(bodies, budget, jsonBytes));
    if (embedBytes(e) <= EMBED_BYTES || budget <= 0) return e;
    budget -= 32;
  }
}

/** Operator header, then each skill with as much of its description as fits. `p` is its preview (image already checked). */
export function operatorEmbed(o: ShareOperator, p: Preview): ComponentEmbed {
  const head = [
    `## ${md(o.name)}`,
    `${stars(o.rarity)} ${md(o.class)} · ${md(element(o.element))} · ${md(o.weapon)}`,
    `-# ${[o.faction, ...o.tags].filter(Boolean).map((s) => md(s!)).join(' · ')}`,
  ].join('\n');
  const skills = uniqueSkills(o.skills);
  const titles = skills.map((s) => `**${md(s.type)} · ${md(s.name)}**`);
  const bodies = skills.map(summaryText);
  return fitEmbed(bodies, (b) =>
    container(p, [
      header(head, p.image),
      separator,
      ...titles.map((t, i) => textDisplay(b[i] ? `${t}\n${b[i]}` : t)),
      credit(o.page),
    ]),
  );
}

/** Weapon header, then each skill's effect with its values over ranks 1–9. */
export function weaponEmbed(w: ShareWeapon, p: Preview): ComponentEmbed {
  const atk = baseAtk(w);
  const head = [
    `## ${md(w.name)}`,
    `${stars(w.rarity)} ${md(w.type)}${atk != null ? ` · Base ATK ${atk}` : ''}`,
    ...(w.source ? [`-# ${md(w.source)}`] : []),
  ].join('\n');
  const titles = w.skills.map((s) => `**${md(s.name)}**`);
  const bodies = w.skills.map((s) => (s.text ? wikiText(s.text, s.values, true) : ''));
  return fitEmbed(bodies, (b) =>
    container(p, [
      header(head, p.image),
      separator,
      ...titles.map((t, i) => textDisplay(b[i] ? `${t}\n${b[i]}` : t)),
      credit(w.page, 'Skill values at ranks 1–9 · '),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Banners and events (Home's schedule): /banners/<name>, /events/<name>
// ---------------------------------------------------------------------------

/** Side bar: Headhunting purple, Arsenal teal (--op, --ars), events amber (--amber). */
const scheduleColor = (i: ScheduleItem): string => (isScheduleBanner(i) ? (isWeaponBanner(i.kind) ? '#12a594' : '#8e4ec6') : '#ffb224');
const scheduleLabel = (i: ScheduleItem): string => (isScheduleBanner(i) ? KIND_LABEL[i.kind] : i.type);
const rateUpsOf = (i: ScheduleItem): string[] => (isScheduleBanner(i) ? i.rateUps : []);

/** "[Oroberyls]" in the schedule's text is an in-game name: plain text drops the brackets, Discord bolds it. */
const bracketed = (s: string, discord: boolean): string =>
  discord ? md(s).replace(/\[([^\]]+)\]/g, '**$1**') : s.replace(/\[([^\]]+)\]/g, '$1');

const SERVERS: Server[] = ['americas', 'asia'];
const UTC_LABEL: Record<Server, string> = { americas: 'UTC-5', asia: 'UTC+8' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 5, 12:00": the time as that server shows it (the ISO string's own offset). */
const serverClock = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(11, 16)}`;

/** The plain preview (Open Graph): server times written out, since it can't use Discord timestamps. */
export function schedulePreview(i: ScheduleItem, path: string): Preview {
  const rateUps = rateUpsOf(i);
  const lines = [
    ...(rateUps.length ? [`Rate-up: ${rateUps.join(', ')}`] : []),
    ...SERVERS.map((s) => `${SERVER_LABEL[s]}: ${i.start ? serverClock(i.start[s]) : 'TBA'} – ${i.end ? serverClock(i.end[s]) : 'TBA'} (${UTC_LABEL[s]})`),
    ...(!isScheduleBanner(i) && i.details ? [bracketed(i.details, false)] : []),
  ];
  return {
    title: clip(`${i.name} · ${scheduleLabel(i)}`, TITLE_BYTES, utf8Bytes),
    description: clip(lines.join('\n'), PREVIEW_BYTES, utf8Bytes),
    image: i.art ?? '',
    url: `${SITE_URL}${path}`,
    color: scheduleColor(i),
  };
}

/** Discord's timestamp markup, shown in each reader's own time zone (F: full date, R: "in 3 days"). */
const stamp = (ms: number, style: 'F' | 'R'): string => `<t:${Math.round(ms / 1000)}:${style}>`;

/** One server's opening and closing, as live Discord timestamps. */
function serverDates(t: { start: ServerTimes | null; end: ServerTimes | null }, s: Server, label = SERVER_LABEL[s]): string {
  const at = (x: ServerTimes | null) => {
    const ms = timeOn(x, s);
    return ms == null ? 'TBA' : `${stamp(ms, 'F')} (${stamp(ms, 'R')})`;
  };
  return [`**${label}**`, `Opens ${at(t.start)}`, `Ends ${at(t.end)}`].join('\n');
}

/**
 * Name, type and rate-ups, the key art, an event's details, then both
 * servers' dates (the embed is the same for every reader, so it can't pick one).
 */
export function scheduleEmbed(i: ScheduleItem, p: Preview): ComponentEmbed {
  const rateUps = rateUpsOf(i);
  const head = [
    `## ${md(i.name)}`,
    `${md(scheduleLabel(i))}${i.version ? ` · ${md(i.version)}` : ''}`,
    ...(rateUps.length ? [`Rate-up: ${rateUps.map((r) => `**${md(r)}**`).join(', ')}`] : []),
  ].join('\n');
  // An end that waits on banners not announced yet: say what it waits for.
  const note = !i.end && i.availability ? `-# ${md(bracketed(i.availability, false))}` : '';
  const details = !isScheduleBanner(i) && i.details ? bracketed(i.details, true) : '';
  // Version updates open and close at one instant everywhere: one block instead of two the same.
  const sameInstant = (['start', 'end'] as const).every((k) => timeOn(i[k], 'americas') === timeOn(i[k], 'asia'));
  const dates = sameInstant ? [serverDates(i, 'americas', 'All servers')] : SERVERS.map((s) => serverDates(i, s));
  return fitEmbed([details], ([d]) =>
    container(p, [
      textDisplay(head),
      ...(p.image ? [{ type: 12, items: [{ media: { url: p.image } }] }] : []),
      ...(d ? [textDisplay(d)] : []),
      separator,
      textDisplay([...dates, note].filter(Boolean).join('\n\n')),
      textDisplay('-# Times are shown in your time zone'),
    ]),
  );
}

/** The <head> tag carrying a component embed, or nothing if it's still too big. */
export const embedTag = (e: ComponentEmbed): string =>
  embedBytes(e) <= EMBED_BYTES ? `<script id="discord:component-embed" type="application/vnd.discord.component-embed+json">${embedJson(e)}</script>` : '';

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** Escapes text for an HTML attribute or element; line breaks survive as &#10;. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, '&#10;');

/**
 * The <head> tags for a link preview. `large` shows the image full width
 * (site art) instead of as a thumbnail (portraits); an empty `image` leaves
 * the image tags out.
 */
export function previewTags(p: Preview & { siteName: string; large?: boolean }): string {
  const meta = (attr: 'property' | 'name', key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    meta('name', 'description', p.description),
    meta('name', 'theme-color', p.color),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', p.siteName),
    meta('property', 'og:title', p.title),
    meta('property', 'og:description', p.description),
    meta('property', 'og:url', p.url),
    meta('property', 'og:image', p.image),
    meta('name', 'twitter:card', p.large ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', p.title),
    meta('name', 'twitter:description', p.description),
    meta('name', 'twitter:image', p.image),
  ];
  return tags.filter((t) => p.image || !t.includes(':image"')).join('\n    ');
}
