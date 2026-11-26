/* 모임기록: 서버·외부 라이브러리 없이 동작하는 브라우저 앱 */
(() => {
  'use strict';
  const D = window.Moim;
  const app = document.querySelector('#app');
  const SAVE_ERROR = '저장하지 못했습니다. 브라우저 저장 공간과 설정을 확인해 주세요.';
  const PHOTO_ICON = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="9" width="34" height="30" rx="5"/><circle cx="17" cy="19" r="3"/><path d="m8 33 10-9 9 8 6-5 8 8"/></svg>';
  let db, activities = [], draft = null, busy = false, ready = false, toastTimer;
  let filters = { query: '', start: '', end: '', type: '' };
  let reportInput = { title: '활동 보고서', start: '', end: '' }, report = null;
  let urlCache = new WeakMap();
  const objectURLs = new Set();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const id = () => crypto.randomUUID();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dateLabel = value => value.replaceAll('-', '. ');
  const typeOptions = value => D.TYPES.map(t => `<option${value === t ? ' selected' : ''}>${t}</option>`).join('');
  function photoURL(photo) {
    if (!urlCache.has(photo.blob)) { const url = URL.createObjectURL(photo.blob); urlCache.set(photo.blob, url); objectURLs.add(url); }
    return urlCache.get(photo.blob);
  }
  function clearURLs() { objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs.clear(); urlCache = new WeakMap(); }
  window.addEventListener('beforeunload', clearURLs);
  function toast(message) { const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 5500); }
  function currentRoute() { return location.hash.slice(1) || 'list'; }
  function go(route) { if (currentRoute() === route) render(); else location.hash = route; }
  function findActivity(activityId) { return activities.find(a => a.id === activityId); }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const request = indexedDB.open('moim-record', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('activities', { keyPath: 'id' }); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); toast('저장소가 변경되었습니다. 새로고침해 주세요.'); }; resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => toast('다른 모임기록 탭을 닫고 새로고침해 주세요.');
    });
  }
  function readAll() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('activities', 'readonly');
      const request = tx.objectStore('activities').getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
  // 하나의 활동에 메타데이터와 Blob을 함께 보관하여 변경을 원자적으로 커밋한다.
  function commit(activity, removeId) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('activities', 'readwrite');
      const store = tx.objectStore('activities');
      if (removeId) store.delete(removeId); else store.put(activity);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function persist(activity, removeId) {
    await commit(activity, removeId);
    activities = removeId ? activities.filter(a => a.id !== removeId) : [...activities.filter(a => a.id !== activity.id), activity];
  }
  function confirmDelete(message) {
    return new Promise(resolve => {
      const dialog = document.querySelector('#confirm-dialog');
      document.querySelector('#confirm-message').textContent = message;
      dialog.returnValue = '';
      document.querySelector('#confirm-cancel').onclick = () => dialog.close('cancel');
      document.querySelector('#confirm-ok').onclick = () => dialog.close('delete');
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true });
      dialog.showModal();
      document.querySelector('#confirm-cancel').focus();
    });
  }
  function field(name, label, value = '', { type = 'text', optional = false, placeholder = '', extra = '' } = {}) {
    return `<div class="field"><label for="${name}">${label}<span class="${optional ? 'optional' : 'required'}">${optional ? '선택' : '*'}</span></label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${placeholder}" aria-describedby="${name}-error" ${extra}><p id="${name}-error" class="error" role="alert"></p></div>`;
  }
  function showErrors(form, errors) {
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.error').forEach(el => { el.textContent = ''; });
    Object.entries(errors).forEach(([key, message]) => { const input = form.elements.namedItem(key); if (input) input.setAttribute('aria-invalid', 'true'); const output = form.querySelector(`#${key}-error`); if (output) output.textContent = message; });
    const first = Object.keys(errors)[0];
    if (first) form.elements.namedItem(first)?.focus();
  }
  function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
  function heading(eyebrow, title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`; }
  function renderList() {
    const list = D.selectActivities(activities, filters);
    const photos = activities.reduce((sum, a) => sum + a.photos.length, 0);
    const missing = activities.filter(a => !a.featured.length).length;
    app.innerHTML = `${heading('우리 모임의 아카이브', '활동 기록', '활동의 순간을 모아, 총회 보고를 간편하게.', '<a class="button secondary" href="#report">서기 보고 만들기</a><a class="button" href="#new"><span class="plus" aria-hidden="true">+</span> 활동 추가</a>')}
      <div class="stats" aria-label="전체 기록 요약"><div class="stat"><div><p>전체 활동</p><strong>${activities.length}<span>개</span></strong></div><span class="stat-icon" aria-hidden="true">▤</span></div><div class="stat"><div><p>모아둔 사진</p><strong>${photos}<span>장</span></strong></div><span class="stat-icon" aria-hidden="true">▧</span></div><div class="stat"><div><p>대표 사진 필요</p><strong>${missing}<span>개</span></strong></div><span class="stat-icon" aria-hidden="true">☆</span></div></div>
      <form id="filter-form" class="panel filters" novalidate><div class="filter-grid">
      ${field('query', '검색어', filters.query, { optional: true, placeholder: '활동명·안건·설명 검색' })}
      ${field('start', '시작일', filters.start, { type: 'date', optional: true })}${field('end', '종료일', filters.end, { type: 'date', optional: true })}
      <div class="field"><label for="type">활동 유형</label><select name="type" id="type"><option value="">전체</option>${typeOptions(filters.type)}</select></div>
      <div class="filter-buttons"><button class="button" type="submit">조회</button><button class="button quiet" id="reset-filters" type="button">초기화</button></div></div></form>
      <div class="results-heading"><h2>활동 <span>${list.length}개</span></h2><span>최근 활동순</span></div>
      ${list.length ? `<div class="card-grid">${list.map(activityCard).join('')}</div>` : `<div class="empty"><div class="empty-icon">${PHOTO_ICON}</div><h2>${activities.length ? '조건에 맞는 활동이 없습니다.' : '아직 등록된 활동이 없습니다.'}</h2><p>${activities.length ? '검색어나 기간을 바꿔 다시 찾아보세요.' : '첫 활동을 기록해 보세요.<br>사진과 이야기를 모아두면, 보고 준비가 한결 가벼워집니다.'}</p>${activities.length ? '<button class="button secondary" id="empty-reset">필터 초기화</button>' : '<a class="button" href="#new"><span class="plus" aria-hidden="true">+</span> 활동 추가</a>'}</div>`}`;
    const reset = () => { filters = { query: '', start: '', end: '', type: '' }; renderList(); };
    document.querySelector('#reset-filters').onclick = reset;
    document.querySelector('#empty-reset')?.addEventListener('click', reset);
    document.querySelector('#filter-form').onsubmit = event => {
      event.preventDefault(); const data = formValues(event.currentTarget), errors = D.periodErrors(data.start, data.end);
      if (D.length(data.query) > 50) errors.query = '검색어는 50자 이내로 입력해 주세요.';
      showErrors(event.currentTarget, errors);
      if (!Object.keys(errors).length) { filters = data; renderList(); }
    };
  }
  function activityCard(a) {
    const cover = a.photos.find(p => p.id === a.featured[0]) || a.photos[0];
    const status = !a.photos.length ? '사진 없음' : !a.featured.length ? '대표 미선택' : '보고 준비 완료';
    return `<a class="activity-card" href="#detail/${a.id}" aria-label="${esc(a.title)} 상세 보기"><div class="cover">${cover ? `<img src="${photoURL(cover)}" alt="${esc(a.title)} 표지" loading="lazy">` : `<div class="cover-placeholder">${PHOTO_ICON}<span>사진을 기다리고 있어요</span></div>`}<span class="badge ${a.featured.length ? 'ready' : 'warning'}">${status}</span></div><div class="card-body"><span class="badge">${esc(a.type)}</span><h3>${esc(a.title)}</h3><p class="card-date">${dateLabel(a.date)}</p><div class="card-bottom"><span>사진 ${a.photos.length}장</span><span>대표 ${a.featured.length}/3</span></div></div></a>`;
  }
  function renderEditor(activityId, origin) {
    const existing = findActivity(activityId);
    if (activityId && !existing) return notFound();
    const previous = existing ? `detail/${activityId}${origin ? '/report' : ''}` : 'list';
    draft = { ...(existing || { title: '', date: today(), type: '회의', topic: '', description: '', featured: [] }), photos: [...(existing?.photos || [])], featured: [...(existing?.featured || [])] };
    const oldIDs = new Set(existing?.photos.map(p => p.id) || []);
    app.innerHTML = `<div class="editor"><a class="back-link" href="#${previous}">취소하고 돌아가기</a>${heading('활동의 순간을 남겨요', existing ? '활동 수정' : '활동 추가', '사진이 없어도 괜찮아요. 활동 이야기부터 기록해 보세요.')}<form id="activity-form" class="panel form-stack" novalidate>
      ${field('title', '활동명', draft.title, { placeholder: '예: 2학기 첫 정기 모임', extra: 'autocomplete="off"' })}
      <div class="form-row">${field('date', '활동 날짜', draft.date, { type: 'date' })}<div class="field"><label for="type">활동 유형<span class="required">*</span></label><select id="type" name="type" aria-describedby="type-error">${typeOptions(draft.type)}</select><p class="error" id="type-error" role="alert"></p></div></div>
      ${field('topic', '안건·주제', draft.topic, { optional: true, placeholder: '함께 나눈 주제를 적어주세요 (최대 50자)' })}
      <div class="field"><label for="description">활동 설명<span class="required">*</span></label><textarea id="description" name="description" placeholder="어떤 활동을 했나요? 보고에 담을 내용을 기록해 주세요." aria-describedby="description-error description-count">${esc(draft.description)}</textarea><div class="field-meta"><span>입력한 내용 그대로 보고서에 담겨요.</span><span id="description-count">${D.length(draft.description)} / 500자</span></div><p class="error" id="description-error" role="alert"></p></div>
      <div><div class="field-label">활동 사진<span class="optional">선택</span></div><div class="upload-box"><label class="button secondary" for="photos">＋ 사진 선택</label><input class="file-input" id="photos" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple><p>JPG·PNG / 한 장 최대 5MB / 활동당 최대 20장</p><span class="small muted">사진은 나중에 추가할 수 있습니다.</span></div><ul class="file-errors" id="file-errors" aria-live="polite"></ul><div class="draft-grid" id="draft-photos"></div><p class="small muted" id="photo-count"></p></div>
      <p id="save-error" class="error" role="alert"></p><div class="actions form-footer"><button class="button secondary" type="button" id="cancel-edit">취소</button><button class="button" id="save-activity" type="submit">저장</button></div></form></div>`;
    const form = document.querySelector('#activity-form');
    const saveButton = document.querySelector('#save-activity');
    const photoInput = document.querySelector('#photos');
    let uploadRunning = false;
    document.querySelector('#cancel-edit').onclick = () => go(previous);
    document.querySelector('#description').oninput = e => { document.querySelector('#description-count').textContent = `${D.length(e.target.value)} / 500자`; };
    const renderDraftPhotos = () => {
      document.querySelector('#draft-photos').innerHTML = draft.photos.map(p => `<div class="draft-photo"><img src="${photoURL(p)}" alt="${esc(p.name)}"><button type="button" data-remove="${p.id}" aria-label="${esc(p.name)} 빼기">빼기</button></div>`).join('');
      document.querySelector('#photo-count').textContent = draft.photos.length ? `선택한 사진 ${draft.photos.length} / 20장` : '';
      document.querySelectorAll('[data-remove]').forEach(button => { button.onclick = async () => {
        if (busy || uploadRunning) return;
        const photoId = button.dataset.remove;
        if (oldIDs.has(photoId) && !await confirmDelete('이 사진을 삭제할까요? 저장하면 삭제가 반영됩니다.')) return;
        draft.photos = draft.photos.filter(p => p.id !== photoId); draft.featured = draft.featured.filter(p => p !== photoId); renderDraftPhotos();
        photoInput.focus();
      }; });
    };
    renderDraftPhotos();
    photoInput.onchange = async () => {
      const files = Array.from(photoInput.files), errors = [], editorDraft = draft;
      photoInput.value = '';
      if (files.length + draft.photos.length > 20) errors.push('한 활동에는 사진을 최대 20장까지 등록할 수 있습니다. 이번에 선택한 묶음은 추가하지 않았습니다.');
      else {
        uploadRunning = true; saveButton.disabled = true; photoInput.disabled = true;
        for (const file of files) {
          let reason = '';
          if (!['image/jpeg', 'image/png'].includes(file.type)) reason = 'JPG 또는 PNG 사진만 등록할 수 있습니다.';
          else if (file.size > 5 * 1024 * 1024) reason = '사진 한 장은 5MB 이하여야 합니다.';
          else {
            try { await verifyImage(file); editorDraft.photos.push({ id: id(), name: file.name, blob: file, createdAt: Date.now() }); }
            catch { reason = '사진을 불러올 수 없습니다. 다른 파일을 선택해 주세요.'; }
          }
          if (reason) errors.push(`${file.name}: ${reason}`);
        }
        uploadRunning = false; saveButton.disabled = false; photoInput.disabled = false;
      }
      if (draft !== editorDraft || !form.isConnected) return;
      document.querySelector('#file-errors').innerHTML = errors.map(e => `<li>${esc(e)}</li>`).join(''); renderDraftPhotos();
    };
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || uploadRunning) return;
      const { data, errors } = D.validateActivity(formValues(form)); showErrors(form, errors);
      if (Object.keys(errors).length) return;
      busy = true; saveButton.disabled = true; saveButton.textContent = '저장 중…';
      form.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = true; });
      const record = { ...draft, ...data, id: existing?.id || id(), createdAt: existing?.createdAt || Math.max(Date.now(), ...activities.map(a => a.createdAt + 1)), updatedAt: Date.now() };
      try { await persist(record); draft = null; go(`detail/${record.id}${origin ? '/report' : ''}`); toast('활동을 저장했습니다.'); }
      catch { document.querySelector('#save-error').textContent = SAVE_ERROR; }
      finally { busy = false; form.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = false; }); saveButton.textContent = '저장'; }
    };
  }
  async function verifyImage(file) {
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
    if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png)) throw new Error('invalid image');
    const url = URL.createObjectURL(file);
    try { await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth > 0 ? resolve() : reject(); image.onerror = reject; image.src = url; }); }
    finally { URL.revokeObjectURL(url); }
  }
  function renderDetail(activityId, origin) {
    const a = findActivity(activityId); if (!a) return notFound();
    app.innerHTML = `<a class="back-link" href="#list">목록으로</a>${origin ? '<a class="button secondary no-print" href="#report" style="margin-left:16px">보고 화면으로 돌아가기</a>' : ''}<div class="page-heading detail-heading"><div><div class="eyebrow">${esc(a.type)} 기록</div><h1>${esc(a.title)}</h1><p>${dateLabel(a.date)} · 사진 ${a.photos.length}장</p></div><div class="actions"><a class="button secondary" href="#edit/${a.id}${origin ? '/report' : ''}">수정</a><button class="button danger" id="delete-activity">활동 삭제</button></div></div>
      <section class="panel detail-info" aria-label="활동 내용">${a.topic ? `<div class="topic"><strong>안건·주제</strong> · ${esc(a.topic)}</div>` : ''}<p class="prose">${esc(a.description)}</p></section>
      <section class="photo-section"><div class="results-heading"><h2>활동 사진 <span>${a.photos.length}장</span></h2><span class="badge ready">대표 사진 ${a.featured.length}/3</span></div><p class="muted small" style="margin-bottom:16px">보고에 담을 사진을 최대 3장 선택하세요. 첫 번째로 선택한 사진이 표지가 됩니다.</p><p id="detail-error" class="error" role="alert"></p>
      ${a.photos.length ? `<div class="photo-grid">${a.photos.map(p => `<article class="photo-card ${a.featured.includes(p.id) ? 'selected' : ''}"><button class="photo-open" data-open="${p.id}" aria-label="${esc(p.name)} 확대"><img src="${photoURL(p)}" alt="${esc(p.name)}">${a.featured.includes(p.id) ? `<span class="badge ready">대표 ${a.featured.indexOf(p.id) + 1}</span>` : ''}</button><div class="photo-controls"><label><input type="checkbox" data-feature="${p.id}" ${a.featured.includes(p.id) ? 'checked' : ''}>대표로 선택</label><button class="text-danger" data-delete-photo="${p.id}">사진 삭제</button></div></article>`).join('')}</div>` : `<div class="empty"><div class="empty-icon">${PHOTO_ICON}</div><h2>아직 사진이 없습니다.</h2><p>활동의 순간을 사진으로 함께 남겨보세요.</p><a class="button secondary" href="#edit/${a.id}${origin ? '/report' : ''}">사진 추가하기</a></div>`}</section>`;
    const update = async (next, focusPhoto) => {
      if (busy) return; busy = true;
      app.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
      try { await persist(next); renderDetail(activityId, origin); if (focusPhoto) app.querySelector(`[data-feature="${focusPhoto}"]`)?.focus(); }
      catch { renderDetail(activityId, origin); document.querySelector('#detail-error').textContent = SAVE_ERROR; if (focusPhoto) app.querySelector(`[data-feature="${focusPhoto}"]`)?.focus(); }
      finally { busy = false; }
    };
    document.querySelectorAll('[data-feature]').forEach(input => { input.onchange = async () => {
      if (busy) { input.checked = a.featured.includes(input.dataset.feature); return; }
      try { const featured = D.toggleFeatured(a, input.dataset.feature); await update({ ...a, featured }, input.dataset.feature); }
      catch (error) { input.checked = a.featured.includes(input.dataset.feature); document.querySelector('#detail-error').textContent = error.message; }
    }; });
    document.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => {
      const photo = a.photos.find(p => p.id === button.dataset.open), lightbox = document.querySelector('#lightbox');
      lightbox.querySelector('img').src = photoURL(photo); lightbox.querySelector('img').alt = photo.name; lightbox.querySelector('p').textContent = photo.name;
      lightbox.showModal(); lightbox.querySelector('button').focus();
    }; });
    document.querySelectorAll('[data-delete-photo]').forEach(button => { button.onclick = async () => {
      if (busy || !await confirmDelete('이 사진을 삭제할까요?')) return;
      const photoId = button.dataset.deletePhoto;
      await update({ ...a, photos: a.photos.filter(p => p.id !== photoId), featured: a.featured.filter(p => p !== photoId) });
      app.querySelector('.photo-open, .photo-section a')?.focus();
    }; });
    document.querySelector('#delete-activity').onclick = async () => {
      if (busy || !await confirmDelete('이 활동과 등록된 사진을 모두 삭제할까요?')) return;
      busy = true;
      try { await persist(null, activityId); go(origin ? 'report' : 'list'); toast('활동을 삭제했습니다.'); }
      catch { document.querySelector('#detail-error').textContent = SAVE_ERROR; }
      finally { busy = false; }
    };
  }
  function renderReport() {
    app.innerHTML = `${heading('기록을 한눈에, 보고를 간편하게', '서기 보고', '기간을 선택하면 활동 이야기와 대표 사진이 한자리에 모입니다.', '<a class="button secondary" href="#list">목록으로</a>')}
      <form id="report-form" class="panel report-settings no-print" novalidate>${field('title', '보고 제목', reportInput.title)}${field('start', '시작일', reportInput.start, { type: 'date' })}${field('end', '종료일', reportInput.end, { type: 'date' })}<button class="button" type="submit">보고 보기</button></form><div id="report-result"></div>`;
    const form = document.querySelector('#report-form');
    form.oninput = () => { reportInput = formValues(form); };
    form.onsubmit = event => {
      event.preventDefault(); reportInput = formValues(form);
      const errors = {};
      if (!D.clean(reportInput.title)) errors.title = '보고 제목을 입력해 주세요.';
      else if (D.length(reportInput.title) > 60) errors.title = '보고 제목은 60자 이내로 입력해 주세요.';
      Object.assign(errors, D.periodErrors(reportInput.start, reportInput.end, true));
      showErrors(form, errors);
      if (Object.keys(errors).length) return;
      report = { ...reportInput, title: D.clean(reportInput.title) }; renderReportResult();
    };
    renderReportResult();
  }
  function renderReportResult() {
    const result = document.querySelector('#report-result');
    document.body.classList.toggle('report-visible', Boolean(report));
    if (!report) { result.innerHTML = `<div class="empty no-print"><div class="empty-icon">${PHOTO_ICON}</div><h2>어떤 순간들을 모아볼까요?</h2><p>보고 제목과 시작일·종료일을 입력하고<br>‘보고 보기’를 눌러 주세요.</p></div>`; return; }
    const list = D.selectActivities(activities, report, true), missing = list.filter(a => !a.featured.length).length;
    result.innerHTML = `<div class="report-tools no-print"><div><strong>활동 ${list.length}개 · 대표 사진이 없는 활동 ${missing}개</strong><p>PDF 파일이 필요하면 인쇄창에서 PDF 저장을 선택하세요.</p></div><button class="button" id="print-report" ${list.length ? '' : 'disabled'}>인쇄 / PDF 저장</button></div>
      ${!list.length ? '<div class="empty"><h2>선택한 기간에 활동이 없습니다.</h2><p>보고 기간을 변경해 다시 확인해 주세요.</p></div>' : `<article class="report-paper"><header class="report-heading"><p class="eyebrow">모임기록 · 서기 보고</p><h2>${esc(report.title)}</h2><p>${dateLabel(report.start)} ~ ${dateLabel(report.end)} · 총 활동 ${list.length}개</p></header>${list.map(a => `<section class="report-activity"><h3>${esc(a.title)}</h3><div class="report-meta"><time datetime="${a.date}">${dateLabel(a.date)}</time><span class="badge">${a.type}</span></div>${a.topic ? `<div class="topic"><strong>안건·주제</strong> · ${esc(a.topic)}</div>` : ''}<p class="prose">${esc(a.description)}</p>${a.featured.length ? `<div class="report-photos">${a.featured.map(photoId => a.photos.find(p => p.id === photoId)).filter(Boolean).map(p => `<figure><img src="${photoURL(p)}" alt="${esc(a.title)} 대표 사진: ${esc(p.name)}"></figure>`).join('')}</div>` : `<div class="missing-photo"><span>대표 사진이 없습니다.</span><a class="button secondary no-print" href="#detail/${a.id}/report">사진 선택하러 가기</a></div>`}</section>`).join('')}</article>`}`;
    document.querySelector('#print-report').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      await Promise.all([...result.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
      window.print(); button.disabled = false;
    };
  }
  function notFound() { app.innerHTML = '<div class="empty"><h1>활동을 찾을 수 없습니다.</h1><p>삭제되었거나 주소가 변경된 기록입니다.</p><a class="button" href="#list">목록으로</a></div>'; }
  function render() {
    if (!ready) return;
    const [page, activityId, origin] = currentRoute().split('/');
    draft = null; clearURLs(); document.body.classList.remove('report-visible');
    document.querySelector('#nav-list').toggleAttribute('aria-current', page !== 'report' && origin !== 'report');
    document.querySelector('#nav-report').toggleAttribute('aria-current', page === 'report' || origin === 'report');
    document.querySelectorAll('nav [aria-current]').forEach(el => el.setAttribute('aria-current', 'page'));
    if (page === 'new') renderEditor();
    else if (page === 'edit') renderEditor(activityId, origin);
    else if (page === 'detail') renderDetail(activityId, origin);
    else if (page === 'report') renderReport();
    else renderList();
    document.title = `${({ new: '활동 추가', edit: '활동 수정', detail: findActivity(activityId)?.title || '활동 상세', report: '서기 보고' })[page] || '활동 기록'} · 모임기록`;
    app.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  document.querySelector('.lightbox-close').onclick = () => document.querySelector('#lightbox').close();
  window.addEventListener('hashchange', render);
  async function boot() {
    try { db = await openDatabase(); activities = await readAll(); ready = true; render(); }
    catch { app.innerHTML = `<div class="empty boot-error"><h1>기록 저장소를 열지 못했습니다.</h1><p>브라우저의 저장 공간과 사이트 데이터 설정을 확인해 주세요.</p><button id="retry" class="button">다시 시도</button></div>`; document.querySelector('#retry').onclick = () => location.reload(); }
  }
  boot();
})();
