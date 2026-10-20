import { html, render } from './html';

/**
 * Framing a new profile picture before it's saved: drag to move it, zoom with
 * the slider, the mouse wheel or a pinch, or the arrow and +/- keys. The ring
 * shows the round avatar; Save keeps that square as a 256px picture (small
 * enough for IndexedDB and Drive sync). Resolves null if cancelled.
 */
export async function cropAvatar(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  const W = bitmap.width;
  const H = bitmap.height;
  const OUT = 256;

  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <h2 class="heading-20" id="crop-title">Frame your picture</h2>
      <div class="crop-stage" tabindex="0" aria-label="Picture: drag or use the arrow keys to move it, + and - to zoom">
        <canvas></canvas>
        <div class="crop-ring" aria-hidden="true"></div>
      </div>
      <label class="crop-zoom label-13 secondary">
        <span>Zoom</span>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom" />
      </label>
      <p class="copy-13 secondary">Drag to move. Scroll, pinch or use the slider to zoom.</p>
      <div class="dialog-actions">
        <button class="btn secondary sm" data-choice="cancel">Cancel</button>
        <button class="btn primary sm" data-choice="save">Save</button>
      </div>
    </div>`,
  );
  document.body.append(backdrop);

  const stage = backdrop.querySelector<HTMLElement>('.crop-stage')!;
  const canvas = stage.querySelector('canvas')!;
  const slider = backdrop.querySelector<HTMLInputElement>('input[type="range"]')!;
  const S = stage.clientWidth;
  const dpr = Math.max(1, devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(S * dpr);
  const ctx = canvas.getContext('2d')!;

  // `zoom` 1 = the picture just covers the square; `cx`, `cy` = the picture
  // pixel at the square's centre.
  const cover = S / Math.min(W, H);
  let zoom = 1;
  let cx = W / 2;
  let cy = H / 2;
  const scale = () => cover * zoom;
  const clamp = () => {
    const half = S / 2 / scale();
    cx = Math.min(Math.max(cx, half), W - half);
    cy = Math.min(Math.max(cy, half), H - half);
  };
  const draw = () => {
    clamp();
    const s = scale();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, S / 2 - cx * s, S / 2 - cy * s, W * s, H * s);
    slider.value = String(zoom);
  };
  /** Zoom to `next`, keeping the picture point under (px, py) on the stage where it is. */
  const zoomTo = (next: number, px = S / 2, py = S / 2) => {
    next = Math.min(4, Math.max(1, next));
    const before = scale();
    const ix = cx + (px - S / 2) / before;
    const iy = cy + (py - S / 2) / before;
    zoom = next;
    const after = scale();
    cx = ix - (px - S / 2) / after;
    cy = iy - (py - S / 2) / after;
    draw();
  };
  draw();

  // Dragging with one pointer moves; two pointers pinch to zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  const local = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    if (pointers.size === 1) {
      cx -= (now.x - prev.x) / scale();
      cy -= (now.y - prev.y) / scale();
      pointers.set(e.pointerId, now);
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

  const crop = (): Promise<Blob> => {
    const half = S / 2 / scale();
    const out = document.createElement('canvas');
    out.width = out.height = OUT;
    const o = out.getContext('2d')!;
    o.imageSmoothingQuality = 'high';
    o.drawImage(bitmap, cx - half, cy - half, half * 2, half * 2, 0, 0, OUT, OUT);
    return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('Could not save the picture'))), 'image/webp', 0.9));
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
        crop().then(
          (blob) => {
            close();
            resolve(blob);
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
