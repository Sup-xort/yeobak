/* ───────────────── 필기(잉크) — 브라우저·서버 공용 순수 함수 ─────────────────
   서버(server/index.js)도 이 파일을 그대로 import 한다(내보내기 외관 스트림을 화면과 똑같이
   만들려고). 그래서 여기엔 DOM·window 를 쓰는 코드를 넣지 않는다.

   획(stroke) 모양: {id, t:"pen"|"hl", c:"#rrggbb", w, a?, pts:[[x,y],…]}
   - 좌표는 **그 쪽의 배율 1 뷰포트 단위**(pdf.js page.getViewport({scale:1}), 좌상단 원점,
     /Rotate 반영). 그래서 줌·relayout 과 무관하게 저장된다.
   - 필압은 쓰지 않는다(2026-09-23 사용자 요청으로 뺐다) — 모든 획은 고정 굵기 둥근 캡 폴리라인.
     굿노트가 내보내는 /Ink 도 필압 없는 고정 굵기라 가져온 획과 모양이 같다.
     예전에 저장된 획에 pr·세 번째 좌표가 남아 있어도 무시하고 그린다.
   - w 는 pt(배율 1 단위) 굵기, a 는 불투명도(형광펜 기본 HL_ALPHA). */

export const HL_ALPHA = 0.35;

/* 캔버스에 획 하나를 그린다. k = 배율 1 → 캔버스 픽셀. (ox, oy) 는 캔버스 픽셀 원점 이동. */
export function drawStroke(ctx, s, k, ox = 0, oy = 0) {
  const pts = s.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.globalAlpha = s.t === "hl" ? (s.a ?? HL_ALPHA) : (s.a ?? 1);
  ctx.strokeStyle = s.c;
  ctx.lineWidth = Math.max(0.5, s.w * k);
  ctx.lineCap = s.t === "hl" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * k + ox, pts[0][1] * k + oy);
  if (pts.length === 1) ctx.lineTo(pts[0][0] * k + ox + 0.01, pts[0][1] * k + oy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * k + ox, pts[i][1] * k + oy);
  ctx.stroke();
  ctx.restore();
}

/* 획의 경계 상자 [x0,y0,x1,y1] (굵기 절반만큼 넓힘). 쪽당 1300획급(굿노트 파일 실측)이라
   지우개·올가미는 이걸로 먼저 거른다. 획 객체에 직접 붙이면 JSON 에 섞이므로 WeakMap 에 둔다. */
const bbCache = new WeakMap();
export function bbox(s) {
  let b = bbCache.get(s);
  if (b && b.n === s.pts.length && b.x === s.pts[0]?.[0] && b.y === s.pts[0]?.[1]) return b.v;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  const h = s.w / 2;
  const v = [x0 - h, y0 - h, x1 + h, y1 + h];
  bbCache.set(s, { v, n: s.pts.length, x: s.pts[0]?.[0], y: s.pts[0]?.[1] });
  return v;
}

const segDist2 = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
};

/* 점 (x,y) 반경 r 안에 획이 닿는가 — 지우개 */
export function hitStroke(s, x, y, r) {
  const b = bbox(s);
  if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
  const rr = (r + s.w / 2) ** 2;
  const p = s.pts;
  if (p.length === 1) return (p[0][0] - x) ** 2 + (p[0][1] - y) ** 2 <= rr;
  for (let i = 1; i < p.length; i++)
    if (segDist2(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= rr) return true;
  return false;
}

export function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* 올가미 안에 든 획인가 — 점의 절반 이상이 안쪽이면 잡는다(가장자리를 살짝 걸친 건 빼고,
   대충 두른 올가미에 끝이 삐져나온 획은 잡히게). */
export function strokeInLasso(s, poly, pb) {
  const b = bbox(s);
  if (b[2] < pb[0] || b[0] > pb[2] || b[3] < pb[1] || b[1] > pb[3]) return false;
  const p = s.pts;
  const step = Math.max(1, Math.floor(p.length / 24)); // 긴 획은 표본만 본다
  let inN = 0, n = 0;
  for (let i = 0; i < p.length; i += step, n++) if (inPolygon(p[i][0], p[i][1], poly)) inN++;
  return inN * 2 >= n;
}

export const polyBox = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

/* 형광펜을 긋고 끝에서 잠깐 멈추면 직선으로 편다(굿노트와 같은 동작).
   거의 수평이면 수평으로 맞춘다 — 글줄 긋기가 대부분이라. */
export function snapLine(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  let by = b[1];
  if (Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]) * 0.12) by = a[1];
  return [[a[0], a[1]], [b[0], by]];
}

/* 점을 소수 둘째 자리로 줄이고, 앞 점과 거의 겹치는 점은 버린다(굿노트 /InkList 는
   0.01pt 간격 점이 수두룩하다 — 저장 크기가 절반 가까이 준다). */
export function tidyPts(pts, minGap = 0.12) {
  const out = [];
  const r = (v) => Math.round(v * 100) / 100;
  for (const p of pts) {
    const q = [r(p[0]), r(p[1])];
    const l = out[out.length - 1];
    if (l && Math.abs(l[0] - q[0]) < minGap && Math.abs(l[1] - q[1]) < minGap) continue;
    out.push(q);
  }
  if (pts.length && out.length === 1 && pts.length > 1) {
    const e = pts[pts.length - 1];
    out.push([r(e[0]), r(e[1])]);
  }
  return out;
}

/* ── PDF 사용자 공간 ↔ 배율 1 뷰포트 ──
   pdf.js PageViewport 와 같은 식이다(3.11.174 display_utils.js). box = 페이지의 보이는 상자
   [x0,y0,x1,y1](pdf.js 의 page.view = CropBox, 없으면 MediaBox), rot = /Rotate(0·90·180·270). */
export function viewportMatrix(box, rot) {
  const r = (((rot || 0) % 360) + 360) % 360;
  const cx = (box[2] + box[0]) / 2, cy = (box[3] + box[1]) / 2;
  let a, b, c, d;
  switch (r) {
    case 90: a = 0; b = 1; c = 1; d = 0; break;
    case 180: a = -1; b = 0; c = 0; d = 1; break;
    case 270: a = 0; b = -1; c = -1; d = 0; break;
    default: a = 1; b = 0; c = 0; d = -1;
  }
  let ox, oy;
  if (a === 0) { ox = Math.abs(cy - box[1]); oy = Math.abs(cx - box[0]); }
  else { ox = Math.abs(cx - box[0]); oy = Math.abs(cy - box[1]); }
  return [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy];
}
export const applyM = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invertM(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const rgbToHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
