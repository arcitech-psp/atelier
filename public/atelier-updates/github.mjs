import {createHmac} from 'node:crypto';
import {versionParts} from './release.mjs';

/** GitHub is optional. Signed service releases remain the source of installable bytes. */
export async function pollGithub(service, repositories, {fetchImpl = fetch, env = process.env} = {}) {
  const result = [];
  for (const [channel, config] of Object.entries(repositories)) {
    if (!['dev', 'public'].includes(channel) || !/^[\w.-]+\/[\w.-]+$/.test(config.repo)) throw Error('Invalid channel repository.');
    const token = config.tokenEnv && env[config.tokenEnv];
    if (channel === 'dev' && !token) { result.push({channel, configured: false}); continue; }
    const headers = {accept: 'application/vnd.github+json', 'user-agent': 'Atelier-Channel-Updater', ...(token ? {authorization: `Bearer ${token}`} : {})};
    const metadata = await fetchImpl(`https://api.github.com/repos/${config.repo}`, {headers, signal: AbortSignal.timeout(15000)});
    if (!metadata.ok) throw Error('GitHub repository check failed.');
    const repo = await metadata.json();
    if (repo.full_name !== config.repo || repo.private !== (channel === 'dev')) throw Error('GitHub repository visibility does not match its channel.');
    const response = await fetchImpl(`https://api.github.com/repos/${config.repo}/releases?per_page=10`, {headers, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('GitHub release check failed.');
    const releases = await response.json(), prefix = `${channel}/v`;
    const found = releases.find(r => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith(prefix));
    if (found) { versionParts(found.tag_name.slice(prefix.length)); result.push({channel, changed: await service.hint(channel, found.tag_name)}); }
  }
  return result;
}
