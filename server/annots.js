/* ───────────────── 필기 ↔ PDF 표준 주석(/Ink·/Highlight) ─────────────────
   여백의 필기는 data/annots/<id>.json 에 자체 형식으로 산다(좌표계·획 모양은 src/ink.js 머리말).
   PDF 자체는 건드리지 않고, 두 순간에만 PDF 주석과 오간다:

   - 가져오기(importAnnots): 서재 파일을 처음 열 때 한 번. 그 PDF 에 이미 들어 있는 /Ink·/Highlight 를
     획으로 되살린다. 굿노트 "편집 가능" 내보내기가 필기를 획 하나당 /Ink 주석 하나로 쓴다는 걸
     실제 파일로 확인했다(2026-09-23: 3쪽짜리에 /Ink 1972개, 고정 굵기, 필압 없음) — 그래서
     굿노트 → 여백은 편집 가능한 획으로 들어온다. (반대로 여백 → 굿노트는 굿노트가 가져올 때
     주석을 평탄화해서 보기 전용이 된다. 이건 여백 쪽에서 못 바꾼다.)
   - 내보내기(exportWithAnnots): "필기 포함" 다운로드. 획마다 /Ink 주석 + /AP 외관 스트림을 단다.
     외관을 안 달면 뷰어마다 제멋대로 그리거나 아예 안 그린다 — 미리보기·굿노트에서 여백 화면과
     같은 모양(둥근 캡·고정 굵기, 형광펜은 multiply)이 나오게 직접 그려 넣는다.

   pdf-lib 에 주석 고수준 API 가 없어서 buildOutlinePdf(index.js) 처럼 PDFContext 로 직접 조립한다. */
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFHexString, PDFString, PDFRef } from "pdf-lib";
import {
  viewportMatrix, applyM, invertM, hexToRgb, rgbToHex, tidyPts, HL_ALPHA,
} from "../src/ink.js";

const num = (o) => (o instanceof PDFNumber ? o.asNumber() : Number.NaN);

function pageBox(page) {
  const b = page.getCropBox();
  return [b.x, b.y, b.x + b.width, b.y + b.height];
}

function colorOf(ctx, dict) {
  const c = ctx.lookup(dict.get(PDFName.of("C")));
  if (!(c instanceof PDFArray)) return null;
  const v = c.asArray().map((x) => num(ctx.lookup(x)));
  if (v.some((x) => !Number.isFinite(x))) return null;
  if (v.length === 1) return rgbToHex([v[0], v[0], v[0]]);
  if (v.length === 3) return rgbToHex(v);
  if (v.length === 4) return rgbToHex([0, 1, 2].map((i) => (1 - v[i]) * (1 - v[3])));
  return null;
}

function widthOf(ctx, dict) {
  const bs = ctx.lookup(dict.get(PDFName.of("BS")));
  if (bs instanceof PDFDict) {
    const w = num(ctx.lookup(bs.get(PDFName.of("W"))));
    if (Number.isFinite(w)) return w;
  }
  const border = ctx.lookup(dict.get(PDFName.of("Border")));
  if (border instanceof PDFArray && border.size() >= 3) {
    const w = num(ctx.lookup(border.get(2)));
    if (Number.isFinite(w)) return w;
  }
  return 1;
}

const numsOf = (ctx, arr) =>
  arr instanceof PDFArray ? arr.asArray().map((x) => num(ctx.lookup(x))) : [];

/* PDF 바이트 → {v, imported, pages:{n:[stroke]}}. 주석이 없으면 imported:false, pages:{} */
export async function importAnnots(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const pages = {};
  let count = 0;
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    if (!annots) return;
    const m = viewportMatrix(pageBox(page), page.getRotation().angle);
    const out = [];
    for (let k = 0; k < annots.size(); k++) {
      const a = ctx.lookup(annots.get(k));
      if (!(a instanceof PDFDict)) continue;
      const sub = a.get(PDFName.of("Subtype"));
      const flags = num(ctx.lookup(a.get(PDFName.of("F"))));
      if (Number.isFinite(flags) && flags & 2) continue; // Hidden
      const caN = num(ctx.lookup(a.get(PDFName.of("CA"))));
      const ca = Number.isFinite(caN) ? Math.max(0, Math.min(1, caN)) : 1;
      if (sub === PDFName.of("Ink")) {
        const list = ctx.lookup(a.get(PDFName.of("InkList")));
        if (!(list instanceof PDFArray)) continue;
        const c = colorOf(ctx, a) || "#1e1b1b";
        const w = widthOf(ctx, a) || 1;
        // 반투명 잉크는 형광펜으로 본다(굿노트·미리보기의 형광펜이 이렇게 나온다)
        const hl = ca < 0.9;
        for (let j = 0; j < list.size(); j++) {
          const flat = numsOf(ctx, ctx.lookup(list.get(j)));
          const pts = [];
          for (let q = 0; q + 1 < flat.length; q += 2) {
            if (!Number.isFinite(flat[q]) || !Number.isFinite(flat[q + 1])) continue;
            pts.push(applyM(m, flat[q], flat[q + 1]));
          }
          if (!pts.length) continue;
          const s = { id: `i${i + 1}-${out.length}`, t: hl ? "hl" : "pen", c, w: +w.toFixed(2), pts: tidyPts(pts, 0.1) };
          if (hl) s.a = ca;
          out.push(s);
        }
      } else if (sub === PDFName.of("Highlight")) {
        const q = numsOf(ctx, ctx.lookup(a.get(PDFName.of("QuadPoints"))));
        const c = colorOf(ctx, a) || "#fde047";
        for (let j = 0; j + 7 < q.length; j += 8) {
          const vs = [0, 2, 4, 6].map((o) => applyM(m, q[j + o], q[j + o + 1]));
          const xs = vs.map((v) => v[0]), ys = vs.map((v) => v[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          if (![x0, x1, y0, y1].every(Number.isFinite) || y1 - y0 <= 0) continue;
          const my = (y0 + y1) / 2;
          out.push({
            id: `i${i + 1}-${out.length}`, t: "hl", c, w: +(y1 - y0).toFixed(2),
            a: ca < 1 ? ca : HL_ALPHA, pts: tidyPts([[x0, my], [x1, my]], 0),
          });
        }
      }
    }
    if (out.length) { pages[i + 1] = out; count += out.length; }
  });
  return { v: 1, imported: count > 0, count, pages };
}

const f2 = (v) => (Math.round(v * 100) / 100).toString();

/* 여백 획을 표준 /Ink 주석으로 박은 PDF 바이트.
   가져온 적 있는(imported) 문서면 원래 /Ink·/Highlight(와 딸린 /Popup)를 빼고 넣는다 —
   안 그러면 가져온 획이 원본 주석과 겹쳐 두 겹으로 나간다. */
export async function exportWithAnnots(bytes, data) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();
  const now = PDFString.fromDate(new Date());
  const author = PDFHexString.fromText("여백");
  let gsRef = null;
  const hlGs = (a) => {
    // 형광펜 불투명도는 대부분 기본값 하나라 ExtGState 를 값마다 하나씩만 만든다
    gsRef ??= new Map();
    const key = f2(a);
    if (!gsRef.has(key)) {
      gsRef.set(key, ctx.register(ctx.obj({
        Type: "ExtGState", CA: PDFNumber.of(a), ca: PDFNumber.of(a), BM: "Multiply",
      })));
    }
    return gsRef.get(key);
  };

  pages.forEach((page, i) => {
    const strokes = data.pages?.[i + 1] || [];
    let annots = page.node.Annots();
    if (data.imported && annots) {
      const keep = [];
      const drop = new Set();
      for (let k = 0; k < annots.size(); k++) {
        const ref = annots.get(k);
        const a = ctx.lookup(ref);
        const sub = a instanceof PDFDict ? a.get(PDFName.of("Subtype")) : null;
        if (sub === PDFName.of("Ink") || sub === PDFName.of("Highlight")) {
          if (ref instanceof PDFRef) drop.add(ref.toString());
          continue;
        }
        keep.push(ref);
      }
      const kept = keep.filter((ref) => {
        const a = ctx.lookup(ref);
        if (!(a instanceof PDFDict) || a.get(PDFName.of("Subtype")) !== PDFName.of("Popup")) return true;
        const par = a.get(PDFName.of("Parent"));
        return !(par instanceof PDFRef && drop.has(par.toString()));
      });
      annots = ctx.obj(kept);
      page.node.set(PDFName.of("Annots"), annots);
    }
    if (!strokes.length) return;
    if (!annots) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of("Annots"), annots);
    }
    const toUser = invertM(viewportMatrix(pageBox(page), page.getRotation().angle));
    const U = (x, y) => applyM(toUser, x, y);

    for (const s of strokes) {
      if (!s.pts?.length) continue;
      const hl = s.t === "hl";
      const alpha = hl ? (s.a ?? HL_ALPHA) : (s.a ?? 1);
      const center = s.pts.map((p) => U(p[0], p[1]));
      const pad = s.w / 2 + 1;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of center) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const rect = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
      const [r, g, b] = hexToRgb(s.c);
      const c4 = [r, g, b].map((v) => +v.toFixed(4)).join(" ");

      let body = "";
      const res = {};
      if (alpha < 1) {
        res.ExtGState = { GS0: hlGs(alpha) };
        body += "/GS0 gs\n";
      }
      // 화면(drawStroke)과 같은 모양: 고정 굵기, 펜은 둥근 캡, 형광펜은 평평한 캡
      body += `${c4} RG ${f2(s.w)} w ${hl ? 0 : 1} J 1 j\n`;
      body += `${f2(center[0][0])} ${f2(center[0][1])} m\n`;
      if (center.length === 1) body += `${f2(center[0][0] + 0.01)} ${f2(center[0][1])} l\n`;
      for (let k = 1; k < center.length; k++) body += `${f2(center[k][0])} ${f2(center[k][1])} l\n`;
      body += "S\n";
      // BBox 를 Rect 와 똑같이 두면 외관 → Rect 사상이 항등이라 본문을 사용자 공간 좌표 그대로 쓸 수 있다
      const ap = ctx.register(ctx.flateStream(body, {
        Type: "XObject", Subtype: "Form", FormType: 1,
        BBox: rect.map((v) => PDFNumber.of(+f2(v))), Resources: res,
      }));
      const inkList = [center.flatMap(([x, y]) => [PDFNumber.of(+f2(x)), PDFNumber.of(+f2(y))])];
      const annot = ctx.obj({
        Type: "Annot", Subtype: "Ink",
        Rect: rect.map((v) => PDFNumber.of(+f2(v))),
        InkList: inkList,
        C: [r, g, b].map((v) => PDFNumber.of(+v.toFixed(4))),
        CA: PDFNumber.of(alpha),
        BS: { Type: "Border", W: PDFNumber.of(s.w), S: "S" },
        F: 4, P: page.ref, M: now, T: author,
        AP: { N: ap },
      });
      annots.push(ctx.register(annot));
    }
  });
  // 굿노트 4.9MB·1972획 실측: 기본(객체 스트림) 7초·3.7MB, 끄면 6초·8MB — 아이패드로 받는 크기가 더 중요하다
  return doc.save();
}
