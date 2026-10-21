import {dshHomePath} from '@deepseek-ai/dsh-home-paths';
import {grep, read, save} from './core.mjs';

export const name = 'atelier-knowledge';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const root = config.root ?? process.env.ATELIER_KNOWLEDGE_DIR ?? dshHomePath('atelier-knowledge', 'notes');
  const output = {schema: {type: 'object'}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]};
  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_save',
    description: 'Save a confirmed, reusable fact to this Atelier installation’s local knowledge shelf. Every note needs at least one source URL; guesses, personal data and secrets do not belong here. Notes persist across chats on this installation and are stored offline.',
    parameters: {type: 'object', additionalProperties: false, required: ['title', 'text', 'topic', 'sources'], properties: {
      title: {type: 'string', maxLength: 140}, text: {type: 'string', maxLength: 12000},
      topic: {type: 'string', maxLength: 60, description: 'Lowercase shelf name using letters, numbers and hyphens.'},
      sources: {type: 'array', minItems: 1, maxItems: 8, items: {type: 'object', additionalProperties: false, required: ['url'],
        properties: {url: {type: 'string', format: 'uri'}, date: {type: 'string'}, title: {type: 'string', maxLength: 120}}}},
    }}, output,
    execute: args => save(args, {root}),
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_grep',
    description: 'Search source-backed notes saved to this installation’s knowledge shelf. Search is local and works without a network connection.',
    parameters: {type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: {type: 'string', maxLength: 500}, topic: {type: 'string', maxLength: 60}, limit: {type: 'integer', minimum: 1, maximum: 20},
    }}, output,
    execute: args => grep(args.query, {root, topic: args.topic, limit: args.limit}),
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_read',
    description: 'Read one full note by its id from knowledge_grep, including its source URLs.',
    parameters: {type: 'object', additionalProperties: false, required: ['id'], properties: {id: {type: 'string', maxLength: 80}}}, output,
    execute: args => read(args.id, {root}),
  }));
}

export {grep, read, save} from './core.mjs';
