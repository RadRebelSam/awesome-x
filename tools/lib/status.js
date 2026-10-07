// Shared decision table so fetch.js and rescore.js can never drift apart.
export function decideStatus(entry, scored, manual, config) {
  const t = config.thresholds;
  if (manual.reject?.includes(entry.id)) return 'rejected';
  if (manual.approve?.includes(entry.id)) return 'approved';
  if (scored.excluded) return 'rejected';

  const stars = entry.stars ?? 0;
  const trusted = scored.score >= (t.trustedScore ?? Infinity);

  // A high enough score carries a project on its own. Everything else has to
  // clear a small popularity floor, which keeps the list free of the one-commit
  // repositories that a hot ecosystem produces by the hundred.
  if (scored.score >= t.autoInclude && (trusted || stars >= (t.autoIncludeMinStars ?? 0))) {
    return 'approved';
  }
  if (scored.score >= t.needsReview) return 'review';
  return 'ignored';
}
