import { readFileSync, existsSync } from 'node:fs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const today = () => new Date().toISOString().slice(0, 10);

export const daysSince = (iso) => {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};

export const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

export const unique = (arr) => [...new Set(arr)];

export function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortObject(value[k])]),
    );
  }
  return value;
}

// Crawled hosts deserve to know who is calling and where to complain. The name
// comes from the topic config so a fork does not impersonate someone else's bot.
let cachedAgent = null;
export function userAgent() {
  if (cachedAgent) return cachedAgent;
  const path = `topics/${process.env.TOPIC || 'example'}.json`;
  let site = {};
  try {
    if (existsSync(path)) site = JSON.parse(readFileSync(path, 'utf8')).site ?? {};
  } catch {
    // A malformed config is the crawler's problem to report, not this helper's.
  }
  const repo = site.repository;
  cachedAgent = repo ? `${repo.split('/').pop()}-bot (+https://github.com/${repo})` : 'awesome-x-bot';
  return cachedAgent;
}
