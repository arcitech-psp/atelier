// Styling for the terminal UI: one chalk instance at the chosen colour depth, the ARCITECH palette, and helpers
// that wrap styled text to a width. In mono (NO_COLOR or --theme mono) only weight is used: bold, dim, inverse.
import {Chalk} from 'chalk';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import {PALETTE} from './theme.mjs';

export {stringWidth};

/** Glyphs; ATELIER_ASCII=1 swaps to plain ASCII for very old consoles. */
export const GLYPHS = process.env.ATELIER_ASCII === '1'
  ? {bullet: '*', closed: '>', open: 'v', ok: '+', fail: 'x', run: '~', rule: '-', bar: '|', dot: '.', prompt: '>', ellipsis: '...'}
  : {bullet: '•', closed: '▸', open: '▾', ok: '✓', fail: '✗', run: '…', rule: '─', bar: '│', dot: '·', prompt: '›', ellipsis: '…'};

/**
 * @param {'mono'|'256'|'truecolor'|'auto'} mode
 * @returns a styler: s.ink('text'), s.accent.bold('x'), s.dim(...), plus s.mode.
 */
export function createStyler(mode) {
  const level = mode === 'mono' ? 1 : mode === '256' ? 2 : mode === 'truecolor' ? 3 : undefined;
  const chalk = level === undefined ? new Chalk() : new Chalk({level});
  const colorless = mode === 'mono' || chalk.level === 0;
  const hue = token => colorless ? chalk.reset : chalk.hex(PALETTE[token]);
  return {
    mode, chalk, colorless,
    ink: hue('ink'), dim: colorless ? chalk.dim : chalk.hex(PALETTE.dim), line: colorless ? chalk.dim : chalk.hex(PALETTE.line),
    accent: colorless ? chalk.bold : chalk.hex(PALETTE.accent), accentSoft: hue('accentSoft'), user: colorless ? chalk.bold : chalk.hex(PALETTE.user),
    code: hue('code'), ok: hue('ok'), warn: colorless ? chalk.bold : chalk.hex(PALETTE.warn), fail: colorless ? chalk.bold : chalk.hex(PALETTE.fail),
    link: colorless ? chalk.underline : chalk.hex(PALETTE.link).underline,
    bold: chalk.bold, italic: chalk.italic, inverse: chalk.inverse,
    selected: colorless ? chalk.inverse : chalk.bgHex(PALETTE.panel).hex(PALETTE.ink).bold,
    bar: colorless ? chalk.inverse : chalk.bgHex(PALETTE.panel).hex(PALETTE.ink),
  };
}

/** Wrap one styled string to `width` columns (hard-wrapping long words), returning lines. */
export function wrap(text, width) {
  if (width < 4) width = 4;
  return wrapAnsi(text, width, {hard: true, trim: false}).split('\n');
}

/** Pad or cut a styled line to exactly `width` columns. */
export function fit(text, width) {
  const w = stringWidth(text);
  if (w <= width) return text + ' '.repeat(width - w);
  return wrapAnsi(text, Math.max(1, width - 1), {hard: true, trim: false}).split('\n')[0] + GLYPHS.ellipsis;
}
