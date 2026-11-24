/* Tray Rater · 패킹 수력 계산 페이지
 *
 * 입력: PackingDesign JSON (tray_rater/packing/design.py) - 계산 설정 + 로딩 열(최대 10)
 * API : GET /api/packing/catalog, GET /api/packing/example, POST /api/packing/evaluate, POST /api/packing/report/<fmt>
 * 입력은 브라우저 localStorage 에 임시 저장 (Tray 설계와 다른 키).
 */
(function () {
  'use strict';

  const KEY = 'trayRater.packingDraft.v1';
  const MAX_LOADINGS = 10;

  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  };
  const icon = name => el('i', { 'data-lucide': name });
  const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  function fmt(v) {
    if (!isNum(v)) return v === null || v === undefined ? '' : String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    const d = a >= 1000 ? 1 : a >= 1 ? 3 : 4;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const fmtN = (v, d) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');

  // ---------------------------------------------------------------- 로딩 표 행
  // unit: [Metric, English] (입력 단위 = INPUT P7)
  const ROWS = [
    { group: '로딩', icon: 'tag' },
    { key: 'name', label: 'Loading', type: 'text' },
    { key: 'section', label: 'Section', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'comment', label: 'Comment', type: 'text' },
    { group: '증기', icon: 'cloud' },
    { key: 'vapor_rate', label: '증기 유량', unit: ['kg/hr', 'lb/hr'], need: true },
    { key: 'vapor_density', label: '증기 밀도', unit: ['kg/m3', 'lb/ft3'], need: true },
    { key: 'vapor_viscosity', label: '증기 점도', unit: ['cP', 'cP'] },
    { group: '액체', icon: 'droplets' },
    { key: 'liquid_rate', label: '액 유량', unit: ['kg/hr', 'lb/hr'], need: true },
    { key: 'liquid_density', label: '액 밀도', unit: ['kg/m3', 'lb/ft3'], need: true },
    { key: 'surface_tension', label: '표면장력', unit: ['dyne/cm', 'dyne/cm'], need: true },
    { key: 'liquid_viscosity', label: '액 점도', unit: ['cP', 'cP'], need: true },
    { group: '탑', icon: 'cylinder' },
    { key: 'system_factor', label: 'System factor', sub: '보통 1.0' },
    { key: 'column_id', label: 'Column ID', unit: ['mm', 'ft'], need: true },
    { key: 'packing_height', label: '패킹 높이', unit: ['m', 'ft'], sub: '보고서 표시용' },
    { group: '패킹', icon: 'layers' },
    { key: 'packing_id', label: '패킹', type: 'packing' },
    { key: 'pf_multiplier', label: 'PF 배수', sub: '랜덤 패킹, 0.5~2', family: 'random' },
    { key: 'special_pf', label: '특수 패킹 PF', sub: 'ID 499, 수정 옵션 P3', only: 499 },
    { key: 'inc_angle_override', label: '경사각 override', unit: ['deg', 'deg'], sub: '정형 패킹, 30~90', family: 'structured' },
    { key: 'thickness_override', label: '두께 override', unit: ['mm', 'mm'], sub: '정형 패킹, 수정 옵션 P2', family: 'structured' },
  ];

  // ---------------------------------------------------------------- 상태
  let catalog = null;
  let design = null;
  let result = null;
  let fixes = [];
  let busy = false;

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function saveDraft() {
    try { localStorage.setItem(KEY, JSON.stringify({ design, fixes })); } catch (e) { /* 저장 불가 */ }
  }

  function toast(msg, isError) {
    const t = $('#toast');
    t.replaceChildren(icon(isError ? 'circle-x' : 'circle-check'), el('span', { text: msg }));
    t.classList.toggle('is-error', !!isError);
    t.hidden = false;
    refreshIcons();
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  const packingById = id => (catalog ? catalog.packings.find(p => p.id === Number(id)) : null);
  const english = () => Number(design.input_unit) === 2;
  function loadings() {
    if (!Array.isArray(design.loadings)) design.loadings = [];
    return design.loadings;
  }
  function isActive(ld) {
    return ld && Number(ld.vapor_rate) > 0 && Number(ld.column_id) > 0;
  }
  function visibleCount() {
    const lds = loadings();
    let n = 0;
    lds.forEach((ld, i) => { if (ld && Object.keys(ld).length) n = i + 1; });
    return Math.max(1, n);
  }

  // ---------------------------------------------------------------- 계산 설정
  function setSeg(id, value) {
    document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === String(value))));
  }
  function renderSettings() {
    setSeg('in-unit', Number(design.input_unit) === 2 ? 2 : 1);
    setSeg('out-unit', String(design.output_unit || 'M').toUpperCase() === 'E' ? 'E' : 'M');
    $('#cap-model').value = String(design.cap_model ?? 4);
    $('#cap-model-rnd').value = String(design.cap_model_rnd ?? 1);
    $('#max-rate').value = design.max_rate ?? '';
    $('#min-rate').value = design.min_rate ?? '';
    renderFixes();
  }
  function renderFixes() {
    const list = $('#fix-list');
    list.replaceChildren(...catalog.fixes.map(f => {
      const id = `fix-${f.name}`;
      const cb = el('input', { type: 'checkbox', id, checked: fixes.includes(f.name) });
      cb.addEventListener('change', () => {
        fixes = cb.checked ? [...new Set([...fixes, f.name])] : fixes.filter(x => x !== f.name);
        saveDraft();
      });
      return el('label', { class: 'pk-fix', for: id }, cb,
        el('span', {}, el('span', { class: 'fix-code', text: f.code }), f.text,
          f.recommended ? el('span', { class: 'badge badge--muted', text: '추천' }) : null));
    }));
  }

  // ---------------------------------------------------------------- 로딩 표
  function packingSelect(ld, i) {
    const sel = el('select', { class: 'input', 'aria-label': `L${i + 1} 패킹` });
    sel.append(el('option', { value: '', text: '선택' }));
    for (const t of catalog.types) {
      const og = el('optgroup', { label: t.name });
      catalog.packings.filter(p => p.type === t.id).forEach(p => og.append(el('option', { value: p.id, text: p.name })));
      sel.append(og);
    }
    sel.value = ld.packing_id ?? '';
    sel.addEventListener('change', () => {
      const p = packingById(sel.value);
      if (p) { ld.packing_id = p.id; ld.packing_type = p.type; } else { delete ld.packing_id; delete ld.packing_type; }
      saveDraft();
      renderTable();
    });
    return sel;
  }

  function cellInput(row, ld, i) {
    if (row.type === 'packing') return packingSelect(ld, i);
    const p = packingById(ld.packing_id);
    const fam = p ? p.family : null;
    const disabled = (row.family && fam && fam !== row.family && !(row.family === 'structured' && fam === 'grid'))
      || (row.only && Number(ld.packing_id) !== row.only);
    const isText = row.type === 'text';
    const inp = el('input', {
      class: isText ? 'input' : 'input num', type: isText ? 'text' : 'number', step: 'any',
      inputmode: isText ? null : 'decimal', 'aria-label': `L${i + 1} ${row.label}`, disabled: !!disabled,
      placeholder: disabled ? '–' : (row.key === 'system_factor' ? '1' : ''),
    });
    inp.value = ld[row.key] ?? '';
    inp.addEventListener('change', () => {
      const raw = inp.value.trim();
      if (raw === '') delete ld[row.key];
      else ld[row.key] = isText ? raw : Number(raw);
      inp.classList.toggle('is-error', row.need && raw !== '' && !(Number(raw) > 0) && row.key !== 'liquid_rate');
      saveDraft();
      updateMeta();
    });
    return inp;
  }

  function renderTable() {
    const lds = loadings();
    const n = visibleCount();
    while (lds.length < n) lds.push({});
    const unitIdx = english() ? 1 : 0;
    const head = el('tr', {}, el('th', { class: 'rowhead', scope: 'col', text: '' }));
    for (let i = 0; i < n; i++) {
      const ld = lds[i];
      const p = packingById(ld.packing_id);
      head.append(el('th', { scope: 'col', class: isActive(ld) ? '' : 'col-inactive' },
        el('div', { class: 'col-head' },
          el('div', { class: 'col-head__top' },
            el('span', { class: 'col-head__name', text: `L${i + 1}` }),
            p ? el('span', { class: `badge ${p.family === 'random' ? 'badge--warning' : 'badge--navy'}`,
                             text: p.family === 'random' ? '랜덤' : p.family === 'grid' ? 'Grid' : '정형' }) : null,
            el('span', { class: 'col-head__tools' },
              n > 1 ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': `L${i + 1} 지우기`,
                                     onclick: () => removeLoading(i) }, icon('trash-2')) : null)))));
    }
    const body = el('tbody');
    for (const row of ROWS) {
      if (row.group) {
        body.append(el('tr', { class: 'group' }, el('th', { colspan: n + 1 },
          el('span', { class: 'group__title' }, icon(row.icon), row.group))));
        continue;
      }
      const tr = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' },
        el('span', { class: 'rowhead__label', text: row.label }),
        row.unit ? el('span', { class: 'unit', text: row.unit[unitIdx] }) : null,
        row.sub ? el('span', { class: 'rowhead__sub', text: row.sub }) : null));
      for (let i = 0; i < n; i++) {
        tr.append(el('td', { class: isActive(lds[i]) ? '' : 'col-inactive' }, cellInput(row, lds[i], i)));
      }
      body.append(tr);
    }
    $('#load-table').replaceChildren(el('thead', {}, head), body);
    $('#btn-add').disabled = n >= MAX_LOADINGS;
    updateMeta();
    refreshIcons();
  }

  function updateMeta() {
    const lds = loadings();
    const act = lds.filter(isActive).length;
    $('#load-meta').textContent = `계산할 로딩 ${act}개 · 열 ${visibleCount()}/${MAX_LOADINGS}`;
  }

  function addLoading() {
    const lds = loadings();
    const n = visibleCount();
    if (n >= MAX_LOADINGS) return;
    const prev = lds[n - 1] || {};
    const copy = Object.assign({}, prev, { name: `L${n + 1}` });
    lds[n] = copy;
    saveDraft();
    renderTable();
  }
  function removeLoading(i) {
    loadings().splice(i, 1);
    saveDraft();
    renderTable();
  }

  // ---------------------------------------------------------------- 계산
  function body(extra) {
    const d = JSON.parse(JSON.stringify(design));
    d.loadings = loadings().slice(0, MAX_LOADINGS).map(ld => {
      const o = {};
      for (const [k, v] of Object.entries(ld || {})) if (v !== '' && v !== null && v !== undefined) o[k] = v;
      return o;
    });
    while (d.loadings.length && !Object.keys(d.loadings[d.loadings.length - 1]).length) d.loadings.pop();
    return JSON.stringify(Object.assign({ design: d, fixes }, extra || {}));
  }

  async function run() {
    if (busy) return;
    busy = true;
    $('#btn-run').disabled = true;
    $('#results').replaceChildren(el('div', { class: 'card pk-progress' }, icon('loader-circle'),
      el('span', { text: '계산하고 있습니다…' })));
    refreshIcons();
    try {
      const res = await fetch('/api/packing/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(),
      });
      result = await res.json();
      renderResults();
    } catch (e) {
      result = { ok: false, messages: [`계산 요청 실패: ${e}`] };
      renderResults();
    } finally {
      busy = false;
      $('#btn-run').disabled = false;
    }
  }

  async function exportFile(fmtName) {
    try {
      const res = await fetch(`/api/packing/report/${fmtName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j.messages || [res.statusText]).join(' '));
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const name = m ? decodeURIComponent(m[1]) : `packing.${fmtName}`;
      const blob = await res.blob();
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      toast(`${name} 저장`);
    } catch (e) {
      toast(`보고서를 만들 수 없습니다: ${e.message || e}`, true);
    }
  }

  // ---------------------------------------------------------------- 결과
  function alertBox(kind, ico, text) {
    return el('div', { class: `alert alert--${kind}` }, icon(ico), el('span', { text }));
  }

  function capCell(v) {
    if (!isNum(v)) return el('td', { class: 'num err', text: '–' });
    const cls = v > 100 ? 'pk-cap is-over' : v > 80 ? 'pk-cap is-high' : 'pk-cap';
    return el('td', { class: 'num' },
      el('div', { class: cls },
        el('span', { class: 'pk-cap__bar', style: `width:${Math.min(v, 120) / 1.2}%` }),
        el('span', { class: 'pk-cap__val', text: `${fmtN(v, 1)} %` })));
  }

  function summaryTable(r) {
    const tb = el('tbody');
    for (const k of r.kpis) {
      tb.append(el('tr', {},
        el('td', { class: 'lab', text: k.label }),
        el('td', { class: 'txt', text: k.packing || '' }),
        capCell(k.capacity),
        el('td', { class: 'num', text: isNum(k.system_limit) ? `${fmtN(k.system_limit, 1)} %` : '–' }),
        el('td', { class: 'num', text: fmtN(k.c_factor, 4) }),
        el('td', { class: 'num', text: isNum(k.holdup) && k.family !== 'random' ? fmtN(k.holdup, 4) : '–' }),   // 랜덤 패킹은 holdup 계산 없음
        el('td', { class: k.dp_error ? 'num err' : 'num', text: k.dp_error || fmtN(k.dp_mmhg_m, 3) })));
    }
    return el('section', { class: 'card card--flush' },
      el('div', { class: 'card__head card__head--pad' },
        el('h2', { class: 'card__title' }, icon('gauge'), '핵심 결과'),
        el('span', { class: 'card__meta', text: 'capacity: 선택한 flood 모델 기준 / 막대 80 % 주의, 100 % 초과 flood' })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'report-table' },
        el('thead', {}, el('tr', {}, ...['케이스', '패킹', 'Capacity', 'System limit', 'C-factor (m/s)', 'Holdup (m3/m3)',
          'ΔP (mmHg/m)'].map(t => el('th', { scope: 'col', text: t })))), tb)));
  }

  function reportTable(title, ico, rows, labels, sections, keyOf, note) {
    const tb = el('tbody');
    for (const row of rows) {
      const sec = sections[keyOf(row)];
      if (sec) tb.append(el('tr', { class: 'sec' }, el('td', { colspan: labels.length + 2, text: sec })));
      tb.append(el('tr', {},
        el('td', { class: 'lab', text: row.label }), el('td', { class: 'u', text: row.unit }),
        ...row.values.map(v => {
          const err = typeof v === 'string' && v.startsWith('#');
          return el('td', { class: err ? 'num err' : isNum(v) ? 'num' : 'txt', text: fmt(v) });
        })));
    }
    return el('section', { class: 'card card--flush' },
      el('div', { class: 'card__head card__head--pad' }, el('h2', { class: 'card__title' }, icon(ico), title),
        note ? el('span', { class: 'card__meta', text: note }) : null),
      el('div', { class: 'table-wrap' }, el('table', { class: 'report-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '항목' }), el('th', { scope: 'col', text: '단위' }),
          ...labels.map(c => el('th', { scope: 'col', text: c })))), tb)));
  }

  function renderResults() {
    const box = $('#results');
    const r = result;
    if (!r) { box.replaceChildren(); return; }
    if (!r.ok) {
      box.replaceChildren(el('div', { class: 'alerts' }, ...(r.messages || ['계산할 수 없습니다']).map(m => alertBox('error', 'circle-x', m))));
      refreshIcons();
      return;
    }
    const kids = [];
    const alerts = [];
    (r.warnings || []).forEach(w => alerts.push(alertBox('warning', 'triangle-alert', w)));
    const anyDpErr = r.kpis.some(k => k.dp_error && k.family === 'structured');
    if (anyDpErr && !(r.fixes || []).some(f => f.includes('rev60'))) {
      alerts.push(alertBox('info', 'info', '원본 파일은 정형 패킹 압력강하 수식이 깨져 있어 #VALUE! 로 나옵니다. 수정 옵션 P1을 켜면 계산됩니다.'));
    }
    if (alerts.length) kids.push(el('div', { class: 'alerts' }, alerts));
    kids.push(el('div', { class: 'pk-result-head' },
      el('div', {},
        el('h2', { class: 'pk-result-title', text: '계산 결과' }),
        el('p', { class: 'card__meta', text: `케이스 ${r.case_labels.length}개 · ${Math.round(r.elapsed_ms)} ms · 수정 옵션: ${(r.fixes || []).length ? r.fixes.join(', ') : '없음 (원본과 같음)'}` })),
      el('div', { class: 'page-actions' },
        el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => exportFile('html') }, icon('file-text'), 'HTML'),
        el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => exportFile('csv') }, icon('file-spreadsheet'), 'CSV'),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => exportFile('xlsx') }, icon('download'), 'Excel 저장'))));
    kids.push(summaryTable(r));
    kids.push(reportTable('고객 보고서', 'file-text', r.main.filter(x => x.row !== 6), r.case_labels,
      { 7: '로딩', 10: '증기', 15: '액체', 21: '탑', 24: '수력 결과', 30: '패킹' }, x => x.row,
      `원본 GENERAL_DEFAULT_P 형식 · ${r.unit === 'E' ? 'English' : 'Metric'}`));
    kids.push(reportTable('상세 (SI 단위)', 'list', r.detail, r.case_labels,
      { uv: '기본량', cs_flood: 'Flood', holdup: 'Holdup', dp_struct_pa_m: '압력강하' }, x => x.field));
    box.replaceChildren(...kids);
    refreshIcons();
  }

  // ---------------------------------------------------------------- 파일
  async function loadExample(silent) {
    const res = await fetch('/api/packing/example');
    design = await res.json();
    result = null;
    saveDraft();
    renderSettings();
    renderTable();
    renderResults();
    if (!silent) toast('원본 예제를 불러왔습니다');
  }

  function saveJson() {
    const d = JSON.parse(body()).design;
    const name = String((d.project && (d.project.tower_no || d.project.tower_name)) || 'packing').replace(/[^\w.-]+/g, '_');
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${name}_packing.json` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function openJson(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d || !Array.isArray(d.loadings)) throw new Error('loadings 가 없습니다');
        if (d.geometry) throw new Error('트레이 설계 파일입니다 (로딩 입력 페이지에서 여세요)');
        design = d;
        result = null;
        saveDraft();
        renderSettings();
        renderTable();
        renderResults();
        toast(`${file.name} 을 불러왔습니다`);
      } catch (e) {
        toast(`패킹 설계 JSON 이 아닙니다: ${e.message}`, true);
      }
    };
    fr.readAsText(file);
  }

  // ---------------------------------------------------------------- 시작
  function bind() {
    document.querySelectorAll('#in-unit button').forEach(b => b.addEventListener('click', () => {
      design.input_unit = Number(b.dataset.value); setSeg('in-unit', b.dataset.value); saveDraft(); renderTable();
    }));
    document.querySelectorAll('#out-unit button').forEach(b => b.addEventListener('click', () => {
      design.output_unit = b.dataset.value; setSeg('out-unit', b.dataset.value); saveDraft();
    }));
    $('#cap-model').addEventListener('change', e => { design.cap_model = Number(e.target.value); saveDraft(); });
    $('#cap-model-rnd').addEventListener('change', e => { design.cap_model_rnd = Number(e.target.value); saveDraft(); });
    for (const id of ['max-rate', 'min-rate']) {
      $(`#${id}`).addEventListener('change', e => {
        const k = id === 'max-rate' ? 'max_rate' : 'min_rate';
        if (e.target.value === '') delete design[k]; else design[k] = Number(e.target.value);
        saveDraft();
      });
    }
    document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      fixes = b.dataset.preset === 'recommended' ? catalog.fixes.filter(f => f.recommended).map(f => f.name) : [];
      saveDraft();
      renderFixes();
    }));
    $('#btn-run').addEventListener('click', run);
    $('#btn-add').addEventListener('click', addLoading);
    $('#btn-example').addEventListener('click', () => loadExample(false));
    $('#btn-save').addEventListener('click', saveJson);
    $('#file-open').addEventListener('change', e => { if (e.target.files[0]) openJson(e.target.files[0]); e.target.value = ''; });
  }

  async function init() {
    refreshIcons();
    try {
      catalog = await (await fetch('/api/packing/catalog')).json();
    } catch (e) {
      $('#results').replaceChildren(alertBox('error', 'circle-x', `패킹 목록을 불러오지 못했습니다: ${e}`));
      refreshIcons();
      return;
    }
    $('#cap-model').replaceChildren(...catalog.cap_models.map(m => el('option', { value: m.id, text: `${m.id}. ${m.name}` })));
    $('#cap-model-rnd').replaceChildren(...catalog.cap_models_rnd.map(m => el('option', { value: m.id, text: `${m.id}. ${m.name}` })));
    bind();
    const draft = readDraft();
    if (draft && draft.design) {
      design = draft.design;
      fixes = Array.isArray(draft.fixes) ? draft.fixes : [];
      renderSettings();
      renderTable();
    } else {
      fixes = catalog.fixes.filter(f => f.recommended).map(f => f.name);
      await loadExample(true);
    }
  }

  init();
})();
