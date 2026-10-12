export const inject = ['tools', 'atelierCanvas'];
export const name = 'atelier-design-tools';
const sceneSchema = {type: 'object', additionalProperties: false, required: ['title', 'cards'], properties: {
  title: {type: 'string', maxLength: 160},
  units: {type: 'string', enum: ['m', 'px'], description: 'm for a plan: x, y, width and height in metres, origin at the south-west corner, x east, y north; it is drawn to scale with a scale bar. px for a diagram or moodboard on the canvas grid.'},
  cards: {type: 'array', minItems: 1, maxItems: 32, items: {
    type: 'object', additionalProperties: false, required: ['label'], properties: {
      label: {type: 'string', maxLength: 160}, note: {type: 'string', maxLength: 800}, color: {type: 'string', pattern: '^#[a-fA-F0-9]{6}$'},
      x: {type: 'number', minimum: 0, maximum: 1600}, y: {type: 'number', minimum: 0, maximum: 1600},
      width: {type: 'number', minimum: 0.05, maximum: 800}, height: {type: 'number', minimum: 0.05, maximum: 800}
    }
  }}
}};
const output = {schema: {type: 'object', required: ['status', 'title', 'cards', 'imagesAvailable'], properties: {
  status: {type: 'string'}, title: {type: 'string'}, cards: {type: 'integer'}, imagesAvailable: {type: 'boolean'}
}}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]};
export function apply(ctx, config = {}) {
  // The Image generation role (Settings > Model roles) is used when no endpoint is configured here.
  const roles = config.imageEndpoint ? undefined : ctx.get('atelierRoles');
  const role = roles?.peek('image');
  const endpoint = config.imageEndpoint ?? role?.baseURL;
  const save = async (args, exec, moodboard) => {
    const sid = String(exec.agent?.session?.header?.id ?? '');
    if (!sid) throw Error('A canvas requires an owning chat.');
    const scene = await ctx.atelierCanvas.put(sid, args);
    return {status: moodboard && !endpoint ? 'Moodboard saved as colour and material cards. No image endpoint is configured; no images were generated.' : 'Saved to the editable canvas.', title: scene.title, cards: scene.cards.length, imagesAvailable: Boolean(endpoint)};
  };
  for (const [tool, description, moodboard] of [
    ['board_draw', 'Draw a plan or design diagram on the editable canvas. For a plan, set units "m" and give every room or zone x, y, width and height in metres (origin at the south-west corner, x east, y north); Atelier draws it to scale. For a process or comparison, leave out positions and the grid places the steps. Include dimensions, circulation and assumptions in notes. Concept drawings are not permit documents.', false],
    ['moodboard_create', 'Create a moodboard on the canvas using colour swatches and descriptive material, texture and lighting cards. This works without an image endpoint and never claims generated images.', true]
  ]) ctx.effect(() => ctx.tools.register({name: tool, description, parameters: sceneSchema, output, execute: (args, exec) => save(args, exec, moodboard)}));
  if (endpoint) {
    const url = new URL(endpoint); if (!['http:', 'https:'].includes(url.protocol)) throw Error('Image endpoint must use HTTP or HTTPS.');
    ctx.effect(() => ctx.tools.register({name: 'image_generate', description: 'Generate one image using the configured OpenAI-compatible image endpoint, then place it on this chat canvas. Use only when the user requests an image.',
      parameters: {type: 'object', required: ['prompt'], additionalProperties: false, properties: {prompt: {type: 'string', maxLength: 4000}}}, output,
      async execute(args, exec) {
        const key = config.imageKeyEnv ? process.env[config.imageKeyEnv] : undefined;
        const request = JSON.stringify({model: config.imageModel ?? (role?.model || 'IMAGE_MODEL'), prompt: args.prompt, n: 1, response_format: 'b64_json'});
        const response = role
          ? await roles.fetch('image', '', {method: 'POST', headers: {'content-type': 'application/json'}, body: request, signal: exec.signal})
          : await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {})},
            body: request, signal: AbortSignal.any([exec.signal, AbortSignal.timeout(600000)]), redirect: 'error'});
        if (!response.ok) throw Error(`Image endpoint returned HTTP ${response.status}.`);
        const bytes = await response.arrayBuffer(); if (bytes.byteLength > 12 * 1024 * 1024) throw Error('Image response exceeds the admitted limit.');
        const body = JSON.parse(new TextDecoder().decode(bytes)); const b64 = body.data?.[0]?.b64_json;
        if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw Error('The endpoint did not return an inline image.');
        const sid = String(exec.agent?.session?.header?.id ?? ''); if (!sid) throw Error('An image requires an owning chat.');
        const previous = await ctx.atelierCanvas.get(sid);
        const scene = await ctx.atelierCanvas.put(sid, {...(previous ?? {title: 'Design image', cards: []}), image: `data:image/png;base64,${b64}`});
        return {status: 'Image saved to the canvas.', title: scene.title, cards: scene.cards.length, imagesAvailable: true};
      }
    }));
  }
}
