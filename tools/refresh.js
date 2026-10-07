// Refreshes stars, push dates and archive state for everything already tracked.
// Discovery only sees repositories that still match a search query, so without
// this pass a listed entry's numbers would freeze the moment it stopped ranking.
import { getRepo, normalizeRepo } from './lib/github.js';
import { loadRegistry, saveRegistry } from './lib/store.js';
import { log, today } from './lib/util.js';

const argv = new Set(process.argv.slice(2));
const ALL = argv.has('--all');

const { byId } = loadRegistry('data/registry.json');
const targets = [...byId.values()].filter(
  (e) => e.source === 'github' && (ALL || e.status === 'approved' || e.status === 'review'),
);

log(`refreshing ${targets.length} entries`);

let updated = 0;
let gone = 0;
for (const entry of targets) {
  const repo = await getRepo(entry.name);
  if (!repo) {
    // Deleted, renamed or made private. Keep the record, drop it from the list.
    entry.missingSince = entry.missingSince ?? today();
    entry.status = 'rejected';
    gone++;
    continue;
  }

  const fresh = normalizeRepo(repo);
  const history = entry.starsHistory ?? [];
  if (history.at(-1)?.[0] === today()) history[history.length - 1] = [today(), fresh.stars];
  else history.push([today(), fresh.stars]);

  Object.assign(entry, {
    stars: fresh.stars,
    forks: fresh.forks,
    description: fresh.description,
    topics: fresh.topics,
    license: fresh.license,
    language: fresh.language,
    pushedAt: fresh.pushedAt,
    isArchived: fresh.isArchived,
    homepage: fresh.homepage,
    starsHistory: history.slice(-60),
    refreshedAt: today(),
  });
  delete entry.missingSince;
  updated++;
}

saveRegistry('data/registry.json', byId);
log(`refreshed ${updated} entries, ${gone} no longer reachable`);
