/* Tray Rater · 계산 결과 페이지
 *
 * 로딩·형상 입력 페이지가 저장한 설계(TrayStore)를 POST /api/evaluate 로 계산해 보여 준다.
 *   - 핵심 지표 (최대 Jet flood / DC flood / 총 ΔP / 케이스 수)
 *   - 케이스별 막대 차트 3개 (같은 축 단위끼리만 한 차트, 설계 한계 85% 기준선)
 *   - 케이스별 패널(A~D) 결과
 *   - 보고서 표 (원본 GENERAL_DEFAULT 형식), 트레이 요약, 치수표
 *   - 원본 특이사항 수정 옵션(Fixes), 보고서 단위, Excel / CSV / HTML 내보내기
 */
(function () {
  'use strict';

  const FIX_KEY = 'trayRater.fixes.v1';
  const FLOOD_LIMIT = 85;                // 원본 ValidateOutput: Jet / DC flood > 0.85 경고
  const SECTION = { 10: '증기', 15: '액체', 21: '트레이', 25: '수력 결과', 42: '용량 지표', 48: '계수' };
  const KEY_ROWS = new Set([25, 26, 29, 33, 34, 38]);
  const BACKUP_LIMIT = 50;               // Downcomer backup % 설계 한계 (사용자 기준)
  const OVER = { 25: FLOOD_LIMIT, 26: FLOOD_LIMIT, 34: BACKUP_LIMIT, 40: 90 };

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
  function fmt(v, digits) {
    if (!isNum(v)) return v === null || v === undefined || v === '' ? '' : String(v);
    if (v === 0) return '0';
    if (digits === undefined && Number.isInteger(v) && Math.abs(v) < 1e6) return v.toLocaleString('en-US');
    const a = Math.abs(v);
    const d = digits ?? (a >= 1000 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4);
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  // ---------------------------------------------------------------- 상태
  let design = TrayStore.getDesign();
  let fixes = readFixes();
  let result = null;
  let caseIdx = 0;

  function readFixes() {
    try { return JSON.parse(localStorage.getItem(FIX_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveFixes() {
    try { localStorage.setItem(FIX_KEY, JSON.stringify(fixes)); } catch (e) { /* 무시 */ }
  }
  const unit = () => (String((design || {}).output_unit || 'M').toUpperCase() === 'E' ? 'E' : 'M');

  // ---------------------------------------------------------------- 계산 요청
  async function run() {
    if (!design) return renderEmpty();
    $('#content').replaceChildren(el('div', { class: 'skeleton', 'aria-label': '계산 중' }));
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design, fixes, output_unit: unit() }),
      });
      result = await res.json();
    } catch (e) {
      result = { ok: false, server: false, messages: ['계산 서버에 연결할 수 없습니다. python -m tray_rater.webapp 로 실행한 주소에서 여세요.'] };
    }
    if (result.ok && caseIdx >= result.case_labels.length) caseIdx = 0;
    render();
  }

  // ---------------------------------------------------------------- 렌더링
  function render() {
    renderToolbar();
    const box = $('#content');
    if (!result.ok) {
      box.replaceChildren(el('div', { class: 'alerts' }, result.messages.map(m =>
        el('div', { class: 'alert alert--error' }, icon('circle-x'), el('span', { text: m }),
          el('span', { class: 'alert__actions' },
            el('a', { class: 'btn btn--secondary btn--sm', href: 'index.html' }, '로딩 입력'),
            el('a', { class: 'btn btn--secondary btn--sm', href: 'geometry.html' }, '형상 입력'))))));
      return refreshIcons();
    }
    box.replaceChildren(
      renderAlerts(),
      renderStats(),
      el('div', { class: 'charts' },
        chartCard('Jet flood', '케이스별 최대 패널 값 · 설계 한계 85%', 'jet_flood', '%', FLOOD_LIMIT),
        chartCard('Downcomer flood', 'DC 입구 flood · 설계 한계 85%', 'dc_flood', '%', FLOOD_LIMIT),
        chartCard('총 압력강하', '트레이 1단 · 건식 + 습식', 'total_dp_mmHg', 'mm Hg', null)),
      el('div', { class: 'two-col' }, renderPanelCard(), renderTrayCard()),
      renderReportCard(),
    );
    refreshIcons();
  }

  const dpUnit = () => (result.unit === 'E' ? 'in. liquid' : 'mm liquid');

  function renderToolbar() {
    document.querySelectorAll('#unit-seg button').forEach(b => {
      b.setAttribute('aria-checked', String(b.dataset.value === unit()));
      b.onclick = () => {
        design.output_unit = b.dataset.value;
        TrayStore.setDesign(design);
        run();
      };
    });
    const badge = $('#fix-badge');
    badge.replaceChildren(fixes.length
      ? el('span', { class: 'badge badge--warning' }, icon('wrench'), `수정 옵션 ${fixes.length}개 적용`)
      : el('span', { class: 'badge badge--navy' }, icon('circle-check'), '원본과 같은 계산'));
    const opts = (result && result.fix_options) || [];
    if (opts.length) {
      $('#fix-list').replaceChildren(...opts.map(o => {
        const id = `fx-${o.name}`;
        const inp = el('input', { type: 'checkbox', role: 'switch', id, checked: fixes.includes(o.name) });
        inp.addEventListener('change', () => {
          fixes = inp.checked ? [...new Set([...fixes, o.name])] : fixes.filter(x => x !== o.name);
          saveFixes();
          run();
        });
        return el('div', { class: 'switch-row' },
          el('label', { class: 'switch', for: id }, inp, el('span', { class: 'switch__track', 'aria-hidden': 'true' })),
          el('label', { class: 'switch-row__label', for: id }, el('span', {}, el('span', { class: 'fix-code', text: o.code }), o.text)));
      }));
    }
    $('#calc-meta').textContent = result && result.ok ? `케이스 ${result.case_labels.length}개 · 계산 ${Math.round(result.elapsed_ms)} ms` : '';
    refreshIcons();
  }

  function renderAlerts() {
    const items = result.warnings.map(w => el('div', { class: 'alert alert--warning' }, icon('triangle-alert'),
      el('span', {}, el('strong', { text: '원본 경고 · ' }), w)));
    if (!items.length) items.push(el('div', { class: 'alert alert--info' }, icon('circle-check'), el('span', { text: '원본 프로그램의 입력·결과 경고가 없습니다.' })));
    return el('div', { class: 'alerts' }, items);
  }

  function maxOf(key) {
    let best = null;
    result.kpis.forEach(k => { if (isNum(k[key]) && (best === null || k[key] > best.v)) best = { v: k[key], label: k.label }; });
    return best;
  }

  function renderStats() {
    const jf = maxOf('jet_flood'), dc = maxOf('dc_flood'), bk = maxOf('dc_backup_pct'), dp = maxOf('total_dp_mmHg');
    const tile = (label, best, unitTxt, limit, digits = 1) => el('div', { class: 'stat' },
      el('div', { class: 'stat__label', text: label }),
      el('div', { class: 'stat__value' }, best ? fmt(best.v, digits) : '–', el('small', { text: unitTxt })),
      el('div', { class: 'stat__caption' }, best ? best.label : '계산값 없음',
        limit && best && best.v > limit ? el('span', { class: 'badge badge--warning' }, icon('triangle-alert'), `한계 ${limit}% 초과`) : null,
        limit && best && best.v <= limit ? el('span', { class: 'badge badge--success' }, icon('circle-check'), `한계 ${limit}% 이내`) : null));
    const nWarn = result.warnings.length;
    return el('div', { class: 'stats' },
      tile('최대 Jet flood', jf, '%', FLOOD_LIMIT),
      tile('최대 Downcomer flood', dc, '%', FLOOD_LIMIT),
      tile('최대 Downcomer backup', bk, '%', BACKUP_LIMIT),
      tile('최대 총 압력강하', dp, 'mm Hg', null, 2),
      el('div', { class: 'stat' }, el('div', { class: 'stat__label', text: '계산 케이스' }),
        el('div', { class: 'stat__value' }, String(result.case_labels.length), el('small', { text: `${result.n_pass}-pass` })),
        el('div', { class: 'stat__caption' }, nWarn
          ? el('span', { class: 'badge badge--warning' }, icon('triangle-alert'), `원본 경고 ${nWarn}개`)
          : el('span', { class: 'badge badge--success' }, icon('circle-check'), '경고 없음'))));
  }

  // ---------------------------------------------------------------- 막대 차트 (가로, 단일 계열)
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function chartCard(title, sub, key, unitTxt, limit) {
    const NS = 'http://www.w3.org/2000/svg';
    const data = result.kpis.map(k => ({ label: k.label, v: isNum(k[key]) ? k[key] : null, k }));
    const W = 420, padL = 92, padR = 56, rowH = 28, bar = 16, top = 20, axisH = 22;
    const H = top + data.length * rowH + axisH;
    const vmax = Math.max(...data.map(d => d.v ?? 0), limit ? 100 : 0);
    const xmax = niceMax(vmax);
    const x = v => padL + (v / xmax) * (W - padL - padR);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${title} 케이스별 막대 차트 (${unitTxt})`);
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text !== undefined) e.textContent = text;
      svg.append(e);
      return e;
    };
    // 격자·축 (recessive)
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (xmax * i) / ticks, xx = x(v);
      add('line', { x1: xx, y1: top - 6, x2: xx, y2: H - axisH, class: 'grid' });
      add('text', { x: xx, y: H - 6, 'text-anchor': 'middle', class: 'axis-text' }, fmt(v, v % 1 ? 1 : 0));
    }
    data.forEach((d, i) => {
      const cy = top + i * rowH + rowH / 2;
      add('text', { x: padL - 10, y: cy + 4, 'text-anchor': 'end', class: 'cat-text' }, d.label);
      if (d.v !== null && d.v > 0) {
        const x0 = x(0), x1 = x(d.v), w = Math.max(x1 - x0, 1), r = Math.min(4, w);
        // 기준선 쪽 직각, 끝 4px 둥글게
        add('path', {
          class: 'bar', 'data-i': i,
          d: `M ${x0} ${cy - bar / 2} H ${x1 - r} Q ${x1} ${cy - bar / 2} ${x1} ${cy - bar / 2 + r} V ${cy + bar / 2 - r} Q ${x1} ${cy + bar / 2} ${x1 - r} ${cy + bar / 2} H ${x0} Z`,
        });
      }
      const over = limit && d.v !== null && d.v > limit;
      const tx = d.v !== null ? x(Math.max(d.v, 0)) + 6 : x(0) + 6;
      add('text', { x: tx, y: cy + 4, class: 'val-text' }, d.v === null ? '–' : fmt(d.v, 1) + (over ? ' ▲' : ''));
      const hit = add('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: 'hit', 'data-i': i });
      hit.addEventListener('mousemove', e => showTip(e, d, title, unitTxt, key, i, svg));
      hit.addEventListener('mouseleave', () => hideTip(svg));
    });
    if (limit) {
      const lx = x(limit);
      add('line', { x1: lx, y1: top - 10, x2: lx, y2: H - axisH, class: 'limit' });
      add('text', { x: lx, y: top - 12, 'text-anchor': 'middle', class: 'limit-text' }, `한계 ${limit}%`);
    }
    return el('section', { class: 'chart-card' },
      el('h3', { text: `${title} (${unitTxt})` }), el('p', { class: 'chart-sub', text: sub }),
      el('div', { class: 'chart' }, svg));
  }

  function showTip(e, d, title, unitTxt, key, i, svg) {
    svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('is-hover', +b.dataset.i === i));
    const tip = $('#chart-tip');
    const panels = (d.k.panels || []).filter(p => isNum(p[key]));
    const lines = [
      el('div', {}, el('strong', { text: d.label })),
      el('div', { text: `${title}: ${d.v === null ? '계산값 없음' : fmt(d.v, 2) + ' ' + unitTxt}` }),
    ];
    if (!key.startsWith('total_dp') && panels.length > 1) lines.push(el('div', { text: panels.map(p => `Panel ${p.name} ${fmt(p[key], 1)}%`).join(' · ') }));
    tip.replaceChildren(...lines);
    tip.hidden = false;
    const pad = 14;
    let left = e.clientX + pad, topY = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - pad;
    if (topY + r.height > window.innerHeight - 8) topY = e.clientY - r.height - pad;
    tip.style.left = `${left}px`;
    tip.style.top = `${topY}px`;
  }
  function hideTip(svg) {
    $('#chart-tip').hidden = true;
    svg.querySelectorAll('.bar').forEach(b => b.classList.remove('is-hover'));
  }

  // ---------------------------------------------------------------- 패널별 결과
  function renderPanelCard() {
    const k = result.kpis[caseIdx];
    const picker = el('div', { class: 'case-picker', role: 'group', 'aria-label': '케이스 선택' },
      result.case_labels.map((c, i) => el('button', {
        type: 'button', 'aria-pressed': String(i === caseIdx), text: c,
        onclick: () => { caseIdx = i; render(); },
      })));
    const dpScale = result.unit === 'E' ? 1 : 25.4;
    const rows = [
      ['Jet flood', '%', p => p.jet_flood, 1, FLOOD_LIMIT],
      ['Downcomer flood', '%', p => p.dc_flood, 1, FLOOD_LIMIT],
      ['DC backup', '%', p => p.dc_backup_frac, 1, BACKUP_LIMIT],
      ['총 압력강하', dpUnit(), p => (isNum(p.total_drop) ? p.total_drop * dpScale : null), 2],
      ['Weeping', '%', p => p.weep, 2],
      ['증기 속도 (활성면적)', 'ft/s', p => p.uv, 3],
    ];
    const head = el('tr', {}, el('th', { text: '항목' }), el('th', { text: '단위' }), k.panels.map(p => el('th', { text: `Panel ${p.name}` })));
    const body = rows.map(([lab, u, fn, d, lim]) => el('tr', {},
      el('td', { class: 'lab', text: lab }), el('td', { class: 'u', text: u }),
      k.panels.map(p => {
        const v = fn(p);
        return el('td', { class: 'num' }, lim && isNum(v) && v > lim
          ? el('span', { class: 'over' }, icon('triangle-alert'), fmt(v, d)) : (isNum(v) ? fmt(v, d) : '–'));
      })));
    return el('section', { class: 'card' },
      el('div', { class: 'card__head' }, el('h2', { class: 'card__title' }, icon('layout-panel-left'), '패널별 결과')),
      picker,
      el('div', { class: 'table-wrap' }, el('table', { class: 'report-table' }, el('thead', {}, head), el('tbody', {}, body))),
      el('p', { class: 'hint' }, icon('info'), '보고서의 각 항목은 활성 패널 중 가장 불리한 값(최대, spray factor 는 최소)입니다.'));
  }

  // ---------------------------------------------------------------- 트레이 요약 / 치수
  function renderTrayCard() {
    // 개구율은 원본 보고서에 분율(0.0403)로 들어가므로 화면에서는 % 로 환산해 표시
    const shown = result.summary.map(s => (/OPENING \(%\)/.test(s.label) && isNum(s.value) ? { ...s, value: s.value * 100, unit: '%' } : s));
    const sum = el('table', { class: 'report-table' }, el('tbody', {}, shown.map(s => el('tr', {},
      el('td', { class: 'lab', text: s.label }), el('td', { class: 'u', text: (s.unit || '').replace(/[()]/g, '') }),
      el('td', { class: isNum(s.value) ? 'num' : 'txt', text: isNum(s.value) ? fmt(s.value) : (s.value ?? '') })))));
    const oc = result.dim_offcenter_label;
    const dim = el('table', { class: 'report-table' },
      el('thead', {}, el('tr', {}, ['치수', '단위', 'Side 상', 'Side 하', `${oc} 상`, `${oc} 하`, 'Center 상', 'Center 하'].map(t => el('th', { text: t })))),
      el('tbody', {}, result.dimensions.map(r => el('tr', {},
        el('td', { class: 'lab', text: r.label }), el('td', { class: 'u', text: (r.unit || '').replace(/[()]/g, '') }),
        r.values.map(v => el('td', { class: isNum(v) ? 'num' : 'txt' + (String(v).startsWith('#') ? ' err' : ''), text: isNum(v) ? fmt(v) : (v ?? '') }))))));
    return el('section', { class: 'card' },
      el('div', { class: 'card__head' }, el('h2', { class: 'card__title' }, icon('layers'), '트레이 요약')),
      el('div', { class: 'table-wrap' }, sum),
      el('div', { class: 'card__head', style: 'margin-top:24px' }, el('h2', { class: 'card__title' }, icon('ruler'), '치수')),
      el('div', { class: 'table-wrap' }, dim));
  }

  // ---------------------------------------------------------------- 보고서 표
  function renderReportCard() {
    const head = el('tr', {}, el('th', { text: '항목' }), el('th', { text: '단위' }), result.case_labels.map(c => el('th', { text: c })));
    const rows = [];
    for (const r of result.main) {
      if (r.row === 6) continue;                       // 케이스 이름은 머리글
      if (SECTION[r.row]) rows.push(el('tr', { class: 'sec' }, el('td', { colspan: result.case_labels.length + 2, text: SECTION[r.row] })));
      rows.push(el('tr', { class: KEY_ROWS.has(r.row) ? 'key' : '' },
        el('td', { class: 'lab', text: r.label }), el('td', { class: 'u', text: r.unit }),
        r.values.map(v => {
          if (!isNum(v)) return el('td', { class: 'txt' + (String(v ?? '').startsWith('#') ? ' err' : ''), text: v ?? '' });
          const lim = OVER[r.row];
          return el('td', { class: 'num' }, lim && v > lim ? el('span', { class: 'over' }, icon('triangle-alert'), fmt(v)) : fmt(v));
        })));
    }
    return el('section', { class: 'card card--flush' },
      el('div', { class: 'card__head card__head--pad' },
        el('h2', { class: 'card__title' }, icon('table'), '보고서'),
        el('span', { class: 'card__meta', text: `원본 GENERAL_DEFAULT 형식 · ${result.unit === 'E' ? 'English' : 'Metric'}` })),
      el('div', { class: 'table-wrap' }, el('table', { class: 'report-table' }, el('thead', {}, head), el('tbody', {}, rows))));
  }

  // ---------------------------------------------------------------- 빈 상태
  function renderEmpty() {
    renderToolbarEmpty();
    $('#content').replaceChildren(el('section', { class: 'card empty-state' },
      el('h2', { text: '계산할 입력이 없습니다' }),
      el('p', { text: '로딩과 형상을 입력하거나 원본 예제를 불러오세요.' }),
      el('div', { class: 'page-actions', style: 'justify-content:center' },
        el('a', { class: 'btn btn--secondary', href: 'index.html' }, icon('table-2'), '로딩 입력'),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: loadExample }, icon('file-text'), '예제로 계산'))));
    refreshIcons();
  }
  function renderToolbarEmpty() { $('#calc-meta').textContent = ''; $('#fix-badge').replaceChildren(); }

  async function loadExample() {
    try {
      const res = await fetch('../examples/original_design.json', { cache: 'no-store' });
      design = await res.json();
      TrayStore.setDesign(design);
      run();
    } catch (e) { toast('예제는 로컬 서버로 열었을 때만 불러올 수 있습니다', true); }
  }

  // ---------------------------------------------------------------- 내보내기
  async function exportFile(fmtName) {
    if (!design) return toast('계산할 입력이 없습니다', true);
    try {
      const res = await fetch(`/api/report/${fmtName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design, fixes, output_unit: unit() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j.messages || [res.status]).join(' '));
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const name = m ? decodeURIComponent(m[1]) : `tray_result.${fmtName}`;
      const blob = await res.blob();
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      toast(`${name} 을(를) 저장했습니다`);
    } catch (e) { toast(`보고서를 만들 수 없습니다. ${e.message}`, true); }
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

  // ---------------------------------------------------------------- 이벤트
  document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => exportFile(b.dataset.export)));
  $('#btn-recalc').addEventListener('click', () => { design = TrayStore.getDesign(); run(); });
  $('#btn-fixes').addEventListener('click', () => {
    const p = $('#fix-panel');
    p.hidden = !p.hidden;
    $('#btn-fixes').setAttribute('aria-expanded', String(!p.hidden));
  });

  run();
  window.trayResults = { get result() { return result; }, run, get fixes() { return fixes; } };
})();
