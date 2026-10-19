import { describe, expect, it } from 'vitest';
import snapshot from '../data/wiki-share.snapshot.json';
import { itemShortLinks, nameSlug, operatorShortLinks, RESERVED_PATHS, shortLinkOf } from './wiki';
import {
  DISCORD_CHARS,
  EMBED_BYTES,
  PREVIEW_BYTES,
  TITLE_BYTES,
  clip,
  embedBytes,
  embedTag,
  escapeHtml,
  operatorDiscord,
  operatorEmbed,
  operatorPreview,
  previewTags,
  utf8Bytes,
  weaponDiscord,
  weaponEmbed,
  weaponPreview,
  wikiText,
  type ShareOperator,
  type ShareWeapon,
} from './share';

const operators = snapshot.operators as unknown as Record<string, ShareOperator>;
const weapons = snapshot.weapons as unknown as Record<string, ShareWeapon>;

describe('link previews', () => {
  it("fit every operator and weapon in Discord's limits", () => {
    for (const [id, o] of Object.entries(operators)) {
      const p = operatorPreview(id, o);
      expect(utf8Bytes(p.title)).toBeLessThanOrEqual(TITLE_BYTES);
      expect(utf8Bytes(p.description)).toBeLessThanOrEqual(PREVIEW_BYTES);
      expect(p.description.split('\n').length).toBeLessThanOrEqual(20);
    }
    for (const [id, w] of Object.entries(weapons)) {
      const p = weaponPreview(id, w);
      expect(utf8Bytes(p.title)).toBeLessThanOrEqual(TITLE_BYTES);
      expect(utf8Bytes(p.description)).toBeLessThanOrEqual(PREVIEW_BYTES);
    }
  });

  it('names each skill once, and uses the portrait ef-assets has', () => {
    const arcane = operatorPreview('chr_0032_lizhiyan', operators.chr_0032_lizhiyan);
    expect(arcane.description.match(/Jadecrushing Grid/g)).toHaveLength(1);
    const typhoeus = operatorPreview('chr_0034_typhoeus', operators.chr_0034_typhoea);
    expect(typhoeus.url).toBe('https://itjustlogs.dev/operators/info/chr_0034_typhoeus');
    expect(typhoeus.image).toMatch(/chr_0034_typhoea\.webp$/);
  });

  it('fills weapon values as rank ranges and drops footnotes', () => {
    const text = 'Gains ATK ⟦num|+{0}%⟧ for 10s. ⟦muted|Effects of the same name cannot stack.⟧';
    expect(wikiText(text, [[12, 14.4, 33.6]], false)).toBe('Gains ATK +12–33.6% for 10s.');
    expect(wikiText(text, [[5, 5]], true)).toBe('Gains ATK +5% for 10s. *Effects of the same name cannot stack.*');
  });

  it('escapes tag values', () => {
    const tags = previewTags({ title: 'A "B" <c>', description: 'x & y\nz', image: '', url: 'https://itjustlogs.dev/', color: '#fff', siteName: 'S' });
    expect(tags).toContain('content="A &#34;B&#34; &#60;c&#62;"');
    expect(tags).toContain('content="x &#38; y&#10;z"');
    expect(tags).not.toContain('og:image');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('clips by bytes at a word boundary', () => {
    const s = 'Basic Attack · Flaming Cinders · Battle Skill · Smouldering Fire';
    const c = clip(s, 40, utf8Bytes);
    expect(utf8Bytes(c)).toBeLessThanOrEqual(40);
    expect(c.endsWith('…')).toBe(true);
  });
});

describe('Copy to Discord', () => {
  it('keeps every skill under the message limit', () => {
    const long = '**SKILL:** ' + 'Deals ⟦heat|Heat DMG⟧ to enemies in a wide area. '.repeat(40);
    const o: ShareOperator = { ...operators.chr_0016_laevat, skills: operators.chr_0016_laevat.skills.map((s) => ({ ...s, description: long })) };
    const text = operatorDiscord('chr_0016_laevat', o);
    expect(text.length).toBeLessThanOrEqual(DISCORD_CHARS);
    for (const s of o.skills) expect(text).toContain(s.name);
    expect(text).toContain('<https://itjustlogs.dev/operators/info/chr_0016_laevat>');
  });

  it('lists weapon skills with their ranges', () => {
    const text = weaponDiscord('wpn_claym_0009', weapons.wpn_claym_0009);
    expect(text).toContain('**Quencher** · 4★ Great Sword');
    expect(text).toContain('Max HP +6–46.8%');
    expect(text.length).toBeLessThanOrEqual(DISCORD_CHARS);
  });
});

type Node = { type: number; components?: Node[]; accessory?: Node; [key: string]: unknown };
const walk = (n: Node): Node[] => [n, ...(n.components ?? []).flatMap(walk), ...(n.accessory ? walk(n.accessory) : [])];

describe('component embeds', () => {
  const all = [
    ...Object.entries(operators).map(([id, o]) => operatorEmbed(o, operatorPreview(id, o))),
    ...Object.entries(weapons).map(([id, w]) => weaponEmbed(w, weaponPreview(id, w))),
  ];

  it("follow Discord's rules for every operator and weapon", () => {
    for (const e of all) {
      expect(embedBytes(e)).toBeLessThanOrEqual(EMBED_BYTES);
      const root = e.component as Node;
      expect(Object.keys(e)).toEqual(['component']);
      expect(root.type).toBe(17);
      const nodes = walk(root);
      expect(nodes.length).toBeLessThanOrEqual(40);
      expect(nodes.filter((n) => n.type === 17)).toHaveLength(1);
      for (const b of nodes.filter((n) => n.type === 2)) {
        expect(b.style).toBe(5);
        expect(Object.keys(b).every((k) => ['id', 'type', 'url', 'style', 'label', 'emoji', 'disabled'].includes(k))).toBe(true);
      }
    }
  });

  it('keep whole skill descriptions when they fit, and the portrait beside the name', () => {
    const o = operators.chr_0016_laevat;
    const e = operatorEmbed(o, operatorPreview('chr_0016_laevat', o));
    const text = walk(e.component as Node).map((n) => n.content ?? '').join('\n');
    expect(text).toContain('does not shorten the duration of the ultimate, Twilight.');
    // Basic attacks are named only; their text is the same on every operator.
    expect(text).toContain('**Basic Attack · Flaming Cinders**');
    expect(text).not.toContain('DIVE ATTACK');
    expect(operatorDiscord('chr_0016_laevat', o)).not.toContain('DIVE ATTACK');
    // "SKILL DESCRIPTION:" goes; "COMBO TRIGGER:" says when the skill fires, so it stays.
    expect(text).not.toContain('SKILL DESCRIPTION');
    expect(text).toContain('**COMBO TRIGGER:** When an enemy suffers Combustion or Corrosion.');
    expect(text).toContain('**Ultimate · Twilight**\nLaevatain summons her Sviga Lævi');
    const head = (e.component as Node).components![0];
    expect(head.type).toBe(9);
    expect((head.accessory as Node).type).toBe(11);
  });

  it('drop the thumbnail when there is no image, and never end the script element early', () => {
    const o = { ...operators.chr_0016_laevat, name: '</script><b>' };
    const e = operatorEmbed(o, { ...operatorPreview('chr_0016_laevat', o), image: '' });
    expect((e.component as Node).components![0].type).toBe(10);
    const tag = embedTag(e);
    expect(tag.split('</script>')).toHaveLength(2);
    expect(tag).toContain(`${String.fromCharCode(92)}u003c/script>`);
  });
});

describe('operator short links', () => {
  const links = operatorShortLinks(snapshot.operators as Record<string, { name: string }>);

  it('turns names into links', () => {
    expect(nameSlug('Si')).toBe('si');
    expect(nameSlug('Zhuang Fangyi')).toBe('zhuang-fangyi');
    expect(nameSlug('Chen Qianyu')).toBe('chen-qianyu');
    expect(links.get('si')).toBe('chr_0036_jsspsi');
    expect(links.get('zhuang-fangyi')).toBe('chr_0030_zhuangfy');
  });

  it('splits the two Endministrators, the plain link opening the female', () => {
    expect(links.get('endministrator')).toBe('chr_0003_endminf');
    expect(links.get('endministrator-female')).toBe('chr_0003_endminf');
    expect(links.get('endministrator-male')).toBe('chr_0002_endminm');
    expect(shortLinkOf(links, 'chr_0002_endminm')).toBe('endministrator-male');
  });

  it('never takes a page path, and gives every other operator one', () => {
    for (const slug of links.keys()) expect(RESERVED_PATHS.has(slug)).toBe(false);
    const linked = new Set(links.values());
    expect(Object.keys(snapshot.operators).filter((id) => !linked.has(id))).toEqual([]);
  });
});

describe('weapon short links', () => {
  const links = itemShortLinks(snapshot.operators as Record<string, { name: string }>, snapshot.weapons as Record<string, { name: string }>);

  it('gives weapons their name, operators keeping theirs', () => {
    expect(links.get('jade-vessel')).toEqual({ kind: 'weap', id: 'wpn_claym_0018' });
    expect(links.get('si')).toEqual({ kind: 'char', id: 'chr_0036_jsspsi' });
    expect(shortLinkOf(links, 'wpn_claym_0018')).toBe('jade-vessel');
  });

  it('links every weapon, none on a page path', () => {
    const linked = new Set([...links.values()].map((t) => t.id));
    expect(Object.keys(snapshot.weapons).filter((id) => !linked.has(id))).toEqual([]);
    for (const slug of links.keys()) expect(RESERVED_PATHS.has(slug)).toBe(false);
  });
});
