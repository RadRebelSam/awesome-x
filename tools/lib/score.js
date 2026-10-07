// Relevance scoring. Two problems drive the design.
//
// 1. "jev" is a short, ambiguous token: it also means Japanese encephalitis virus
//    and is a common Slovenian surname. Anything tripping an exclusion rule is
//    dropped outright, whatever else it matched.
// 2. Mentioning a topic is not the same as being part of it. Every awesome-list
//    clone and every "models we support" table mentions it. Matches in the name,
//    description and topics therefore count full weight, while matches that only
//    appear in the readme are discounted.

const DEFAULT_README_FACTOR = 0.35;

function lower(parts) {
  return parts.filter(Boolean).join('\n').toLowerCase();
}

function countMatches(text, pattern) {
  if (!text) return 0;
  return (text.match(new RegExp(pattern, 'gi')) || []).length;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export function scoreEntry(entry, readme, config) {
  const meta = lower([entry.name, entry.description, (entry.topics || []).join(' '), entry.homepage]);
  const body = (readme || '').toLowerCase();
  const combined = `${meta}\n${body}`;
  const readmeFactor = config.budget?.readmeWeightFactor ?? DEFAULT_README_FACTOR;

  for (const rule of config.exclude || []) {
    if (countMatches(combined, rule.pattern) >= (rule.minHits ?? 1)) {
      return { score: -100, signals: [`excluded:${rule.name}`], excluded: true };
    }
  }

  const signals = [];
  let score = 0;

  for (const rule of config.signals || []) {
    const cap = rule.maxHits ?? 1;
    const metaHits = Math.min(countMatches(meta, rule.pattern), cap);
    const bodyHits = Math.min(countMatches(body, rule.pattern), cap);
    if (!metaHits && !bodyHits) continue;

    const points = round(rule.weight * metaHits + rule.weight * readmeFactor * bodyHits);
    score += points;
    signals.push(`${rule.name}${metaHits ? '' : '(readme)'}:+${points}`);
  }

  if (entry.isArchived) {
    score -= 3;
    signals.push('archived:-3');
  }
  if (entry.isFork) {
    score -= 3;
    signals.push('fork:-3');
  }
  if (!entry.description) {
    score -= 1;
    signals.push('no-description:-1');
  }

  return { score: round(score), signals, excluded: false };
}
