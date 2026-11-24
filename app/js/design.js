/* Tray Rater · 자동 설계 페이지
 *
 * 로딩 입력이 저장한 설계(TrayStore)로 POST /api/autodesign 을 호출해
 *   - 추천 설계 (패스 수, Column ID, DC·weir·개구율, 핵심 지표, 추천 이유)
 *   - 패스 후보별 비교 표 (행을 고르면 아래에 기준 판정 목록)
 *   - "이 설계 적용": 고른 후보의 형상을 TrayStore 에 저장하고 형상 입력 / 계산 결과 페이지로 이동
 * 기준: docs/tray_design_criteria.md (서버 버전 전용, 외부 테스트 사이트에는 없음)
 */
(function () {
  'use strict';

  const OPT_KEY = 'trayRater.autodesign.v1';
  const DESIGN_FLOOD = 80, FLOOD = 85, BACKUP = 40, WEIR_LOAD = 89.4, FPL_MIN = 450;
  const TRAY_TYPES = ['VALVE', 'SIEVE', 'GT-PURGE™', 'GT-OPTIM™'];

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
  const fmt = (v, d = 1) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const pct = (v, d = 1) => (isNum(v) ? fmt(v * 100, d) : '–');
  const mm = v => (isNum(v) && v > 0 ? fmt(v, 0) : '–');

  // ---------------------------------------------------------------- 상태
  let design = TrayStore.getDesign();
  let opts = readOpts();
  let result = null;
  let selected = null;          // 선택한 후보의 n_pass
  let busy = false;

  function readOpts() {
    try {
      const o = JSON.parse(localStorage.getItem(OPT_KEY) || 'null');
      if (o && Array.isArray(o.passes)) return Object.assign(defaults(), o);
    } catch (e) { /* 무시 */ }
    return defaults();
  }
  function defaults() {
    const g = (design && design.geometry) || {};
    return { passes: [1, 2, 4], open_area: 'auto', dp_max: '', tray_type: g.tray_type || 'VALVE',
             valve: g.valve1_type || 'mfix6', hole: g.sieve_hole_override ?? '' };
  }
  function saveOpts() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) { /* 무시 */ }
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

  // ---------------------------------------------------------------- 입력 요약
  function activeLoadings() {
    return ((design && design.loadings) || []).filter(l => isNum(+l.vapor_rate) && +l.vapor_rate > 0
      && isNum(+l.liquid_rate) && +l.liquid_rate > 0);
  }

  function renderSetup() {
    const g = (design && design.geometry) || {};
    const loads = activeLoadings();
    const unitIn = String((design && design.input_unit) || 'M').toUpperCase() === 'E';
    const ts = loads.map(l => +l.tray_spacing).filter(v => v > 0);
    const tsTxt = ts.length ? `${Math.min(...ts)}${Math.max(...ts) !== Math.min(...ts) ? `~${Math.max(...ts)}` : ''} ${unitIn ? 'in' : 'mm'}` : '–';
    const rate = design ? `${design.min_rate ?? 100} ~ ${design.max_rate ?? 100} %` : '–';
    const item = (label, value, warn) => el('div', { class: 'basis__item' },
      el('span', { class: 'basis__label', text: label }),
      el('span', { class: `basis__value${warn ? ' is-warn' : ''}`, text: value }));
    $('#basis').replaceChildren(
      item('로딩', loads.length ? `${loads.length}개 · ${loads.map((l, i) => l.name || `L${i + 1}`).slice(0, 4).join(', ')}${loads.length > 4 ? ' …' : ''}` : '입력 없음', !loads.length),
      item('Tray spacing', tsTxt, !ts.length),
      item('부하 범위', rate),
      item('재질 · 데크', g.metallurgy ? `${g.metallurgy} · ${g.deck_thickness ?? '–'} mm` : '–'),
      item('현재 형상', isNum(+g.column_id) && +g.column_id > 0 ? `${g.n_pass || 1}-pass · ${fmt(+g.column_id, 0)} mm` : '없음'),
    );
    document.querySelectorAll('#pass-pick button').forEach(b => {
      b.setAttribute('aria-pressed', String(opts.passes.includes(+b.dataset.pass)));
    });
    const sieve = opts.tray_type === 'SIEVE';
    $('#tray-type').value = opts.tray_type;
    $('#valve-field').hidden = sieve;
    $('#hole-field').hidden = !sieve;
    if ($('#valve-type').options.length) $('#valve-type').value = opts.valve;
    $('#hole-dia').value = opts.hole;
    if (document.activeElement !== $('#dp-max')) $('#dp-max').value = opts.dp_max;
    const oa = +g.open_area;
    $('#oa-fixed').textContent = isNum(oa) && oa > 0 ? `입력값 유지 (${fmt(oa * 100, 1)} %)` : '입력값 유지';
    $('#oa-fixed').disabled = !(isNum(oa) && oa > 0);
    if ($('#oa-fixed').disabled && opts.open_area === 'fixed') opts.open_area = 'auto';
    document.querySelectorAll('#oa-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === opts.open_area)));
    $('#btn-run').disabled = busy || !loads.length || !opts.passes.length;
  }

  document.querySelectorAll('#pass-pick button').forEach(b => b.addEventListener('click', () => {
    const p = +b.dataset.pass;
    const on = opts.passes.includes(p);
    if (on && opts.passes.length === 1) return toast('패스 수를 하나 이상 고르세요', true);
    opts.passes = on ? opts.passes.filter(x => x !== p) : [...opts.passes, p].sort();
    saveOpts();
    renderSetup();
  }));
  document.querySelectorAll('#oa-seg button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    opts.open_area = b.dataset.value;
    saveOpts();
    renderSetup();
  }));

  function fillSelect(sel, items) {
    sel.replaceChildren(...items.map(v => el('option', { value: v, text: v })));
  }
  fillSelect($('#tray-type'), TRAY_TYPES);
  $('#tray-type').addEventListener('change', e => { opts.tray_type = e.target.value; saveOpts(); renderSetup(); });
  $('#valve-type').addEventListener('change', e => { opts.valve = e.target.value; saveOpts(); });
  $('#hole-dia').addEventListener('change', e => { opts.hole = e.target.value; saveOpts(); });
  $('#dp-max').addEventListener('input', e => { opts.dp_max = e.target.value; saveOpts(); });
  fetch('/api/catalog').then(r => r.json()).then(cat => {
    const valves = cat.valves || [];
    if (opts.valve && !valves.includes(opts.valve)) valves.unshift(opts.valve);
    fillSelect($('#valve-type'), valves);
    renderSetup();
  }).catch(() => { fillSelect($('#valve-type'), [opts.valve]); renderSetup(); });

  // 서버로 보낼 설계: 이 페이지에서 고른 트레이 종류·밸브(또는 홀 지름)를 반영
  function requestDesign() {
    const d = JSON.parse(JSON.stringify(design));
    d.geometry = d.geometry || {};
    const g = d.geometry;
    g.tray_type = opts.tray_type;
    if (opts.tray_type === 'SIEVE') {
      const h = parseFloat(opts.hole);
      g.sieve_hole_override = Number.isFinite(h) && h > 0 ? h : null;
    } else {
      g.valve1_type = opts.valve;
      if (!g.valve2_type || !(+g.valve2_fraction > 0)) g.valve2_type = opts.valve;
    }
    for (const [k, v] of Object.entries({ metallurgy: 'SA-283C (C.S)', deck_thickness: 2, mcsd: 'NO', inlet_sump: 'NO',
      swept_back_weir: 'NO', relief_hole: 'NO', envelope: 'NO', valve2_fraction: 0, dp_factor: 1 })) {
      if (g[k] === undefined || g[k] === null || g[k] === '') g[k] = v;
    }
    return d;
  }

  // ---------------------------------------------------------------- 실행
  async function run() {
    if (busy) return;
    if (!activeLoadings().length) return renderEmpty();
    busy = true;
    renderSetup();
    $('#btn-run').replaceChildren(icon('loader-circle'), '설계 중…');
    $('#content').replaceChildren(el('div', { class: 'card running', role: 'status' },
      el('div', { class: 'running__bar', 'aria-hidden': 'true' }),
      el('p', { text: document.documentElement.classList.contains('is-static')
        ? `패스 후보 ${opts.passes.length}개의 최소 지름을 찾는 중입니다. 브라우저 안에서 계산해 10~40 초 걸리고, 그동안 화면이 멈춘 것처럼 보일 수 있습니다.`
        : `패스 후보 ${opts.passes.length}개의 최소 지름을 찾는 중입니다. 보통 5~15 초 걸립니다.` })));
    refreshIcons();
    // 정적 사이트는 계산이 화면 스레드에서 돌아가므로, 진행 표시가 먼저 그려지도록 한 프레임 기다린다
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
    try {
      const res = await fetch('/api/autodesign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: requestDesign(), passes: opts.passes, open_area: opts.open_area,
                               dp_max_mmhg: opts.dp_max === '' ? null : opts.dp_max, tray_type: opts.tray_type }),
      });
      result = await res.json();
    } catch (e) {
      result = { ok: false, messages: ['계산 서버에 연결할 수 없습니다. python -m tray_rater.webapp 로 실행한 주소에서 여세요.'] };
    }
    busy = false;
    $('#btn-run').replaceChildren(icon('wand-sparkles'), '자동 설계 실행');
    const rec = result.ok && result.candidates.find(c => c.recommended);
    selected = rec ? rec.n_pass : (result.ok && result.candidates[0] ? result.candidates[0].n_pass : null);
    renderSetup();
    render();
  }
  $('#btn-run').addEventListener('click', run);

  // ---------------------------------------------------------------- 결과
  function renderEmpty() {
    $('#content').replaceChildren(el('section', { class: 'card empty-state' },
      el('h2', { text: '로딩 데이터가 없습니다' }),
      el('p', { text: '로딩 입력 페이지에서 증기·액체 유량, 밀도, tray spacing을 입력하세요. 트레이 종류와 밸브는 형상 입력 페이지에서 고릅니다.' }),
      el('div', { class: 'empty-state__actions' },
        el('a', { class: 'btn btn--primary', href: 'index.html' }, icon('table-2'), '로딩 입력'),
        el('a', { class: 'btn btn--secondary', href: 'geometry.html' }, icon('ruler'), '형상 입력'))));
    refreshIcons();
  }

  function renderIntro() {
    $('#content').replaceChildren(el('section', { class: 'card intro' },
      icon('wand-sparkles'),
      el('div', {},
        el('h2', { text: '설계 조건을 확인하고 자동 설계를 실행하세요' }),
        el('p', { text: '패스 후보마다 기준을 모두 만족하는 가장 작은 지름을 찾고, 그중 하나를 추천합니다. 결과에서 후보를 골라 형상 입력에 적용할 수 있습니다.' }))));
    refreshIcons();
  }

  function render() {
    const box = $('#content');
    if (!result.ok) {
      box.replaceChildren(el('div', { class: 'alerts' }, result.messages.map(m =>
        el('div', { class: 'alert alert--error' }, icon('circle-x'), el('span', { text: m })))));
      return refreshIcons();
    }
    const rec = result.candidates.find(c => c.recommended);
    box.replaceChildren(
      rec ? renderHero(rec) : el('div', { class: 'alert alert--error' }, icon('circle-x'),
        el('span', { text: '기준을 모두 만족하는 설계가 없습니다. 로딩, tray spacing, 밸브 종류를 확인하거나 검토할 패스 수를 늘리세요.' })),
      renderTable(),
      renderDetail(),
    );
    refreshIcons();
  }

  const dpLimit = () => (result && result.basis && isNum(result.basis.dp_max_mmHg) ? result.basis.dp_max_mmHg : null);

  function stat(label, value, unit, limit, caption, digits = 1) {
    const over = isNum(limit) && isNum(value) && value > limit;
    return el('div', { class: 'stat' },
      el('div', { class: 'stat__label', text: label }),
      el('div', { class: 'stat__value' }, isNum(value) ? fmt(value, digits) : '–', el('small', { text: unit })),
      el('div', { class: 'stat__caption' }, caption || null,
        isNum(limit) ? el('span', { class: `badge badge--${over ? 'warning' : 'success'}` },
          icon(over ? 'triangle-alert' : 'circle-check'), `${over ? '초과' : '이내'} · ${limit}${unit}`) : null));
  }

  function renderHero(c) {
    const m = c.metrics, g = c.geometry;
    const dims = [
      ['Column ID', `${mm(c.column_id)} mm`], ['패스 수', `${c.n_pass}-pass`], ['트레이', g.tray_type || '–'],
      ['Side DC 폭', `${mm(g.side_dc)} mm`],
      c.n_pass >= 2 ? ['Center DC 폭', `${mm(g.center_dc)} mm`] : null,
      c.n_pass === 4 ? ['Off-center DC 폭', `${mm(g.offcenter_dc)} mm`] : null,
      ['Weir 높이', `${mm(g.weir_height)} mm`], ['DC clearance', `${mm(g.dc_clearance)} mm`],
      ['개구율', `${pct(g.open_area)} %`],
    ].filter(Boolean);
    return el('section', { class: 'card hero', 'aria-labelledby': 'hero-title' },
      el('div', { class: 'hero__main' },
        el('p', { class: 'overline', text: 'RECOMMENDED' }),
        el('h2', { class: 'hero__title', id: 'hero-title' },
          el('span', { class: 'num', text: `${c.n_pass}-pass` }), el('span', { class: 'hero__sep', 'aria-hidden': 'true', text: '·' }),
          el('span', { class: 'num', text: mm(c.column_id) }), el('small', { text: 'mm' })),
        el('p', { class: 'hero__reason', text: result.reason.replace(/^\d-pass, Column ID \d+ mm\.\s*/, '') }),
        el('dl', { class: 'dims' }, dims.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { class: 'num', text: v })))),
        el('div', { class: 'hero__actions' },
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => apply(c, 'geometry.html') }, icon('ruler'), '형상 입력에 적용'),
          el('button', { class: 'btn btn--secondary', type: 'button', onclick: () => apply(c, 'results.html') }, icon('chart-column'), '적용하고 계산 결과 보기'))),
      el('div', { class: 'hero__stats' },
        stat('설계 케이스 Jet flood', m.jet_design * 100, '%', DESIGN_FLOOD, `전체 최대 ${pct(m.jet_all)} %`),
        stat('설계 케이스 DC flood', m.dc_design * 100, '%', DESIGN_FLOOD, `전체 최대 ${pct(m.dc_all)} %`),
        stat('최대 DC backup', m.backup * 100, '%', BACKUP, null),
        stat('최대 총 압력강하', m.dp_max_mmHg, ' mmHg', dpLimit(), dpLimit() ? null : '한계 입력 없음', 2),
        stat('최대 weir loading', m.weir_load_max, ' m3/h/m', WEIR_LOAD, null),
        stat('최소 유량 weeping', isNum(m.weep_at_min) ? m.weep_at_min * 100 : null, '%', 25, '실제 유량 기준')));
  }

  function statusBadge(c) {
    if (!c.feasible) return el('span', { class: 'badge badge--error' }, icon('circle-x'), '불가');
    if (c.recommended) return el('span', { class: 'badge badge--navy' }, icon('star'), '추천');
    return el('span', { class: 'badge badge--success' }, icon('circle-check'), '통과');
  }

  function cell(v, limit, digits = 1, suffix = '') {
    const over = isNum(limit) && isNum(v) && v > limit;
    return el('td', { class: `num${over ? ' is-over' : ''}` }, isNum(v) ? fmt(v, digits) + suffix : '–',
      over ? el('span', { class: 'sr-only', text: ' (기준 초과)' }) : null);
  }

  function renderTable() {
    const rows = result.candidates.map(c => {
      const m = c.metrics || {};
      const soft = (c.checks || []).filter(x => x.grade === 'SOFT' && !x.ok).length;
      const tr = el('tr', {
        class: `${c.n_pass === selected ? 'is-selected' : ''}${c.recommended ? ' is-rec' : ''}`,
        tabindex: '0', 'aria-selected': String(c.n_pass === selected),
        onclick: () => select(c.n_pass),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.n_pass); } },
      },
      el('th', { scope: 'row', class: 'lab' }, `${c.n_pass}-pass`),
      c.feasible ? el('td', { class: 'num strong', text: `${mm(c.column_id)}` }) : el('td', { class: 'note', colspan: 9, text: c.note || '기준을 만족하는 지름 없음' }),
      ...(c.feasible ? [
        cell(m.jet_design * 100, DESIGN_FLOOD), cell(m.dc_design * 100, DESIGN_FLOOD), cell(m.backup * 100, BACKUP),
        cell(m.dp_max_mmHg, dpLimit(), 2), cell(m.weir_load_max, WEIR_LOAD),
        el('td', { class: `num${m.fpl_min < FPL_MIN ? ' is-over' : ''}`, text: mm(m.fpl_min) }),
        el('td', { class: 'num', text: pct(c.geometry.open_area) }),
        el('td', { class: 'num', text: String(soft) }),
      ] : []),
      el('td', {}, statusBadge(c)));
      return tr;
    });
    return el('section', { class: 'card card--flush', 'aria-labelledby': 'cand-title' },
      el('div', { class: 'card__head card__head--pad' },
        el('h2', { class: 'card__title', id: 'cand-title' }, icon('list-checks'), '패스 후보 비교'),
        el('span', { class: 'card__meta', text: `${(result.basis || {}).tray_type || ''} · 계산 ${result.evaluations}회 · ${fmt(result.elapsed_s, 1)} 초 · 개구율 ${result.open_area === 'auto' ? '자동' : '입력값'}` })),
      el('p', { class: 'cand-hint', text: '패스 수마다 기준을 모두 만족하는 가장 작은 지름입니다. 행을 고르면 아래에 기준 판정이 나옵니다. 굵은 주황 값은 SOFT 기준 초과입니다.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'report-table cand-table' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', text: '패스' }), el('th', { scope: 'col', text: 'Column ID mm' }),
            el('th', { scope: 'col', text: 'Jet flood %' }), el('th', { scope: 'col', text: 'DC flood %' }),
            el('th', { scope: 'col', text: 'DC backup %' }), el('th', { scope: 'col', text: 'ΔP mmHg' }),
            el('th', { scope: 'col', text: 'Weir load m3/h/m' }),
            el('th', { scope: 'col', text: 'Flow path mm' }), el('th', { scope: 'col', text: '개구율 %' }),
            el('th', { scope: 'col', text: '경고' }), el('th', { scope: 'col', text: '판정' }))),
          el('tbody', {}, rows))),
      el('p', { class: 'cand-foot', text: `값은 설계 여유를 반영한 부하(${fmt((result.basis || {}).margin_pct ?? 105, 0)} %) 기준. Jet·DC flood는 설계 케이스 값. `
        + `기준: flood 80 %, DC backup 40 %, ΔP ${dpLimit() ? dpLimit() + ' mmHg' : '제한 없음'}, weir load 89.4 m3/h/m(120 gpm/ft 넘으면 패스 수 증가 검토), flow path 450 mm 이상.` }));
  }

  function select(n) {
    selected = n;
    render();
    const row = document.querySelector('.cand-table tr.is-selected');
    if (row) row.focus();
  }

  function renderDetail() {
    const c = result.candidates.find(x => x.n_pass === selected);
    if (!c) return null;
    const group = (grade, title, ico) => {
      const items = (c.checks || []).filter(x => x.grade === grade);
      if (!items.length) return null;
      items.sort((a, b) => Number(a.ok) - Number(b.ok));
      return el('div', { class: 'checks' },
        el('h3', { class: 'checks__title' }, icon(ico), title,
          el('span', { class: 'checks__count', text: `${items.filter(x => x.ok).length} / ${items.length} 만족` })),
        el('ul', {}, items.map(x => el('li', { class: x.ok ? 'is-ok' : (grade === 'HARD' ? 'is-fail' : 'is-warn') },
          icon(x.ok ? 'circle-check' : grade === 'HARD' ? 'circle-x' : 'triangle-alert'),
          el('span', { class: 'checks__id', text: x.id }), el('span', { text: x.text })))));
    };
    return el('section', { class: 'card', 'aria-labelledby': 'detail-title' },
      el('div', { class: 'card__head' },
        el('h2', { class: 'card__title', id: 'detail-title' }, icon('clipboard-check'),
          `${c.n_pass}-pass${c.feasible ? ` · ${mm(c.column_id)} mm` : ''} 기준 판정`),
        c.feasible && !c.recommended ? el('div', { class: 'card__tools' },
          el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => apply(c, 'geometry.html') }, icon('ruler'), '이 후보를 형상 입력에 적용')) : null),
      el('div', { class: 'checks-grid' },
        group('HARD', '설계 한계 (넘으면 불가)', 'shield-check'),
        group('SOFT', '권장 기준 (넘으면 경고)', 'triangle-alert')),
      el('p', { class: 'hint' }, icon('info'), 'ID는 기준 문서(docs/tray_design_criteria.md)의 항목 번호입니다. ENG-W는 원본 계산 엔진의 경고입니다.'));
  }

  // ---------------------------------------------------------------- 적용
  function apply(c, page) {
    if (!c.design) return;
    const cur = TrayStore.getDesign() || {};
    const next = c.design;
    next.output_unit = cur.output_unit || next.output_unit;
    TrayStore.setDesign(next);
    design = next;
    toast(`${c.n_pass}-pass · ${mm(c.column_id)} mm 설계를 적용했습니다`);
    setTimeout(() => { location.href = page + location.search; }, 450);   // 정적 사이트의 빌드 번호 유지
  }

  // ---------------------------------------------------------------- 시작
  renderSetup();
  if (!activeLoadings().length) renderEmpty(); else renderIntro();
  refreshIcons();
})();
