export function categorize(entry, readme, config) {
  const name = (entry.name || '').toLowerCase();
  const text = [entry.name, entry.description, (entry.topics || []).join(' '), readme || '']
    .join('\n')
    .toLowerCase();

  for (const category of config.categories) {
    for (const pattern of category.matchName || []) {
      if (new RegExp(pattern, 'i').test(name)) return category.id;
    }
    for (const pattern of category.match || []) {
      if (new RegExp(pattern, 'i').test(text)) return category.id;
    }
  }
  return config.defaultCategory || 'other';
}
