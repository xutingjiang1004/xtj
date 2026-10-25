'use strict';
function parseStatisticsRange(query = {}) {
  const range = {};
  for (const name of ['start', 'end']) {
    const value = query[name];
    if (value === undefined || value === '') { range[name] = null; continue; }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') ||
        !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0,10) !== value) {
      throw Object.assign(Error('请选择有效的统计日期'), { status: 400 });
    }
    range[name] = value;
  }
  if (range.start && range.end && range.start > range.end) throw Object.assign(Error('开始日期不能晚于结束日期'), { status: 400 });
  return range;
}
async function readStatistics(db, range) {
  const result = await db.rpc('admin_statistics', { p_start: range.start, p_end: range.end });
  if (!result || result.error || !result.data || !result.data.summary || !Array.isArray(result.data.daily)) throw result?.error || Error('statistics_unavailable');
  return result.data;
}
module.exports = { parseStatisticsRange, readStatistics };
