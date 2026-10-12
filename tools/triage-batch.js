// Emits one batch of review-queue candidates as a state document for the judge.
// Usage: node tools/triage-batch.js <offset> <size>
import { reviewQueue } from './lib/queue.js';

const offset = Number(process.argv[2] ?? 0);
const size = Number(process.argv[3] ?? 40);
const queue = reviewQueue();

const repos = queue.slice(offset, offset + size).map((entry, index) => ({
  ref: index,
  name: entry.name,
  description: (entry.description || '').slice(0, 150) || null,
  topics: (entry.topics || []).slice(0, 6),
  readme: (entry.readmeExcerpt || '').replace(/\s+/g, ' ').slice(0, 260) || null,
}));

console.error(`batch ${offset}..${offset + repos.length - 1} of ${queue.length}`);
console.log(JSON.stringify({ repos }));
