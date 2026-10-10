// A small Markdown renderer for the terminal: headings, paragraphs, lists, quotes, rules, fenced code and tables,
// with bold, italic, inline code, links and strikethrough. It re-renders the whole message on every streamed piece,
// so a half-written block (an open code fence, a table still growing) always draws sensibly.
import {GLYPHS, stringWidth, wrap} from './style.mjs';

/** Inline spans to styled text. */
export function inline(text, s) {
  const out = [];
  const pattern = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)|(?<![\w_])_([^_\s][^_]*?)_(?![\w])|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;
  let last = 0, m;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(s.ink(text.slice(last, m.index)));
    if (m[2] !== undefined) out.push(s.code(m[2]));
    else if (m[3] !== undefined || m[4] !== undefined) out.push(s.bold(s.ink(m[3] ?? m[4])));
    else if (m[5] !== undefined || m[6] !== undefined) out.push(s.italic(s.ink(m[5] ?? m[6])));
    else if (m[7] !== undefined) out.push(s.chalk.strikethrough(s.dim(m[7])));
    else if (m[8] !== undefined) out.push(`${s.link(m[8])}${m[9] !== m[8] ? s.dim(` (${m[9]})`) : ''}`);
    else if (m[10] !== undefined) out.push(s.link(m[10]));
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(s.ink(text.slice(last)));
  return out.join('');
}

const prefixed = (lines, first, rest) => lines.map((line, i) => (i === 0 ? first : rest) + line);

function renderTable(rows, width, s) {
  const cells = rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const cols = Math.max(...cells.map(r => r.length));
  const widths = Array.from({length: cols}, (_, i) => Math.max(3, ...cells.map(r => stringWidth(r[i] ?? ''))));
  const total = widths.reduce((a, b) => a + b, 0) + 3 * (cols - 1);
  if (total > width) {
    // Too wide for the pane: fall back to one "header: value" line per cell.
    const [head, ...body] = cells;
    return body.flatMap(row => [...row.flatMap((c, i) => wrap(`${s.dim(`${head[i] ?? ''}:`)} ${inline(c, s)}`, width)), '']);
  }
  const line = (row, header) => row.map((c, i) => {
    const pad = ' '.repeat(Math.max(0, widths[i] - stringWidth(c)));
    return (header ? s.bold(s.ink(c)) : inline(c, s)) + pad;
  }).join(s.line(` ${GLYPHS.bar} `));
  const [head, ...body] = cells;
  return [line(head, true), s.line(widths.map(w => GLYPHS.rule.repeat(w)).join(`${GLYPHS.rule}${GLYPHS.rule}${GLYPHS.rule}`)), ...body.map(r => line(r, false))];
}

/**
 * Render Markdown to styled lines that fit `width` columns.
 * @param {string} text
 * @param {number} width
 * @param {ReturnType<import('./style.mjs').createStyler>} s
 */
export function renderMarkdown(text, width, s) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(...wrap(inline(paragraph.join(' '), s), width));
    paragraph = [];
  };
  const gap = () => { if (out.length && out.at(-1) !== '') out.push(''); };
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush(); gap();
      const body = [];
      let j = i + 1;
      for (; j < src.length && !src[j].trim().startsWith(fence[1]); j++) body.push(src[j]);
      if (fence[2]) out.push(s.dim(`  ${fence[2]}`));
      for (const codeLine of body) out.push(...wrap(s.code(codeLine || ' '), width - 2).map(l => `  ${l}`));
      i = j; gap(); continue;
    }
    if (!line.trim()) { flush(); gap(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush(); gap();
      const body = inline(heading[2].replace(/\s+#+\s*$/, ''), s);
      out.push(...wrap(heading[1].length <= 2 ? s.accent.bold(heading[2].replace(/[*_`]/g, '')) : s.bold(body), width));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); gap(); out.push(s.line(GLYPHS.rule.repeat(Math.min(width, 40)))); gap(); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      let j = i;
      for (; j < src.length && /^\s*\|.*\|\s*$/.test(src[j]); j++) rows.push(src[j]);
      out.push(...renderTable(rows, width, s));
      i = j - 1; continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flush(); out.push(...prefixed(wrap(s.italic(inline(quote[1], s)), width - 2), s.line(`${GLYPHS.bar} `), s.line(`${GLYPHS.bar} `))); continue; }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const depth = Math.min(3, Math.floor(item[1].length / 2));
      const marker = /\d/.test(item[2]) ? `${item[2]} ` : `${GLYPHS.bullet} `;
      const indent = '  '.repeat(depth);
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      const body = task ? `${task[1] === ' ' ? '[ ]' : `[${GLYPHS.ok}]`} ${task[2]}` : item[3];
      const width2 = width - indent.length - stringWidth(marker);
      out.push(...prefixed(wrap(inline(body, s), width2), indent + s.accentSoft(marker), indent + ' '.repeat(stringWidth(marker))));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  while (out.length && out.at(-1) === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out;
}
