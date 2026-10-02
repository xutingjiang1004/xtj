'use strict';

// Scan one bounded page per tick. Retained legitimate objects must not hide
// newer orphans behind an eternal first page. Revisit failures on the next pass.
async function scanStorageOrphans({ store, lookup, remove, offset = 0, limit = 100, now = Date.now(), onError = () => {} }) {
  const listed = await store.list('', { limit, offset, sortBy: { column: 'created_at', order: 'asc' } });
  if (!listed || listed.error) throw new Error('orphan_listing_unavailable');
  const files = Array.isArray(listed.data) ? listed.data : [];
  let deleted = 0;
  for (const file of files) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.bin$/i.test(String(file.name)) ||
        !Number.isFinite(Date.parse(file.created_at)) || Date.parse(file.created_at) > now - 86400000) continue;
    try {
      const row = await lookup(file.name);
      if (!row) { await remove(file.name); deleted++; }
    } catch (error) { onError(error); }
  }
  return files.length < limit ? 0 : Math.max(0, offset + files.length - deleted);
}
module.exports = { scanStorageOrphans };
