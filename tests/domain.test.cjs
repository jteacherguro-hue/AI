const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain.js');
const activity = (id, date, createdAt, overrides = {}) => ({ id, date, createdAt, title: '정기 모임', type: '회의', topic: '총회 준비', description: '학기 활동을 돌아보았습니다.', photos: [], featured: [], ...overrides });

test('공백 제거와 필수값, 날짜, 글자 수를 검증한다', () => {
  const valid = D.validateActivity({ title: '  모임  ', date: '2026-11-26', type: '회의', topic: '  ', description: '  내용\n둘째 줄  ' });
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.data.title, '모임');
  assert.equal(valid.data.topic, '');
  assert.equal(valid.data.description, '내용\n둘째 줄');
  const invalid = D.validateActivity({ title: ' ', date: '2026-02-30', type: '임의', topic: '가'.repeat(51), description: '가'.repeat(501) });
  assert.deepEqual(Object.keys(invalid.errors), ['title', 'date', 'type', 'topic', 'description']);
  assert.ok(D.validateActivity({ ...valid.data, title: '가'.repeat(51) }).errors.title);
  assert.equal(D.validateActivity({ ...valid.data, title: '가'.repeat(50), description: '가'.repeat(500) }).errors.description, undefined);
});
test('실제 달력 날짜만 허용한다', () => {
  assert.equal(D.validDate('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-13-01', '2026-00-01', '26-01-01', '']) assert.equal(D.validDate(value), false);
});
test('목록의 열린 기간과 보고의 필수 기간, 역순 기간을 구분한다', () => {
  assert.deepEqual(D.periodErrors('', ''), {});
  assert.deepEqual(D.periodErrors('2026-01-01', ''), {});
  assert.deepEqual(D.periodErrors('', '2026-11-26'), {});
  assert.equal(Object.keys(D.periodErrors('', '', true)).length, 2);
  assert.equal(D.periodErrors('2026-11-26', '2026-11-25').end, '시작일은 종료일보다 늦을 수 없습니다.');
});
test('검색어·유형·기간은 AND 조건이며 양 끝 날짜를 포함한다', () => {
  const records = [activity('a', '2026-11-01', 1), activity('b', '2026-11-26', 2), activity('c', '2026-11-26', 3, { type: '행사' }), activity('d', '2026-10-31', 4)];
  assert.deepEqual(D.selectActivities(records, { query: '총회', type: '회의', start: '2026-11-01', end: '2026-11-26' }).map(a => a.id), ['b', 'a']);
  assert.equal(D.selectActivities(records, { query: '돌아보았습니다' }).length, 4);
  assert.equal(D.selectActivities(records, { query: '  정기  ' }).length, 4);
  assert.equal(D.selectActivities(records, { query: '없는 검색어' }).length, 0);
  assert.equal(D.selectActivities(records, { end: '2026-10-31' }).length, 1);
});
test('목록은 최신순, 보고는 과거순이며 같은 날짜의 등록 순서를 반영한다', () => {
  const records = [activity('a', '2026-11-01', 1), activity('b', '2026-11-01', 2), activity('c', '2026-11-02', 3)];
  assert.deepEqual(D.selectActivities(records).map(a => a.id), ['c', 'b', 'a']);
  assert.deepEqual(D.selectActivities(records, {}, true).map(a => a.id), ['a', 'b', 'c']);
  assert.deepEqual(records.map(a => a.id), ['a', 'b', 'c']);
});
test('대표 사진은 최대 3장이고 재선택 시 마지막에 배치한다', () => {
  let record = activity('a', '2026-11-01', 1, { photos: ['p1', 'p2', 'p3', 'p4'].map(id => ({ id })), featured: [] });
  for (const photoId of ['p2', 'p1', 'p3']) record.featured = D.toggleFeatured(record, photoId);
  assert.deepEqual(record.featured, ['p2', 'p1', 'p3']);
  assert.throws(() => D.toggleFeatured(record, 'p4'), /최대 3장/);
  assert.deepEqual(record.featured, ['p2', 'p1', 'p3']);
  record.featured = D.toggleFeatured(record, 'p2');
  record.featured = D.toggleFeatured(record, 'p2');
  assert.deepEqual(record.featured, ['p1', 'p3', 'p2']);
  assert.throws(() => D.toggleFeatured(record, 'missing'), /찾을 수/);
});
test('대표 사진 없는 활동도 보고 결과에서 제외되지 않는다', () => {
  const records = [activity('a', '2026-11-01', 1), activity('b', '2026-11-02', 2, { photos: [{ id: 'p1' }], featured: ['p1'] })];
  const report = D.selectActivities(records, { start: '2026-11-01', end: '2026-11-02' }, true);
  assert.equal(report.length, 2);
  assert.equal(report.filter(a => !a.featured.length).length, 1);
});
