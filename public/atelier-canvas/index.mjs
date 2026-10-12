import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';

// The browser RPC needs the web 'connection' service; other profiles (headless, ACP, SDK) still get the canvas state.
export const inject = [];
export const name = 'atelier-canvas';
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const has = c => ['x', 'y', 'width', 'height'].every(k => c?.[k] !== undefined);
/** Plans are in metres (origin at the south-west corner, x east, y north); diagrams and moodboards in canvas pixels.
 *  Without an explicit `units`, a drawing whose placed cards all fit within 150 units is taken to be in metres. */
export function unitsOf(scene) {
  if (scene?.units === 'm' || scene?.units === 'px') return scene.units;
  const placed = (scene?.cards ?? []).filter(c => c && c.placed !== false && has(c));
  return placed.length > 0 && placed.every(c => [c.x + c.width, c.y + c.height].every(n => Number.isFinite(n) && n <= 150)) ? 'm' : 'px';
}
export function admitScene(scene) {
  if (!scene || typeof scene.title !== 'string' || scene.title.length > 160 || !Array.isArray(scene.cards) || scene.cards.length > 32) throw Error('A canvas needs a title and at most 32 cards.');
  if (scene.units !== undefined && scene.units !== 'm' && scene.units !== 'px') throw Error('Canvas units are "m" (a plan in metres) or "px".');
  const units = unitsOf(scene);
  return {title: scene.title, units, cards: scene.cards.map((c, i) => {
    if (!c || typeof c.label !== 'string' || c.label.length > 160 || (c.note !== undefined && (typeof c.note !== 'string' || c.note.length > 800))) throw Error('Canvas labels or notes exceed the limit.');
    const color = c.color ?? '#e8dfce';
    if (!/^#[a-f0-9]{6}$/i.test(color)) throw Error('Use a six-digit hexadecimal colour.');
    const number = (value, fallback, min, max) => { const n = value ?? fallback; if (!Number.isFinite(n) || n < min || n > max) throw Error('Canvas coordinates are outside the drawing.'); return n; };
    // In a plan, a card without a position (a note, a legend) is listed beside the drawing instead of being drawn.
    const placed = units === 'px' || (c.placed !== false && has(c));
    return {id: String(i), label: c.label, note: c.note ?? '', color, ...(placed ? {} : {placed: false}),
      x: number(c.x, 24 + i % 3 * 250, 0, 1600), y: number(c.y, 24 + Math.floor(i / 3) * 180, 0, 1600),
      width: number(c.width, 230, 0.05, 800), height: number(c.height, 160, 0.05, 800)};
  }), image: scene.image && typeof scene.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(scene.image) && scene.image.length <= 12 * 1024 * 1024 ? scene.image : null};
}
export function apply(ctx) {
  const root = dshHomePath('atelier-canvas');
  const file = sid => { if (!idPattern.test(sid)) throw Error('Invalid session address.'); return join(root, sid + '.json'); };
  const state = {
    async get(sid) { try { return JSON.parse(await readFile(file(sid), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async put(sid, input) {
      const scene = admitScene(input); const target = file(sid);
      await mkdir(root, {recursive: true});
      const value = {...scene, revision: randomUUID(), sessionId: sid, updatedAt: new Date().toISOString()};
      const temp = join(root, randomUUID() + '.pending');
      await writeFile(temp, JSON.stringify(value), {flag: 'wx'}); await rename(temp, target);
      return value;
    }
  };
  ctx.provide('atelierCanvas', state);
  ctx.inject(['connection'], ctx => ctx.effect(() => ctx.connection.rpc.handle('/atelier-canvas', async (endpoint, payload) => {
    try {
      const sid = payload?.sessionId;
      if (typeof sid !== 'string' || !idPattern.test(sid)) throw Error('Invalid session address.');
      if (endpoint === 'get') return {ok: true, value: await state.get(sid)};
      if (endpoint === 'save') return {ok: true, value: await state.put(sid, payload.scene)};
      throw Error('Unknown canvas operation.');
    } catch (e) { return {ok: false, error: {code: 'bad-request', message: e.message}}; }
  })));
}
