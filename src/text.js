/* 캔버스를 떼어 낼 때는 크기를 0 으로 줄인 뒤에 — iOS 사파리는 떼어 낸 캔버스의 메모리를 GC 가 돌 때까지
   들고 있고, 쪽 캔버스 하나가 최대 12M 픽셀(약 48MB)이라 확대한 채 스크롤하면 캔버스 한도에 금세 닿는다. */
export const freeCanvas = (c) => { c.width = 0; c.height = 0; c.remove(); };

/* ───────────────── 텍스트 유틸 ───────────────── */
export function wordAt(text, off) {
  let s = off, e = off;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return text.slice(s, e).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "");
}
export function sentenceAt(text, off) {
  const stop = /[.!?。！？…\n]/;
  let s = off, e = off;
  while (s > 0 && !stop.test(text[s - 1])) s--;
  while (e < text.length && !stop.test(text[e])) e++;
  if (e < text.length) e++;
  return { text: text.slice(s, e).replace(/\s+/g, " ").trim(), start: s, end: e };
}
/* 화면 세로좌표 y 아래에 있는 페이지 번호(1-based).
   페이지는 세로 한 줄로 쌓이므로 rect.top 이 인덱스에 대해 단조 증가한다 — 이진 탐색으로 찾는다.
   curRef 가 얼마나 어긋나 있든 답이 옳다는 게 핵심이다. 예전엔 curRef 주변 ±10쪽만 훑어서,
   핀치나 빠른 스크롤로 curRef 가 멀어지면 창 안에서 아무것도 못 찾고 그대로 굳었다.
   그 결과 쪽번호가 실제 화면과 어긋나고, prune 이 보고 있는 페이지를 지워 흰 화면이 뜨고,
   핀치 앵커가 엉뚱한 페이지를 가리켜 이상한 곳으로 넘어갔다.
   변환(핀치 중 CSS scale)이 걸려 있어도 getBoundingClientRect 는 변환 후 좌표라 그대로 쓴다. */
export const pageAt = (pages, y) => {
  const n = pages.length;
  if (!n) return 1;
  let lo = 0, hi = n - 1, below = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const r = pages[m]?.getBoundingClientRect();
    if (!r) break;
    if (y < r.top) { below = m; hi = m - 1; }
    else if (y > r.bottom) lo = m + 1;
    else return m + 1;
  }
  return below >= 0 ? below + 1 : n; // 페이지 사이 여백이면 바로 아래 페이지
};

/* 하이라이트 박스를 .vb-tl 바로 아래에 깐다.
   .w 스팬 자체에 배경을 주면 안 되는 이유: 부모 .it 에는 폭 보정용 transform 이 걸려 있고,
   transform 은 블렌딩을 격리시켜서 mix-blend-mode 가 그 아래 캔버스에 닿지 못한다.
   (translateZ(0) 로 mix-blend-mode 를 가두는 우회법이 바로 이 성질을 쓰는 것)
   그래서 transform 이 없는 .vb-tl 의 자식으로 박스를 만들어 multiply 로 곱한다 —
   흰 종이는 형광색으로, 검은 획은 검정 원색 그대로 남는다.
   좌표는 getBoundingClientRect 차이로 잡으므로 .it 의 transform 이 이미 반영돼 있다. */
export const markSpans = (els, cls) => {
  for (const el of els) {
    const layer = el.closest(".vb-tl");
    if (!layer) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const lr = layer.getBoundingClientRect();
    const hl = document.createElement("i");
    hl.className = "vb-hl" + (cls ? " " + cls : "");
    /* 아래로 4px 더 키운다 — 형광펜 획이 그 여유 안에 들어가서 g·j·p 같은
       내림자를 가로지르지 않고 글자 밑을 지나간다 */
    hl.style.left = r.left - lr.left - 1 + "px";
    hl.style.top = r.top - lr.top + "px";
    hl.style.width = r.width + 2 + "px";
    hl.style.height = r.height + 4 + "px";
    layer.prepend(hl);
  }
};
export const fmtSize = (b) =>
  b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
export const fmtDate = (t) => {
  const d = new Date(t || 0);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
/* 서재 카드 메타 줄용 상대 시간 — "3일 전"이 "2026.7.28"보다 한눈에 들어온다.
   1주 넘어가면 다시 절대 날짜로(오래된 날짜의 "N일 전"은 오히려 안 읽힌다). */
export const fmtRel = (t) => {
  if (!t) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "어제";
  if (day < 7) return `${day}일 전`;
  return fmtDate(t);
};

/* 하위 폴더까지 이은 이름 "A › B" — 폴더는 parent 로 이어진다 */
export const folderPath = (folders, id) => {
  const out = [];
  for (let f = folders.find((x) => x.id === id); f && out.length < 20; f = folders.find((x) => x.id === f.parent))
    out.unshift(f.name);
  return out.join(" › ");
};
/* 폴더를 나무 순서(부모 바로 뒤에 자식, 형제끼리는 배열 순서)로 펼치고 깊이를 붙인다 */
export const folderTree = (folders, parent = "", depth = 0) =>
  depth > 20 ? [] : folders.filter((f) => (f.parent || "") === parent)
    .flatMap((f) => [{ ...f, depth }, ...folderTree(folders, f.id, depth + 1)]);
