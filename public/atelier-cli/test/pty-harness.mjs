// Drive `atelier` in a pseudo-terminal and read the screen like a person would: node-pty (ConPTY on Windows, so no
// window opens) feeds a headless xterm.js, whose buffer is the screen. Also renders that screen to SVG.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const require = createRequire(import.meta.url);
const pty = require('node-pty');
const {Terminal} = require('@xterm/headless');

export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'atelier.mjs');

export class Screen {
  constructor({cols = 120, rows = 34, args = [], env = {}, cwd = process.cwd()} = {}) {
    this.term = new Terminal({cols, rows, allowProposedApi: true, scrollback: 0});
    this.output = '';
    this.proc = pty.spawn(process.execPath, [BIN, ...args], {
      name: 'xterm-256color', cols, rows, cwd,
      env: {...process.env, COLORTERM: 'truecolor', ...env},
      useConpty: true,
    });
    this.exited = new Promise(resolve => this.proc.onExit(e => resolve(e.exitCode)));
    this.proc.onData(data => { this.output += data; this.term.write(data); });
  }

  /** The visible screen as plain text lines. */
  text() {
    const buffer = this.term.buffer.active, lines = [];
    for (let y = 0; y < this.term.rows; y++) lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '');
    return lines;
  }

  has(needle) { return this.text().join('\n').includes(needle); }

  async waitFor(predicate, {timeoutMs = 60000, label = 'condition'} = {}) {
    const test = typeof predicate === 'string' ? () => this.has(predicate) : predicate instanceof RegExp ? () => predicate.test(this.text().join('\n')) : predicate;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 150));
      await new Promise(r => this.term.write('', r));
      if (test()) return true;
    }
    throw Error(`Timed out waiting for ${label}. Screen:\n${this.text().join('\n')}`);
  }

  async settle(ms = 400) { await new Promise(r => setTimeout(r, ms)); await new Promise(r => this.term.write('', r)); }

  type(text) { this.proc.write(text); }
  key(name) {
    const keys = {enter: '\r', esc: '\x1b', tab: '\t', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', pgup: '\x1b[5~', pgdn: '\x1b[6~', backspace: '\x7f',
      'ctrl+c': '\x03', 'ctrl+n': '\x0e', 'ctrl+t': '\x14', 'ctrl+r': '\x12', 'ctrl+b': '\x02', 'ctrl+u': '\x15'};
    this.proc.write(keys[name] ?? name);
  }

  resize(cols, rows) { this.proc.resize(cols, rows); this.term.resize(cols, rows); }

  kill() { try { this.proc.kill(); } catch { /* gone */ } }
}

// ------------------------------------------------------------------ SVG rendering of the xterm buffer
const XTERM_16 = ['#1e2023', '#c9665a', '#8fa876', '#d9a55b', '#7d93a8', '#a7809a', '#7fa6a0', '#d6cfc4',
  '#51483f', '#d9776b', '#a3bb8a', '#e6b872', '#95aac0', '#bd97b0', '#97bdb7', '#ece6da'];
function palette256(i) {
  if (i < 16) return XTERM_16[i];
  if (i < 232) { const n = i - 16, v = [0, 95, 135, 175, 215, 255]; return `rgb(${v[Math.floor(n / 36)]},${v[Math.floor(n / 6) % 6]},${v[n % 6]})`; }
  const g = 8 + (i - 232) * 10; return `rgb(${g},${g},${g})`;
}
const rgb = n => `#${n.toString(16).padStart(6, '0')}`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {Terminal} term
 * @param {{title?: string, bg?: string, fg?: string}} options
 */
export function screenToSvg(term, {title = 'Atelier', bg = '#1E2023', fg = '#ECE6DA'} = {}) {
  const cw = 8.6, lh = 18, pad = 14, top = 30;
  const width = Math.ceil(term.cols * cw + pad * 2), height = Math.ceil(term.rows * lh + pad + top);
  const buffer = term.buffer.active, cell = buffer.getNullCell();
  const rects = [], texts = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    if (!line) continue;
    let run = null;
    const flush = () => {
      if (!run) return;
      const x = pad + run.x * cw, yy = top + y * lh;
      if (run.bg) rects.push(`<rect x="${x.toFixed(1)}" y="${yy}" width="${(run.w * cw).toFixed(1)}" height="${lh}" fill="${run.bg}"/>`);
      if (run.text.trim()) {
        const style = `${run.bold ? ' font-weight="700"' : ''}${run.italic ? ' font-style="italic"' : ''}${run.underline ? ' text-decoration="underline"' : ''}${run.dim ? ' opacity="0.6"' : ''}`;
        texts.push(`<text x="${x.toFixed(1)}" y="${yy + 13}" fill="${run.fg}"${style} textLength="${(run.w * cw).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(run.text)}</text>`);
      }
      run = null;
    };
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell);
      const w = cell.getWidth();
      if (w === 0) continue;
      let f = cell.isFgRGB() ? rgb(cell.getFgColor()) : cell.isFgPalette() ? palette256(cell.getFgColor()) : fg;
      let b = cell.isBgRGB() ? rgb(cell.getBgColor()) : cell.isBgPalette() ? palette256(cell.getBgColor()) : null;
      if (cell.isInverse()) { const t = f; f = b ?? bg; b = t; }
      const key = `${f}|${b}|${cell.isBold()}|${cell.isItalic()}|${cell.isDim()}|${cell.isUnderline()}`;
      const ch = cell.getChars() || ' ';
      if (run && run.key === key) { run.text += ch; run.w += w; }
      else { flush(); run = {key, x, w, text: ch, fg: f, bg: b, bold: cell.isBold(), italic: cell.isItalic(), dim: cell.isDim(), underline: cell.isUnderline()}; }
    }
    flush();
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="8" fill="${bg}"/>
<rect width="100%" height="24" rx="8" fill="#16181A"/><rect y="16" width="100%" height="8" fill="#16181A"/>
<circle cx="16" cy="12" r="5" fill="#51483F"/><circle cx="32" cy="12" r="5" fill="#51483F"/><circle cx="48" cy="12" r="5" fill="#51483F"/>
<text x="${width / 2}" y="16" fill="#9A9088" font-family="Segoe UI, DejaVu Sans, sans-serif" font-size="12" text-anchor="middle">${esc(title)}</text>
<g font-family="Cascadia Mono, Consolas, DejaVu Sans Mono, monospace" font-size="14" xml:space="preserve">
${rects.join('\n')}
${texts.join('\n')}
</g>
</svg>
`;
}
