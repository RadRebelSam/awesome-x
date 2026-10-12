import { writeFileSync } from 'node:fs';
import { today } from './util.js';

const MAX_LISTED = 200;

// The review queue is the human-in-the-loop half of the pipeline: everything the
// crawler found interesting but not convincing lands here instead of in the list.
export function writeReviewQueue(entries, path = 'data/review-queue.md') {
  const queue = entries.filter((e) => e.status === 'review').sort((a, b) => b.score - a.score);
  const shown = queue.slice(0, MAX_LISTED);

  const lines = [
    '# Review queue',
    '',
    'Candidates that scored above the noise floor but below the auto-include threshold.',
    'Settle one by adding its id to `approve` or `reject` in `data/manual.json`.',
    '',
    `Generated ${today()} - ${queue.length} waiting${queue.length > shown.length ? `, showing the top ${shown.length}` : ''}.`,
    '',
  ];

  for (const entry of shown) {
    lines.push(
      `- **[${entry.name}](${entry.url})** - score ${entry.score} · ${entry.stars} stars`,
      `  - ${entry.description?.trim() || '_no description_'}`,
      `  - \`${entry.id}\` · ${entry.signals?.join(', ') || 'no signals'}`,
    );
  }

  writeFileSync(path, `${lines.join('\n')}\n`);
  return { count: queue.length };
}
