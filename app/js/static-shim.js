/* 정적 사이트용: 앱 페이지의 /api 요청을 부모 창(index.html)의 브라우저 안 계산 엔진으로 연결.
 * 페이지 스크립트(loading.js, geometry.js, results.js)는 서버 버전과 같은 코드를 그대로 쓴다.
 * 입장 화면을 거치지 않고 열면 입장 화면으로 돌려보낸다.
 */
(function () {
  'use strict';
  let api = null;
  try { api = window.parent !== window ? window.parent.trayApi : null; } catch (e) { api = null; }
  if (!api) {
    location.replace('../index.html');
    return;
  }
  const original = window.fetch.bind(window);
  const intercept = url => /\/api\/|original_design\.json/.test(url);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    if (!intercept(url)) return original(input, init);
    const method = (init && init.method) || 'GET';
    const body = (init && typeof init.body === 'string') ? init.body : '';
    const r = await api.request(method, url, body);
    const data = r.base64 ? Uint8Array.from(atob(r.body), c => c.charCodeAt(0)) : r.body;
    const headers = { 'Content-Type': r.type };
    if (r.filename) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`;
    return new Response(data, { status: r.status, headers });
  };
})();
