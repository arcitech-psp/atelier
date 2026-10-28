import test from 'node:test';
import assert from 'node:assert/strict';
import { getFastImagePreset, planFastImage, runFastImage } from '../fast-image.mjs';

test('fast preset maps the measured request and output dimensions', () => {
  assert.deepEqual(getFastImagePreset(), {
    id: 'fast-1366x768',
    input: { width: 1366, height: 768 },
    render: { width: 1376, height: 768 },
    output: { width: 3840, height: 2160 },
    upscale: { scale: 3, crop: 'center' },
  });
  assert.equal(3840 * 2160, 8_294_400);
});

test('planning trims prompts and uses the preset render dimensions', () => {
  const plan = planFastImage('  exterior study  ');
  assert.equal(plan.prompt, 'exterior study');
  assert.equal(plan.preset, 'fast-1366x768');
  assert.deepEqual(plan.render, { width: 1376, height: 768 });
});

test('provider adapters run in order and receive the requested target', async () => {
  const calls = [];
  const result = await runFastImage('wood house', {
    generate: async (input) => { calls.push(['generate', input]); return 'source'; },
    upscale: async (source, options) => { calls.push(['upscale', source, options]); return 'final'; },
  });
  assert.equal(result, 'final');
  assert.deepEqual(calls.map(([name]) => name), ['generate', 'upscale']);
  assert.deepEqual(calls[0][1], { prompt: 'wood house', width: 1376, height: 768 });
  assert.deepEqual(calls[1].slice(1), ['source', { scale: 3, crop: 'center', width: 3840, height: 2160 }]);
});

test('missing prompt, adapters, or outputs fail closed', async () => {
  assert.throws(() => planFastImage(' '), /prompt/);
  await assert.rejects(runFastImage('x', {}), /adapters/);
  await assert.rejects(runFastImage('x', { generate: async () => null, upscale: async () => 'x' }), /source image/);
  await assert.rejects(runFastImage('x', { generate: async () => 'source', upscale: async () => null }), /upscale adapter/);
});
