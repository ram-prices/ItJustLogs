import { describe, expect, it } from 'vitest';
import { fetchXMedia, fromFxTwitter, fromVxTwitter, parseXPost, pickVariant, VIDEO_WARN_BYTES, XPostError, xPostUrl, type XMedia } from './xpost';

describe('parseXPost', () => {
  it('reads X, Twitter and the embed mirrors', () => {
    expect(parseXPost('https://x.com/jack/status/20')).toEqual({ id: '20', user: 'jack' });
    expect(parseXPost('https://twitter.com/jack/status/20?s=20&t=abc')).toEqual({ id: '20', user: 'jack' });
    expect(parseXPost('https://mobile.twitter.com/jack/status/20/photo/1')).toEqual({ id: '20', user: 'jack' });
    expect(parseXPost('https://fxtwitter.com/a_b/status/1585341984679469056')).toEqual({ id: '1585341984679469056', user: 'a_b' });
    expect(parseXPost('https://vxtwitter.com/a/status/5')).toEqual({ id: '5', user: 'a' });
    expect(parseXPost('https://fixupx.com/a/status/5')).toEqual({ id: '5', user: 'a' });
    expect(parseXPost('  https://x.com/i/status/5  ')).toEqual({ id: '5' });
    expect(parseXPost('https://twitter.com/i/web/status/5')).toEqual({ id: '5' });
  });
  it('ignores everything else', () => {
    expect(parseXPost('https://x.com/jack')).toBeNull();
    expect(parseXPost('https://pbs.twimg.com/media/abc.jpg')).toBeNull();
    expect(parseXPost('https://notx.com/a/status/5')).toBeNull();
    expect(parseXPost('https://example.com/a/status/5')).toBeNull();
    expect(parseXPost('ftp://x.com/a/status/5')).toBeNull();
    expect(parseXPost('not a link')).toBeNull();
  });
  it('keeps the post address as the source', () => {
    expect(xPostUrl({ id: '20', user: 'jack' })).toBe('https://x.com/jack/status/20');
    expect(xPostUrl({ id: '20' })).toBe('https://x.com/i/status/20');
  });
});

const video = {
  type: 'video',
  url: 'https://video.twimg.com/v/vid/1920x1080/a.mp4',
  thumbnail_url: 'https://pbs.twimg.com/t.jpg',
  duration: 9.3,
  width: 1920,
  height: 1080,
  variants: [
    { url: 'https://video.twimg.com/v/pl/a.m3u8', bitrate: 0, content_type: 'application/x-mpegURL' },
    { url: 'https://video.twimg.com/v/vid/480x270/a.mp4', bitrate: 256000, content_type: 'video/mp4' },
    { url: 'https://video.twimg.com/v/vid/1280x720/a.mp4', bitrate: 2176000, content_type: 'video/mp4' },
    { url: 'https://video.twimg.com/v/vid/1920x1080/a.mp4', bitrate: 10368000, content_type: 'video/mp4' },
  ],
};

describe('fromFxTwitter', () => {
  it('lists photos, videos and GIFs', () => {
    const media = fromFxTwitter({
      code: 200,
      tweet: { media: { all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/p.jpg?name=orig', width: 1920, height: 1080 }, video, { type: 'gif', url: 'https://video.twimg.com/g.mp4', thumbnail_url: 't', variants: [{ url: 'https://video.twimg.com/g.mp4', bitrate: 0, content_type: 'video/mp4' }] }] } },
    });
    expect(media.map((m) => m.type)).toEqual(['photo', 'video', 'gif']);
    expect(media[0].url).toBe('https://pbs.twimg.com/media/p.jpg?name=orig');
    expect(media[1].variants.map((v) => v.height)).toEqual([270, 720, 1080]);
    expect(media[2].variants).toHaveLength(1);
  });
  it('a post without media has none', () => expect(fromFxTwitter({ code: 200, tweet: { text: 'hi' } })).toEqual([]));
  it('says when the post is gone', () => {
    expect(() => fromFxTwitter({ code: 404, message: 'NOT_FOUND', tweet: null })).toThrow(XPostError);
    try {
      fromFxTwitter({ code: 401, tweet: null });
    } catch (e) {
      expect((e as XPostError).gone).toBe(true);
    }
  });
});

describe('fromVxTwitter', () => {
  it('lists photos and videos', () => {
    const media = fromVxTwitter({
      media_extended: [
        { type: 'image', url: 'https://pbs.twimg.com/media/p.jpg', size: { width: 800, height: 600 } },
        { type: 'video', url: 'https://video.twimg.com/v/vid/1280x720/a.mp4', thumbnail_url: 't', duration_millis: 4000 },
      ],
    });
    expect(media.map((m) => [m.type, m.duration])).toEqual([
      ['photo', undefined],
      ['video', 4],
    ]);
  });
});

describe('pickVariant', () => {
  const m = fromFxTwitter({ code: 200, tweet: { media: { all: [video] } } })[0];
  it('takes the best one under the limit', () => expect(pickVariant(m)).toMatchObject({ url: 'https://video.twimg.com/v/vid/1920x1080/a.mp4', big: false }));
  it('steps down to 720p for long videos', () => expect(pickVariant({ ...m, duration: 30 }).url).toBe('https://video.twimg.com/v/vid/1280x720/a.mp4'));
  it('stays HD and flags it big rather than dropping below 720p', () => {
    const p = pickVariant({ ...m, duration: 120 });
    expect(p.url).toBe('https://video.twimg.com/v/vid/1280x720/a.mp4');
    expect(p.big).toBe(true);
    expect(p.bytes! > VIDEO_WARN_BYTES).toBe(true);
  });
  it('unknown sizes count as small', () => {
    const gif: XMedia = { type: 'gif', url: 'g.mp4', thumb: '', variants: [{ url: 'g.mp4', bitrate: 0 }] };
    expect(pickVariant(gif)).toEqual({ url: 'g.mp4', bytes: undefined, big: false });
  });
});

describe('fetchXMedia', () => {
  const answer = (status: number, body: unknown) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  it('falls back to vxtwitter when fxtwitter is down', async () => {
    const seen: string[] = [];
    const get = ((url: string) => {
      seen.push(url);
      return url.includes('fxtwitter') ? answer(503, 'down') : answer(200, { media_extended: [{ type: 'image', url: 'https://pbs.twimg.com/p.jpg' }] });
    }) as typeof fetch;
    const media = await fetchXMedia({ id: '5', user: 'a' }, get);
    expect(media).toHaveLength(1);
    expect(seen).toEqual(['https://api.fxtwitter.com/a/status/5', 'https://api.vxtwitter.com/a/status/5']);
  });
  it('a deleted post says so', async () => {
    const get = ((url: string) => (url.includes('fxtwitter') ? answer(200, { code: 404, tweet: null }) : answer(200, '<!DOCTYPE html>'))) as typeof fetch;
    await expect(fetchXMedia({ id: '5' }, get)).rejects.toMatchObject({ gone: true });
  });
  it('services down is not "deleted"', async () => {
    const get = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await expect(fetchXMedia({ id: '5' }, get)).rejects.toMatchObject({ gone: false });
  });
});
