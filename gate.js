/* Tray Rater 외부 테스트 버전 - 입장 화면과 브라우저 안 계산 엔진.
 *
 * 1) 비밀번호 -> PBKDF2-SHA256(600,000회) -> AES-256-GCM 키 -> bundle.enc.json 복호화 (실패 = 비밀번호 오류)
 * 2) Pyodide(브라우저용 Python) 를 CDN 에서 내려받아 복호화한 zip(계산 엔진·데이터)을 설치
 * 3) window.trayApi.request() 로 앱 페이지(iframe)의 /api 요청을 처리 (static-shim.js 참고)
 * 같은 탭에서는 다시 묻지 않도록 키를 sessionStorage 에 둔다 (탭을 닫거나 '잠그기' 하면 지워짐).
 */
(function () {
  'use strict';
  const PYODIDE = 'https://cdn.jsdelivr.net/npm/pyodide@0.26.4/';
  const KEY_STORE = 'trayRater.static.key';
  const $ = s => document.querySelector(s);
  const enc = new TextEncoder();
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => btoa(String.fromCharCode(...u8));
  let blob = null;

  async function loadBlob() {
    if (blob) return blob;
    const res = await fetch('bundle.enc.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('bundle');
    blob = await res.json();
    return blob;
  }

  async function deriveKey(password, b) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64(b.salt), iterations: b.iterations },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function decrypt(key, b) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(b.iv), additionalData: enc.encode(b.aad) }, key, b64(b.data));
    return new Uint8Array(plain);
  }

  // ---------------------------------------------------------------- 진행 표시
  function step(name, state) {
    const li = document.querySelector(`[data-step="${name}"]`);
    if (!li) return;
    li.classList.toggle('is-active', state === 'active');
    li.classList.toggle('is-done', state === 'done');
  }
  function message(text) {
    $('#pw-msg').textContent = text;
    $('#pw').classList.toggle('is-error', !!text);
  }
  function busy(on) {
    $('#gate-submit').disabled = on;
    $('#pw').disabled = on;
    $('#gate-submit').textContent = on ? '확인 중' : '입장하기';
  }

  // ---------------------------------------------------------------- 계산 엔진
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script'));
      document.head.append(s);
    });
  }

  async function startEngine(zipBytes) {
    step('engine', 'active');
    await loadScript(PYODIDE + 'pyodide.js');
    const py = await window.loadPyodide({ indexURL: PYODIDE });
    step('engine', 'done');
    step('modules', 'active');
    py.FS.writeFile('/tmp/bundle.zip', zipBytes);
    py.runPython(`
import sys, zipfile
zipfile.ZipFile('/tmp/bundle.zip').extractall('/home/pyodide/trayrater')
sys.path.insert(0, '/home/pyodide/trayrater/lib')
import tray_rater.static_api as _api
handle = _api.handle
handle('GET', '/api/catalog', '')      # 모듈 미리 불러오기
`);
    const handle = py.globals.get('handle');
    window.trayApi = {
      version: 'static',
      async request(method, url, body) {
        const proxy = handle(method, url, body || '');
        try { return proxy.toJs({ dict_converter: Object.fromEntries }); } finally { proxy.destroy(); }
      },
    };
    step('modules', 'done');
  }

  function openApp() {
    $('#gate').hidden = true;
    $('#shell').hidden = false;
    $('#app').src = 'app/index.html?v=20261124143937';
  }

  async function unlockWith(key) {
    const b = await loadBlob();
    const zip = await decrypt(key, b);           // 비밀번호가 틀리면 여기서 예외
    step('key', 'done');
    try {
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      sessionStorage.setItem(KEY_STORE, toB64(raw));
    } catch (e) { /* 세션 저장 불가 환경: 매번 입력 */ }
    await startEngine(zip);
    openApp();
  }

  // ---------------------------------------------------------------- 이벤트
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('#pw').value;
    if (!pw) return message('비밀번호를 입력하세요');
    message('');
    busy(true);
    $('#steps').hidden = false;
    step('key', 'active');
    let key;
    try {
      const b = await loadBlob();
      key = await deriveKey(pw, b);
      await decrypt(key, b);
    } catch (err) {
      step('key', '');
      $('#steps').hidden = true;
      busy(false);
      if (err && err.message === 'bundle') return message('사이트 파일(bundle.enc.json)을 읽을 수 없습니다. 관리자에게 알려 주세요');
      await new Promise(r => setTimeout(r, 600));
      message('비밀번호가 올바르지 않습니다');
      $('#pw').select();
      return;
    }
    try {
      await unlockWith(key);
    } catch (err) {
      busy(false);
      message('계산 엔진을 준비하지 못했습니다. 인터넷 연결과 cdn.jsdelivr.net 접속을 확인한 뒤 다시 시도하세요');
      console.error(err);
    }
  });

  $('#pw-toggle').addEventListener('click', () => {
    const inp = $('#pw');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('#pw-toggle').setAttribute('aria-pressed', String(show));
    $('#pw-toggle').setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
  });

  $('#lock').addEventListener('click', () => {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) { /* 무시 */ }
    location.reload();
  });

  // 같은 탭에서 다시 열면 저장한 키로 바로 입장
  (async () => {
    let saved = null;
    try { saved = sessionStorage.getItem(KEY_STORE); } catch (e) { saved = null; }
    if (!saved) { $('#pw').focus(); return; }
    busy(true);
    $('#steps').hidden = false;
    try {
      const key = await crypto.subtle.importKey('raw', b64(saved), 'AES-GCM', true, ['decrypt']);
      await unlockWith(key);
    } catch (e) {
      try { sessionStorage.removeItem(KEY_STORE); } catch (x) { /* 무시 */ }
      $('#steps').hidden = true;
      busy(false);
      $('#pw').focus();
    }
  })();
})();
