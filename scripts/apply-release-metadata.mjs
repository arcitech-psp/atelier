import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [root, sourceDir] = process.argv.slice(2);
if (!root || !sourceDir) throw new Error('Usage: node apply-release-metadata.mjs <public-worktree-root> <job-payload-dir>');
const manifestPath = join(root, 'RELEASE_MANIFEST.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const additions = [
  ['@arcitech/atelier-studio-fast', 'public/atelier-studio-fast'],
  ['@arcitech/atelier-bimcraft-design', 'public/atelier-bimcraft-design'],
  ['@arcitech/atelier-solidcraft-recipes', 'public/atelier-solidcraft-recipes'],
];
const known = new Set(manifest.packages.map((pkg) => pkg.name));
for (const [name, path] of additions) {
  if (!known.has(name)) manifest.packages.push({ name, version: '0.2.0-preview', path, license: 'PolyForm-Shield-1.0.0' });
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const featuresPath = join(root, 'public/FEATURES.json');
await writeFile(featuresPath, `${JSON.stringify(JSON.parse(await readFile(join(sourceDir, 'FEATURES.json'), 'utf8')), null, 2)}\n`);
await writeFile(join(root, 'docs/public-modules.md'), await readFile(join(sourceDir, 'feature-modules.md')));

const notesPath = join(root, 'packaging/RELEASE_NOTES.md');
let notes = await readFile(notesPath, 'utf8');
const marker = '## 27 Oct 2026 — public modules';
if (!notes.includes(marker)) {
  const lines = [
    marker,
    '',
    '- Add optional fast image preset, BIMCraft design adapter, and five SolidCraft recipe containers.',
    '- Keep optional modules disabled until users configure their compatible service or application.',
    '- Keep video generation and its panel out of the public package.',
    '- Do not bundle local bylaw text, staging sources, or unqualified 3D assets.',
    '',
  ].join('\n');
  const firstSection = notes.indexOf('\n## ');
  notes = firstSection < 0 ? `${notes.trimEnd()}\n\n${lines}` : `${notes.slice(0, firstSection + 1)}${lines}${notes.slice(firstSection + 1)}`;
  await writeFile(notesPath, notes);
}
