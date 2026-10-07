// Folds the judge's verdicts into data/manual.json. Anything it was unsure about stays
// in the review queue for a human, which is the whole point of keeping the file.
import { readJson, writeJson, loadRegistry } from './lib/store.js';
import { log } from './lib/util.js';

const TOPIC = process.env.TOPIC || 'example';
const judge = readJson(`topics/${TOPIC}.json`).judge ?? {};

// Where the judge's probability is decisive in each direction. The band between
// them is what a human looks at, so widening it buys accuracy with your time.
const APPROVE_AT = judge.listAt ?? 0.75;
const REJECT_AT = judge.rejectAt ?? 0.45;
// Entries the crawler already put on the list are only pulled back off when the judge
// disagrees decisively. A terse readme can score low without the project being
// wrong for the list, and the crawler had other evidence.
const DEMOTE_AT = 0.25;

const verdicts = readJson('data/triage.json', {});
const manual = readJson('data/manual.json', { approve: [], reject: [], pinned: [], overrides: {} });
const { byId } = loadRegistry('data/registry.json');

const approve = new Set(manual.approve ?? []);
const reject = new Set(manual.reject ?? []);
let unsure = 0;
let kept = 0;

for (const [id, verdict] of Object.entries(verdicts)) {
  if (verdict.noul >= APPROVE_AT) {
    approve.add(id);
    reject.delete(id);
  } else if (verdict.noul <= REJECT_AT) {
    const listedByCrawler = byId.get(id)?.status === 'approved' && !approve.has(id);
    if (listedByCrawler && verdict.noul > DEMOTE_AT) {
      kept++;
      continue;
    }
    reject.add(id);
    approve.delete(id);
  } else {
    unsure++;
  }
}

manual.approve = [...approve].sort();
manual.reject = [...reject].sort();
writeJson('data/manual.json', manual);

log(
  `merged: ${manual.approve.length} approved, ${manual.reject.length} rejected, ${unsure} left for a human, ` +
    `${kept} crawler entries kept despite a low verdict`,
);
