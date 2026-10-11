// Entry of the terminal UI: choose the colour depth, take the alternate screen, run the Ink app, and give the
// terminal back exactly as it was on exit, error or Ctrl+C.
import {applyColorMode, chooseColorMode} from './theme.mjs';

/** @returns {Promise<number>} exit code */
export async function runTui({home, session, port, theme = 'auto'}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('atelier: the terminal UI needs an interactive terminal. For scripts use: atelier chat "..." (add --json)\n');
    return 2;
  }
  const mode = chooseColorMode(theme);
  applyColorMode(mode);
  // Ink and chalk read FORCE_COLOR when they load, so load them only now.
  const React = (await import('react')).default;
  const {render} = await import('ink');
  const {App} = await import('./app.mjs');
  const {Controller} = await import('./controller.mjs');
  const {createStyler} = await import('./style.mjs');

  const controller = new Controller({home, session, port});
  controller.styler = createStyler(mode);
  const stdout = process.stdout;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    stdout.write('\x1b[?25h\x1b[?1049l');
  };
  stdout.write('\x1b[?1049h\x1b[H\x1b[2J');
  process.once('exit', restore);
  let app;
  try {
    app = render(React.createElement(App, {controller, onExit: () => controller.stop()}), {exitOnCtrlC: false, patchConsole: true});
    controller.start();
    await app.waitUntilExit();
  } finally {
    controller.stop();
    restore();
  }
  if (controller.state.sessionId) process.stdout.write(`Chat ${controller.state.sessionId} is saved. Reopen it with: atelier sessions open ${controller.state.sessionId}\n`);
  return controller.state.phase === 'error' ? 1 : 0;
}
