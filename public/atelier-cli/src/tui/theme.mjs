// ARCITECH studio palette for the terminal: warm charcoal, paper ink, copper accent (the same tokens as the web
// pages' dark theme). Colours are given once as truecolor hex; on a 256-colour terminal chalk maps each to the
// nearest xterm-256 entry, and the mono theme (NO_COLOR, or --theme mono) uses only bold, dim and inverse.

export const PALETTE = {
  bg: '#1E2023',
  panel: '#282A2E',
  ink: '#ECE6DA',
  dim: '#9A9088',
  line: '#51483F',
  accent: '#C8894F',
  accentSoft: '#D39A66',
  user: '#D9C3A5',
  code: '#CDBFA8',
  ok: '#8FA876',
  warn: '#D9A55B',
  fail: '#C9665A',
  link: '#B9A07E',
};

/**
 * Decide the colour depth before Ink (and its chalk) load: NO_COLOR and --theme mono turn colour off; 256 and
 * truecolor force a depth; auto lets chalk read the terminal (COLORTERM, WT_SESSION, TERM).
 * @returns {'mono'|'256'|'truecolor'|'auto'}
 */
export function chooseColorMode(theme = 'auto', env = process.env) {
  if (theme === 'mono' || ('NO_COLOR' in env && env.NO_COLOR !== '')) return 'mono';
  if (theme === '256' || theme === 'truecolor') return theme;
  if (env.ATELIER_THEME === 'mono' || env.ATELIER_THEME === '256' || env.ATELIER_THEME === 'truecolor') return env.ATELIER_THEME;
  return 'auto';
}

/** Apply the mode through FORCE_COLOR, which chalk honours. Must run before ink is imported. */
export function applyColorMode(mode, env = process.env) {
  if (mode === 'mono') env.FORCE_COLOR = '0';
  else if (mode === '256') env.FORCE_COLOR = '2';
  else if (mode === 'truecolor') env.FORCE_COLOR = '3';
}

/** Text props for a palette token; in mono, colour props are dropped so only weight carries meaning. */
export function tone(mode, token, extra = {}) {
  if (mode === 'mono') return extra;
  return {color: PALETTE[token] ?? token, ...extra};
}
