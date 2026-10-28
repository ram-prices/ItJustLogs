/**
 * X (Twitter) posts pasted as operator art: which links are posts, and the
 * media a post holds, read from the public embed services api.fxtwitter.com
 * (first) and api.vxtwitter.com (if that fails). Both allow cross-site
 * requests, and so do X's own media hosts (pbs.twimg.com, video.twimg.com),
 * so the browser downloads the files itself. No DOM here.
 */

/** Hosts that serve X posts: X itself and the embed-fixing mirrors people share. */
const X_HOSTS = /^(?:www\.|mobile\.|m\.|d\.|g\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx|twittpr|fxbsky)\.com$/i;

export interface XPost {
  id: string;
  /** The poster's handle, when the link has it (i/status links don't). */
  user?: string;
}

/** The post a link points to, or null if it isn't an X post link. */
export function parseXPost(text: string): XPost | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !X_HOSTS.test(u.hostname)) return null;
  const m = /^\/(?:i\/web|i|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  return m[1] ? { id: m[2], user: m[1] } : { id: m[2] };
}

/** The post's own address on x.com, kept as the source of what's saved from it. */
export const xPostUrl = (p: XPost): string => `https://x.com/${p.user ?? 'i'}/status/${p.id}`;

export interface XVariant {
  url: string;
  /** Bits per second; 0 when unknown. */
  bitrate: number;
  /** Its height in pixels, when its address says (…/1280x720/…). */
  height?: number;
}

export interface XMedia {
  /** GIFs on X are silent looping MP4s. */
  type: 'photo' | 'video' | 'gif';
  /** The file: the picture at full size, or the best MP4. */
  url: string;
  /** A still to show while picking. */
  thumb: string;
  width?: number;
  height?: number;
  /** Seconds (videos and GIFs). */
  duration?: number;
  /** Every MP4 X has of it (videos and GIFs). */
  variants: XVariant[];
}

const heightOf = (url: string): number | undefined => {
  const m = /\/(\d{2,5})x(\d{2,5})\//.exec(url);
  return m ? Number(m[2]) : undefined;
};

const mp4s = (list: { url?: string; bitrate?: number; content_type?: string; container?: string }[] | undefined): XVariant[] =>
  (list ?? [])
    .filter((v) => v.url && (v.content_type === 'video/mp4' || v.container === 'mp4' || /\.mp4(\?|$)/.test(v.url)))
    .map((v) => ({ url: v.url!, bitrate: v.bitrate ?? 0, height: heightOf(v.url!) }));

/** Why a post couldn't be read: gone or private (the services said so), or the services didn't answer. */
export class XPostError extends Error {
  readonly gone: boolean;
  constructor(message: string, gone: boolean) {
    super(message);
    this.gone = gone;
  }
}

interface FxMedia {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  variants?: { url?: string; bitrate?: number; content_type?: string }[];
  formats?: { url?: string; bitrate?: number; container?: string }[];
}

/** The media in an api.fxtwitter.com/status/<id> answer. Throws XPostError when the post is gone or private. */
export function fromFxTwitter(json: unknown): XMedia[] {
  const j = json as { code?: number; tweet?: { media?: { all?: FxMedia[] } } };
  if (!j || typeof j !== 'object') throw new XPostError('Unexpected answer.', false);
  if (j.code === 404 || j.code === 401 || j.code === 403) throw new XPostError('That post is deleted or private.', true);
  if (j.code !== 200 || !j.tweet) throw new XPostError('Unexpected answer.', false);
  return (j.tweet.media?.all ?? []).flatMap((m): XMedia[] => {
    if (!m.url) return [];
    if (m.type === 'photo') return [{ type: 'photo', url: m.url, thumb: m.url, width: m.width, height: m.height, variants: [] }];
    if (m.type !== 'video' && m.type !== 'gif') return [];
    const variants = mp4s(m.variants?.length ? m.variants : m.formats);
    return [{ type: m.type, url: m.url, thumb: m.thumbnail_url ?? '', width: m.width, height: m.height, duration: m.duration, variants }];
  });
}

interface VxMedia {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  size?: { width?: number; height?: number };
  duration_millis?: number;
}

/** The media in an api.vxtwitter.com/Twitter/status/<id> answer (it lists one MP4 per video). */
export function fromVxTwitter(json: unknown): XMedia[] {
  const j = json as { media_extended?: VxMedia[]; error?: string; tweetID?: string };
  if (!j || typeof j !== 'object') throw new XPostError('Unexpected answer.', false);
  if (j.error || !('media_extended' in j)) throw new XPostError('That post is deleted or private.', true);
  return (j.media_extended ?? []).flatMap((m): XMedia[] => {
    if (!m.url) return [];
    const base = { width: m.size?.width, height: m.size?.height };
    if (m.type === 'image') return [{ type: 'photo', url: m.url, thumb: m.url, ...base, variants: [] }];
    if (m.type !== 'video' && m.type !== 'gif') return [];
    return [
      {
        type: m.type,
        url: m.url,
        thumb: m.thumbnail_url ?? '',
        ...base,
        duration: m.duration_millis ? m.duration_millis / 1000 : undefined,
        variants: [{ url: m.url, bitrate: 0, height: heightOf(m.url) }],
      },
    ];
  });
}

/** Videos are saved as they are (no shrinking), so above this size the player is asked first. */
export const VIDEO_WARN_BYTES = 15 * 1024 * 1024;

/** A file's rough size from its bitrate and length, or undefined if either is unknown. */
export const estimateBytes = (v: XVariant, duration?: number): number | undefined => (v.bitrate && duration ? Math.round((v.bitrate * duration) / 8) : undefined);

/**
 * Which MP4 to save: the best one under the size limit, but not below 720p
 * when a 720p (or better) one exists; then that smallest HD one, flagged big
 * when it's over the limit. Unknown sizes count as under it.
 */
export function pickVariant(m: XMedia, limit = VIDEO_WARN_BYTES): { url: string; bytes?: number; big: boolean } {
  const list = [...m.variants].sort((a, b) => b.bitrate - a.bitrate);
  if (!list.length) return { url: m.url, big: false };
  const fits = (v: XVariant) => (estimateBytes(v, m.duration) ?? 0) <= limit;
  const hd = list.filter((v) => (v.height ?? 720) >= 720);
  const pool = hd.length ? hd : list;
  const pick = pool.find(fits) ?? pool[pool.length - 1];
  const bytes = estimateBytes(pick, m.duration);
  return { url: pick.url, bytes, big: (bytes ?? 0) > limit };
}

/** The API addresses to try for a post, in order. */
export const xApiUrls = (p: XPost): { url: string; read: (json: unknown) => XMedia[] }[] => [
  { url: `https://api.fxtwitter.com/${p.user ?? 'i'}/status/${p.id}`, read: fromFxTwitter },
  { url: `https://api.vxtwitter.com/${p.user ?? 'Twitter'}/status/${p.id}`, read: fromVxTwitter },
];

/**
 * The post's media, from the first service that answers. Throws XPostError:
 * `gone` when a service says the post is deleted or private, otherwise the
 * services are down or blocked.
 */
export async function fetchXMedia(p: XPost, get: typeof fetch = fetch): Promise<XMedia[]> {
  let gone = false;
  for (const api of xApiUrls(p)) {
    try {
      const res = await get(api.url, { referrerPolicy: 'no-referrer' });
      if (res.status === 404) {
        gone = true;
        continue;
      }
      if (!res.ok) continue;
      return api.read(await res.json());
    } catch (e) {
      if (e instanceof XPostError && e.gone) gone = true;
    }
  }
  throw gone ? new XPostError('That post is deleted or private.', true) : new XPostError("Couldn't reach X's embed services. Try again later.", false);
}
