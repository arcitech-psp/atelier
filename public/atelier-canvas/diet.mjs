// Tool diet for small models (Vitruvius Zero). Config only; the tools themselves are untouched.
// Rewrites what the model SEES of the tool list at each step:
//   hide      - names (or prefix*) never shown;
//   onDemand  - {skill: [names]} shown only after that skill is loaded in this chat (skill tool or /skill-name);
//   tools     - {name: {description?, keep?: [optional params to keep]}} shorter text, fewer optional fields;
//   stripParameterDescriptions - drop description strings inside parameter schemas.
// Hidden tools still run if called by exact name; the diet only trims the prompt. Required parameters are never removed.
export const name = 'atelier-tool-diet';

const matches = (patterns = [], tool) => patterns.some(p => p.endsWith('*') ? tool.startsWith(p.slice(0, -1)) : p === tool);

function strip(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {...schema};
  if (typeof out.description === 'string') delete out.description;
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions']) {
    if (out[key] && typeof out[key] === 'object') out[key] = Object.fromEntries(Object.entries(out[key]).map(([k, v]) => [k, strip(v)]));
  }
  for (const key of ['items', 'additionalProperties', 'not', 'contains']) if (out[key] && typeof out[key] === 'object') out[key] = strip(out[key]);
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) if (Array.isArray(out[key])) out[key] = out[key].map(strip);
  return out;
}

function keepOnly(parameters, keep) {
  if (!keep || !parameters?.properties) return parameters;
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  const properties = Object.fromEntries(Object.entries(parameters.properties)
    .filter(([k, v]) => keep.includes(k) || required.has(k) || v?.required === true));
  return {...parameters, properties};
}

/** Skill names loaded in this chat so far: `skill` tool calls and `/name` user invocations. */
export function loadedSkills(events = []) {
  const loaded = new Set();
  for (const event of events) {
    const data = event?.data ?? {};
    if (event?.type === 'tool/call' && data.name === 'skill') {
      try { const args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments; if (args?.name) loaded.add(String(args.name)); } catch {}
    }
    if (event?.type === 'user/message') {
      if (data.source?.kind === 'skill-invocation' && data.source.name) loaded.add(String(data.source.name));
      if (data.source?.kind === 'user') {
        const text = (data.content ?? []).map(c => c?.text ?? '').join('').trimStart();
        const m = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/.exec(text);
        if (m) loaded.add(m[1]);
      }
    }
  }
  return loaded;
}

/** Pure: the model-facing tool list after the diet. */
export function diet(tools, config = {}, loaded = new Set()) {
  const onDemand = Object.entries(config.onDemand ?? {});
  return tools
    .filter(t => !matches(config.hide, t.name))
    .filter(t => onDemand.every(([skill, names]) => !matches(names, t.name) || loaded.has(skill)))
    .map(t => {
      const o = config.tools?.[t.name] ?? {};
      let parameters = keepOnly(t.parameters, o.keep);
      if (config.stripParameterDescriptions) parameters = strip(parameters);
      return {...t, description: o.description ?? t.description, parameters};
    });
}

export function apply(ctx, config = {}) {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    const loaded = loadedSkills(context?.agent?.session?.events ?? []);
    return {...result, tools: diet(result.tools ?? [], config, loaded)};
  });
}
