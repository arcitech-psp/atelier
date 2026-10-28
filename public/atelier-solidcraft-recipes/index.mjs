import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from './catalog.json' with { type: 'json' };

const packageDir = dirname(fileURLToPath(import.meta.url));

export function listRecipes() {
  return catalog.recipes.map((recipe) => ({ ...recipe }));
}

export async function readRecipe(id) {
  const recipe = catalog.recipes.find((item) => item.id === id);
  if (!recipe) throw new RangeError(`Unknown recipe: ${id}`);
  return readFile(join(packageDir, 'recipes', recipe.file));
}
