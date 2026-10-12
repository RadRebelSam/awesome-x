import { log, unique, userAgent } from './util.js';

// Reserved GitHub paths that look like owner/repo but are not.
const RESERVED = new Set([
  'about', 'apps', 'blog', 'collections', 'contact', 'events', 'explore', 'features',
  'issues', 'login', 'marketplace', 'orgs', 'pricing', 'pulls', 'readme', 'search',
  'security', 'settings', 'signup', 'sponsors', 'topics', 'trending', 'users',
]);

const REPO_PATTERN = /github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9_.-]{1,100})/gi;

export function extractRepos(text) {
  const names = [];
  for (const [, owner, repoRaw] of text.matchAll(REPO_PATTERN)) {
    if (RESERVED.has(owner.toLowerCase())) continue;
    const repo = repoRaw.replace(/\.git$/i, '').replace(/[.]+$/, '');
    if (!repo || repo === '.' || repo === '..') continue;
    names.push(`${owner}/${repo}`);
  }
  return unique(names);
}

export async function fetchText(url, label = url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.text();
}

// Rival directories are already human-filtered, which makes their outbound
// links a good candidate source. Only the repository names are taken: every one
// is then re-fetched from the GitHub API and scored like any other candidate, so
// nothing these pages claim about a project is carried over.
export async function harvestWebSources(sources = []) {
  const found = new Map();

  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': userAgent() },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const names = extractRepos(await res.text());
      log(`  ${names.length} repo links from ${source.name}`);
      for (const name of names) {
        const via = found.get(name) ?? [];
        found.set(name, [...via, source.name]);
      }
    } catch (err) {
      log(`web source failed (${source.name}): ${err.message}`);
    }
  }

  return found;
}
