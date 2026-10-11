// Transcript to styled lines for the chat pane. Pure: (transcript, width, options) in, lines out, so it is tested
// without a terminal and the TUI can scroll by line.
import {renderMarkdown} from './markdown.mjs';
import {GLYPHS, stringWidth, wrap} from './style.mjs';
import {summarizeArgs} from '../transcript.mjs';

const SPINNER = ['·  ', '·· ', '···', ' ··', '  ·', '   '];
export const spinner = frame => process.env.ATELIER_ASCII === '1' ? ['.  ', '.. ', '...', ' ..', '  .', '   '][frame % 6] : SPINNER[frame % SPINNER.length];

const indent = (lines, pad = '  ') => lines.map(l => pad + l);

// The AIT mark for the terminal (ARCITECH brand kit, cli-banner): walls in the accent, ink in the text colour.
const MARK = [
  '     ██       ━┯━   ██████████',
  '      ██       │       ██',
  '       ██     ▐▌      ██',
  '     (●) ██    │       ██',
  '━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━',
];
const markLine = (line, s) => line.replace(/(█+)|([^█]+)/g, (_, wall, rest) => wall ? s.accentSoft(wall) : s.ink(rest));

/** The calm first screen, before any message. */
export function welcomeLines(width, s, {profile = 'Vitruvius', brain} = {}) {
  const w = Math.min(width, 72);
  return [
    '',
    ...(process.env.ATELIER_ASCII === '1' || width < 36 ? [] : [...MARK.map(l => markLine(l, s)), '']),
    s.accent.bold('Atelier') + s.dim(`  by ARCITECH`),
    s.line(GLYPHS.rule.repeat(Math.min(w, 24))),
    '',
    ...wrap(s.ink(`Describe the project. ${profile} works through it with you, one visible step at a time. You can stop it, change the plan or take over at any time.`), w),
    '',
    ...wrap(s.dim(brain ? `Brain: ${brain}` : 'No brain connected yet: type /roles to see how to connect your model.'), w),
    '',
    s.dim('Try:'),
    ...['A two-bedroom flat on a narrow lot: where should the light come from?', 'A moodboard for a calm reading room in oak and lime plaster', 'Review this plan against the brief  (/attach a file first)']
      .flatMap(t => wrap(`${s.accentSoft(GLYPHS.closed)} ${s.ink(t)}`, w)),
  ];
}

function stepLines(steps, width, s, expanded) {
  const done = steps.filter(t => t.done).length, failed = steps.filter(t => t.isError).length;
  const names = [...new Set(steps.map(t => t.name))];
  const head = `${expanded ? GLYPHS.open : GLYPHS.closed} ${steps.length} step${steps.length > 1 ? 's' : ''}`;
  const state = failed ? s.fail(` ${failed} failed`) : done < steps.length ? s.warn(` ${GLYPHS.run} working`) : '';
  const lines = wrap(`${s.accentSoft(head)}${state}  ${s.dim(names.join(` ${GLYPHS.dot} `))}`, width);
  if (!expanded) return lines;
  for (const step of steps) {
    const mark = step.isError ? s.fail(GLYPHS.fail) : step.done ? s.ok(GLYPHS.ok) : s.warn(GLYPHS.run);
    const args = summarizeArgs(step.args, Math.max(20, width - stringWidth(step.name) - 8));
    lines.push(...indent(wrap(`${mark} ${s.bold(s.ink(step.name))}  ${s.dim(args)}`, width - 2)));
    if (step.result) {
      const preview = step.result.replace(/\r/g, '').split('\n').filter(l => l.trim()).slice(0, 4);
      for (const line of preview) lines.push(...indent(wrap(s.dim(line.length > 300 ? `${line.slice(0, 299)}${GLYPHS.ellipsis}` : line), width - 6), '      ').slice(0, 2));
    }
  }
  return lines;
}

/**
 * @param {ReturnType<import('../transcript.mjs').createTranscript>} t
 * @param {number} width
 * @param {object} s styler
 * @param {{expandSteps?: boolean, showReasoning?: boolean, frame?: number, assistantName?: string}} options
 */
export function renderChat(t, width, s, {expandSteps = false, showReasoning = false, frame = 0, assistantName = 'Vitruvius'} = {}) {
  const lines = [];
  const items = t.items;
  let previous;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'user') {
      if (lines.length) lines.push('');
      lines.push(s.user.bold('You'));
      lines.push(...indent(wrap(s.ink(item.text.trim()), width - 2)));
    } else if (item.kind === 'tool') {
      const group = [item];
      while (items[i + 1]?.kind === 'tool' || (items[i + 1]?.kind === 'assistant' && !items[i + 1].text.trim() && items[i + 2]?.kind === 'tool')) {
        i++; if (items[i].kind === 'tool') group.push(items[i]);
      }
      if (previous?.kind === 'user') { lines.push(''); lines.push(s.accent.bold(assistantName)); }
      lines.push(...indent(stepLines(group, width - 2, s, expandSteps)));
      previous = item; continue;
    } else if (item.kind === 'assistant') {
      const hasText = item.text.trim().length > 0;
      const thinking = !hasText && !item.final && t.running && i === items.length - 1;
      if (!hasText && !thinking && !(showReasoning && item.reasoning)) { previous = previous ?? item; continue; }
      if (previous?.kind !== 'assistant' && previous?.kind !== 'tool') { lines.push(''); lines.push(s.accent.bold(assistantName)); }
      else if (previous?.kind === 'tool') lines.push('');
      if (showReasoning && item.reasoning.trim()) {
        lines.push(...indent(wrap(s.dim.italic(item.reasoning.trim()), width - 4), `  ${s.line(GLYPHS.bar)} `));
        if (hasText) lines.push('');
      }
      if (thinking) lines.push(`  ${s.dim(`thinking ${spinner(frame)}`)}`);
      if (hasText) lines.push(...indent(renderMarkdown(item.text, width - 2, s)));
      if (item.interrupted) lines.push(`  ${s.dim('(stopped)')}`);
    }
    previous = item;
  }
  if (t.running && items.at(-1)?.kind === 'user') { lines.push(''); lines.push(s.accent.bold(assistantName)); lines.push(`  ${s.dim(`thinking ${spinner(frame)}`)}`); }
  if (t.error) { lines.push(''); lines.push(...wrap(s.fail(`${GLYPHS.fail} ${t.error}`), width)); }
  else if (t.turnEnd?.kind === 'aborted' && !t.running) { lines.push(''); lines.push(s.dim('Stopped. Type to continue, or start again.')); }
  else if (t.turnEnd?.kind === 'max-tokens') { lines.push(''); lines.push(s.warn('The answer reached the model\'s length limit. Type "continue" to get the rest.')); }
  return lines;
}
