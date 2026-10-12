// Records the judge's verdicts for a batch.
// Usage: node tools/triage-apply.js <offset> <size> "0.96,0.92,0.31,..."
import { reviewQueue } from './lib/queue.js';
import { readJson, writeJson } from './lib/store.js';
import { log, today } from './lib/util.js';

const offset = Number(process.argv[2]);
const size = Number(process.argv[3]);
const values = (process.argv[4] || '').split(',').map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v));

const batch = reviewQueue().slice(offset, offset + size);
if (values.length !== batch.length) {
  throw new Error(`got ${values.length} probabilities for ${batch.length} repositories`);
}

const verdicts = readJson('data/triage.json', {});
let approve = 0;
let reject = 0;
let unsure = 0;

batch.forEach((entry, index) => {
  const noul = values[index];
  verdicts[entry.id] = { noul, judgedAt: today(), model: process.env.JUDGE_MODEL || 'judge' };
  if (noul >= 0.75) approve++;
  else if (noul <= 0.45) reject++;
  else unsure++;
});

writeJson('data/triage.json', verdicts);
log(`batch ${offset}: ${approve} clear, ${reject} rejected, ${unsure} borderline (${Object.keys(verdicts).length} judged so far)`);
