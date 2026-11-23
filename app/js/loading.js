/* Tray Rater · 로딩 입력 페이지
 *
 * 데이터 형식은 Python 쪽 tray_rater.design.TrayDesign JSON 과 같다.
 *   loadings[i] = { name, section, description, comment, vapor_rate, vapor_density, vapor_viscosity,
 *                   liquid_rate, liquid_density, surface_tension, liquid_viscosity, system_factor, tray_spacing }
 *   input_unit / output_unit ("M" | "E"), max_rate, min_rate, max_vapor, max_liquid, min_vapor, min_liquid
 *   project = { job_no, project, customer, end_user, tower_no, tower_name, prepared_by, revision }
 * geometry 등 이 페이지가 다루지 않는 필드는 불러온 그대로 보존해 저장한다.
 */
(function () {
  'use strict';

  const MAX_LOADS = 10;
  const MIN_VISIBLE = 5;
  const MAX_CASES = 30;
  const DRAFT_KEY = 'trayRater.loadingDraft.v1';

  const PROJECT_FIELDS = [
    ['project', '프로젝트'], ['customer', '고객'], ['end_user', 'End user'], ['job_no', 'Job No.'],
    ['tower_no', 'Tower No.'], ['tower_name', 'Tower 이름'], ['prepared_by', '작성자'], ['revision', 'Revision'],
  ];

  // 표의 행: [키, 라벨, 보조 라벨, 단위(M), 단위(E), 종류]
  const GROUPS = [
    { id: 'general', title: '일반', icon: 'tag', rows: [
      ['name', '로딩 이름', 'Loading', '', '', 'text'],
      ['section', 'Section', 'Zone', '', '', 'text'],
      ['description', '설명', 'Description', '', '', 'text'],
      ['comment', '비고', 'Tray / Bed No.', '', '', 'text'],
    ] },
    { id: 'vapor', title: '증기 VAPOR', icon: 'wind', rows: [
      ['vapor_rate', '질량 유량', 'Mass rate', 'kg/hr', 'lb/hr', 'num'],
      ['vapor_density', '밀도', 'Density', 'kg/m3', 'lb/ft3', 'num'],
      ['vapor_viscosity', '점도', 'Viscosity', 'cP', 'cP', 'num'],
      ['vapor_volume', '체적 유량', '자동 계산 · rate / density', 'm3/hr', 'ft3/s', 'calc'],
    ] },
    { id: 'liquid', title: '액체 LIQUID', icon: 'droplets', rows: [
      ['liquid_rate', '질량 유량', 'Mass rate', 'kg/hr', 'lb/hr', 'num'],
      ['liquid_density', '밀도', 'Density', 'kg/m3', 'lb/ft3', 'num'],
      ['surface_tension', '표면장력', 'Surface tension', 'dyne/cm', 'dyne/cm', 'num'],
      ['liquid_viscosity', '점도', 'Viscosity', 'cP', 'cP', 'num'],
      ['liquid_volume', '체적 유량', '자동 계산 · rate / density', 'm3/hr', 'ft3/hr', 'calc'],
    ] },
    { id: 'tray', title: '트레이 TRAY', icon: 'layers', rows: [
      ['system_factor', 'System factor', '거품 보정 계수', '', '', 'num'],
      ['tray_spacing', 'Tray spacing', '단 간격', 'mm', 'in', 'num'],
    ] },
  ];
  const NUM_KEYS = GROUPS.flatMap(g => g.rows.filter(r => r[5] === 'num').map(r => r[0]));
  const TEXT_KEYS = GROUPS.flatMap(g => g.rows.filter(r => r[5] === 'text').map(r => r[0]));
  const INPUT_KEYS = [...TEXT_KEYS, ...NUM_KEYS];
  const DEFAULT_KEYS = ['system_factor', 'tray_spacing'];

  // ---------------------------------------------------------------- 상태
  let state = emptyState();

  function emptyState() {
    return {
      base: {},                                   // 불러온 JSON (geometry 등 보존용)
      project: {},
      input_unit: 'M', output_unit: 'M',
      rates: { max_vapor: '100', max_liquid: '100', min_vapor: '50', min_liquid: '50' },
      loads: Array.from({ length: MAX_LOADS }, () => ({})),
      visible: MIN_VISIBLE,
    };
  }

  // ---------------------------------------------------------------- 유틸
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  };
  const icon = (name) => el('i', { 'data-lucide': name });
  const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };

  /** 입력 문자열 -> 숫자 (빈 칸 null, 숫자 아님 NaN). 천 단위 쉼표 허용. */
  function parseNum(s) {
    if (s === undefined || s === null) return null;
    const t = String(s).trim().replace(/,/g, '');
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  }
  const isBlank = v => v === undefined || v === null || String(v).trim() === '';

  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    const a = Math.abs(v);
    const d = digits ?? (a >= 1000 ? 1 : a >= 1 ? 3 : 4);
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** VBA Integer 변환 (Banker's rounding) - 원본 매크로의 varMin_Liq */
  function bankersRound(x) {
    const f = Math.floor(x), r = x - f;
    if (r > 0.5) return f + 1;
    if (r < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  function toast(msg, isError) {
    const t = $('#toast');
    t.replaceChildren(icon(isError ? 'triangle-alert' : 'circle-check'), el('span', { text: msg }));
    t.classList.toggle('is-error', !!isError);
    t.hidden = false;
    refreshIcons();
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------- 계산 (원본 INPUT 시트 / 매크로와 같은 규칙)
  /** 체적 유량: INPUT 21행 = rate/density (M: m3/hr, E: ft3/s 는 /3600), 26행 = rate/density */
  function volumes(ld) {
    const vr = parseNum(ld.vapor_rate), vd = parseNum(ld.vapor_density);
    const lr = parseNum(ld.liquid_rate), lDen = parseNum(ld.liquid_density);
    const vv = vr > 0 && vd > 0 ? (state.input_unit === 'M' ? vr / vd : vr / vd / 3600) : null;
    const lv = lr > 0 && lDen > 0 ? lr / lDen : null;
    return { vapor: vv, liquid: lv };
  }

  /** 로딩 상태와 확인 사항 */
  function check(ld, idx) {
    const issues = [];       // {level: 'err'|'warn', msg}
    // System factor / Tray spacing 은 원본 시트가 모든 열에 미리 채워 두므로 '사용 여부' 판단에서 제외
    const filledNums = NUM_KEYS.filter(k => !DEFAULT_KEYS.includes(k) && !isBlank(ld[k]));
    const anyText = TEXT_KEYS.some(k => !isBlank(ld[k]));
    for (const k of NUM_KEYS) {
      if (!isBlank(ld[k]) && Number.isNaN(parseNum(ld[k]))) issues.push({ level: 'err', key: k, msg: `${label(k)}: 숫자를 입력하세요` });
    }
    const vol = volumes(ld);
    const active = vol.vapor > 0 && vol.liquid > 0;
    if (!filledNums.length && !anyText) return { status: 'empty', active: false, issues: [] };
    if (!active) {
      const need = [];
      if (!(parseNum(ld.vapor_rate) > 0)) need.push('증기 유량');
      if (!(parseNum(ld.vapor_density) > 0)) need.push('증기 밀도');
      if (!(parseNum(ld.liquid_rate) > 0)) need.push('액체 유량');
      if (!(parseNum(ld.liquid_density) > 0)) need.push('액체 밀도');
      issues.push({ level: 'warn', msg: `계산하려면 ${need.join(' · ')} 입력이 필요합니다` });
    } else {
      const vd = parseNum(ld.vapor_density), lDen = parseNum(ld.liquid_density);
      if (vd >= lDen) issues.push({ level: 'err', key: 'vapor_density', msg: '증기 밀도가 액체 밀도보다 큽니다' });
      const ts = parseNum(ld.tray_spacing);
      if (!(ts > 0)) issues.push({ level: 'err', key: 'tray_spacing', msg: 'Tray spacing을 입력하세요' });
      const sf = parseNum(ld.system_factor);
      if (sf === null) issues.push({ level: 'err', key: 'system_factor', msg: 'System factor를 입력하세요' });
      else if (sf <= 0 || sf > 1.5) issues.push({ level: 'warn', key: 'system_factor', msg: 'System factor는 보통 0.5 ~ 1.0 입니다' });
      const lv = parseNum(ld.liquid_viscosity);
      if (lv !== null && lv > 100) issues.push({ level: 'warn', key: 'liquid_viscosity', msg: '액체 점도가 매우 큽니다. 단위를 확인하세요' });
      const vv = parseNum(ld.vapor_viscosity);
      if (vv !== null && vv > 1) issues.push({ level: 'warn', key: 'vapor_viscosity', msg: '증기 점도가 큽니다. 단위를 확인하세요' });
    }
    if (idx === 0 && !active) issues.push({ level: 'err', msg: 'Load 1은 반드시 입력해야 합니다' });
    const hasErr = issues.some(i => i.level === 'err');
    const status = hasErr ? 'error' : !active ? 'partial' : issues.length ? 'warn' : 'ok';
    return { status, active: active && !hasErr ? true : active, issues };
  }
  const PREFIX = { vapor: '증기 ', liquid: '액체 ' };
  const label = k => {
    for (const g of GROUPS) for (const r of g.rows) if (r[0] === k) return (PREFIX[g.id] || '') + r[1];
    return k;
  };

  /** 원본 매크로(ScaledMetricInputLoad)의 케이스 생성 규칙 */
  function cases() {
    const r = state.rates;
    const maxV = parseNum(r.max_vapor) ?? 100, maxL = parseNum(r.max_liquid) ?? 100;
    const minV = parseNum(r.min_vapor) ?? 100, minL = parseNum(r.min_liquid) ?? 100;
    const M7 = Math.max(maxV, maxL), M8 = Math.min(minV, minL);
    const varMax = M7 > 100 ? M7 : 0;
    const varMin = M8 < 100 ? M8 : 0;
    const minLiqInt = bankersRound(minL);
    const out = [];
    state.loads.forEach((ld, i) => {
      if (!(volumes(ld).vapor > 0 && volumes(ld).liquid > 0)) return;
      const L = `L${i + 1}`;
      out.push({ label: `${L} - 100%`, sub: '설계 부하', main: true });
      if (100 < varMax && varMax !== 0) {
        out.push({ label: maxV === maxL ? `${L} - ${varMax}%` : `${L} - T/Up`, sub: `증기 ${maxV}% · 액체 ${maxL}%` });
      }
      if (varMin < 100 && varMin !== 0) {
        out.push({ label: minV === minLiqInt ? `${L} - ${varMin}%` : `${L} - T/Down`, sub: `증기 ${minV}% · 액체 ${minLiqInt}%` });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 렌더링
  function renderProject() {
    const box = $('#project-fields');
    box.replaceChildren(...PROJECT_FIELDS.map(([k, text]) => {
      const id = `pj-${k}`;
      const inp = el('input', { class: 'input', id, value: state.project[k] ?? '', autocomplete: 'off' });
      inp.addEventListener('input', () => { state.project[k] = inp.value; saveDraft(); });
      return el('div', { class: 'field' }, el('label', { class: 'field__label', for: id, text }), inp);
    }));
  }

  function renderSettings() {
    document.querySelectorAll('.segmented').forEach(seg => {
      const key = seg.dataset.key;
      seg.querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-checked', String(state[key] === b.dataset.value));
        b.onclick = () => {
          state[key] = b.dataset.value;
          renderSettings();
          if (key === 'input_unit') renderTable();
          saveDraft();
        };
      });
    });
    document.querySelectorAll('[data-rate]').forEach(inp => {
      const k = inp.dataset.rate;
      inp.value = state.rates[k] ?? '';
      inp.oninput = () => {
        state.rates[k] = inp.value;
        inp.classList.toggle('is-error', Number.isNaN(parseNum(inp.value)));
        renderCases();
        saveDraft();
      };
    });
  }

  function unitOf(row) { return state.input_unit === 'M' ? row[3] : row[4]; }

  function renderTable() {
    const n = state.visible;
    const thead = $('#load-table thead'), tbody = $('#load-table tbody'), tfoot = $('#load-table tfoot');

    // 머리글
    const head = el('tr', {}, el('th', { class: 'rowhead', scope: 'col' }, el('span', { class: 'rowhead__label', text: '항목' })));
    for (let i = 0; i < n; i++) {
      head.append(el('th', { class: 'col-head', scope: 'col', 'data-col': i },
        el('div', { class: 'col-head__top' },
          el('span', { class: 'col-head__name', text: `Load ${i + 1}` }),
          el('span', { class: 'col-head__tools' },
            i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: `Load ${i}의 값을 복사`, 'aria-label': `Load ${i}의 값을 Load ${i + 1}로 복사`, onclick: () => copyLeft(i) }, icon('copy')) : null,
            el('button', { class: 'icon-btn', type: 'button', title: '이 로딩 지우기', 'aria-label': `Load ${i + 1} 지우기`, onclick: () => clearLoad(i) }, icon('eraser')),
          ))));
    }
    thead.replaceChildren(head);

    // 본문
    const rows = [];
    for (const g of GROUPS) {
      rows.push(el('tr', { class: `group ${g.id}` },
        el('th', { colspan: n + 1, scope: 'colgroup' }, el('span', { class: 'group__title' }, icon(g.icon), g.title))));
      for (const r of g.rows) {
        const [key, text, sub, , , kind] = r;
        const tr = el('tr', { class: kind === 'calc' ? 'calc-row' : '' },
          el('th', { class: 'rowhead', scope: 'row' },
            el('span', { class: 'rowhead__label', text }),
            unitOf(r) ? el('span', { class: 'unit', text: unitOf(r) }) : null,
            el('span', { class: 'rowhead__sub', text: sub })));
        for (let i = 0; i < n; i++) {
          if (kind === 'calc') {
            tr.append(el('td', { class: 'calc num', 'data-calc': key, 'data-col': i }));
            continue;
          }
          const inp = el('input', {
            class: `input${kind === 'num' ? ' num' : ''}`, 'data-key': key, 'data-col': i,
            inputmode: kind === 'num' ? 'decimal' : undefined, autocomplete: 'off',
            'aria-label': `Load ${i + 1} ${text}${unitOf(r) ? ' (' + unitOf(r) + ')' : ''}`,
          });
          inp.value = state.loads[i][key] ?? '';
          inp.addEventListener('input', () => {
            state.loads[i][key] = inp.value;
            updateColumn(i);
            renderCases();
            saveDraft();
          });
          inp.addEventListener('keydown', onCellKey);
          tr.append(el('td', {}, inp));
        }
        rows.push(tr);
      }
    }
    tbody.replaceChildren(...rows);

    // 상태 줄
    const foot = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' }, el('span', { class: 'rowhead__label', text: '상태' })));
    for (let i = 0; i < n; i++) foot.append(el('td', { 'data-status': i }));
    tfoot.replaceChildren(foot);

    for (let i = 0; i < n; i++) updateColumn(i, true);
    $('#btn-add').disabled = n >= MAX_LOADS;
    $('#load-count').textContent = `${n} / ${MAX_LOADS}열`;
    renderCases();
    refreshIcons();
  }

  const STATUS = {
    ok: ['badge--success', 'circle-check', '입력 완료'],
    warn: ['badge--warning', 'triangle-alert', '확인 필요'],
    partial: ['badge--warning', 'circle-dashed', '입력 중'],
    error: ['badge--error', 'circle-x', '입력 오류'],
    empty: ['badge--muted', 'circle-minus', '미사용'],
  };

  function updateColumn(i, skipIcons) {
    const ld = state.loads[i];
    const vol = volumes(ld);
    for (const [key, v] of [['vapor_volume', vol.vapor], ['liquid_volume', vol.liquid]]) {
      const td = $(`td[data-calc="${key}"][data-col="${i}"]`);
      if (td) { td.textContent = v === null ? '–' : fmt(v); td.classList.toggle('empty', v === null); }
    }
    const res = check(ld, i);
    document.querySelectorAll(`input[data-col="${i}"]`).forEach(inp => {
      const it = res.issues.find(x => x.key === inp.dataset.key);
      inp.classList.toggle('is-error', !!it && it.level === 'err');
      inp.classList.toggle('is-warn', !!it && it.level === 'warn');
      inp.setAttribute('aria-invalid', String(!!it && it.level === 'err'));
    });
    document.querySelectorAll(`[data-col="${i}"]`).forEach(c => c.closest('td,th')?.classList.toggle('col-inactive', res.status === 'empty'));
    const [cls, ic, text] = STATUS[res.status];
    const td = $(`td[data-status="${i}"]`);
    if (td) {
      const parts = [el('span', { class: `badge ${cls}` }, icon(ic), text)];
      if (res.issues.length) parts.push(el('ul', { class: 'issues' }, res.issues.map(x => el('li', { class: x.level, text: x.msg }))));
      td.replaceChildren(...parts);
      if (!skipIcons) refreshIcons();
    }
  }

  function renderCases() {
    const list = cases();
    const box = $('#cases');
    if (!list.length) {
      box.replaceChildren(el('span', { class: 'empty', text: '계산할 로딩이 없습니다. Load 1부터 입력하세요.' }));
    } else {
      box.replaceChildren(...list.map(c => el('span', { class: `case-chip${c.main ? '' : ' case-chip--sub'}` },
        c.label, el('small', { text: c.sub }))));
    }
    const over = list.length > MAX_CASES;
    $('#case-count').replaceChildren(over
      ? el('span', { class: 'badge badge--error' }, icon('circle-x'), `${list.length}개 · 최대 ${MAX_CASES}개`)
      : el('span', { class: 'badge badge--navy' }, `${list.length}개 케이스`));
    refreshIcons();
  }

  // ---------------------------------------------------------------- 동작
  function onCellKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll(`#load-table input[data-col="${e.target.dataset.col}"]`)];
    const k = inputs.indexOf(e.target);
    const next = inputs[k + (e.shiftKey ? -1 : 1)];
    if (next) next.focus(), next.select();
  }

  function copyLeft(i) {
    state.loads[i] = { ...state.loads[i - 1], name: state.loads[i].name ?? '' };
    renderTable();
    saveDraft();
    toast(`Load ${i}의 값을 Load ${i + 1}에 복사했습니다`);
  }

  function clearLoad(i) {
    state.loads[i] = {};
    renderTable();
    saveDraft();
    toast(`Load ${i + 1}을(를) 비웠습니다`);
  }

  $('#btn-add').addEventListener('click', () => {
    if (state.visible < MAX_LOADS) { state.visible += 1; renderTable(); saveDraft(); }
  });

  // ---------------------------------------------------------------- JSON 변환
  function fromDesign(d) {
    const s = emptyState();
    s.base = d || {};
    s.project = { ...(d.project || {}) };
    s.input_unit = (d.input_unit || 'M').toUpperCase() === 'E' ? 'E' : 'M';
    s.output_unit = (d.output_unit || 'M').toUpperCase() === 'E' ? 'E' : 'M';
    const str = v => (v === undefined || v === null ? '' : String(v));
    s.rates.max_vapor = str(d.max_vapor ?? d.max_rate ?? 100);
    s.rates.max_liquid = str(d.max_liquid ?? d.max_rate ?? 100);
    s.rates.min_vapor = str(d.min_vapor ?? d.min_rate ?? 50);
    s.rates.min_liquid = str(d.min_liquid ?? d.min_rate ?? 50);
    (d.loadings || []).slice(0, MAX_LOADS).forEach((ld, i) => {
      const o = {};
      for (const k of INPUT_KEYS) if (ld[k] !== undefined && ld[k] !== null) o[k] = String(ld[k]);
      s.loads[i] = o;
    });
    const last = lastUsed(s.loads);
    s.visible = Math.min(MAX_LOADS, Math.max(MIN_VISIBLE, last + 1));
    return s;
  }

  function lastUsed(loads) {
    let last = -1;
    loads.forEach((ld, i) => { if (INPUT_KEYS.some(k => !DEFAULT_KEYS.includes(k) && !isBlank(ld[k]))) last = i; });
    return last;
  }

  function toDesign() {
    const d = JSON.parse(JSON.stringify(state.base || {}));
    const project = {};
    for (const [k] of PROJECT_FIELDS) if (!isBlank(state.project[k])) project[k] = state.project[k].trim();
    d.project = project;
    d.input_unit = state.input_unit;
    d.output_unit = state.output_unit;
    const r = Object.fromEntries(Object.entries(state.rates).map(([k, v]) => [k, parseNum(v)]));
    d.max_vapor = r.max_vapor ?? 100; d.max_liquid = r.max_liquid ?? 100;
    d.min_vapor = r.min_vapor ?? 100; d.min_liquid = r.min_liquid ?? 100;
    d.max_rate = Math.max(d.max_vapor, d.max_liquid);    // INPUT!M7: Turn-up 여부와 케이스 이름에 사용
    d.min_rate = Math.min(d.min_vapor, d.min_liquid);    // INPUT!M8
    const loads = state.loads.map(ld => {
      const o = {};
      for (const k of TEXT_KEYS) if (!isBlank(ld[k])) o[k] = String(ld[k]).trim();
      for (const k of NUM_KEYS) { const v = parseNum(ld[k]); if (v !== null && !Number.isNaN(v)) o[k] = v; }
      return o;
    });
    while (loads.length && !Object.keys(loads[loads.length - 1]).length) loads.pop();   // 끝의 빈 로딩만 생략
    d.loadings = loads;
    return d;
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  $('#btn-save').addEventListener('click', () => {
    const errs = state.loads.map((ld, i) => check(ld, i)).filter(r => r.status === 'error').length;
    const d = toDesign();
    const name = (state.project.tower_no || state.project.tower_name || 'tray_design').replace(/[\\/:*?"<>|\s]+/g, '_');
    download(`${name}.json`, JSON.stringify(d, null, 2));
    toast(errs ? `저장했습니다. 입력 오류가 있는 로딩 ${errs}개를 확인하세요` : 'JSON 파일로 저장했습니다', errs > 0);
  });

  $('#file-open').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (typeof d !== 'object' || Array.isArray(d)) throw new Error('형식');
      state = fromDesign(d);
      renderAll();
      saveDraft();
      toast(`${f.name}을(를) 불러왔습니다`);
    } catch (err) {
      toast('JSON 형식을 확인하세요', true);
    }
    e.target.value = '';
  });

  $('#btn-example').addEventListener('click', async () => {
    try {
      const res = await fetch('../examples/original_design.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      state = fromDesign(await res.json());
      renderAll();
      saveDraft();
      toast('원본 예제(GT-Rater-Tray)를 불러왔습니다');
    } catch (err) {
      toast('예제는 로컬 서버로 열었을 때만 불러올 수 있습니다', true);
    }
  });

  // ---------------------------------------------------------------- 임시 저장 (브라우저)
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ design: toDesign(), visible: state.visible })); } catch (e) { /* 저장 불가 환경 */ }
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      const s = fromDesign(o.design || {});
      s.visible = Math.min(MAX_LOADS, Math.max(s.visible, o.visible || MIN_VISIBLE));
      return s;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 시작
  function renderAll() {
    renderProject();
    renderSettings();
    renderTable();
  }

  $('#today').textContent = new Date().toISOString().slice(0, 10);
  const draft = loadDraft();
  if (draft) state = draft;
  else state.loads[0] = { system_factor: '1', tray_spacing: '600' };
  renderAll();

  // 테스트·디버깅용
  window.trayLoading = { get state() { return state; }, toDesign, fromDesign: d => { state = fromDesign(d); renderAll(); }, cases };
})();
