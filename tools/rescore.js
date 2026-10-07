// Re-scores everything already in the registry using the cached readme excerpts.
// No network, so tuning topics/<topic>.json is a fast loop.
import { scoreEntry } from './lib/score.js';
import { categorize } from './lib/categorize.js';
import { readJson, writeJson, loadRegistry, saveRegistry } from './lib/store.js';
import { writeReviewQueue } from './lib/report.js';
import { decideStatus } from './lib/status.js';
import { log } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const config = readJson(`topics/${TOPIC}.json`);
const manual = readJson('data/manual.json', { approve: [], reject: [], pinned: [], overrides: {} });
const { byId } = loadRegistry('data/registry.json');

let dropped = 0;
for (const [id, entry] of [...byId]) {
  const scored = scoreEntry(entry, entry.readmeExcerpt ?? '', config);
  entry.score = scored.score;
  entry.signals = scored.signals;
  entry.category = categorize(entry, entry.readmeExcerpt ?? '', config);

  entry.status = decideStatus(entry, scored, manual, config);

  if (entry.status === 'ignored' && !manual.reject?.includes(id)) {
    byId.delete(id);
    dropped++;
  }
}

const entries = saveRegistry('data/registry.json', byId);
const review = writeReviewQueue(entries);
writeJson('data/stats.json', {
  generatedAt: new Date().toISOString(),
  total: entries.length,
  approved: entries.filter((e) => e.status === 'approved').length,
  review: review.count,
  rejected: entries.filter((e) => e.status === 'rejected').length,
});

log(`rescored: ${entries.length} kept, ${dropped} dropped below the floor, ${review.count} awaiting review`);
