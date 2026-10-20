/**
 * Behind Home: a looping, muted clip from the game, one of ef-assets' defaults
 * at random, picked once per visit (backgrounds/index.json, made with its
 * scripts/background-clip.py). Settings → Backgrounds Still, reduced motion,
 * phones and Save-Data get the clip's first frame instead, so the video itself
 * is never downloaded there.
 */
import { EF_ASSETS_CDN } from '../domain/banners';
import { state } from '../state';

interface BackgroundIndex {
  clips: Record<string, { name: string }>;
  /** Clips for particular operators (not shown anywhere for now). */
  operators: Record<string, string>;
  default: string[];
}

/** jsDelivr: it sends video files with their own type, which <video> needs. In dev, `localStorage['ijl.backgrounds']` can point elsewhere. */
const BASE = (import.meta.env.DEV && localStorage.getItem('ijl.backgrounds')) || `${EF_ASSETS_CDN}/backgrounds`;

let index: BackgroundIndex | null = null;
let loading = false;
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
  fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<BackgroundIndex>) : null))
    .then((data) => {
      index = data ?? { clips: {}, operators: {}, default: [] };
      syncVideoBackground();
    })
    .catch(() => {
      index = { clips: {}, operators: {}, default: [] };
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
      for (const [ext, type] of [['webm', 'video/webm; codecs="vp9"'], ['mp4', 'video/mp4']]) {
        const source = document.createElement('source');
        source.src = `${BASE}/${clip}.${ext}`;
        source.type = type;
        video.append(source);
      }
      video.preload = 'auto';
    } else {
      // Only the first frame: the poster, shown once it loads.
      video.preload = 'none';
      const poster = new Image();
      poster.onload = () => video?.classList.add('shown');
      poster.src = video.poster;
    }
    video.load();
  } else if (video.readyState >= 2 || !play) video.classList.add('shown');
  if (play && !document.hidden) void video.play().catch(() => {});
}

/** After each page draw (app.ts): the clip when the page shown is Home, else none. */
export function syncVideoBackground(): void {
  if (!document.querySelector('.bg-source')) return hide();
  if (!index) {
    load();
    return hide();
  }
  const clip = index.default[Math.floor(pick * index.default.length)];
  if (!clip || !index.clips[clip]) return hide();
  show(clip);
}

document.addEventListener('visibilitychange', () => {
  if (!video) return;
  if (document.hidden) video.pause();
  else if (video.classList.contains('shown') && playing()) void video.play().catch(() => {});
});
