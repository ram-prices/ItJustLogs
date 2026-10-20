import type { AvatarBox, AvatarEdit } from '../store';
import { html, render } from './html';

/**
 * Framing a new profile picture before it's saved: drag to move it, zoom with
 * the slider, the mouse wheel or a pinch, or the arrow and +/- keys. The ring
 * shows the round avatar; Save keeps that square as a 256px picture (small
 * enough for IndexedDB and Drive sync).
 *
 * `tall` (the picture rises above its circle, settings `avatarPop`): the frame
 * is 2.5 circles wide and 1.4 tall with the circle at its bottom middle, and the player
 * paints what may show outside the circle (ears, hair), or erases it again.
 * Saved with everything else see-through, so the picture shows as it is.
 *
 * The saved picture is trimmed to what shows, and `box` says how far it
 * reaches beside the circle on each side (in circle widths), so the page
 * only makes room where something pokes out. A preview shows it as the
 * header and Settings will.
 *
 * Resolves with the picture and what's needed to edit it again (the upload,
 * at most 1024px, its framing and painting); `start` reopens such an edit.
 * Null if cancelled.
 */
export async function cropAvatar(file: Blob, tall = false, start?: AvatarEdit, name = ''): Promise<{ blob: Blob; edit: AvatarEdit; box?: AvatarBox } | null> {
  const { bitmap, source } = await shrunk(start?.source ?? file);
  const W = bitmap.width;
  const H = bitmap.height;
  const OUT = 256;
  // The frame in circle widths: 2.5 wide and 1.4 tall when the picture may show beyond the circle.
  const WIDE = tall ? 2.5 : 1;
  const RATIO = tall ? 1.4 : 1;

  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <h2 class="heading-20" id="crop-title">Frame your picture</h2>
      ${tall
        ? html`<div class="toggle crop-tools" role="group" aria-label="Tool">
            <button type="button" data-tool="move" aria-pressed="true">Move</button>
            <button type="button" data-tool="paint" aria-pressed="false">Paint</button>
            <button type="button" data-tool="erase" aria-pressed="false">Erase</button>
          </div>`
        : ''}
      <div class="crop-stage${tall ? ' tall' : ''}" tabindex="0" aria-label="Picture: drag or use the arrow keys to move it, + and - to zoom">
        <canvas></canvas>
        <div class="crop-ring" aria-hidden="true"></div>
      </div>
      <label class="crop-zoom label-13 secondary">
        <span>Zoom</span>
        <input type="range" min="0.3" max="4" step="0.01" value="1" aria-label="Zoom" data-zoom />
      </label>
      ${tall
        ? html`<label class="crop-zoom label-13 secondary">
              <span>Brush</span>
              <input type="range" min="2" max="40" step="1" value="12" aria-label="Brush size" data-brush />
            </label>
            <div class="row crop-fill">
              <button type="button" class="btn tertiary sm" data-fill="above">Show all above the circle</button>
              <button type="button" class="btn tertiary sm" data-fill="none">Clear</button>
            </div>
            <p class="copy-13 secondary">Move to frame it, then paint what may show outside the circle.</p>`
        : html`<p class="copy-13 secondary">Drag to move. Scroll, pinch or use the slider to zoom.</p>`}
      <div class="crop-preview" aria-label="Preview">
        <span class="label-12 secondary">Preview</span>
        <span class="crop-preview-item"><canvas data-preview="32"></canvas><span class="label-14">${name || 'Endministrator'}</span></span>
        <span class="crop-preview-item"><canvas data-preview="56"></canvas></span>
      </div>
      <div class="dialog-actions">
        <button class="btn secondary sm" data-choice="cancel">Cancel</button>
        <button class="btn primary sm" data-choice="save">Save</button>
      </div>
    </div>`,
  );
  document.body.append(backdrop);

  const stage = backdrop.querySelector<HTMLElement>('.crop-stage')!;
  const canvas = stage.querySelector('canvas')!;
  const slider = backdrop.querySelector<HTMLInputElement>('[data-zoom]')!;
  const brush = backdrop.querySelector<HTMLInputElement>('[data-brush]');
  const S = stage.clientWidth;
  const SH = (S / WIDE) * RATIO;
  const R = S / WIDE / 2;
  /** The circle's centre on the stage: the frame's middle, or its bottom square's. */
  const MID = SH - R;
  const dpr = Math.max(1, devicePixelRatio || 1);
  canvas.width = Math.round(S * dpr);
  canvas.height = Math.round(SH * dpr);
  const ctx = canvas.getContext('2d')!;

  // What may show outside the circle, painted on the picture itself (so it
  // moves and zooms with it), at up to 1024px.
  const ms = Math.min(1, 1024 / Math.max(W, H));
  const mask = document.createElement('canvas');
  mask.width = Math.max(1, Math.round(W * ms));
  mask.height = Math.max(1, Math.round(H * ms));
  const mctx = mask.getContext('2d')!;
  /** Dims what won't show; drawn over the picture. */
  const shade = document.createElement('canvas');
  shade.width = canvas.width;
  shade.height = canvas.height;
  const sctx = shade.getContext('2d')!;

  let tool: 'move' | 'paint' | 'erase' = 'move';
  let hover: { x: number; y: number } | null = null;

  // `zoom` 1 = the picture just covers the frame (down to 0.3, smaller); `cx`, `cy` = the picture
  // pixel at the frame's centre.
  const cover = Math.max(S / W, SH / H);
  let zoom = start?.zoom ?? 1;
  let cx = start?.cx ?? W / 2;
  let cy = start?.cy ?? H / 2;
  if (tall && start?.mask) mctx.drawImage(await createImageBitmap(start.mask), 0, 0, mask.width, mask.height);
  const scale = () => cover * zoom;
  // The picture may move past the frame's edges (what it leaves empty is
  // see-through), as long as part of it stays at the frame's centre.
  const clamp = () => {
    cx = Math.min(Math.max(cx, 0), W);
    cy = Math.min(Math.max(cy, 0), H);
  };
  /** The circle's box on the stage. */
  const CIRCLE = { x0: S / 2 - R, x1: S / 2 + R, y0: MID - R };
  /** The painted mask, where the picture is, on a context `k` times the stage's size. */
  const drawMask = (c: CanvasRenderingContext2D, k: number) =>
    c.drawImage(mask, (S / 2 - cx * scale()) * k, (SH / 2 - cy * scale()) * k, W * scale() * k, H * scale() * k);
  const circle = (c: CanvasRenderingContext2D, k: number) => {
    c.beginPath();
    c.arc((S / 2) * k, MID * k, R * k, 0, Math.PI * 2);
    c.fill();
  };
  /**
   * The picture as it will show, on a context `k` times the stage's size:
   * the circle and (tall) what's painted; everything else see-through.
   */
  const composite = (o: CanvasRenderingContext2D, k: number) => {
    o.imageSmoothingQuality = 'high';
    o.drawImage(bitmap, (S / 2 - cx * scale()) * k, (SH / 2 - cy * scale()) * k, W * scale() * k, H * scale() * k);
    const keep = document.createElement('canvas');
    keep.width = o.canvas.width;
    keep.height = o.canvas.height;
    const kc = keep.getContext('2d')!;
    kc.fillStyle = '#000';
    circle(kc, k);
    if (tall) drawMask(kc, k);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(keep, 0, 0);
    o.globalCompositeOperation = 'source-over';
  };
  /** What shows, in stage units: the circle plus anything painted that the picture covers. */
  const shown = (c: HTMLCanvasElement, k: number) => {
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let x0 = CIRCLE.x0 * k;
    let x1 = CIRCLE.x1 * k;
    let y0 = CIRCLE.y0 * k;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x + 1 > x1) x1 = x + 1;
          if (y < y0) y0 = y;
        }
    return { x0: Math.floor(x0), x1: Math.ceil(x1), y0: Math.floor(y0) };
  };
  // Preview: each size's picture as the page will show it, on its gradient circle.
  const previews = [...backdrop.querySelectorAll<HTMLCanvasElement>('[data-preview]')];
  let previewQueued = false;
  const preview = () => {
    previewQueued = false;
    for (const pc of previews) {
      const k = (Number(pc.dataset.preview) / (2 * R)) * dpr;
      const layer = document.createElement('canvas');
      layer.width = Math.ceil(S * k);
      layer.height = Math.ceil(SH * k);
      composite(layer.getContext('2d')!, k);
      const b = shown(layer, k);
      pc.width = b.x1 - b.x0;
      pc.height = layer.height - b.y0;
      pc.style.width = `${pc.width / dpr}px`;
      pc.style.height = `${pc.height / dpr}px`;
      const p = pc.getContext('2d')!;
      const css = getComputedStyle(document.documentElement);
      const grad = p.createLinearGradient((CIRCLE.x0 * k) - b.x0, layer.height - 2 * R * k - b.y0, (CIRCLE.x1 * k) - b.x0, layer.height - b.y0);
      grad.addColorStop(0, css.getPropertyValue('--op').trim() || '#8e4ec6');
      grad.addColorStop(1, css.getPropertyValue('--ars').trim() || '#12a594');
      p.fillStyle = grad;
      p.beginPath();
      p.arc((S / 2) * k - b.x0, MID * k - b.y0, R * k, 0, Math.PI * 2);
      p.fill();
      p.drawImage(layer, -b.x0, -b.y0);
    }
  };
  const draw = () => {
    if (!previewQueued) {
      previewQueued = true;
      requestAnimationFrame(preview);
    }
    clamp();
    const s = scale();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, SH);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, S / 2 - cx * s, SH / 2 - cy * s, W * s, H * s);
    if (tall) {
      // Dim all but the circle and what's painted.
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, shade.width, shade.height);
      sctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      sctx.fillRect(0, 0, shade.width, shade.height);
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = '#000';
      circle(sctx, dpr);
      drawMask(sctx, dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(shade, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(S / 2, MID, R - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.stroke();
      if (hover && tool !== 'move') {
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, Number(brush!.value), 0, Math.PI * 2);
        ctx.strokeStyle = tool === 'paint' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 99, 105, 0.9)';
        ctx.stroke();
      }
    }
    slider.value = String(zoom);
  };
  /** Zoom to `next`, keeping the picture point under (px, py) on the stage where it is. */
  const zoomTo = (next: number, px = S / 2, py = SH / 2) => {
    next = Math.min(4, Math.max(0.3, next));
    const before = scale();
    const ix = cx + (px - S / 2) / before;
    const iy = cy + (py - SH / 2) / before;
    zoom = next;
    const after = scale();
    cx = ix - (px - S / 2) / after;
    cy = iy - (py - SH / 2) / after;
    draw();
  };
  /** Paints (or erases) a stroke from `a` to `b`, stage points, on the mask. */
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const toMask = (p: { x: number; y: number }) => [(cx + (p.x - S / 2) / scale()) * ms, (cy + (p.y - SH / 2) / scale()) * ms];
    const [ax, ay] = toMask(a);
    const [bx, by] = toMask(b);
    mctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    mctx.strokeStyle = '#000';
    mctx.lineCap = 'round';
    mctx.lineWidth = ((Number(brush!.value) * 2) / scale()) * ms;
    mctx.beginPath();
    mctx.moveTo(ax, ay);
    mctx.lineTo(bx, by);
    mctx.stroke();
    draw();
  };
  draw();

  // Move: one pointer drags, two pinch to zoom. Paint and Erase: one pointer paints.
  const pointers = new Map<number, { x: number; y: number }>();
  const local = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * S) / r.width, y: ((e.clientY - r.top) * SH) / r.height };
  };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    stage.classList.add('dragging');
    if (tool !== 'move' && pointers.size === 1) stroke(p, p);
  });
  stage.addEventListener('pointermove', (e) => {
    const now = local(e);
    hover = now;
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (tool !== 'move') draw();
      return;
    }
    if (pointers.size === 1) {
      pointers.set(e.pointerId, now);
      if (tool !== 'move') return stroke(prev, now);
      cx -= (now.x - prev.x) / scale();
      cy -= (now.y - prev.y) / scale();
      draw();
      return;
    }
    const [a, b] = [...pointers.entries()].map(([id, p]) => (id === e.pointerId ? now : p));
    const [pa, pb] = [...pointers.values()];
    const was = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const is = Math.hypot(a.x - b.x, a.y - b.y);
    pointers.set(e.pointerId, now);
    if (was > 0) zoomTo(zoom * (is / was), (a.x + b.x) / 2, (a.y + b.y) / 2);
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e as unknown as PointerEvent);
      zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    },
    { passive: false },
  );
  slider.addEventListener('input', () => zoomTo(Number(slider.value)));
  brush?.addEventListener('input', draw);
  backdrop.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as typeof tool;
      backdrop.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      stage.classList.toggle('painting', tool !== 'move');
      draw();
    }),
  );
  backdrop.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach((b) =>
    b.addEventListener('click', () => {
      mctx.globalCompositeOperation = 'source-over';
      mctx.clearRect(0, 0, mask.width, mask.height);
      if (b.dataset.fill === 'above') {
        // Everything above the circle's middle, where the picture is now.
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, mask.width, Math.max(0, (cy + (MID - SH / 2) / scale()) * ms));
      }
      draw();
    }),
  );
  stage.addEventListener('keydown', (e) => {
    const step = 12 / scale();
    if (e.key === 'ArrowLeft') cx -= step;
    else if (e.key === 'ArrowRight') cx += step;
    else if (e.key === 'ArrowUp') cy -= step;
    else if (e.key === 'ArrowDown') cy += step;
    else if (e.key === '+' || e.key === '=') return zoomTo(zoom * 1.1);
    else if (e.key === '-') return zoomTo(zoom / 1.1);
    else return;
    e.preventDefault();
    draw();
  });

  const edit = async (): Promise<AvatarEdit> => ({
    source,
    zoom,
    cx,
    cy,
    mask: tall ? await new Promise<Blob | undefined>((ok) => mask.toBlob((b) => ok(b ?? undefined), 'image/png')) : start?.mask,
  });
  /** The picture (circle mode: the square around the circle; tall: trimmed to what shows) and, tall, how far it reaches beside the circle. */
  const crop = async (): Promise<{ blob: Blob; box?: AvatarBox }> => {
    const f = OUT / (2 * R);
    const full = document.createElement('canvas');
    full.width = Math.round(S * f);
    full.height = Math.round(SH * f);
    composite(full.getContext('2d')!, f);
    const b = tall ? shown(full, f) : { x0: 0, x1: full.width, y0: 0 };
    const out = document.createElement('canvas');
    out.width = b.x1 - b.x0;
    out.height = full.height - b.y0;
    out.getContext('2d')!.drawImage(full, -b.x0, -b.y0);
    const blob = await new Promise<Blob>((ok, fail) => out.toBlob((x) => (x ? ok(x) : fail(new Error('Could not save the picture'))), 'image/webp', 0.9));
    if (!tall) return { blob };
    const round = (n: number) => Math.max(0, Math.round(n * 1000) / 1000);
    return { blob, box: { l: round((CIRCLE.x0 * f - b.x0) / OUT), r: round((b.x1 - CIRCLE.x1 * f) / OUT) } };
  };

  return new Promise((resolve, reject) => {
    const close = () => {
      backdrop.remove();
      bitmap.close();
    };
    backdrop.addEventListener('click', (e) => {
      const choice = (e.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
      if (e.target === backdrop || choice === 'cancel') {
        close();
        resolve(null);
      } else if (choice === 'save') {
        Promise.all([crop(), edit()]).then(
          ([c, e]) => {
            close();
            resolve({ ...c, edit: e });
          },
          (err) => {
            close();
            reject(err);
          },
        );
      }
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      close();
      resolve(null);
    });
    stage.focus();
  });
}

/** The upload, shrunk to at most 1024px (kept for editing later), and its bitmap. */
async function shrunk(blob: Blob): Promise<{ bitmap: ImageBitmap; source: Blob }> {
  const MAX = 1024;
  const full = await createImageBitmap(blob);
  const k = Math.min(1, MAX / Math.max(full.width, full.height));
  if (k === 1) return { bitmap: full, source: blob };
  const c = document.createElement('canvas');
  c.width = Math.round(full.width * k);
  c.height = Math.round(full.height * k);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, c.width, c.height);
  full.close();
  const source = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Could not read the picture'))), 'image/webp', 0.92));
  return { bitmap: await createImageBitmap(source), source };
}
