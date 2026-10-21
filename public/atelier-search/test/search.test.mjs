import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSearchUrl, mapResponse, resolveConfig, SearxngSearchProvider} from '../index.mjs';

test('builds an encoded SearXNG JSON search URL', () => {
  const config = resolveConfig({baseUrl: 'http://localhost:8080/'});
  assert.equal(buildSearchUrl(config, 'vitruvius facts'), 'http://localhost:8080/search?q=vitruvius+facts&format=json');
});

test('bounds results, clips snippets and removes duplicate or unsafe URLs', () => {
  const result = mapResponse({results: [
    {url: 'https://example.com/a', title: 'A', content: 'one '.repeat(20)},
    {url: 'https://example.com/a', title: 'duplicate'}, {url: 'javascript:alert(1)'},
    {url: 'https://example.com/b', title: 'B'},
  ]}, {limit: 1, snippetChars: 12});
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].snippet.length, 12);
  assert.equal(result.truncated, true);
});

test('reports an absent endpoint in plain language', async () => {
  const provider = new SearxngSearchProvider(() => ({}));
  assert.equal(provider.available(), true);
  await assert.rejects(provider.search({query: 'test'}), /web search is not configured/);
});

test('uses the fallback endpoint when the primary is unavailable', async () => {
  const visited = [];
  const provider = new SearxngSearchProvider(() => ({baseUrl: 'http://primary.test', fallbackUrl: 'http://fallback.test'}), {
    fetchImpl: async url => {
      visited.push(new URL(url).host);
      if (visited.length === 1) throw Error('offline');
      return Response.json({results: [{url: 'https://example.com', title: 'Result'}]});
    },
  });
  const result = await provider.search({query: 'test'});
  assert.deepEqual(visited, ['primary.test', 'fallback.test']);
  assert.equal(result.sources.length, 1);
});

test('reads SearXNG answers given as strings or objects', () => {
  const result = mapResponse({results: [], answers: ['plain answer', {answer: 'object answer', url: 'https://example.com'}, {}]});
  assert.equal(result.content, ['plain answer', 'object answer'].join(String.fromCharCode(10)));
});
