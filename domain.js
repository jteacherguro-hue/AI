(function (root) {
  'use strict';
  const TYPES = ['회의', '행사', '봉사', '기타'];
  const clean = value => String(value ?? '').trim();
  const length = value => Array.from(clean(value)).length;
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }
  function periodErrors(start, end, required = false) {
    const errors = {};
    if ((required || start) && !validDate(start)) errors.start = '시작일을 올바르게 입력해 주세요.';
    if ((required || end) && !validDate(end)) errors.end = '종료일을 올바르게 입력해 주세요.';
    if (!Object.keys(errors).length && start && end && start > end) errors.end = '시작일은 종료일보다 늦을 수 없습니다.';
    return errors;
  }
  function validateActivity(input) {
    const data = Object.fromEntries(['title', 'date', 'type', 'topic', 'description'].map(key => [key, clean(input[key])]));
    const errors = {};
    if (!data.title) errors.title = '활동명을 입력해 주세요.';
    else if (length(data.title) > 50) errors.title = '활동명은 50자 이내로 입력해 주세요.';
    if (!validDate(data.date)) errors.date = '활동 날짜를 올바르게 입력해 주세요.';
    if (!TYPES.includes(data.type)) errors.type = '활동 유형을 선택해 주세요.';
    if (length(data.topic) > 50) errors.topic = '안건·주제는 50자 이내로 입력해 주세요.';
    if (!data.description) errors.description = '활동 설명을 입력해 주세요.';
    else if (length(data.description) > 500) errors.description = '활동 설명은 500자 이내로 입력해 주세요.';
    return { data, errors };
  }
  function selectActivities(activities, filters = {}, ascending = false) {
    const query = clean(filters.query).toLocaleLowerCase();
    return activities.filter(a => (!filters.start || a.date >= filters.start) && (!filters.end || a.date <= filters.end) && (!filters.type || a.type === filters.type) && (!query || [a.title, a.topic, a.description].some(v => v.toLocaleLowerCase().includes(query))))
      .sort((a, b) => (a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)) * (ascending ? 1 : -1));
  }
  function toggleFeatured(activity, photoId) {
    if (!activity.photos.some(p => p.id === photoId)) throw new Error('사진을 찾을 수 없습니다.');
    if (activity.featured.includes(photoId)) return activity.featured.filter(id => id !== photoId);
    if (activity.featured.length >= 3) throw new Error('대표 사진은 최대 3장까지 선택할 수 있습니다.');
    return [...activity.featured, photoId];
  }
  const api = { TYPES, clean, length, validDate, periodErrors, validateActivity, selectActivities, toggleFeatured };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Moim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
