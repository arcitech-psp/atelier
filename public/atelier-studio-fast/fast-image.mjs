const PRESET = Object.freeze({
  id: 'fast-1366x768',
  input: Object.freeze({ width: 1366, height: 768 }),
  render: Object.freeze({ width: 1376, height: 768 }),
  output: Object.freeze({ width: 3840, height: 2160 }),
  upscale: Object.freeze({ scale: 3, crop: 'center' }),
});

export function getFastImagePreset() {
  return PRESET;
}

export function planFastImage(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('A non-empty prompt is required.');
  }
  return Object.freeze({
    preset: PRESET.id,
    prompt: prompt.trim(),
    render: PRESET.render,
    upscale: PRESET.upscale,
    output: PRESET.output,
  });
}

export async function runFastImage(prompt, { generate, upscale }) {
  if (typeof generate !== 'function' || typeof upscale !== 'function') {
    throw new TypeError('Configured image generation and upscale adapters are required.');
  }
  const plan = planFastImage(prompt);
  const source = await generate({ prompt: plan.prompt, ...plan.render });
  if (source == null) throw new Error('The image adapter returned no source image.');
  const result = await upscale(source, { ...plan.upscale, ...plan.output });
  if (result == null) throw new Error('The upscale adapter returned no image.');
  return result;
}
