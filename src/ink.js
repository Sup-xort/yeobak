/* ───────────────── 필기(잉크) — 브라우저·서버 공용 순수 함수 ─────────────────
   서버(server/index.js)도 이 파일을 그대로 import 한다(내보내기 외관 스트림을 화면과 똑같이
   만들려고). 그래서 여기엔 DOM·window 를 쓰는 코드를 넣지 않는다.

   획(stroke) 모양: {id, t:"pen"|"hl", c:"#rrggbb", w, a?, pts:[[x,y],…]}
   - pts 는 펜 샘플 그대로다. 그릴 때만 curve() 로 다듬는다(아래 "필기 보정").
   - 좌표는 **그 쪽의 배율 1 뷰포트 단위**(pdf.js page.getViewport({scale:1}), 좌상단 원점,
     /Rotate 반영). 그래서 줌·relayout 과 무관하게 저장된다.
   - 필압은 쓰지 않는다(2026-09-23 사용자 요청으로 뺐다) — 모든 획은 고정 굵기 둥근 캡.
     굿노트가 내보내는 /Ink 도 필압 없는 고정 굵기라 가져온 획과 모양이 같다.
     예전에 저장된 획에 pr·세 번째 좌표가 남아 있어도 무시하고 그린다.
   - w 는 pt(배율 1 단위) 굵기, a 는 불투명도(형광펜 기본 HL_ALPHA). */

export const HL_ALPHA = 0.35;

/* ── 필기 보정(부드럽게 잇기) ──
   펜 샘플을 직선으로만 이으면 "짧은 직선 여러 개를 엮어 놓은" 것처럼 모가 난다(2026-09-23 실기기).
   그래서 저장은 원래 점 그대로 두고, **그릴 때만** 두 단계로 다듬는다 — 화면(캔버스·SVG)과
   내보내기(PDF 외관)가 전부 이 함수 하나를 거치므로 모양이 어디서나 같다.
   1) 이웃 점과 1:2:1 가중 평균 — 손떨림·샘플 지글거림을 걷어낸다(양 끝점은 그대로).
   2) 점과 점의 중점을 잇는 2차 베지에 — 꺾이는 곳 없이 매끈한 곡선이 되고, 원래 점 근처를 지난다.
   0) 그보다 먼저, 앞 점에서 굵기의 35% 안쪽인 점은 건너뛴다(w 를 넘길 때). 크게 확대해 쓰면 240Hz 샘플 간격이
      굵기보다 훨씬 짧아 손떨림이 굵기 안에서 **되꺾이는** 점이 줄줄이 생기는데(실측: 한 획 190점에 61번),
      사파리는 그런 머리핀 곡선을 칠할 때 획 안쪽에 흰 구멍을 낸다(2026-10-09 실기기 사진). 굵기 안의 떨림은
      어차피 안 보이니 걷어도 모양은 같다.
   반환: {m:[x,y], q:[[cx,cy,ex,ey],…], l:[x,y]|null} — moveTo, quadraticCurveTo 들, 마지막 lineTo. */
export function curve(pts, w = 0) {
  let p = pts;
  const gap = Math.min(w * 0.35, 1);
  if (gap > 0 && p.length > 2) {
    const o = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      const l = o[o.length - 1];
      if (Math.hypot(p[i][0] - l[0], p[i][1] - l[1]) >= gap) o.push(p[i]);
    }
    const e = p[p.length - 1], l = o[o.length - 1];
    // 끝점은 늘 남긴다 — 바로 앞 점이 너무 가까우면 그 점을 끝점으로 바꾼다
    if (o.length > 1 && Math.hypot(e[0] - l[0], e[1] - l[1]) < gap) o[o.length - 1] = e;
    else o.push(e);
    p = o;
  }
  const n = p.length;
  if (n >= 3) {
    const o = [p[0]];
    for (let i = 1; i < n - 1; i++)
      o.push([(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4]);
    o.push(p[n - 1]);
    p = o;
  }
  const q = [];
  if (n < 3) return { m: p[0], q, l: n === 2 ? p[1] : null };
  /* 90° 넘게 되꺾이는 점은 곡선 대신 두 직선(꼭짓점 경유)으로 잇는다. 그 자리의 2차 곡선은 반지름이 굵기보다
     훨씬 작은 머리핀이 되는데, 사파리가 그걸 칠하다 획 안쪽을 비운다(위 0번과 같은 흰 구멍). 직선 둘의 이음매는
     둥근 이음(lineJoin round)으로 채워져 구멍이 안 난다. 소비자 쪽 형식을 안 바꾸려고 직선도 '조절점 = 시작점'인
     2차 곡선으로 낸다. */
  let s = p[0];
  for (let i = 1; i < n - 1; i++) {
    const e = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
    const ax = p[i][0] - s[0], ay = p[i][1] - s[1], bx = e[0] - p[i][0], by = e[1] - p[i][1];
    if (ax * bx + ay * by < 0) {
      q.push([s[0], s[1], p[i][0], p[i][1]]);
      q.push([p[i][0], p[i][1], e[0], e[1]]);
    } else q.push([p[i][0], p[i][1], e[0], e[1]]);
    s = e;
  }
  return { m: p[0], q, l: p[n - 1] };
}

/* 캔버스에 획 하나를 그린다. k = 배율 1 → 캔버스 픽셀. (ox, oy) 는 캔버스 픽셀 원점 이동. */
export function drawStroke(ctx, s, k, ox = 0, oy = 0) {
  if (!s.pts.length) return;
  const c = curve(s.pts, s.w);
  const X = (v) => v * k + ox, Y = (v) => v * k + oy;
  ctx.save();
  ctx.globalAlpha = s.t === "hl" ? (s.a ?? HL_ALPHA) : (s.a ?? 1);
  ctx.strokeStyle = s.c;
  ctx.lineWidth = Math.max(0.5, s.w * k);
  ctx.lineCap = s.t === "hl" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(X(c.m[0]), Y(c.m[1]));
  if (!c.l) ctx.lineTo(X(c.m[0]) + 0.01, Y(c.m[1]));
  for (const [cx, cy, ex, ey] of c.q) ctx.quadraticCurveTo(X(cx), Y(cy), X(ex), Y(ey));
  if (c.l) ctx.lineTo(X(c.l[0]), Y(c.l[1]));
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

/* 지그재그로 문지르면 지운다(굿노트의 "긁어서 지우기"). 펜 획을 뗄 때 본다.
   점들의 주축(PCA)을 잡고 그 축에서 앞뒤로 몇 번 꺾였나를 센다 — 축 폭의 35% 넘게 되돌아가야 한 번.
   긁는 손은 같은 길을 왔다 갔다 하니 주축이 획 방향이 되고 꺾임이 많다(끝이 둥글어 고리가 져도 상관없다).
   필기체는 글줄 방향으로 나아가며 위아래로 오르내리니 주축이 글줄이고, 그 축에선 되돌아가는 일이 거의 없다.
   주축에서 4번 이상 꺾이고(5번 쓸고), 길이가 상자 긴 변의 2배 이상이면 지그재그다. */
export function isScribble(pts) {
  if (pts.length < 12) return false;
  const [x0, y0, x1, y1] = polyBox(pts);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (len < 2 * Math.max(x1 - x0, y1 - y0)) return false;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(th), uy = Math.sin(th);
  const v = pts.map((p) => (p[0] - mx) * ux + (p[1] - my) * uy);
  let lo = Infinity, hi = -Infinity;
  for (const e of v) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const ext = hi - lo;
  if (ext < 4) return false; // 4pt 미만의 흔들림은 지그재그가 아니다
  const h = ext * 0.35;
  let dir = 0, l = v[0], u = v[0], n = 0;
  for (const e of v) {
    if (dir >= 0) {
      if (e > u) u = e;
      if (u - e > h) { if (dir > 0) n++; dir = -1; l = e; }
    }
    if (dir <= 0) {
      if (e < l) l = e;
      if (e - l > h) { if (dir < 0) n++; dir = 1; u = e; }
    }
  }
  return n >= 4;
}

/* 지그재그 sc 의 상자 안에 절반 넘게 들어 있는 획을 list 에서 빼서 [{s, i}] 로 돌려준다
   (지우개의 del 과 같은 모양 — 실행취소가 그대로 된다). 지그재그에 닿지 않아도 범위 안이면 지운다.
   절반 넘게라는 조건은 긴 밑줄 끝을 스친 정도로 밑줄 전체가 날아가지 않게 하려는 것.
   지울 게 있으면 지그재그 자신도 맨 앞 항목으로 넣는다 — 실행취소 한 번에 지그재그까지 돌아온다(list 에는 안 둔다). */
export function scribbleHits(list, sc) {
  const [x0, y0, x1, y1] = polyBox(sc.pts);
  const pad = sc.w / 2 + 1;
  const inBox = (p) => p[0] >= x0 - pad && p[0] <= x1 + pad && p[1] >= y0 - pad && p[1] <= y1 + pad;
  const n0 = list.length;
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const b = bbox(s);
    if (b[2] < x0 - pad || b[0] > x1 + pad || b[3] < y0 - pad || b[1] > y1 + pad) continue;
    const p = s.pts, k = Math.max(1, Math.floor(p.length / 24));
    let inN = 0, n = 0;
    for (let j = 0; j < p.length; j += k, n++) if (inBox(p[j])) inN++;
    if (inN * 2 < n) continue;
    out.push({ s: list.splice(i, 1)[0], i });
  }
  if (out.length) out.unshift({ s: sc, i: n0 });
  return out;
}

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

/* 획 → SVG path d (배율 1 단위). 쪽 위의 필기는 SVG 로 그린다 — 벡터라 어느 배율에서도 선명하고,
   캔버스처럼 쪽마다 수백만 픽셀을 잡아먹지 않는다(캔버스였을 땐 확대하면 pdf 캔버스와 함께 흐려졌다). */
export function strokePath(s) {
  if (!s.pts.length) return "";
  const f = (v) => Math.round(v * 100) / 100;
  const c = curve(s.pts, s.w);
  let d = `M${f(c.m[0])} ${f(c.m[1])}`;
  if (!c.l) d += "l0.01 0";
  for (const [cx, cy, ex, ey] of c.q) d += `Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
  if (c.l) d += `L${f(c.l[0])} ${f(c.l[1])}`;
  return d;
}
