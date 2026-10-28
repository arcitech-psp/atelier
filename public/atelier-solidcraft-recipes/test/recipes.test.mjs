import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listRecipes, readRecipe } from '../index.mjs';

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if (flags & 0x08) throw new Error('Recipe archive uses an unsupported streaming header.');
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported archive compression method: ${method}`);
    entries.set(name, data);
    offset = dataStart + compressedSize;
  }
  return entries;
}

test('catalog exposes the four verified furniture recipes and one resize variant', () => {
  const recipes = listRecipes();
  assert.equal(recipes.length, 5);
  assert.equal(new Set(recipes.map(({ id }) => id)).size, recipes.length);
});

test('every packaged recipe is a parseable SolidCraft container with millimetre geometry', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'atelier-recipe-check-'));
  const metadataFiles = [];
  try {
    let index = 0;
    for (const recipe of listRecipes()) {
      const entries = readZipEntries(await readRecipe(recipe.id));
      assert.ok(entries.has('document.json'), `${recipe.id}: document.json`);
      const document = JSON.parse(entries.get('document.json').toString('utf8'));
      assert.equal(document.format, 'solidcraft/29', recipe.id);
      assert.equal(document.units, 'mm', recipe.id);
      assert.ok(Array.isArray(document.features) && document.features.length > 0, recipe.id);
      assert.ok(Array.isArray(document.params) && document.params.length > 0, recipe.id);
      for (const [name, content] of entries) {
        if (!/\.json$/i.test(name)) continue;
        const target = join(temp, `${index++}.json`);
        await writeFile(target, content);
        metadataFiles.push(target);
      }
    }
    const gate = fileURLToPath(new URL('../../../scripts/check-private-strings.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [gate, '--root', temp, ...metadataFiles], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'recipe metadata passes the public source privacy gate');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('unknown recipe identifiers are rejected', async () => {
  await assert.rejects(readRecipe('../settings.yaml'), /Unknown recipe/);
});
