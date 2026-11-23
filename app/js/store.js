/* 페이지 사이에 공유하는 설계(TrayDesign JSON) 임시 저장소 - 브라우저 localStorage.
 * 로딩 입력(index.html)과 형상 입력(geometry.html)이 같은 키를 쓴다.
 *   { design: TrayDesign JSON, visible: 로딩 표에 보이는 열 수 }
 */
window.TrayStore = (function () {
  const KEY = 'trayRater.loadingDraft.v1';
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function write(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* 저장 불가 환경 */ }
  }
  return {
    KEY,
    getDesign() { return read().design || null; },
    setDesign(design) { const o = read(); o.design = design; write(o); },
    read, write,
  };
})();
