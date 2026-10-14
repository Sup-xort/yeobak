/* ───────── 작은 노트 ─────────
   세 손가락으로 위로 쓸어 올리면 아래에서 올라오는 작은 창(세로 3:4). 서재의 다른 PDF 하나를 띄워 놓고
   넘겨 보며 필기한다(플렉실의 노트 창을 본뜬 것 — 본문 읽으며 기출 풀기). 손잡이를 끌어 옮기고,
   창 크기는 고정, 안에서 두 손가락으로 확대(1~4배)한다. 고른 적 없으면 본문에서 바로 전에 연 문서를 띄운다.

   본문 뷰어(App.jsx)와 따로 돈다 — pdf 문서·쪽 DOM 은 이 컴포넌트 것이다. 필기 데이터만은 App 의
   문서별 저장소(acquireAnn)에서 받아, 본문과 같은 문서를 열면 **같은 객체**를 나눠 쓴다(2026-10-09~).
   그래서 같은 문서의 다른 쪽을 띄워 놓고 양쪽에서 써도 서로의 획을 덮지 않는다 — 한쪽에서 바꾸면
   다른 쪽은 그 쪽만 다시 그린다(mark → onInkPaint, App 의 markInk → apiRef.repaint).
   필기는 본문의 필기 모드(✎)를 따른다: 켜져 있으면 애플펜슬로 쓰고, 도구·색·굵기도 본문과 같은 것.
   올가미는 여기선 안 된다. 실행취소는 본문의 ↶ 가 같이 맡는다 — 연산에 mini(문서 id)를 달아
   App 의 inkApply 가 apiRef.apply 로 넘긴다.
   좌표·저장 형식은 본문 필기와 같다(src/ink.js 머리말) — 그래서 같은 문서를 본문에서 열면 그대로 보인다. */
import { useState, useRef, useEffect } from "react";
import { drawStroke, hitStroke, isScribble, scribbleHits, snapLine, tidyPts, strokePath, HL_ALPHA } from "./ink.js";
import { getPdf, pdfSource } from "./pdfCache.js";
import { u } from "./paths.js";
import { folderPath, folderTree } from "./text.js";

const LS = "yeobaek-mini";
const lsLoad = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const lsSave = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };
const SVGNS = "http://www.w3.org/2000/svg";
const Z_MIN = 1, Z_MAX = 4;
const MAX_PX = 8e6; // 쪽 캔버스 하나의 픽셀 상한 — 크게 확대해도 사파리 캔버스 한도에 안 걸리게
const recentOf = (f) => f.lastOpenedAt || f.at || 0;
const freeCanvas = (c) => { c.width = 0; c.height = 0; c.remove(); }; // App.jsx 의 같은 이름 참고

const inkPathEl = (s) => {
  const p = document.createElementNS(SVGNS, "path");
  const hl = s.t === "hl";
  p.setAttribute("d", strokePath(s));
  p.setAttribute("stroke", s.c);
  p.setAttribute("stroke-width", String(s.w));
  p.setAttribute("stroke-linecap", hl ? "butt" : "round");
  const a = hl ? (s.a ?? HL_ALPHA) : (s.a ?? 1);
  if (a < 1) p.setAttribute("stroke-opacity", String(a));
  return p;
};

export default function MiniNote({ open, onClose, lib, mainId, libApi, cdn, inkOn, inkCfgRef, onInkOp, apiRef, invert, coarse,
  acquireAnn, releaseAnn, onInkPaint }) {
  const st = useRef(null);
  if (!st.current) st.current = { pages: {}, ...lsLoad() };
  const [docId, setDocId] = useState(st.current.id || null);
  const [picking, setPicking] = useState(false);
  const [pos, setPos] = useState(st.current.pos || null); // 창 왼쪽 위(px). null = 아래 가운데
  const [shown, setShown] = useState(false);               // 한 번이라도 열렸나 — 그 전엔 문서를 안 받는다
  const [nPages, setNPages] = useState(0);
  const [pg, setPg] = useState(1);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const wetRef = useRef(null);
  const pagesRef = useRef([]);
  const pdfRef = useRef(null);
  const annRef = useRef(null);      // {id, imported, pages:{n:[stroke]}}
  const sizesRef = useRef([]);      // 쪽별 배율 1 크기 [w1,h1]
  const dirtyRef = useRef(new Set());
  const timerRef = useRef(0);
  const ioRef = useRef(null);
  const mpRef = useRef(null);       // .vb-mpages — 확대는 이 폭(%)을 바꾼다
  const zoomRef = useRef(Math.min(Z_MAX, Math.max(Z_MIN, st.current.zoom || 1)));

  useEffect(() => { if (open) setShown(true); }, [open]);

  const files = lib?.files || [];
  const libReady = files.length > 0;
  const missing = docId && libReady && !files.some((f) => f.id === docId);
  // 고른 문서가 없으면(처음, 지웠음) 본문에서 바로 전에 연 문서. 본문 문서도 고를 수는 있다
  const recent = files.filter((f) => f.id !== mainId).sort((a, b) => recentOf(b) - recentOf(a));
  const effId = docId && !missing ? docId : recent[0]?.id || null;
  const docName = files.find((f) => f.id === effId)?.name?.replace(/\.pdf$/i, "") || "";
  const showPick = picking || !effId;

  const remember = (patch) => { st.current = { ...st.current, ...patch }; lsSave(st.current); };

  /* ── 필기 저장 — 본문과 같은 쪽 단위 PUT, 800ms 디바운스 ── */
  const flush = () => {
    clearTimeout(timerRef.current);
    const a = annRef.current;
    const dirty = [...dirtyRef.current];
    dirtyRef.current.clear();
    if (!a || !dirty.length) return;
    for (const n of dirty) {
      libApi(`/api/library/file/${a.id}/annots/${n}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokes: a.pages[n] || [] }),
      }).then(() => setErr("")).catch((e) => {
        if (e.name === "AuthError") return;
        if (annRef.current === a) dirtyRef.current.add(n);
        setErr("필기를 저장하지 못했어요 — " + e.message);
      });
    }
  };
  const mark = (n) => {
    dirtyRef.current.add(n);
    onInkPaint?.(annRef.current?.id, n); // 본문에 같은 문서가 열려 있으면 그쪽도 다시 그린다
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 800);
  };
  useEffect(() => {
    const on = () => { if (document.visibilityState !== "visible") flush(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(() => { if (!open) flush(); }, [open]);

  /* 쪽 n 의 필기를 SVG 두 장(형광펜 multiply / 펜)으로 통째로 새로 그린다 */
  const paint = (n) => {
    const el = pagesRef.current[n - 1];
    if (!el) return;
    const old = el.querySelectorAll("svg.vb-ink");
    const strokes = annRef.current?.pages?.[n] || [];
    const [w1, h1] = sizesRef.current[n - 1] || [];
    if (!strokes.length || !w1) { old.forEach((c) => c.remove()); return; }
    const mk = (cls) => {
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "vb-ink " + cls);
      svg.setAttribute("viewBox", `0 0 ${w1} ${h1}`);
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    };
    const hl = mk("hl"), pen = mk("pen");
    for (const s of strokes) (s.t === "hl" ? hl : pen).appendChild(inkPathEl(s));
    el.appendChild(hl);
    el.appendChild(pen);
    old.forEach((c) => c.remove());
  };

  // 실행취소·다시실행 — App 의 inkApply 가 mini 가 달린 연산을 여기로 넘긴다
  apiRef.current = {
    id: () => annRef.current?.id || null,
    repaint: (n) => paint(n),
    apply(op, dir) {
      const a = annRef.current;
      if (!a || a.id !== op.mini) return; // 그새 다른 문서로 바꿨다 — 되돌릴 대상이 없다
      const list = (a.pages[op.n] ||= []);
      const idx = (id) => list.findIndex((s) => s.id === id);
      if (op.k === "add") {
        if (dir > 0) list.push(op.s);
        else { const i = idx(op.s.id); if (i >= 0) list.splice(i, 1); }
      } else if (op.k === "del") {
        if (dir > 0) for (const { s } of op.items) { const i = idx(s.id); if (i >= 0) list.splice(i, 1); }
        else for (const { s, i } of [...op.items].reverse()) list.splice(Math.min(i, list.length), 0, s);
      }
      if (!list.length) delete a.pages[op.n];
      paint(op.n);
      mark(op.n);
    },
  };

  /* ── 문서 받기 ── 처음 열릴 때(shown) 받고, 닫아도 들고 있다가 다시 열면 그 자리 그대로 */
  useEffect(() => {
    if (!effId || !shown || !window.pdfjsLib) return;
    let dead = false, held = null;
    setErr(""); setLoading(true); setNPages(0);
    (async () => {
      try {
        // 필기는 파일을 한 번 받은 뒤에 읽는다 — 서버가 첫 GET 때 PDF 속 주석을 필기로 가져온다
        // 본문과 같은 저장소(src/pdfCache.js) — 기기에 있으면 안 받고, 필요한 조각만 읽는다
        const { blob } = await getPdf(u("/api/library/file/" + effId));
        const ann = await acquireAnn(effId);
        if (dead) { if (ann) releaseAnn(effId); return; } // 정리(cleanup)가 먼저 돌았다 — 여기서 놓는다
        if (!ann) throw new Error("필기를 불러오지 못했어요");
        held = effId;
        const pdf = await window.pdfjsLib.getDocument({
          ...pdfSource(blob), cMapUrl: cdn + "cmaps/", cMapPacked: true,
        }).promise;
        if (dead) { pdf.destroy?.(); return; }
        const v = (await pdf.getPage(1)).getViewport({ scale: 1 });
        sizesRef.current = Array.from({ length: pdf.numPages }, () => [v.width, v.height]);
        pagesRef.current = [];
        pdfRef.current = pdf;
        annRef.current = ann; // 본문과 같은 문서면 본문과 같은 객체
        setPg(Math.min(st.current.pages?.[effId] || 1, pdf.numPages));
        setNPages(pdf.numPages);
      } catch (e) {
        if (!dead && e.name !== "AuthError") setErr("문서를 열지 못했어요 — " + e.message);
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
      flush();
      ioRef.current?.disconnect();
      pdfRef.current?.destroy?.();
      pdfRef.current = null;
      annRef.current = null;
      if (held) releaseAnn(held);
    };
  }, [effId, shown]);

  /* ── 쪽 그리기 — 보이는 쪽(+600px)만 캔버스를 들고, 멀어지면 내려놓는다. 필기 SVG 는 그대로 둔다 ── */
  const renderPage = async (n) => {
    const el = pagesRef.current[n - 1];
    const pdf = pdfRef.current;
    if (!el || !pdf || el.dataset.st) return;
    const tok = String(Math.random());
    el.dataset.st = tok;
    try {
      const page = await pdf.getPage(n);
      if (pdfRef.current !== pdf || el.dataset.st !== tok) return;
      const v1 = page.getViewport({ scale: 1 });
      const [ow, oh] = sizesRef.current[n - 1] || [];
      if (ow !== v1.width || oh !== v1.height) {
        sizesRef.current[n - 1] = [v1.width, v1.height];
        el.style.aspectRatio = `${v1.width} / ${v1.height}`;
        paint(n);
      }
      const W = el.clientWidth || 300;
      let dpr = Math.min(window.devicePixelRatio || 1, 3);
      const px = W * dpr * W * dpr * (v1.height / v1.width);
      if (px > MAX_PX) dpr *= Math.sqrt(MAX_PX / px);
      const vp = page.getViewport({ scale: (W * dpr) / v1.width });
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({
        canvasContext: ctx, viewport: vp,
        // 주석을 필기로 가져온 문서는 원본 주석을 끈다(본문 renderPage 와 같은 이유 — 두 겹 방지)
        annotationMode: annRef.current?.imported
          ? window.pdfjsLib.AnnotationMode.DISABLE : window.pdfjsLib.AnnotationMode.ENABLE,
      }).promise;
      if (pdfRef.current !== pdf || el.dataset.st !== tok) return;
      el.querySelectorAll("canvas").forEach(freeCanvas);
      el.insertBefore(cv, el.firstChild);
      if (!el.querySelector("svg.vb-ink")) paint(n);
    } catch {
      if (el.dataset.st === tok) delete el.dataset.st;
    }
  };
  const dropPage = (n) => {
    const el = pagesRef.current[n - 1];
    if (!el) return;
    delete el.dataset.st;
    el.querySelectorAll("canvas").forEach(freeCanvas);
  };

  const observe = () => {
    ioRef.current?.disconnect();
    const sc = scrollRef.current;
    if (!sc || !nPages) return;
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const n = +e.target.dataset.n;
        if (e.isIntersecting) renderPage(n);
        else dropPage(n);
      }
    }, { root: sc, rootMargin: "600px 0px" });
    pagesRef.current.forEach((el) => el && io.observe(el));
    ioRef.current = io;
  };

  // 문서가 들어오면 지난번 쪽으로 가서 관찰을 건다
  useEffect(() => {
    if (!nPages || showPick) return;
    const sc = scrollRef.current;
    const el = pagesRef.current[pg - 1];
    applyZoom();
    if (sc && el) sc.scrollTop = el.offsetTop - 8;
    observe();
    paintAll();
    return () => ioRef.current?.disconnect();
  }, [nPages, showPick]);
  const paintAll = () => { for (let n = 1; n <= nPages; n++) paint(n); };

  // 창 폭이 바뀌면(기기 회전 등) 캔버스를 새 폭으로 다시 그린다
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !nPages || showPick) return;
    let w = sc.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(sc.clientWidth - w) < 2) return;
      w = sc.clientWidth;
      for (let n = 1; n <= nPages; n++) dropPage(n);
      observe();
    });
    ro.observe(sc);
    return () => ro.disconnect();
  }, [nPages, showPick]);

  // 지금 쪽 — 창 위쪽 3분의 1 지점에 걸친 쪽
  const onScroll = () => {
    const sc = scrollRef.current;
    const els = pagesRef.current;
    if (!sc || !els.length) return;
    const y = sc.scrollTop + sc.clientHeight / 3;
    let lo = 0, hi = nPages - 1, at = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if ((els[m]?.offsetTop ?? 0) <= y) { at = m; lo = m + 1; } else hi = m - 1;
    }
    if (at + 1 !== pg) {
      setPg(at + 1);
      if (effId) remember({ pages: { ...st.current.pages, [effId]: at + 1 } });
    }
  };

  /* ── 두 손가락 확대 ── 본문 핀치(App.jsx '두 손가락 핀치 줌')와 같은 규칙으로 돈다:
     - 손가락이 움직이는 동안은 .vb-mpages 에 CSS scale 만 걸고 중점을 따라 직접 스크롤한다. 그동안 관찰(IO)을
       끊는다 — 임시 scale 로 쪽이 600px 여유 밖으로 밀려 캔버스가 치워졌다가 다시 그려지는 걸 막는다.
     - 앵커는 끝나는 순간 중점 아래의 **쪽 번호 + 쪽 안 비율**로 잡는다. 쪽 사이 간격(10px)은 확대해도 그대로라
       "내용 좌표 × 배율"로 잡으면 아래쪽 쪽일수록 어긋났다.
     - 새 폭을 넣은 뒤 목표 위치를 **절대값으로 대입**한다. 예전엔 `scrollTop +=` 상대 보정이라, 축소하면 내용이
       짧아져 브라우저가 scrollTop 을 끝으로 잘라 둔 만큼이 그대로 오차가 됐다(2026-10-09 "작은 창에서 줌하면 튄다").
     - 확정은 손가락을 **전부** 뗀 뒤에. 하나만 떼면 남은 손가락이 네이티브 스크롤을 시작해 iOS 가 우리가 넣은
       scrollTop 을 덮어쓴다 — 남은 손가락의 move 는 막고, 다시 대면 같은 핀치를 이어 간다.
     - 대입한 자리를 350ms 동안 지킨다(새로 만지면 그만) — iOS 가 관성·손가락 위치로 되덮는 걸 되돌린다.
     첫 touchmove 가 cancelable 이 아니면 네이티브 스크롤이 이미 가져간 것 — 포기한다. */
  const applyZoom = () => { if (mpRef.current) mpRef.current.style.width = zoomRef.current * 100 + "%"; };
  useEffect(() => {
    const sc = scrollRef.current, mp = mpRef.current;
    if (!sc || !mp || !nPages || showPick) return;
    let p = null; // {d0, z0, f, m:[x,y], ids:Set}
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
    const reset = () => { mp.style.transform = ""; mp.style.transformOrigin = ""; };
    const abort = () => {
      if (!p) return;
      p = null;
      reset();
      observe();
    };
    // 화면 y 아래의 쪽(변환이 걸려 있어도 getBoundingClientRect 는 변환 후 좌표라 그대로 쓴다)
    const pageAtY = (y) => {
      const els = pagesRef.current;
      let lo = 0, hi = nPages - 1, at = 0;
      while (lo <= hi) {
        const k = (lo + hi) >> 1;
        const r = els[k]?.getBoundingClientRect();
        if (!r) break;
        if (r.top <= y) { at = k; lo = k + 1; } else hi = k - 1;
      }
      return at + 1;
    };
    const onS = (e) => {
      if (p) {
        // 한 손가락을 남긴 채 다른 손가락을 다시 댔다 — 지금 배율에서 이어 간다
        const kept = [...e.touches].filter((t) => p.ids.has(t.identifier));
        if (e.touches.length === 2 && kept.length === 1) {
          p.ids = new Set([...e.touches].map((t) => t.identifier));
          p.d0 = dist(e.touches) / p.f;
          p.m = mid(e.touches);
          return;
        }
        abort(); // 끝을 놓쳤거나 세 번째 손가락 — 버린다
        return;
      }
      if (e.touches.length !== 2) return;
      if ([...e.touches].some((t) => t.touchType === "stylus")) return; // 필기 중 손바닥
      const r = mp.getBoundingClientRect();
      const m = mid(e.touches);
      p = { d0: dist(e.touches), z0: zoomRef.current, f: 1, m, ids: new Set([...e.touches].map((t) => t.identifier)) };
      ioRef.current?.disconnect();
      mp.style.transformOrigin = `${m[0] - r.left}px ${m[1] - r.top}px`;
    };
    const onM = (e) => {
      if (!p) return;
      if (e.touches.length === 1) {
        // 다 뗄 때까지 확정을 미룬다 — 그동안 남은 손가락의 네이티브 스크롤을 막는다. 못 막으면 지금 확정
        if (e.cancelable) e.preventDefault();
        else commit();
        return;
      }
      if (e.touches.length !== 2) return;
      if (!e.cancelable) { abort(); return; }
      e.preventDefault();
      const m = mid(e.touches);
      sc.scrollLeft -= m[0] - p.m[0];
      sc.scrollTop -= m[1] - p.m[1];
      p.m = m;
      const z = Math.max(Z_MIN, Math.min(Z_MAX, p.z0 * dist(e.touches) / p.d0));
      p.f = z / p.z0;
      mp.style.transform = `scale(${p.f})`;
    };
    const onE = (e) => {
      if (!p) return;
      if (e.touches.length === 0) commit();
      else p.ids = new Set([...e.touches].map((t) => t.identifier));
    };
    const commit = () => {
      if (!p) return;
      const { f, z0, m } = p;
      p = null;
      // 앵커 — 변환이 걸린 채로 잰다: 중점 아래 쪽 n 과 그 쪽 안의 비율
      const n = pageAtY(m[1]);
      const el0 = pagesRef.current[n - 1];
      const r0 = el0?.getBoundingClientRect();
      const fx = r0 ? (m[0] - r0.left) / r0.width : 0.5;
      const fy = r0 ? (m[1] - r0.top) / r0.height : 0;
      reset();
      const next = Math.max(Z_MIN, Math.min(Z_MAX, z0 * f));
      if (Math.abs(next - zoomRef.current) < 0.01 || !el0) { observe(); return; }
      zoomRef.current = next;
      applyZoom();
      // 새 폭이 반영된 뒤(getBoundingClientRect 가 레이아웃을 확정시킨다) 목표를 절대값으로 대입
      const vr = sc.getBoundingClientRect();
      const er = el0.getBoundingClientRect();
      const want = {
        top: er.top - vr.top + sc.scrollTop + fy * er.height - (m[1] - vr.top),
        left: er.left - vr.left + sc.scrollLeft + fx * er.width - (m[0] - vr.left),
      };
      sc.scrollTop = want.top;
      sc.scrollLeft = want.left;
      want.top = sc.scrollTop; want.left = sc.scrollLeft; // 끝에 걸려 잘린 값이 기준
      let touched = false;
      const off = () => { touched = true; };
      sc.addEventListener("touchstart", off, { passive: true });
      const hold = () => {
        if (touched || zoomRef.current !== next) return;
        if (Math.abs(sc.scrollTop - want.top) > 4) sc.scrollTop = want.top;
        if (Math.abs(sc.scrollLeft - want.left) > 4) sc.scrollLeft = want.left;
      };
      requestAnimationFrame(() => { hold(); requestAnimationFrame(hold); });
      setTimeout(hold, 120);
      setTimeout(() => { hold(); sc.removeEventListener("touchstart", off); }, 350);
      remember({ zoom: next });
      // 새 폭으로 다시 그린다 — 옛 캔버스는 새 것이 나올 때까지 늘어난 채 남는다.
      // 관찰은 스크롤을 고친 다음에 붙인다(본문 relayout 과 같은 이유)
      pagesRef.current.forEach((x) => x && delete x.dataset.st);
      observe();
    };
    const onHide = () => { if (document.visibilityState !== "visible") abort(); };
    sc.addEventListener("touchstart", onS, { passive: true });
    sc.addEventListener("touchmove", onM, { passive: false });
    sc.addEventListener("touchend", onE, { passive: true });
    sc.addEventListener("touchcancel", abort, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      sc.removeEventListener("touchstart", onS);
      sc.removeEventListener("touchmove", onM);
      sc.removeEventListener("touchend", onE);
      sc.removeEventListener("touchcancel", abort);
      document.removeEventListener("visibilitychange", onHide);
      reset();
    };
  }, [nPages, showPick]);

  /* ── 필기 입력 — 본문 필기와 같은 원칙(App.jsx '입력' 주석): 시작·끝·스크롤 차단은 터치 이벤트(stylus),
     좌표는 passive pointermove 의 getCoalescedEvents. 긋는 중 획은 창 안의 젖은 캔버스에 그린다. ── */
  useEffect(() => {
    const sc = scrollRef.current, wet = wetRef.current;
    if (!sc || !wet || !inkOn || !nPages || showPick) return;
    let ctx = null, dpr = 1, wr = null, cur = null;

    const fit = () => {
      const r = sc.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!wr || r.width !== wr.width || r.height !== wr.height) {
        wet.width = Math.round(r.width * dpr);
        wet.height = Math.round(r.height * dpr);
        ctx = wet.getContext("2d", { desynchronized: true });
      }
      wr = r;
    };
    const geo = (n) => {
      const el = pagesRef.current[n - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { r, k: r.width / (sizesRef.current[n - 1]?.[0] || r.width) };
    };
    const hitPage = (x, y) => {
      const els = pagesRef.current;
      let lo = 0, hi = nPages - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        const r = els[m]?.getBoundingClientRect();
        if (!r) return 0;
        if (y < r.top) hi = m - 1;
        else if (y > r.bottom) lo = m + 1;
        else return x >= r.left && x <= r.right ? m + 1 : 0;
      }
      return 0;
    };
    const toPage = (g, x, y) => [(x - g.r.left) / g.k, (y - g.r.top) / g.k];

    const render = (pred) => {
      if (!ctx) fit();
      ctx.clearRect(0, 0, wet.width, wet.height);
      if (!cur) return;
      const g = geo(cur.n);
      if (!g) return;
      const k = g.k * dpr, ox = (g.r.left - wr.left) * dpr, oy = (g.r.top - wr.top) * dpr;
      if (cur.kind === "draw") {
        const s = cur.s, P = s.pts;
        let ds = s;
        if (!cur.snapped && pred?.length) ds = { ...s, pts: [...P, ...pred] };
        drawStroke(ctx, ds, k, ox, oy);
      } else if (cur.at) {
        ctx.save();
        ctx.strokeStyle = "rgba(120,120,120,.9)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(cur.at[0] * k + ox, cur.at[1] * k + oy, cur.r * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const eraseAt = (pt) => {
      cur.at = pt;
      const list = annRef.current?.pages?.[cur.n];
      if (!list) return;
      let hit = false;
      for (let i = list.length - 1; i >= 0; i--) {
        if (hitStroke(list[i], pt[0], pt[1], cur.r)) { cur.gone.push({ s: list.splice(i, 1)[0], i }); hit = true; }
      }
      if (hit) {
        if (!list.length) delete annRef.current.pages[cur.n];
        paint(cur.n);
      }
    };
    const armSnap = () => {
      clearTimeout(cur.still);
      const c = cur;
      c.still = setTimeout(() => {
        if (cur !== c || c.snapped) return;
        const P = c.s.pts, a = P[0], b = P[P.length - 1];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) return;
        c.snapped = true;
        c.s.pts = snapLine(P);
        render();
      }, 450);
    };

    const begin = (x, y) => {
      if (!annRef.current) return false;
      const tool = inkCfgRef.current.tool;
      if (tool === "lasso") return false; // 올가미는 본문에서만 — 펜은 그냥 스크롤한다
      fit();
      const n = hitPage(x, y);
      const g = n && geo(n);
      if (!g) return false;
      const pt = toPage(g, x, y);
      if (tool === "eraser") {
        cur = { kind: "erase", n, gone: [], r: 9 / g.k };
        eraseAt(pt);
      } else {
        const c = tool === "hl" ? inkCfgRef.current.hl : inkCfgRef.current.pen;
        const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: tool, c: c.c, w: c.w, pts: [pt] };
        cur = { kind: "draw", n, s };
        wet.style.mixBlendMode = tool === "hl" ? "multiply" : "";
      }
      render();
      return true;
    };
    const add = (g, x, y) => {
      const pt = toPage(g, x, y);
      if (cur.kind === "erase") { eraseAt(pt); return; }
      const s = cur.s;
      if (cur.snapped) { s.pts = snapLine([s.pts[0], pt]); return; }
      const l = s.pts[s.pts.length - 1];
      if (Math.abs(pt[0] - l[0]) + Math.abs(pt[1] - l[1]) < 0.04) return;
      s.pts.push(pt);
      if (s.t === "hl") armSnap();
    };
    const end = () => {
      const c = cur;
      cur = null;
      if (!c) return;
      clearTimeout(c.still);
      const a = annRef.current;
      if (c.kind === "draw" && a) {
        const s = c.s;
        s.pts = tidyPts(s.pts, 0.04);
        const gone = s.t === "pen" && isScribble(s.pts) && a.pages[c.n] ? scribbleHits(a.pages[c.n], s) : [];
        if (gone.length) { // 지그재그로 지웠다 — 지그재그 자신은 남기지 않는다
          if (!a.pages[c.n].length) delete a.pages[c.n];
          paint(c.n);
          onInkOp({ k: "del", n: c.n, items: gone, mini: a.id });
          mark(c.n);
          wet.style.mixBlendMode = "";
          render();
          return;
        }
        (a.pages[c.n] ||= []).push(s);
        const svg = pagesRef.current[c.n - 1]?.querySelector("svg.vb-ink." + (s.t === "hl" ? "hl" : "pen"));
        if (svg) svg.appendChild(inkPathEl(s)); else paint(c.n);
        onInkOp({ k: "add", n: c.n, s, mini: a.id });
        mark(c.n);
      } else if (c.kind === "erase" && c.gone.length && a) {
        onInkOp({ k: "del", n: c.n, items: c.gone, mini: a.id });
        mark(c.n);
      }
      wet.style.mixBlendMode = "";
      render();
    };

    let tid = null, pid = null;
    const stylus = (list) => { for (const t of list) if (t.touchType === "stylus") return t; return null; };
    const onTS = (e) => {
      if (cur) { if (e.cancelable) e.preventDefault(); return; }
      const t = stylus(e.changedTouches);
      if (!t) return;
      if (begin(t.clientX, t.clientY)) { tid = t.identifier; if (e.cancelable) e.preventDefault(); }
    };
    const onTM = (e) => {
      if (!cur || tid == null) return;
      if (e.cancelable) e.preventDefault();
      if (cur.ptr) return;
      const g = geo(cur.n);
      if (!g) return;
      for (const t of e.changedTouches) if (t.identifier === tid) add(g, t.clientX, t.clientY);
      render();
    };
    const onTE = (e) => {
      if (!cur || tid == null) return;
      for (const t of e.changedTouches) if (t.identifier === tid) { tid = null; end(); }
    };
    const onPM = (e) => {
      if (!cur) return;
      if (tid != null) { if (e.pointerType !== "pen") return; cur.ptr = true; }
      else if (e.pointerId !== pid) return;
      const g = geo(cur.n);
      if (!g) return;
      const evs = e.getCoalescedEvents?.();
      for (const c of evs?.length ? evs : [e]) add(g, c.clientX, c.clientY);
      const pr = cur.kind === "draw" ? e.getPredictedEvents?.() : null;
      render(pr?.length ? pr.map((c) => toPage(g, c.clientX, c.clientY)) : null);
    };
    const onPD = (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (begin(e.clientX, e.clientY)) { pid = e.pointerId; e.preventDefault(); sc.setPointerCapture?.(e.pointerId); }
    };
    const onPU = (e) => { if (e.pointerId === pid) { pid = null; end(); } };
    sc.addEventListener("touchstart", onTS, { passive: false });
    sc.addEventListener("touchmove", onTM, { passive: false });
    sc.addEventListener("touchend", onTE, { passive: true });
    sc.addEventListener("touchcancel", onTE, { passive: true });
    sc.addEventListener("pointermove", onPM, { passive: true });
    if (!coarse) {
      sc.addEventListener("pointerdown", onPD);
      sc.addEventListener("pointerup", onPU);
      sc.addEventListener("pointercancel", onPU);
    }
    return () => {
      sc.removeEventListener("touchstart", onTS);
      sc.removeEventListener("touchmove", onTM);
      sc.removeEventListener("touchend", onTE);
      sc.removeEventListener("touchcancel", onTE);
      sc.removeEventListener("pointermove", onPM);
      sc.removeEventListener("pointerdown", onPD);
      sc.removeEventListener("pointerup", onPU);
      sc.removeEventListener("pointercancel", onPU);
      if (cur) end();
    };
  }, [inkOn, nPages, showPick]);

  /* ── 손잡이로 옮기기 ── 창이 화면 밖으로 다 나가지 않게 손잡이 줄은 늘 화면 안에 남긴다 */
  const drag = useRef(null);
  const clampPos = (x, y) => {
    const p = panelRef.current;
    const w = p?.offsetWidth || 400;
    return {
      x: Math.round(Math.max(-w + 120, Math.min(window.innerWidth - 120, x))),
      y: Math.round(Math.max(0, Math.min(window.innerHeight - 56, y))),
    };
  };
  const onHandleDown = (e) => {
    if (e.target.closest("button")) return;
    const r = panelRef.current.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    panelRef.current.classList.add("drag");
  };
  const onHandleMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onHandleUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    panelRef.current.classList.remove("drag");
    setPos((p) => { if (p) remember({ pos: p }); return p; });
  };

  const pick = (id) => {
    flush();
    setDocId(id);
    setPicking(false);
    remember({ id });
  };

  // 고르기 목록 — 맨 위에 지금 본문 문서(다른 쪽을 같이 띄워 보기), 그 다음 폴더 밖 문서, 그 다음 폴더별
  const mainFile = files.find((f) => f.id === mainId);
  const groups = (() => {
    const by = new Map([[null, []]]);
    for (const f of folderTree(lib?.folders || [])) by.set(f.id, []);
    for (const f of files) if (f.id !== mainId) (by.get(f.folder ?? null) || by.get(null)).push(f);
    const name = (id) => folderPath(lib?.folders || [], id);
    let out = [...by].filter(([, l]) => l.length).map(([id, l]) => ({ id, name: id ? name(id) : "", files: l }));
    if (recent.length > 6) out = [{ id: "recent", name: "최근 연 문서", files: recent.slice(0, 4) }, ...out];
    return mainFile ? [{ id: "main", name: "지금 본문 문서", files: [mainFile] }, ...out] : out;
  })();

  const style = pos ? { left: clampPos(pos.x, pos.y).x, top: clampPos(pos.x, pos.y).y, bottom: "auto" } : undefined;

  return (
    <div ref={panelRef} className={"vb-mini" + (open ? "" : " off") + (invert ? " inv" : "")} style={style}
      aria-hidden={!open}>
      <div className="vb-mhead" onPointerDown={onHandleDown} onPointerMove={onHandleMove}
        onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
        <i className="vb-mgrip" />
        <button className="vb-mname" onClick={() => setPicking((v) => !v || !effId)}
          title="다른 문서 고르기">
          <span>{showPick ? "문서 고르기" : docName || "작은 노트"}</span>
          <svg viewBox="0 0 24 24"><path d={showPick ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg>
        </button>
        {!showPick && nPages > 0 && <span className="vb-mpg">{pg} / {nPages}</span>}
        <button className="vb-mx" onClick={onClose} aria-label="작은 노트 닫기">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="vb-mnbody">
        {showPick ? (
          <div className="vb-mpick">
            {!groups.length && <p className="vb-mnote">서재에 띄울 문서가 없어요.</p>}
            {groups.map((g) => (
              <section key={g.id ?? "root"}>
                {g.name && <h4>{g.name}</h4>}
                {g.files.map((f) => (
                  <button key={g.id + f.id} className={"vb-mrow" + (f.id === effId ? " on" : "")} onClick={() => pick(f.id)}>
                    {f.name.replace(/\.pdf$/i, "")}
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="vb-mscroll" ref={scrollRef} onScroll={onScroll}>
              <div className="vb-mpages" ref={mpRef}>
                {Array.from({ length: nPages }, (_, i) => (
                  <div key={effId + ":" + i} className="vb-page vb-mpage" data-n={i + 1}
                    ref={(el) => { pagesRef.current[i] = el; }}
                    style={{ aspectRatio: `${sizesRef.current[i]?.[0] || 1} / ${sizesRef.current[i]?.[1] || 1.414}` }} />
                ))}
              </div>
              {loading && <p className="vb-mnote">여는 중…</p>}
            </div>
            <canvas className="vb-mwet" ref={wetRef} />
          </>
        )}
        {err && <p className="vb-merr">{err}</p>}
      </div>
    </div>
  );
}
