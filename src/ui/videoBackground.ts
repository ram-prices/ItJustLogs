/**
 * Behind Home: a looping, muted clip from the game, the one the player picked
 * in Settings (`homeClip`), else one of ef-assets' defaults at random, picked
 * once per visit (backgrounds/index.json, made with its
 * scripts/background-clip.py). Settings → Backgrounds Still, reduced motion,
 * phones and Save-Data get the clip's first frame instead, so the video itself
 * is never downloaded there.
 */
import { EF_ASSETS, mirrorUrl } from '../domain/banners';
import { state } from '../state';

interface BackgroundIndex {
  clips: Record<string, { name: string }>;
  /** Clips for particular operators (not shown anywhere for now). */
  operators: Record<string, string>;
  default: string[];
}

/** ef-assets' Pages site (it sends video files with their own type, which <video> needs). In dev, `localStorage['ijl.backgrounds']` can point elsewhere. */
const BASE = (import.meta.env.DEV && localStorage.getItem('ijl.backgrounds')) || `${EF_ASSETS}/backgrounds`;

let index: BackgroundIndex | null = null;
let loading = false;
/** Pages waiting for the clip list (Settings' picker). */
const waiting = new Set<() => void>();
let video: HTMLVideoElement | null = null;
let shown: string | null = null;
/** Which default clip this visit uses. */
const pick = Math.random();

const playing = () =>
  state.settings.motion !== false &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  matchMedia('(hover: hover)').matches &&
  !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

function load(): void {
  if (loading) return;
  loading = true;
  // The list is JSON, revalidated on every load; GitHub when the Pages site fails.
  const list = `${BASE}/index.json`;
  fetch(list)
    .then((r) => (r.ok ? r : fetch(mirrorUrl(list) ?? list)))
    .catch(() => fetch(mirrorUrl(list) ?? list))
    .then((r) => (r.ok ? (r.json() as Promise<BackgroundIndex>) : null))
    .then((data) => {
      index = data ?? { clips: {}, operators: {}, default: [] };
      syncVideoBackground();
      waiting.forEach((f) => f());
      waiting.clear();
    })
    .catch(() => {
      index = { clips: {}, operators: {}, default: [] };
      waiting.forEach((f) => f());
      waiting.clear();
    });
}

function hide(): void {
  if (!video) return;
  video.classList.remove('shown');
  video.pause();
}

function show(clip: string): void {
  if (!video) {
    video = document.createElement('video');
    video.className = 'video-bg';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('loadeddata', () => video?.classList.add('shown'));
    document.body.prepend(video);
  }
  const play = playing();
  const key = `${clip}:${play}`;
  if (shown !== key) {
    shown = key;
    video.classList.remove('shown');
    video.poster = `${BASE}/${clip}.jpg`;
    video.replaceChildren();
    video.removeAttribute('src');
    if (play) {
      // A <source> that fails moves on to the next, so GitHub's copies come last.
      const urls = [`${BASE}/${clip}.webm`, `${BASE}/${clip}.mp4`];
      for (const url of [...urls, ...urls.map(mirrorUrl)]) {
        if (!url) continue;
        const source = document.createElement('source');
        source.src = url;
        source.type = url.endsWith('.webm') ? 'video/webm; codecs="vp9"' : 'video/mp4';
        video.append(source);
      }
      video.preload = 'auto';
    } else {
      // Only the first frame: the poster, shown once it loads.
      video.preload = 'none';
      const poster = new Image();
      poster.onload = () => video?.classList.add('shown');
      poster.onerror = () => {
        poster.onerror = null;
        const other = mirrorUrl(poster.src);
        if (other && video) poster.src = video.poster = other;
      };
      poster.src = video.poster;
    }
    video.load();
  } else if (video.readyState >= 2 || !play) video.classList.add('shown');
  if (play && !document.hidden) void video.play().catch(() => {});
}

/** The clips to pick from (Settings), each with its first frame; null until the list loads (then `redraw`). */
export function clipChoices(redraw: () => void): { id: string; name: string; poster: string }[] | null {
  if (!index) {
    waiting.add(redraw);
    load();
    return null;
  }
  return Object.entries(index.clips).map(([id, c]) => ({ id, name: c.name, poster: `${BASE}/${id}.jpg` }));
}

/** After each page draw (app.ts): the clip when the page shown is Home, else none. */
export function syncVideoBackground(): void {
  if (!document.querySelector('.bg-source')) return hide();
  if (!index) {
    load();
    return hide();
  }
  const chosen = state.settings.homeClip;
  if (chosen === 'none') return hide();
  const clip = chosen && index.clips[chosen] ? chosen : index.default[Math.floor(pick * index.default.length)];
  if (!clip || !index.clips[clip]) return hide();
  show(clip);
}

document.addEventListener('visibilitychange', () => {
  if (!video) return;
  if (document.hidden) video.pause();
  else if (video.classList.contains('shown') && playing()) void video.play().catch(() => {});
});
