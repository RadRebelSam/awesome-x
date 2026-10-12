import { sleep, log, userAgent } from './util.js';

const API = 'https://api.github.com';
const SEARCH_MIN_INTERVAL_MS = 2200; // authenticated search allows ~30 requests/minute
const MAX_SEARCH_RESULTS = 1000; // hard cap the search API enforces per query
const PER_PAGE = 100;

let lastSearchAt = 0;

function headers(raw = false) {
  const h = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': userAgent(),
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function request(path, { raw = false, isSearch = false, attempt = 1 } = {}) {
  if (isSearch) {
    const wait = SEARCH_MIN_INTERVAL_MS - (Date.now() - lastSearchAt);
    if (wait > 0) await sleep(wait);
    lastSearchAt = Date.now();
  }

  // fetch throws rather than returning a response when the connection drops, and
  // one dropped socket partway through several hundred refreshes used to end the
  // whole day's run. Treated like a 500: wait, try again, give up after three.
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers: headers(raw), signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    if (attempt > 3) throw err;
    log(`  ${err.message} on ${path}, retrying (attempt ${attempt})`);
    await sleep(2000 * attempt);
    return request(path, { raw, isSearch, attempt: attempt + 1 });
  }

  if (res.status === 404) return null;

  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    let waitMs = 60_000;
    if (retryAfter) waitMs = retryAfter * 1000;
    else if (remaining === 0 && reset) waitMs = Math.max(1000, reset * 1000 - Date.now() + 1000);
    if (attempt > 4) throw new Error(`rate limited on ${path} after ${attempt} attempts`);
    log(`rate limited, sleeping ${Math.round(waitMs / 1000)}s (attempt ${attempt})`);
    await sleep(waitMs);
    return request(path, { raw, isSearch, attempt: attempt + 1 });
  }

  if (res.status >= 500 && attempt <= 3) {
    await sleep(2000 * attempt);
    return request(path, { raw, isSearch, attempt: attempt + 1 });
  }

  if (!res.ok) {
    throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  }

  return raw ? res.text() : res.json();
}

async function searchPage(kind, q, page) {
  const qs = new URLSearchParams({ q, per_page: String(PER_PAGE), page: String(page) });
  return request(`/search/${kind}?${qs}`, { isSearch: true });
}

// The search API refuses to page past 1000 results, so a query that matches more
// than that gets split into narrower slices until every slice fits under the cap.
async function searchAll(kind, baseQuery, slices) {
  const items = [];
  const seen = new Set();
  let overflowed = false;

  for (const slice of slices) {
    const q = slice ? `${baseQuery} ${slice}` : baseQuery;
    let first;
    try {
      first = await searchPage(kind, q, 1);
    } catch (err) {
      log(`query failed, skipping: ${q} -> ${err.message}`);
      continue;
    }
    if (!first) continue;

    const total = first.total_count ?? 0;
    log(`  ${total} hits for: ${q}`);
    if (total > MAX_SEARCH_RESULTS) overflowed = true;

    const pages = Math.min(Math.ceil(total / PER_PAGE), MAX_SEARCH_RESULTS / PER_PAGE);
    let batch = first.items ?? [];
    for (let page = 2; page <= pages; page++) {
      const next = await searchPage(kind, q, page);
      if (!next?.items?.length) break;
      batch = batch.concat(next.items);
    }

    for (const item of batch) {
      const key = kind === 'code' ? item.repository?.full_name : item.full_name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return { items, overflowed };
}

// Runs the query whole first. Only if it blows past the 1000 result cap does it
// pay for the extra requests needed to walk the query in narrower slices.
export async function searchRepositories(query, slices = []) {
  const first = await searchAll('repositories', query, ['']);
  if (!first.overflowed || !slices.length) return first.items;
  log(`  query exceeds the ${MAX_SEARCH_RESULTS} result cap, re-running in ${slices.length} slices`);
  const sharded = await searchAll('repositories', query, slices);
  const merged = new Map(first.items.map((i) => [i.full_name, i]));
  for (const item of sharded.items) merged.set(item.full_name, item);
  return [...merged.values()];
}

export async function searchCode(query, slices = ['']) {
  try {
    const { items } = await searchAll('code', query, slices);
    return items;
  } catch (err) {
    log(`code search unavailable: ${err.message}`);
    return [];
  }
}

export async function getReadme(fullName) {
  try {
    const text = await request(`/repos/${fullName}/readme`, { raw: true });
    return (text || '').slice(0, 20_000);
  } catch {
    return '';
  }
}

export function getRepo(fullName) {
  return request(`/repos/${fullName}`);
}

export function normalizeRepo(repo) {
  return {
    id: `github:${repo.full_name}`,
    source: 'github',
    name: repo.full_name,
    owner: repo.owner?.login ?? repo.full_name.split('/')[0],
    url: repo.html_url,
    homepage: repo.homepage || null,
    description: repo.description || '',
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    language: repo.language || null,
    license: repo.license?.spdx_id || null,
    topics: repo.topics ?? [],
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    isArchived: Boolean(repo.archived),
    isFork: Boolean(repo.fork),
  };
}
