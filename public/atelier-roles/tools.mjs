// Agent tools backed by model roles. Each tool is offered only when its role is connected, so a missing role simply
// means the tool is absent (the new chat after you connect the role gets it).
//   look_at_image          the Vision role, only when the brain cannot read images itself
//   search_project_files   the Embeddings role: meaning-based search over the text files in the chat's folder
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import {extname, join, relative, resolve, sep} from 'node:path';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';

export const name = 'atelier-role-tools';
export const inject = ['tools'];

const IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'};
const TEXT_TYPES = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.ini', '.toml', '.tex', '.rst',
  '.js', '.mjs', '.ts', '.tsx', '.py', '.css', '.scad', '.svg']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', '.next', 'TO_DELETE']);
const LIMITS = {files: 400, fileBytes: 300 * 1024, chunks: 1500, chunkChars: 1400, overlap: 200, batch: 32};

const output = {schema: {type: 'object'}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]};
const workspaceOf = exec => resolve(exec.agent?.session?.header?.cwd ?? process.cwd());
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !rel.includes(':') && !rel.startsWith(sep)); };

async function* walk(root, dir = root, budget = {files: LIMITS.files}) {
  let entries; try { entries = await readdir(dir, {withFileTypes: true}); } catch { return; }
  for (const entry of entries) {
    if (budget.files <= 0) return;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* walk(root, path, budget); }
    else if (entry.isFile() && TEXT_TYPES.has(extname(entry.name).toLowerCase())) { budget.files--; yield path; }
  }
}
function chunks(text) {
  const out = [];
  for (let start = 0; start < text.length; start += LIMITS.chunkChars - LIMITS.overlap) {
    out.push({start, text: text.slice(start, start + LIMITS.chunkChars)});
    if (start + LIMITS.chunkChars >= text.length) break;
  }
  return out;
}
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
const toB64 = vector => Buffer.from(new Float32Array(vector).buffer).toString('base64');
const fromB64 = b64 => { const bytes = Buffer.from(b64, 'base64'); return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4); };
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
}

export function apply(ctx) {
  const roles = ctx.get('atelierRoles');
  if (!roles) return;

  if (roles.isSet('vision') && !roles.brainReadsImages()) {
    ctx.effect(() => ctx.tools.register({
      name: 'look_at_image',
      description: 'Look at an image file in this chat\'s project folder with the Vision model and answer a question about it (what it shows, text in it, dimensions written on a drawing). Use it whenever the user refers to an image or screenshot, because you cannot see images yourself.',
      parameters: {type: 'object', additionalProperties: false, required: ['path'], properties: {
        path: {type: 'string', description: 'Image path, relative to the project folder.'},
        question: {type: 'string', maxLength: 2000, description: 'What to look for. Default: describe the image in detail.'}}},
      output,
      async execute(args, exec) {
        const root = workspaceOf(exec), path = resolve(root, args.path);
        if (!inside(root, path)) throw Error('Only images inside the project folder can be read.');
        const type = IMAGE_TYPES[extname(path).toLowerCase()];
        if (!type) throw Error('Use a PNG, JPEG, WebP or GIF image.');
        if ((await stat(path)).size > 8 * 1024 * 1024) throw Error('The image is larger than 8 MB.');
        const url = `data:${type};base64,${(await readFile(path)).toString('base64')}`;
        const {model} = roles.peek('vision');
        const response = await roles.fetch('vision', '/chat/completions', {method: 'POST', headers: {'content-type': 'application/json'}, signal: exec.signal,
          body: JSON.stringify({model, max_tokens: 700, temperature: 0.2, messages: [{role: 'user', content: [
            {type: 'text', text: args.question || 'Describe this image in detail for a designer: layout, objects, materials, colours, any text or dimensions.'},
            {type: 'image_url', image_url: {url}}]}]})});
        if (!response.ok) throw Error(`The Vision model answered HTTP ${response.status}.`);
        const answer = (await response.json())?.choices?.[0]?.message?.content;
        return {image: relative(root, path), answer: typeof answer === 'string' ? answer : JSON.stringify(answer ?? '')};
      },
    }));
  }

  if (roles.isSet('embeddings')) {
    const cacheDir = dshHomePath('atelier-roles', 'embedding-cache');
    const embed = async (inputs, signal) => {
      const {model} = roles.peek('embeddings');
      const response = await roles.fetch('embeddings', '/embeddings', {method: 'POST', headers: {'content-type': 'application/json'}, signal,
        body: JSON.stringify({model, input: inputs})});
      if (!response.ok) throw Error(`The Embeddings model answered HTTP ${response.status}.`);
      const data = (await response.json())?.data ?? [];
      return data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
    };
    ctx.effect(() => ctx.tools.register({
      name: 'search_project_files',
      description: 'Search the text files in this chat\'s project folder by meaning (notes, briefs, specifications, schedules, code). Returns the best matching passages with file and line. Use it to recall what the project documents say before answering.',
      parameters: {type: 'object', additionalProperties: false, required: ['query'], properties: {
        query: {type: 'string', maxLength: 1000}, limit: {type: 'integer', minimum: 1, maximum: 12}}},
      output,
      async execute(args, exec) {
        const root = workspaceOf(exec), {model} = roles.peek('embeddings');
        const gemma = /gemma/i.test(model);
        const doc = t => gemma ? `title: none | text: ${t}` : t, query = q => gemma ? `task: search result | query: ${q}` : q;
        const cacheFile = join(cacheDir, createHash('sha1').update(model).digest('hex').slice(0, 16) + '.json');
        let cache = {}; try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
        const passages = [];
        for await (const file of walk(root)) {
          const info = await stat(file); if (info.size > LIMITS.fileBytes) continue;
          const text = await readFile(file, 'utf8');
          for (const piece of chunks(text)) {
            if (passages.length >= LIMITS.chunks) break;
            passages.push({file, text, piece, key: createHash('sha256').update(piece.text).digest('hex')});
          }
        }
        if (!passages.length) return {query: args.query, results: [], note: 'No text files found in the project folder.'};
        const missing = [...new Set(passages.filter(p => !cache[p.key]).map(p => p.key))];
        const byKey = new Map(passages.map(p => [p.key, p]));
        for (let i = 0; i < missing.length; i += LIMITS.batch) {
          const keys = missing.slice(i, i + LIMITS.batch);
          const vectors = await embed(keys.map(k => doc(byKey.get(k).piece.text)), exec.signal);
          keys.forEach((k, j) => { if (vectors[j]) cache[k] = toB64(vectors[j]); });
        }
        if (missing.length) {
          await mkdir(cacheDir, {recursive: true});
          const temp = cacheFile + '.' + process.pid + '.pending';
          await writeFile(temp, JSON.stringify(cache)); await rename(temp, cacheFile);
        }
        const [q] = await embed([query(args.query)], exec.signal);
        const scored = passages.filter(p => cache[p.key]).map(p => ({p, score: cosine(q, fromB64(cache[p.key]))}))
          .sort((a, b) => b.score - a.score).slice(0, args.limit ?? 6);
        return {query: args.query, searched: new Set(passages.map(p => p.file)).size + ' files',
          results: scored.map(({p, score}) => ({file: relative(root, p.file), line: lineAt(p.text, p.piece.start), score: Number(score.toFixed(3)),
            excerpt: p.piece.text.slice(0, 600)}))};
      },
    }));
  }
}
