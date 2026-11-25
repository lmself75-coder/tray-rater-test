/* Tray Rater · 형상 입력 페이지 (참조: Pass_Layout.pdf)
 *
 * 입력값은 TrayDesign JSON 의 geometry (+ geometry_unit) 에 저장한다 (tray_rater/design.py GEOMETRY_CELLS).
 * 회색 계산값은 서버 API (POST /api/geometry, tray_rater/webapp.py) 가 Python 형상 엔진으로 계산한다.
 * 패스 수에 따라 열이 바뀐다: 1P Side / 2P Side·Center / 3P Side·Off Center(2) / 4P Side·Off Center(2)·Center
 */
(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  };
  const icon = name => el('i', { 'data-lucide': name });
  const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };
  const fill = (box, ...items) => box.replaceChildren(...items.flat().filter(x => x !== null && x !== undefined && x !== false));
  const isBlank = v => v === undefined || v === null || String(v).trim() === '';
  function parseNum(s) {
    if (isBlank(s)) return null;
    const v = Number(String(s).trim().replace(/,/g, ''));
    return Number.isFinite(v) ? v : NaN;
  }

  // ---------------------------------------------------------------- 상태
  const DEFAULT_GEOMETRY = {
    tray_type: 'VALVE', column_id: null, n_pass: 1, valve1_type: 'mfix6', open_area: null, valve2_type: 'mfix6',
    valve2_fraction: 0, metallurgy: 'SA-283C (C.S)', optim_enabled: false, deck_thickness: 2, mcsd: 'NO',
    inlet_sump: 'NO', swept_back_weir: 'NO', swept_back_distance: 0, relief_hole: 'NO', envelope: 'NO',
    envelope_width: 35, side_weir_height: 50, center_weir_height: 50, side_dc_clearance: 38, center_dc_clearance: 38,
    dp_factor: 1,
  };
  let design = TrayStore.getDesign() || {};
  design.geometry = Object.assign({}, DEFAULT_GEOMETRY, design.geometry || {});
  if (!design.geometry.column_id && !TrayStore.getDesign()) design.geometry.column_id = null;
  let catalog = { tray_types: ['VALVE', 'SIEVE', 'GT-PURGE™', 'GT-OPTIM™', 'BUBBLE CAP'], valves: [], materials: [],
                  caps: [{ id: 'BC-3"', label: '3" bubble cap', od_in: 3 }, { id: 'BC-4"', label: '4" bubble cap (FRI standard)', od_in: 4 },
                         { id: 'BC-6"', label: '6" bubble cap', od_in: 6 }] };
  const isBubble = () => String(G().tray_type || '').toUpperCase() === 'BUBBLE CAP';
  const isCap = v => catalog.caps.some(c => c.id === v);
  // 트레이 종류를 바꾸면 밸브 종류를 맞는 목록의 값으로 바꾼다 (캡 <-> 밸브)
  function onTrayType(v) {
    const bubble = String(v).toUpperCase() === 'BUBBLE CAP';
    if (bubble && !isCap(G().valve1_type)) G().valve1_type = 'BC-4"';
    if (!bubble && isCap(G().valve1_type)) G().valve1_type = 'mfix6';
  }
  let calc = null;            // 마지막 API 결과
  let serverOk = true;
  const G = () => design.geometry;
  const nPass = () => { const v = parseInt(G().n_pass, 10); return [1, 2, 3, 4].includes(v) ? v : 1; };
  const unitE = () => String(design.geometry_unit || 'M').toUpperCase() === 'E';
  const LEN = () => (unitE() ? 'in' : 'mm');

  // ---------------------------------------------------------------- 저장 / 계산 요청
  let timer = null;
  function changed() {
    // swept-back weir 는 거리 입력으로 켜고 끈다 (원본: I8 YES/NO + J8 거리)
    const d = parseNum(G().swept_back_distance);
    G().swept_back_weir = d > 0 ? 'YES' : 'NO';
    TrayStore.setDesign(design);
    clearTimeout(timer);
    timer = setTimeout(requestCalc, 250);
  }

  async function requestCalc() {
    try {
      const res = await fetch('/api/geometry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design }),
      });
      calc = await res.json();
      serverOk = true;
    } catch (e) {
      calc = null;
      serverOk = false;
    }
    renderCalc();
  }

  // ---------------------------------------------------------------- 입력 컴포넌트
  /** 숫자 입력. scale: 표시 = 저장값 x scale (개구율·blocking 은 % 로 표시) */
  function numInput(field, { scale = 1, placeholder, label, disabled } = {}) {
    const v = G()[field];
    const inp = el('input', {
      class: 'input num', inputmode: 'decimal', autocomplete: 'off', 'data-field': field,
      placeholder: placeholder ?? '', 'aria-label': label || field, disabled,
    });
    inp.value = isBlank(v) ? '' : String(+(Number(v) * scale).toPrecision(12));
    inp.addEventListener('input', () => {
      const x = parseNum(inp.value);
      inp.classList.toggle('is-error', Number.isNaN(x));
      if (Number.isNaN(x)) return;
      G()[field] = x === null ? null : +(x / scale).toPrecision(12);
      changed();
    });
    return inp;
  }
  // options: 값 목록 또는 [값, 표시 이름] 목록
  function selectInput(field, options, label, onChange) {
    const s = el('select', { class: 'input select', 'aria-label': label, 'data-field': field });
    const cur = G()[field];
    const opts = options.map(o => (Array.isArray(o) ? o : [o, o]));
    if (cur && !opts.some(([v]) => String(v).toLowerCase() === String(cur).toLowerCase())) opts.unshift([cur, cur]);
    for (const [v, t] of opts) s.append(el('option', { value: v, text: t, selected: String(v).toLowerCase() === String(cur ?? '').toLowerCase() }));
    s.addEventListener('change', () => { G()[field] = s.value; if (onChange) onChange(s.value); changed(); renderAll(); });
    return el('div', { class: 'select-wrap' }, s, icon('chevron-down'));
  }
  function switchInput(field, label, { on = 'YES', off = 'NO', hint } = {}) {
    const cur = G()[field];
    const checked = typeof on === 'boolean' ? cur === true : String(cur ?? '').toUpperCase() === String(on).toUpperCase();
    const id = `sw-${field}`;
    const inp = el('input', { type: 'checkbox', role: 'switch', id, checked });
    inp.addEventListener('change', () => { G()[field] = inp.checked ? on : off; changed(); renderAll(); });
    return el('div', { class: 'switch-row' },
      el('label', { class: 'switch', for: id }, inp, el('span', { class: 'switch__track', 'aria-hidden': 'true' })),
      el('label', { class: 'switch-row__label', for: id }, label, hint ? el('span', { class: 'switch-row__hint', text: hint }) : null));
  }
  function field(label, control, unit, help) {
    return el('div', { class: 'field field--row' },
      el('span', { class: 'field__label', text: label }),
      el('div', { class: 'field__control' }, control, unit ? el('span', { class: 'unit', text: unit }) : null),
      help ? el('span', { class: 'field__help', text: help }) : null);
  }
  function segmented(key, items, label, target = 'geometry') {
    const cur = target === 'geometry' ? G()[key] : design[key];
    const box = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
    for (const [v, text] of items) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(String(cur ?? '') === String(v)), text });
      b.addEventListener('click', () => {
        if (target === 'geometry') G()[key] = v; else design[key] = v;
        changed(); renderAll();
      });
      box.append(b);
    }
    return box;
  }

  // ---------------------------------------------------------------- 왼쪽 패널
  function renderLeft() {
    const sieve = String(G().tray_type || '').toUpperCase() === 'SIEVE';
    const bubble = isBubble();
    fill($('#tray-fields'),
      field('트레이 종류', selectInput('tray_type', catalog.tray_types, '트레이 종류', onTrayType)),
      field('Tower 지름', numInput('column_id', { label: 'Tower 지름', placeholder: '0' }), LEN()),
      field('패스 수', segmented('n_pass', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], '패스 수')),
      field('형상 단위', segmented('geometry_unit', [['M', 'mm'], ['E', 'inch']], '형상 단위', 'design')),
    );
    const capOd = (catalog.caps.find(c => c.id === G().valve1_type) || {}).od_in || 4;
    const skirtDefault = unitE() ? (0.375 * capOd / 4).toFixed(3) : (9.525 * capOd / 4).toFixed(1);
    fill($('#aa-fields'),
      bubble
        ? [field('캡 크기', selectInput('valve1_type', catalog.caps.map(c => [c.id, c.label]), '캡 크기'), null,
                 'FRI 표준 캡 형상. 3"·6" 는 4" 표준을 비례 확대·축소'),
           field('Skirt clearance', numInput('bc_skirt_clearance', { label: 'Skirt clearance', placeholder: skirtDefault }), LEN(),
                 `캡 하단 ~ 트레이 바닥 (slot 높이). 비우면 ${skirtDefault} ${LEN()}`),
           field('캡 수', numInput('bc_cap_count', { label: '캡 수', placeholder: '자동' }), 'caps',
                 '비우면 활성면적으로 추정 (삼각 배열, 배치 효율 85%)')]
        : sieve
          ? field('홀 지름', numInput('sieve_hole_override', { label: '홀 지름', placeholder: '13' }), 'mm', '비우면 13 mm')
          : field('밸브 종류', selectInput('valve1_type', catalog.valves, '밸브 종류')),
      bubble ? null : field('개구율', numInput('open_area', { scale: 100, label: '개구율 %', placeholder: '0' }), '%', '활성면적 대비 개구 면적 (5 ~ 18%)'),
      field('데크 두께', numInput('deck_thickness', { label: '데크 두께' }), 'mm'),
      field('재질', selectInput('metallurgy', catalog.materials, '재질')),
    );
    const n = nPass();
    fill($('#opt-fields'),
      switchInput('inlet_sump', 'Inlet sump / weir', { hint: 'Sump 깊이·inlet weir 높이 입력 사용' }),
      switchInput('mcsd', 'GT-Optim™ MCSD', { hint: '측면 DC 하부 형상을 MCSD 로 계산' }),
      bubble ? null : switchInput('relief_hole', 'Relief hole', { hint: '밸브 슬롯 면적에 relief hole 포함' }),
      switchInput('envelope', 'Envelope', { on: 'yes', off: 'NO', hint: '1-pass 측면 DC 면적을 envelope 기준으로' }),
      String(G().envelope || '').toLowerCase() === 'yes'
        ? field('Envelope 폭', numInput('envelope_width', { label: 'Envelope 폭' }), 'mm') : null,
      bubble ? null : switchInput('optim_enabled', 'GT-OPTIM capacity factor', { on: true, off: false, hint: '비우면 1.1 적용' }),
      !bubble && G().optim_enabled === true ?field('Capacity factor', numInput('optim_factor_override', { placeholder: '1.1', label: 'Capacity factor' })) : null,
      el('div', { class: 'divider' }),
      sieve || bubble ? null : field('두 번째 밸브', selectInput('valve2_type', catalog.valves, '두 번째 밸브 종류')),
      sieve || bubble ? null : field('두 번째 밸브 비율', numInput('valve2_fraction', { scale: 100, label: '두 번째 밸브 비율 %' }), '%'),
      field('ΔP factor', numInput('dp_factor', { label: 'Pressure drop factor', placeholder: '1' })),
      n >= 3 ? field('Off-center DC 위치', numInput('ocdc_override', { label: 'Off-center DC 위치', placeholder: '자동' }), LEN(),
        '탑 중심에서 DC 중심까지. 비우면 패스 길이가 같도록 자동 계산') : null,
    );
  }

  // ---------------------------------------------------------------- 다운커머 / 위어 표
  // 열 구성: side / offcenter(2칸) / center
  function groups() {
    const n = nPass();
    const g = [{ id: 'side', label: 'Side', span: 1 }];
    if (n >= 3) g.push({ id: 'offcenter', label: 'Off Center', span: 2 });
    if (n === 2 || n === 4) g.push({ id: 'center', label: 'Center', span: 1 });
    return g;
  }

  // 행 정의. 각 열: in(입력 필드) / calc(API 값 키) / same(측면 값 그대로) / pair(off-center 두 칸)
  const L = 'len', A = 'area', P = 'pct';
  const ROWS = [
    { section: '다운커머와 위어', icon: 'ruler' },
    { label: 'Width Top', sub: 'DC 상부 폭', unit: L, side: { in: 'side_dc_width_top' }, offcenter: { in: 'offcenter_dc_width_top' }, center: { in: 'center_dc_width_top' } },
    { label: 'Kickback', sub: '하부 폭 축소량', unit: L, side: { in: 'side_kickback' }, offcenter: { in: 'offcenter_kickback' }, center: { in: 'center_kickback' } },
    { label: 'Width Bottom', sub: 'DC 하부 폭 (계산)', unit: L, side: { calc: c => c.tray.side_bottom }, offcenter: { js: () => sub2('offcenter_dc_width_top', 'offcenter_kickback') }, center: { js: () => sub2('center_dc_width_top', 'center_kickback') } },
    { label: 'Swept Back Weir', sub: '위어 후퇴 거리', unit: L, side: { in: 'swept_back_distance', placeholder: '0' } },
    { label: 'Sump Depth', sub: 'Inlet sump 깊이', unit: L, sump: true, side: { in: 'side_sump_depth' }, offcenter: { in: 'offcenter_sump_depth' }, center: { in: 'center_sump_depth' } },
    { label: 'Sump Width', sub: 'Inlet sump 폭 (계산)', unit: L, side: { calc: c => c.columns.side?.inlet_width }, offcenter: { calc: c => c.columns.offcenter?.inlet_width }, center: { calc: c => c.columns.center?.inlet_width } },
    { label: 'Weir Height', sub: '출구 위어 높이', unit: L, side: { in: 'side_weir_height' }, offcenter: { same: 'side_weir_height' }, center: { in: 'center_weir_height' } },
    { label: 'Downcomer Clearance', sub: 'DC 하부 간극', unit: L, side: { in: 'side_dc_clearance' }, offcenter: { same: 'side_dc_clearance' }, center: { in: 'center_dc_clearance' } },
    { section: '다운커머 면적', icon: 'square-dashed' },
    { label: 'Top Area', sub: 'DC 상부 면적', unit: A, side: { calc: c => c.columns.side?.top_area }, offcenter: { calc: c => c.columns.offcenter?.top_area }, center: { calc: c => c.columns.center?.top_area } },
    { label: 'Bottom Area', sub: 'DC 하부 면적', unit: A, side: { calc: c => c.columns.side?.bottom_area }, offcenter: { calc: c => c.columns.offcenter?.bottom_area }, center: { calc: c => c.columns.center?.bottom_area } },
    { label: 'Exit Area', sub: 'DC 출구 면적', unit: A, side: { calc: c => c.columns.side?.exit_area }, offcenter: { pair: [c => c.columns.offcenter?.exit_area, c => c.columns.offcenter?.exit_area_2] }, center: { calc: c => c.columns.center?.exit_area } },
    { section: '위어 길이', icon: 'move-horizontal' },
    { label: 'Top Weir Length', sub: '상부 현 길이 (계산)', unit: L, side: { calc: c => c.columns.side?.weir_chord }, offcenter: { pair: [c => c.columns.offcenter?.weir_chord, c => c.columns.offcenter?.weir_chord_2] }, center: { calc: c => c.columns.center?.weir_chord } },
    { label: '% Blocked', sub: '위어 막음 비율', unit: P, side: { in: 'side_weir_blanking', scale: 100 }, offcenter: { in: 'offcenter_weir_blanking', scale: 100, placeholder: '자동' }, center: { in: 'center_weir_blanking', scale: 100 } },
    { label: 'Effective Weir Length', sub: '막음 반영 위어 길이', unit: L, side: { calc: c => c.columns.side?.weir_length }, offcenter: { pair: [c => c.columns.offcenter?.weir_length, c => c.columns.offcenter?.weir_length_2] }, center: { calc: c => c.columns.center?.weir_length } },
    { label: 'Bottom Edge Length', sub: '하부 현 길이 (계산)', unit: L, side: { calc: c => c.columns.side?.edge_chord }, offcenter: { pair: [c => c.columns.offcenter?.edge_chord, c => c.columns.offcenter?.edge_chord_2] }, center: { calc: c => c.columns.center?.edge_chord } },
    { label: '% Blocked', sub: '간극 막음 비율', unit: P, side: { in: 'side_clearance_blanking', scale: 100 }, offcenter: { in: 'offcenter_clearance_blanking', scale: 100, placeholder: '자동' }, center: { in: 'center_clearance_blanking', scale: 100 } },
    { label: 'Effective Edge Length', sub: '막음 반영 하부 길이', unit: L, side: { calc: c => c.columns.side?.edge_length }, offcenter: { pair: [c => c.columns.offcenter?.edge_length, c => c.columns.offcenter?.edge_length_2] }, center: { calc: c => c.columns.center?.edge_length } },
    { section: 'Inlet 위어', icon: 'arrow-down-to-line' },
    { label: 'Height', sub: 'Inlet weir 높이', unit: L, side: { in: 'side_inlet_weir_height', sump: true }, offcenter: { pairIn: ['offcenter_inlet_weir_height', 'inlet_weir_height_g24'] }, center: { in: 'center_inlet_weir_height', sump: true } },
    { label: 'Inlet Width', sub: '입구 폭 직접 입력', unit: L, sump: true, side: { in: 'side_inlet_width_override', placeholder: '자동' }, offcenter: { in: 'offcenter_inlet_width_override', placeholder: '자동' }, center: { in: 'center_inlet_width_override', placeholder: '자동' } },
  ];

  function sub2(topField, kickField) {
    const t = parseNum(G()[topField]) ?? 0, k = parseNum(G()[kickField]) ?? 0;
    return Number.isNaN(t) || Number.isNaN(k) ? null : t - k * 2;
  }

  function unitLabel(u) {
    if (u === L) return LEN();
    if (u === A) return unitE() ? 'ft2' : 'm2';
    if (u === P) return '%';
    return '';
  }
  /** API 값 (mm, m2) -> 표시 단위 */
  function showCalc(v, u) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    let x = v;
    if (u === L && unitE()) x = v / 25.4;
    if (u === A && unitE()) x = v * 10.76391;
    const d = u === A ? 4 : Math.abs(x) >= 1000 ? 1 : 2;
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function renderTable() {
    const gs = groups();
    const table = $('#dc-table');
    const nCols = 1 + gs.reduce((s, g) => s + g.span, 0) + 1;
    const head = el('tr', {}, el('th', { class: 'rowhead', scope: 'col' }));
    for (const g of gs) head.append(el('th', { class: `colgroup colgroup--${g.id}`, colspan: g.span, scope: 'colgroup', text: g.label }));
    head.append(el('th', { class: 'unitcol', scope: 'col', text: '단위' }));
    const rows = [el('thead', {}, head)];
    const body = el('tbody');
    const sumpOn = String(G().inlet_sump || '').toUpperCase() === 'YES';
    for (const r of ROWS) {
      if (r.section) {
        body.append(el('tr', { class: 'group' }, el('th', { colspan: nCols, scope: 'colgroup' },
          el('span', { class: 'group__title' }, icon(r.icon), r.section))));
        continue;
      }
      const tr = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' },
        el('span', { class: 'rowhead__label', text: r.label }), el('span', { class: 'rowhead__sub', text: r.sub })));
      for (const g of gs) {
        const spec = r[g.id];
        const disabled = (r.sump || spec?.sump) && !sumpOn;
        if (!spec) { tr.append(el('td', { colspan: g.span, class: 'blank' })); continue; }
        if (spec.in) {
          tr.append(el('td', { colspan: g.span }, numInput(spec.in, {
            scale: spec.scale || 1, placeholder: spec.placeholder, disabled,
            label: `${g.label} ${r.label}`,
          })));
        } else if (spec.pairIn) {
          for (const f of spec.pairIn) tr.append(el('td', {}, numInput(f, { label: `${g.label} ${r.label}` })));
        } else if (spec.same) {
          const cell = el('td', { colspan: g.span, class: 'calc num', title: '원본 계산은 측면 값을 그대로 사용합니다' },
            el('span', { class: 'calc-box', 'data-same': spec.same }));
          tr.append(cell);
        } else if (spec.pair) {
          spec.pair.forEach((fn, i) => tr.append(el('td', { class: 'calc num' }, el('span', { class: 'calc-box', 'data-calc': `${r.label}|${g.id}|${i}` }))));
        } else {
          tr.append(el('td', { colspan: g.span, class: 'calc num' }, el('span', { class: 'calc-box', 'data-calc': `${r.label}|${g.id}` })));
        }
      }
      tr.append(el('td', { class: 'unitcol', text: unitLabel(r.unit) }));
      body.append(tr);
    }
    rows.push(body);
    table.replaceChildren(...rows);
    $('#pass-meta').textContent = `${nPass()}-pass · 입력 단위 ${LEN()}`;
  }

  function renderPanels() {
    const n = nPass();
    const names = 'ABCD'.slice(0, n).split('');
    const fields = ['panel_a_area_override', 'panel_b_area_override', 'panel_c_area_override', 'panel_d_area_override'];
    const head = el('tr', {}, el('th', { class: 'rowhead', scope: 'col' }), ...names.map(p => el('th', { class: 'colgroup', scope: 'col', text: `Panel ${p}` })), el('th', { class: 'unitcol', text: '단위' }));
    const tr1 = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' }, el('span', { class: 'rowhead__label', text: 'Active Area' }), el('span', { class: 'rowhead__sub', text: '패널 활성면적 (계산)' })),
      ...names.map((p, i) => el('td', { class: 'calc num' }, el('span', { class: 'calc-box', 'data-panel': `${i}|active_area` }))), el('td', { class: 'unitcol', text: unitLabel(A) }));
    const tr2 = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' }, el('span', { class: 'rowhead__label', text: 'Flow Path Length' }), el('span', { class: 'rowhead__sub', text: '액 흐름 길이 (계산)' })),
      ...names.map((p, i) => el('td', { class: 'calc num' }, el('span', { class: 'calc-box', 'data-panel': `${i}|flow_path` }))), el('td', { class: 'unitcol', text: unitLabel(L) }));
    const tr3 = el('tr', {}, el('th', { class: 'rowhead', scope: 'row' }, el('span', { class: 'rowhead__label', text: 'Area Override' }), el('span', { class: 'rowhead__sub', text: '활성면적 직접 입력' })),
      ...names.map((p, i) => el('td', {}, numInput(fields[i], { placeholder: '자동', label: `Panel ${p} 활성면적 직접 입력` }))), el('td', { class: 'unitcol', text: unitE() ? 'in2' : 'mm2' }));
    $('#panel-table').replaceChildren(el('thead', {}, head), el('tbody', {}, tr1, tr2, tr3));
  }

  // ---------------------------------------------------------------- 계산값 채우기
  function renderCalc() {
    const c = calc && calc.ok ? calc : null;
    document.querySelectorAll('[data-calc]').forEach(box => {
      const [label, gid, idx] = box.dataset.calc.split('|');
      const row = ROWS.find(r => r.label === label && r[gid] && (r[gid].calc || r[gid].pair || r[gid].js) && box.closest('tr').querySelector('.rowhead__label').textContent === label);
      const spec = row[gid];
      let v = null;
      if (spec.js) v = spec.js();
      else if (c) v = spec.pair ? spec.pair[+idx](c) : spec.calc(c);
      box.textContent = showCalc(v, row.unit);
    });
    document.querySelectorAll('[data-same]').forEach(box => {
      const v = parseNum(G()[box.dataset.same]);
      box.textContent = v === null || Number.isNaN(v) ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    });
    document.querySelectorAll('[data-panel]').forEach(box => {
      const [i, key] = box.dataset.panel.split('|');
      const v = c && c.panels[+i] ? c.panels[+i][key] : null;
      box.textContent = showCalc(v, key === 'active_area' ? A : L);
    });
    // 활성 영역 요약
    const t = c ? c.tray : {};
    const sieve = String(G().tray_type || '').toUpperCase() === 'SIEVE';
    const bubble = isBubble();
    const what = bubble ? ['캡 수', 'caps', '캡 밀도'] : sieve ? ['홀 수', 'holes', '홀 밀도'] : ['밸브 수', 'valves', '밸브 밀도'];
    const lenOut = mmv => (mmv == null ? '–' : unitE() ? (mmv / 25.4).toFixed(3) : mmv.toFixed(1));
    const items = [
      ['활성 면적', showCalc(t.active_area, A), unitLabel(A)],
      [what[0], t.n_valves == null ? '–' : Math.round(t.n_valves).toLocaleString('en-US'), what[1]],
      [what[2], t.valve_density == null ? '–' : t.valve_density.toFixed(1), '#/m2'],
      bubble ? ['캡 피치 (삼각)', lenOut(t.cap && t.cap.pitch_mm), LEN()]
             : ['Net rise', sieve || t.net_rise == null ? '–' : t.net_rise.toFixed(2), 'mm'],
      bubble ? ['Riser 높이', lenOut(t.cap && t.cap.riser_height_mm), LEN()] : null,
      ['Tower 단면적', showCalc(t.tower_area, A), unitLabel(A)],
    ].filter(Boolean);
    if (String(G().mcsd || '').toUpperCase() === 'YES' && t.mcsd_joint) items.push(['MCSD 접합', t.mcsd_joint, '']);
    $('#aa-calc').replaceChildren(...items.flatMap(([k, v, u]) => [el('dt', { text: k }), el('dd', {}, el('span', { class: 'num', text: v }), el('span', { class: 'unit', text: u }))]));
    renderStatus();
    renderSketch();
  }

  function renderStatus() {
    const box = $('#status');
    const parts = [];
    if (!serverOk) {
      parts.push(el('span', { class: 'badge badge--muted' }, icon('plug-zap'), '계산 서버 없음'),
        el('p', { class: 'status-text', text: '계산값은 python -m tray_rater.webapp 로 열었을 때 표시됩니다. 입력은 그대로 저장됩니다.' }));
    } else if (!calc) {
      parts.push(el('span', { class: 'badge badge--muted' }, icon('loader'), '계산 중'));
    } else if (!calc.ok || calc.messages.length) {
      parts.push(el('span', { class: `badge ${calc.ok ? 'badge--warning' : 'badge--error'}` }, icon(calc.ok ? 'triangle-alert' : 'circle-x'), calc.ok ? '확인 필요' : '입력 필요'));
      parts.push(el('ul', { class: 'issues' }, calc.messages.map(m => el('li', { class: calc.ok ? 'warn' : 'err', text: m }))));
    } else {
      parts.push(el('span', { class: 'badge badge--success' }, icon('circle-check'), '계산 가능'),
        el('p', { class: 'status-text', text: '형상 입력으로 패널 면적과 다운커머 치수를 계산했습니다.' }));
    }
    box.replaceChildren(...parts);
    refreshIcons();
  }

  // ---------------------------------------------------------------- 스케치 (평면도)
  function renderSketch() {
    const host = $('#sketch');
    const s = calc && calc.ok ? calc.sketch : null;
    if (!s || !(s.diameter > 0)) {
      host.replaceChildren(el('p', { class: 'status-text', text: 'Tower 지름을 입력하면 배치가 표시됩니다.' }));
      return;
    }
    const R = s.diameter / 2, n = nPass(), pad = R * 0.16;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${-R - pad} ${-R - pad} ${2 * (R + pad)} ${2 * (R + pad)}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${n}-pass 트레이 배치 평면도`);
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      svg.append(e);
      return e;
    };
    const yAt = x => Math.sqrt(Math.max(R * R - x * x, 0));
    const band = (x1, x2, cls) => {
      x1 = Math.max(-R, Math.min(R, x1)); x2 = Math.max(-R, Math.min(R, x2));
      if (x2 <= x1) return;
      const y1 = yAt(x1), y2 = yAt(x2);
      add('path', { d: `M ${x1} ${-y1} A ${R} ${R} 0 0 1 ${x2} ${-y2} L ${x2} ${y2} A ${R} ${R} 0 0 1 ${x1} ${y1} Z`, class: cls });
    };
    const fs = R * 0.075;
    add('circle', { cx: 0, cy: 0, r: R, class: 'sk-deck' });
    const side = s.side_top || 0;
    band(R - side, R, 'sk-dc');
    band(-R, -R + side, 'sk-dc');
    if ((n === 2 || n === 4) && s.center_top > 0) band(-s.center_top / 2, s.center_top / 2, 'sk-dc');
    if (n >= 3 && s.offc_top > 0 && s.ocdc != null) {
      for (const sgn of [1, -1]) band(sgn * s.ocdc - s.offc_top / 2, sgn * s.ocdc + s.offc_top / 2, 'sk-dc sk-dc--off');
    }
    add('circle', { cx: 0, cy: 0, r: R, class: 'sk-shell' });
    // 치수: 지름
    add('line', { x1: -R, y1: R + pad * 0.45, x2: R, y2: R + pad * 0.45, class: 'sk-dim' });
    add('text', { x: 0, y: R + pad * 0.45 - fs * 0.4, class: 'sk-text', 'font-size': fs, 'text-anchor': 'middle' }, `ID ${Math.round(s.diameter).toLocaleString('en-US')} mm`);
    const legend = el('ul', { class: 'sk-legend' },
      el('li', {}, el('span', { class: 'sk-swatch' }), `Side${n === 2 || n === 4 ? ' · Center' : ''} DC`),
      n >= 3 ? el('li', {}, el('span', { class: 'sk-swatch sk-swatch--off' }), `Off-center DC · 중심에서 ${Math.round(s.ocdc ?? 0).toLocaleString('en-US')} mm`) : null,
      el('li', {}, el('span', { class: 'sk-swatch sk-swatch--deck' }), '트레이 데크 (활성 영역 포함)'));
    host.replaceChildren(svg, legend);
  }

  // ---------------------------------------------------------------- 공통 동작
  function renderAll() {
    renderLeft();
    renderTable();
    renderPanels();
    renderCalc();
    refreshIcons();
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

  function loadDesign(d) {
    design = d;
    design.geometry = Object.assign({}, DEFAULT_GEOMETRY, d.geometry || {});
    TrayStore.setDesign(design);
    calc = null;
    renderAll();
    requestCalc();
  }

  $('#btn-save').addEventListener('click', () => {
    const name = ((design.project || {}).tower_no || 'tray_design').replace(/[\\/:*?"<>|\s]+/g, '_');
    const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${name}.json` });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast('JSON 파일로 저장했습니다');
  });
  $('#file-open').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { loadDesign(JSON.parse(await f.text())); toast(`${f.name}을(를) 불러왔습니다`); } catch (err) { toast('JSON 형식을 확인하세요', true); }
    e.target.value = '';
  });
  $('#btn-example').addEventListener('click', async () => {
    try {
      const res = await fetch('../examples/original_design.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      loadDesign(await res.json());
      toast('원본 예제(GT-Rater-Tray)를 불러왔습니다');
    } catch (err) { toast('예제는 로컬 서버로 열었을 때만 불러올 수 있습니다', true); }
  });

  async function init() {
    try {
      const res = await fetch('/api/catalog');
      if (res.ok) catalog = await res.json();
    } catch (e) { serverOk = false; }
    if (!catalog.valves.length) catalog.valves = [G().valve1_type || 'mfix6'];
    if (!catalog.materials.length) catalog.materials = [G().metallurgy || 'SA-283C (C.S)'];
    renderAll();
    requestCalc();
  }
  init();

  window.trayGeometry = { get design() { return design; }, get calc() { return calc; }, loadDesign };
})();
