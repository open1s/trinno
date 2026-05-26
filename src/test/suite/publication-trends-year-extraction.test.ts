import * as assert from 'assert';

function extractYearCounts(results: Array<{ title: string; publishedDate?: string }>): Array<{ year: string; count: number }> {
  const yearCounts: Record<string, number> = {};
  for (const r of results) {
    const year = String(r.publishedDate || '').slice(0, 4);
    const validYear = /^(19\d{2}|20\d{2})$/.test(year) ? year : undefined;
    const m = validYear ? undefined : r.title?.match(/\b(19\d{2}|20\d{2})\b/);
    const found = validYear || (m?.[0]);
    if (found) {
      yearCounts[found] = (yearCounts[found] ?? 0) + 1;
    }
  }
  return Object.entries(yearCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, count]) => ({ year, count }));
}

describe('Year extraction for publication_trends', function () {

  it('extracts year from YYYY-MM-DD publishedDate', function () {
    const results = [
      { title: 'Some paper', publishedDate: '2023-04-15' },
      { title: 'Another paper', publishedDate: '2024-08-01' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [
      { year: '2023', count: 1 },
      { year: '2024', count: 1 },
    ]);
  });

  it('extracts year from YYYY publishedDate', function () {
    const results = [
      { title: 'Some paper', publishedDate: '2021' },
      { title: 'Another paper', publishedDate: '2021' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [{ year: '2021', count: 2 }]);
  });

  it('falls back to title regex when publishedDate is missing', function () {
    const results: Array<{ title: string; publishedDate?: string }> = [
      { title: 'Research in 2019', publishedDate: '' },
      { title: 'Study from 2020', publishedDate: '' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [
      { year: '2019', count: 1 },
      { year: '2020', count: 1 },
    ]);
  });

  it('prefers publishedDate over title regex', function () {
    const results = [
      { title: 'Research in 2019', publishedDate: '2022-01-01' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [{ year: '2022', count: 1 }]);
  });

  it('ignores invalid publishedDate and falls back to title', function () {
    const results = [
      { title: 'Study of 2020 technologies', publishedDate: 'invalid-date' },
      { title: 'Old research from 2018', publishedDate: '' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [
      { year: '2018', count: 1 },
      { year: '2020', count: 1 },
    ]);
  });

  it('handles empty results', function () {
    const trends = extractYearCounts([]);
    assert.deepStrictEqual(trends, []);
  });

  it('aggregates multiple results per year', function () {
    const results = [
      { title: 'Paper A', publishedDate: '2024-03-01' },
      { title: 'Paper B', publishedDate: '2024-06-15' },
      { title: 'Paper C', publishedDate: '2024-09-20' },
      { title: 'Paper D', publishedDate: '2023-11-01' },
    ];
    const trends = extractYearCounts(results);
    assert.deepStrictEqual(trends, [
      { year: '2023', count: 1 },
      { year: '2024', count: 3 },
    ]);
  });

});