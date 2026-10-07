import { readJson } from './store.js';

// Everything the judge should have an opinion on: the review queue, plus entries the
// crawler auto-approved on keyword score alone, which never passed through it.
// One deterministic ordering, shared by every step, so a list of probabilities
// can always be matched back to the right repositories.
export function reviewQueue({ scope = 'all' } = {}) {
  const registry = readJson('data/registry.json', { entries: [] });
  const wanted = scope === 'queue' ? ['review'] : ['review', 'approved'];
  return registry.entries
    .filter((e) => wanted.includes(e.status))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
