/* ───────────────── 기기에 저장한 PDF (Cache Storage) ─────────────────
   서재 책을 열 때마다 통째로 다시 받았다 — 64MB 물리 책을 7분 사이 두 번 열면 두 번 다 64MB(2026-10-09 로그).
   서버는 ETag + no-cache 로 보내지만 사파리가 이렇게 큰 응답은 HTTP 캐시에 안 남긴다.
   그래서 받은 PDF 를 Cache Storage 에 직접 넣어 두고, 열 때는 If-None-Match 로 "바뀌었나"만 묻는다 —
   안 바뀌었으면 304(본문 없음)라 곧바로 열린다. 서버에서 바뀌었으면(목차 박기 등) 새로 받아 바꿔 넣는다.

   Cache Storage 에서 꺼낸 Blob 은 디스크에 있다 — 통째로 ArrayBuffer 로 읽지 말고 openSource() 로
   pdf.js 에 필요한 조각만 잘라 준다(메모리: 예전엔 받은 버퍼 + 사본 + 워커 사본으로 파일 크기의 2~3배).

   자주 여는 책만 남으면 된다 — 이틀(KEEP_MS) 동안 안 연 책은 지우고(2026-10-09 사용자: "이틀만 저장해도 돼"),
   그 안에서도 합계가 CAP 을 넘으면 오래 안 연 것부터 지운다. 홈 화면 앱은 사파리의
   "7일 안 쓰면 지움" 규칙에서 빠져 있어 오래 남는다. Cache Storage 가 없거나 막혀 있으면(사파리 사생활 보호 창 등)
   예전처럼 받기만 한다. */

const NAME = "yeobaek-pdf-v1";
const IDX = "yeobaek-pdfcache"; // localStorage: { url: { size, at } } — 오래된 것 지우기용
export const CACHE_CAP = 2 * 1024 ** 3;
export const KEEP_MS = 2 * 24 * 3600e3;

/* 진단 — 기기 콘솔은 볼 수 없으니 **잘못됐을 때만** 서버 로그로 한 줄 보낸다(App 이 setReport 로 꽂는다,
   journalctl 에 [기기]). 매번 다시 받던 원인(서버가 no-cache 를 보고 304 를 안 줌)도 이걸로 찾았다. */
let report = () => {};
export const setReport = (fn) => { report = fn; };
const est = async () => {
  try { const e = await navigator.storage.estimate(); return ` 사용 ${(e.usage / 1e6).toFixed(0)}MB/한도 ${(e.quota / 1e6).toFixed(0)}MB`; } catch { return ""; }
};

const readIdx = () => { try { return JSON.parse(localStorage.getItem(IDX)) || {}; } catch { return {}; } };
const writeIdx = (x) => { try { localStorage.setItem(IDX, JSON.stringify(x)); } catch {} };
let asked = false;
const box = async () => {
  // 사파리가 저장 공간을 넉넉히 주고 함부로 안 지우게 — 홈 화면 앱이면 대개 바로 승인된다
  if (!asked) { asked = true; try { navigator.storage?.persist?.().then((ok) => ok || report("저장소 유지 요청 거절")); } catch {} } try { return typeof caches !== "undefined" ? await caches.open(NAME) : null; } catch { return null; } };

export class AuthError extends Error { constructor() { super("로그인이 필요합니다"); this.name = "AuthError"; } }

/* XHR 인 이유: fetch 는 받는 진행률을 못 준다. etag 를 주면 조건부 요청 — 직접 단 If-None-Match 에는
   브라우저가 304 를 그대로 넘겨준다. */
const xhrBlob = (url, etag, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.responseType = "blob";
  if (etag) xhr.setRequestHeader("If-None-Match", etag);
  xhr.onprogress = (e) => onProgress?.(e.lengthComputable ? e.loaded / e.total : null, e.loaded);
  xhr.onload = () => {
    if (xhr.status === 401) return reject(new AuthError());
    if (xhr.status === 304) return resolve({ status: 304 });
    if (xhr.status < 200 || xhr.status >= 300) return reject(new Error("요청 실패 " + xhr.status));
    resolve({ status: 200, blob: xhr.response, etag: xhr.getResponseHeader("ETag") });
  };
  xhr.onerror = () => reject(new Error("네트워크 오류"));
  xhr.send();
});

/* url 의 PDF 를 Blob 으로. onProgress(비율|null, 받은 바이트) 는 실제로 받을 때만 불린다.
   반환 { blob, cached } — cached 면 기기에 있던 것(받지 않았다). */
export async function getPdf(url, onProgress) {
  const c = await box();
  if (c) await trim(c, url);
  let hit = null;
  try { hit = c && (await c.match(url)); } catch {}
  const etag = hit?.headers.get("x-etag");
  let r;
  try {
    r = await xhrBlob(url, etag, onProgress);
  } catch (e) {
    // 서버에 못 닿으면(오프라인) 기기에 있는 걸로 연다 — 낡았을 수는 있어도 못 여는 것보다 낫다
    if (hit && e.name !== "AuthError") { touch(url); return { blob: await hit.blob(), cached: true }; }
    throw e;
  }
  if (r.status === 304 && hit) { touch(url); return { blob: await hit.blob(), cached: true }; }
  if (r.status === 304) { // 기기 것은 사라졌는데 304 — 조건 없이 다시
    r = await xhrBlob(url, null, onProgress);
  }
  if (c && r.etag) {
    try {
      await c.put(url, new Response(r.blob, { headers: { "Content-Type": "application/pdf", "x-etag": r.etag } }));
      const x = readIdx();
      x[url] = { size: r.blob.size, at: Date.now() };
      writeIdx(x);
      trim(c, url);
      // 방금 받은 메모리 속 Blob 대신 디스크에 있는 것을 쓴다
      const h = await c.match(url);
      if (!h) report(`PDF 저장했는데 다시 못 찾음${await est()}`);
      if (h) return { blob: await h.blob(), cached: false };
    } catch (e) {
      // 저장 공간 부족 등 — 열기는 그대로
      report(`PDF 저장 실패 ${e?.name}: ${e?.message}${await est()}`);
    }
  } else {
    report(`PDF 저장 안 함 — 저장소 ${c ? "있음" : "없음"}, etag ${r.etag || "없음"}`);
  }
  return { blob: r.blob, cached: false };
}

function touch(url) {
  const x = readIdx();
  if (x[url]) { x[url].at = Date.now(); writeIdx(x); }
}

/* 지우기 — 이틀 넘게 안 연 것, 그다음 합계가 CAP 을 넘으면 오래된 것부터. keep 은 지금 여는 책(남긴다).
   목록(localStorage)에 없는 항목도 지운다 — 사이트 데이터 일부만 지워져 목록이 사라지면 영영 못 지운다. */
async function trim(c, keep) {
  const x = readIdx();
  const now = Date.now();
  try {
    for (const req of await c.keys()) {
      const k = new URL(req.url).pathname;
      const hit = Object.keys(x).find((url) => new URL(url, location.href).pathname === k);
      if (!hit && k !== new URL(keep, location.href).pathname) await c.delete(req);
    }
  } catch {}
  const old = Object.entries(x).sort((a, b) => a[1].at - b[1].at);
  let total = old.reduce((s, [, v]) => s + (v.size || 0), 0);
  for (const [url, v] of old) {
    if (url === keep) continue;
    if (now - v.at < KEEP_MS && total <= CACHE_CAP) continue;
    try { await c.delete(url); } catch {}
    delete x[url];
    total -= v.size || 0;
  }
  writeIdx(x);
}

export async function dropPdf(url) {
  const c = await box();
  try { await c?.delete(url); } catch {}
  const x = readIdx();
  if (x[url]) { delete x[url]; writeIdx(x); }
}

/* 설정 화면용 — 개수와 합계 */
export const cacheInfo = () => {
  const v = Object.values(readIdx());
  return { n: v.length, bytes: v.reduce((s, e) => s + (e.size || 0), 0) };
};
export async function clearPdfs() {
  try { await caches.delete(NAME); } catch {}
  writeIdx({});
}

/* pdf.js getDocument 에 펼쳐 넣을 원본. Blob 이면 통째로 읽지 않고 pdf.js 가 달라는 조각만 잘라 준다
   (PDFDataRangeTransport). Uint8Array 면 예전처럼 data 로. */
export function pdfSource(src) {
  if (!(src instanceof Blob)) return { data: src };
  const t = new window.pdfjsLib.PDFDataRangeTransport(src.size, null);
  t.requestDataRange = (begin, end) => {
    src.slice(begin, end).arrayBuffer()
      .then((ab) => t.onDataRange(begin, new Uint8Array(ab)))
      .catch((e) => console.error("[여백] PDF 조각 읽기 실패", begin, end, e));
  };
  return { range: t, length: src.size, rangeChunkSize: 256 * 1024, disableAutoFetch: true, disableStream: true };
}
