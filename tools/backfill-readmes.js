// Fills in readme excerpts for review-queue entries that were scored on metadata
// alone, so the triage step has actual evidence to judge.
import { getReadme } from './lib/github.js';
import { readJson, loadRegistry, saveRegistry } from './lib/store.js';
import { log, today } from './lib/util.js';

const config = readJson(`topics/${process.env.TOPIC || 'example'}.json`);
const { byId } = loadRegistry('data/registry.json');
const excerptChars = config.budget?.readmeExcerptChars ?? 1500;

const missing = [...byId.values()]
  .filter((e) => e.status === 'review' && e.source === 'github' && !e.readmeExcerpt)
  .sort((a, b) => b.score - a.score);

log(`${missing.length} review entries without a cached readme`);

let fetched = 0;
for (const entry of missing) {
  const readme = await getReadme(entry.name);
  entry.readmeExcerpt = readme.replace(/\s+/g, ' ').slice(0, excerptChars);
  entry.readmeFetchedAt = today();
  if (++fetched % 100 === 0) log(`  ${fetched}/${missing.length}`);
}

saveRegistry('data/registry.json', byId);
log(`backfilled ${fetched} readmes`);
