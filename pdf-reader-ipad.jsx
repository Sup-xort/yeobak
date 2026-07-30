import { useState, useRef, useEffect, useCallback } from "react";

/* ───────────────────────── 설정 ───────────────────────── */
const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_CFG = {
  geminiKey: "",
  geminiModel: "gemini-3.5-flash",
  forceGemini: false,
  useDict: true,
};
const WIDE = 880;

const CSS = `
.vb-root{--desk:#201F1D;--desk2:#2A2926;--desk3:#38362F;--paper:#FDFDFC;
  --muted:#918C82;--mark:#FFD84D;--mark2:#6FD3C0;--line:rgba(255,255,255,.10);
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",Pretendard,"Noto Sans KR","Segoe UI",system-ui,sans-serif;
  --serif:"Iowan Old Style",Charter,"Palatino Linotype",Georgia,"Times New Roman",serif;
  position:relative;width:100%;height:100vh;height:100dvh;
  display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--sans);background:var(--desk);color:#EDEBE6;font-size:15px;
  -webkit-font-smoothing:antialiased;overscroll-behavior:none}
.vb-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.vb-root button{font-family:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}

.vb-bar{flex:0 0 auto;display:flex;align-items:center;gap:2px;
  padding:calc(6px + env(safe-area-inset-top)) 8px 6px;
  background:var(--desk);border-bottom:1px solid var(--line);z-index:40}
.vb-tool{height:36px;min-width:36px;padding:0 10px;border-radius:9px;display:inline-flex;
  align-items:center;justify-content:center;font-size:13px;color:#D9D5CC;flex:0 0 auto;
  touch-action:manipulation}
.vb-tool:active{background:var(--desk3)}
.vb-tool.on{background:var(--mark);color:#241F00;font-weight:600}
.vb-tool svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round}
@media (pointer:coarse){.vb-tool{height:42px;min-width:42px}}
.vb-name{flex:1;min-width:0;padding:0 8px;font-size:13px;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb-pill{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--muted);padding:0 8px;white-space:nowrap}
.vb-eng{font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:4px 7px;
  border-radius:5px;background:var(--desk3);color:var(--muted);white-space:nowrap}
.vb-eng.c{color:var(--mark)} .vb-eng.g{color:var(--mark2)}

.vb-body{flex:1;min-height:0;display:flex;position:relative}

.vb-out{position:absolute;inset:0 auto 0 0;width:min(80%,300px);z-index:30;background:var(--desk2);
  border-right:1px solid var(--line);transform:translateX(-101%);
  transition:transform .24s cubic-bezier(.3,.8,.4,1);display:flex;flex-direction:column}
.vb-out.open{transform:none}
.vb-root.wide .vb-out{position:relative;flex:0 0 272px;width:272px;transform:none}
.vb-root.wide .vb-out.closed{display:none}
.vb-out h2{margin:0;padding:14px 16px 10px;font-size:10.5px;font-weight:600;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.vb-olist{flex:1;overflow-y:auto;padding:0 8px calc(24px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.vb-oi{display:block;width:100%;text-align:left;padding:10px;border-radius:7px;
  font-size:13.5px;line-height:1.4;color:#CFCBC2;touch-action:manipulation}
.vb-oi:active{background:var(--desk3)}
.vb-oi.d1{padding-left:24px;font-size:13px;color:#B4B0A7}
.vb-oi.d2{padding-left:36px;font-size:12.5px;color:#A09C93}
.vb-oempty{padding:10px 12px;font-size:13px;color:var(--muted);line-height:1.5}
.vb-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:25;opacity:0;
  pointer-events:none;transition:opacity .24s}
.vb-scrim.on{opacity:1;pointer-events:auto}
.vb-root.wide .vb-scrim{display:none}

.vb-view{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  padding:14px 0 45vh;touch-action:pan-y;overscroll-behavior:contain}
.vb-pages{transform-origin:50% 0;will-change:transform}
.vb-page{position:relative;margin:0 auto 14px;background:var(--paper);
  box-shadow:0 1px 3px rgba(0,0,0,.5),0 10px 30px rgba(0,0,0,.28);border-radius:2px;overflow:hidden}
.vb-page canvas{display:block;width:100%;height:100%}
.vb-pn{position:absolute;right:6px;bottom:5px;font-size:9.5px;color:#B9B5AC;
  font-variant-numeric:tabular-nums;pointer-events:none}
.vb-tl{position:absolute;inset:0;overflow:hidden;line-height:1;color:transparent;
  -webkit-user-select:text;user-select:text;-webkit-touch-callout:none}
.vb-tl .it{position:absolute;white-space:pre;transform-origin:0 0;cursor:text}
.vb-tl .w{border-radius:2px}
.vb-tl .w.hit{background:var(--mark);box-shadow:0 0 0 1px var(--mark)}
.vb-tl .w.sent{background:rgba(111,211,192,.55)}
.vb-root ::selection{background:rgba(255,216,77,.55)}

.vb-zoompill{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:36;
  padding:6px 14px;border-radius:20px;background:rgba(32,31,29,.9);color:#EDEBE6;
  font-size:13px;font-variant-numeric:tabular-nums;pointer-events:none}

.vb-drop{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:18px;text-align:center;padding:32px;background:var(--desk)}
.vb-mk{font-family:var(--serif);font-size:56px;line-height:1;color:var(--paper);letter-spacing:-.02em}
.vb-mk em{font-style:italic;background:var(--mark);color:#241F00;padding:0 .12em;border-radius:3px}
.vb-drop p{margin:0;max-width:36ch;font-size:14px;line-height:1.7;color:var(--muted)}
.vb-pick{margin-top:4px;padding:13px 24px;border-radius:12px;background:var(--mark);
  color:#241F00;font-weight:650;font-size:15px;touch-action:manipulation}
.vb-hint{font-size:12.5px;color:#6E6A62;line-height:1.8}
.vb-hint b{color:#9B958A;font-weight:600}

.vb-sheet{position:absolute;left:0;right:0;bottom:0;z-index:35;background:var(--desk2);
  border-top:1px solid var(--line);border-radius:18px 18px 0 0;display:flex;flex-direction:column;
  transform:translateY(100%);transition:transform .26s cubic-bezier(.3,.85,.35,1);
  box-shadow:0 -8px 34px rgba(0,0,0,.4)}
.vb-sheet.open{transform:none}
.vb-root.wide .vb-sheet{left:auto;right:0;top:0;bottom:0;width:400px;height:100%!important;
  border-radius:0;border-top:0;border-left:1px solid var(--line);transform:translateX(101%)}
.vb-root.wide .vb-sheet.open{transform:none}
.vb-grip{padding:10px 0 2px;display:flex;justify-content:center;touch-action:none;cursor:grab}
.vb-grip i{width:42px;height:5px;border-radius:3px;background:#57544C;display:block}
.vb-root.wide .vb-grip{display:none}
.vb-tabs{display:flex;gap:2px;padding:4px 10px 8px;align-items:center}
.vb-root.wide .vb-tabs{padding-top:16px}
.vb-tab{padding:8px 14px;border-radius:8px;font-size:13.5px;color:var(--muted);touch-action:manipulation}
.vb-tab.on{background:var(--desk3);color:#F2EFE8;font-weight:600}
.vb-x{margin-left:auto;padding:8px 12px;color:var(--muted);font-size:18px;line-height:1}
.vb-panes{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;padding:0 20px calc(22px + env(safe-area-inset-bottom))}

.vb-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.vb-hw{font-family:var(--serif);font-size:32px;line-height:1.15;color:var(--paper);
  letter-spacing:-.01em;word-break:break-word}
.vb-pos{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mark);
  border:1px solid rgba(255,216,77,.35);border-radius:4px;padding:2px 6px}
.vb-rule{height:1px;background:var(--line);margin:14px 0}
.vb-lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.vb-txt{margin:0;font-size:15.5px;line-height:1.75;color:#E7E4DD;white-space:pre-wrap;word-break:break-word}
.vb-quote{font-family:var(--serif);font-size:15px;color:#C9C5BC;border-left:2px solid var(--mark2);
  padding-left:12px;line-height:1.65;white-space:pre-wrap}
.vb-senses{margin:0;padding:0;list-style:none;counter-reset:s}
.vb-senses li{font-size:15px;line-height:1.65;color:#DAD6CE;padding:3px 0 3px 20px;position:relative}
.vb-senses li::before{content:counter(s);counter-increment:s;position:absolute;left:0;top:5px;
  font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vb-cur::after{content:'';display:inline-block;width:7px;height:15px;margin-left:2px;
  background:var(--mark);vertical-align:-2px;animation:vbblink .9s steps(2) infinite}
@keyframes vbblink{0%,50%{opacity:1}50.01%,100%{opacity:0}}
.vb-err{color:#FF9A8A;font-size:13.5px;line-height:1.6}
.vb-ph{color:#6E6A62;font-size:14px;line-height:1.75;padding:8px 0}

.vb-msg{font-size:15px;line-height:1.75;margin-bottom:14px}
.vb-msg.me{color:var(--mark);font-weight:550}
.vb-msg.ai{color:#E7E4DD;white-space:pre-wrap}
.vb-askbar{position:sticky;bottom:0;background:var(--desk2);padding:10px 0 4px;
  display:flex;gap:8px;align-items:flex-end}
.vb-askin{flex:1;min-height:44px;max-height:120px;resize:none;padding:11px 12px;border-radius:11px;
  border:1px solid var(--line);background:#232220;color:#EDEBE6;font-size:16px;line-height:1.4;
  outline:none;font-family:inherit}
.vb-askin:focus{border-color:rgba(255,216,77,.5)}
.vb-send{height:44px;padding:0 16px;border-radius:11px;background:var(--mark);color:#241F00;
  font-weight:650;font-size:14.5px;touch-action:manipulation}
.vb-send:disabled{opacity:.4}
.vb-askctx{font-size:12px;color:var(--muted);line-height:1.55;margin-bottom:14px}

.vb-modal{position:absolute;inset:0;z-index:50;background:rgba(20,19,18,.92);display:flex;
  align-items:center;justify-content:center;padding:24px}
.vb-card{width:min(440px,100%);background:var(--desk2);border:1px solid var(--line);
  border-radius:16px;padding:22px;max-height:86%;overflow-y:auto}
.vb-card h3{margin:0 0 4px;font-size:17px;font-weight:650}
.vb-sub{margin:0 0 18px;font-size:13px;color:var(--muted);line-height:1.65}
.vb-field{margin-bottom:16px}
.vb-field label{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);margin-bottom:7px}
.vb-field input{width:100%;padding:11px;border-radius:10px;border:1px solid var(--line);
  background:#232220;color:#EDEBE6;font-size:16px;outline:none;font-family:inherit}
.vb-row{display:flex;align-items:center;gap:10px;font-size:14px;color:#D2CEC5;margin-bottom:16px}
.vb-row input{width:19px;height:19px;accent-color:var(--mark);flex:0 0 auto}
.vb-done{width:100%;padding:13px;border-radius:11px;background:var(--mark);color:#241F00;
  font-weight:650;font-size:15px;touch-action:manipulation}

.vb-bubble{position:absolute;z-index:38;padding:9px 15px;border-radius:10px;background:var(--mark);
  color:#241F00;font-size:13.5px;font-weight:650;box-shadow:0 4px 14px rgba(0,0,0,.4);white-space:nowrap}

@media (prefers-reduced-motion:reduce){.vb-root *{transition:none!important;animation:none!important}}
`;

/* ───────────────── AI 호출 (Claude → Gemini) ───────────────── */
async function readSSE(res, pick, onDelta) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("event-stream")) {
    const j = await res.json();
    const t = pick.whole(j);
    if (t) onDelta(t);
    return t;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let j;
      try { j = JSON.parse(raw); } catch { continue; }
      const t = pick.delta(j);
      if (t) { out += t; onDelta(t); }
    }
  }
  return out;
}

async function callClaude(system, user, onDelta, signal) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 1000, system,
      messages: [{ role: "user", content: user }], stream: true,
    }),
  });
  if (!res.ok) throw new Error("Claude " + res.status);
  const t = await readSSE(res, {
    delta: (j) => (j.type === "content_block_delta" && j.delta?.text) || "",
    whole: (j) => (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""),
  }, onDelta);
  if (!t) throw new Error("Claude 응답 없음");
  return t;
}

async function callGemini(cfg, system, user, onDelta, signal) {
  if (!cfg.geminiKey) throw new Error("Gemini 키 없음");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 1000, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    let d = "";
    try { d = (await res.json()).error?.message || ""; } catch {}
    throw new Error("Gemini " + res.status + (d ? ": " + d : ""));
  }
  const grab = (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return await readSSE(res, { delta: grab, whole: grab }, onDelta);
}

/* ───────────────── 텍스트 유틸 ───────────────── */
function wordAt(text, off) {
  let s = off, e = off;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return text.slice(s, e).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "");
}
function sentenceAt(text, off) {
  const stop = /[.!?。！？…\n]/;
  let s = off, e = off;
  while (s > 0 && !stop.test(text[s - 1])) s--;
  while (e < text.length && !stop.test(text[e])) e++;
  if (e < text.length) e++;
  return { text: text.slice(s, e).replace(/\s+/g, " ").trim(), start: s, end: e };
}
function parseWord(s) {
  const m = s.match(/뜻\s*:\s*([\s\S]*?)(?:\n\s*문맥\s*:|$)/);
  const c = s.match(/문맥\s*:\s*([\s\S]*)$/);
  return { mean: m ? m[1].trim() : "", ctx: c ? c[1].trim() : "" };
}

const SYS_WORD = `너는 한국 대학생이 영어 원서·논문을 읽을 때 옆에서 짚어주는 사람이다.
답은 한국어로, 군더더기 없이 짧게. 인사·서론·마무리 문장 금지. 마크다운 기호 금지.
반드시 아래 두 줄 형식만 출력한다:
뜻: <사전적 의미 1~3개를 ' / '로 구분해 한 줄>
문맥: <이 문장 안에서 어떤 의미와 역할로 쓰였는지 1~2문장>`;

const SYS_SENT = `너는 영어 원서·논문을 읽는 한국 대학생의 번역 파트너다.
입력 문장을 자연스러운 한국어로 옮긴다. 직역투를 피하고 전문 용어는 원어를 괄호로 병기한다.
번역문만 출력한다. 인사·설명·마크다운 금지.
문장 구조가 까다로울 때만 마지막 줄에 "핵심: "으로 시작하는 한 줄을 덧붙인다.`;

const SYS_ASK = `너는 한국 대학생이 읽고 있는 문서를 함께 보는 튜터다.
주어진 본문 발췌를 근거로 한국어로 답한다. 짧고 정확하게, 필요하면 원문 표현을 인용한다.
본문에 없는 내용은 추측이라고 밝힌다. 인사말 없이 바로 답한다.`;

/* ───────────────── 컴포넌트 ───────────────── */
export default function VerbatimReader() {
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [docName, setDocName] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const [outline, setOutline] = useState([]);
  const [outOpen, setOutOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState("word");
  const [engine, setEngine] = useState("");
  const [word, setWord] = useState(null);
  const [sent, setSent] = useState(null);
  const [askLog, setAskLog] = useState([]);
  const [askVal, setAskVal] = useState("");
  const [asking, setAsking] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [busy, setBusy] = useState(false);
  const [sheetFrac, setSheetFrac] = useState(0.46);
  const [bubble, setBubble] = useState(null);
  const [wide, setWide] = useState(true);
  const [zoomPill, setZoomPill] = useState(null);

  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const pdfRef = useRef(null);
  const pagesRef = useRef([]);
  const dataRef = useRef([]);
  const renderedRef = useRef(new Set());
  const queueRef = useRef(new Set());
  const ioRef = useRef(null);
  const scaleRef = useRef(1);
  const zoomRef = useRef(1);
  const curRef = useRef(1);
  const cacheRef = useRef(new Map());
  const cfgRef = useRef(cfg);
  const downRef = useRef(0);
  const tapRef = useRef({ t: 0, page: null });
  const wAbort = useRef(null);
  const sAbort = useRef(null);
  const lastSentRef = useRef("");
  const selRef = useRef("");
  const boxRef = useRef({ w: 1024, h: 768 });
  const layoutRef = useRef({ sheetOpen: false, outOpen: false });

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { layoutRef.current = { sheetOpen, outOpen }; }, [sheetOpen, outOpen]);

  /* 설정 저장 / 복원 */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage?.get("yeobaek");
        if (!r?.value) return;
        const s = JSON.parse(r.value);
        if (s.cfg) setCfg((c) => ({ ...c, ...s.cfg }));
        if (s.zoom) zoomRef.current = s.zoom;
      } catch {}
    })();
  }, []);
  const persist = useCallback(async () => {
    try {
      await window.storage?.set(
        "yeobaek",
        JSON.stringify({ cfg: cfgRef.current, zoom: zoomRef.current })
      );
    } catch {}
  }, []);

  /* pdf.js */
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = CDN + "pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + "pdf.worker.min.js";
      setReady(true);
    };
    s.onerror = () => setLoadErr("pdf.js를 불러오지 못했습니다. 네트워크를 확인하세요.");
    document.head.appendChild(s);
  }, []);

  /* 컨테이너 크기 관측 — 스플릿 뷰·슬라이드 오버 대응 */
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      boxRef.current = { w: r.width, h: r.height };
      setWide(r.width >= WIDE);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const ask = useCallback(async (system, user, onDelta, signal) => {
    const c = cfgRef.current;
    if (!c.forceGemini && Date.now() > downRef.current) {
      try {
        setEngine("Claude");
        return await callClaude(system, user, onDelta, signal);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        downRef.current = Date.now() + 3 * 60 * 1000;
      }
    }
    setEngine("Gemini");
    return await callGemini(c, system, user, onDelta, signal);
  }, []);

  /* ── 레이아웃 계산 ── */
  const contentWidth = () => {
    const { w } = boxRef.current;
    const isWide = w >= WIDE;
    const pad = isWide ? 56 : 12;
    const sh = isWide && layoutRef.current.sheetOpen ? 400 : 0;
    const ow = isWide && layoutRef.current.outOpen ? 272 : 0;
    return Math.max(240, w - pad - sh - ow);
  };

  const buildTextLayer = async (page, vp, layer, n) => {
    const tc = await page.getTextContent();
    let text = "";
    const words = [];
    const frag = document.createDocumentFragment();
    const pend = [];
    for (const item of tc.items) {
      if (!item.str) { if (item.hasEOL) text += "\n"; continue; }
      if (text && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      const tx = window.pdfjsLib.Util.transform(vp.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      const ang = Math.atan2(tx[1], tx[0]);
      const st = tc.styles[item.fontName] || {};
      const d = document.createElement("span");
      d.className = "it";
      d.style.left = tx[4] + "px";
      d.style.top = tx[5] - fh + "px";
      d.style.fontSize = fh + "px";
      d.style.fontFamily = st.fontFamily || "sans-serif";
      for (const part of item.str.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { d.appendChild(document.createTextNode(part)); text += part; }
        else {
          const w = document.createElement("span");
          w.className = "w";
          w.textContent = part;
          w.dataset.off = String(text.length);
          w.dataset.page = String(n);
          d.appendChild(w);
          text += part;
          words.push(w);
        }
      }
      if (item.hasEOL) text += "\n";
      frag.appendChild(d);
      pend.push([d, item.width * vp.scale, ang]);
    }
    layer.appendChild(frag);
    const widths = pend.map(([d]) => d.offsetWidth);
    pend.forEach(([d, target, ang], i) => {
      const a = widths[i];
      let t = "";
      if (ang) t += `rotate(${ang}rad) `;
      if (a > 0 && target > 0) t += `scaleX(${target / a})`;
      if (t) d.style.transform = t;
    });
    dataRef.current[n - 1] = { text, words };
  };

  const renderPage = async (n) => {
    if (renderedRef.current.has(n) || queueRef.current.has(n)) return;
    queueRef.current.add(n);
    try {
      const pdf = pdfRef.current;
      const page = await pdf.getPage(n);
      const el = pagesRef.current[n - 1];
      if (!el) return;
      const vp = page.getViewport({ scale: scaleRef.current * zoomRef.current });
      el.style.width = vp.width + "px";
      el.style.height = vp.height + "px";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width * dpr);
      cv.height = Math.floor(vp.height * dpr);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      el.insertBefore(cv, el.firstChild);
      await page.render({
        canvasContext: ctx, viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      const layer = document.createElement("div");
      layer.className = "vb-tl";
      el.appendChild(layer);
      await buildTextLayer(page, vp, layer, n);
      renderedRef.current.add(n);
    } catch (e) {
      console.error("page " + n, e);
    } finally {
      queueRef.current.delete(n);
    }
  };

  const prune = () => {
    for (const n of [...renderedRef.current]) {
      if (Math.abs(n - curRef.current) > 4) {
        const el = pagesRef.current[n - 1];
        if (el) {
          el.querySelector("canvas")?.remove();
          el.querySelector(".vb-tl")?.remove();
        }
        renderedRef.current.delete(n);
        dataRef.current[n - 1] = null;
      }
    }
  };

  const observe = () => {
    ioRef.current?.disconnect();
    ioRef.current = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const n = +e.target.dataset.n;
        if (e.isIntersecting) {
          renderPage(n);
          if (e.intersectionRatio > 0.35) { curRef.current = n; setCurPage(n); }
        }
      }
      prune();
    }, { root: viewRef.current, rootMargin: "1000px 0px", threshold: [0, 0.35] });
    pagesRef.current.forEach((el) => el && ioRef.current.observe(el));
  };

  const buildPages = (w1, h1, total) => {
    const stage = stageRef.current;
    stage.innerHTML = "";
    pagesRef.current = [];
    scaleRef.current = contentWidth() / w1;
    const w = w1 * scaleRef.current * zoomRef.current;
    const h = h1 * scaleRef.current * zoomRef.current;
    for (let i = 1; i <= total; i++) {
      const d = document.createElement("div");
      d.className = "vb-page";
      d.dataset.n = String(i);
      d.style.width = w + "px";
      d.style.height = h + "px";
      const s = document.createElement("span");
      s.className = "vb-pn";
      s.textContent = String(i);
      d.appendChild(s);
      stage.appendChild(d);
      pagesRef.current[i - 1] = d;
    }
  };

  const loadPDF = async (buf, name) => {
    setBusy(true);
    setLoadErr("");
    try {
      renderedRef.current.clear();
      queueRef.current.clear();
      dataRef.current = [];
      const pdf = await window.pdfjsLib.getDocument({
        data: buf, cMapUrl: CDN + "cmaps/", cMapPacked: true,
        standardFontDataUrl: CDN + "standard_fonts/",
      }).promise;
      pdfRef.current = pdf;
      setDocName(name);
      setNumPages(pdf.numPages);
      const p1 = await pdf.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      buildPages(v1.width, v1.height, pdf.numPages);
      observe();
      curRef.current = 1;
      setCurPage(1);
      let out = null;
      try { out = await pdf.getOutline(); } catch {}
      const flat = [];
      const walk = (items, depth) => {
        for (const it of items) {
          flat.push({ title: it.title, depth, dest: it.dest });
          if (it.items?.length && depth < 2) walk(it.items, depth + 1);
        }
      };
      if (out?.length) walk(out, 0);
      setOutline(flat);
    } catch (e) {
      setLoadErr("PDF를 열지 못했습니다: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const scrollToPage = (n, smooth = true) => {
    const el = pagesRef.current[n - 1];
    const view = viewRef.current;
    if (!el || !view) return;
    const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 10;
    view.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    curRef.current = n;
    setCurPage(n);
  };

  const relayout = useCallback(async (keepPage) => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    const keep = keepPage || curRef.current;
    const p1 = await pdf.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    scaleRef.current = contentWidth() / v1.width;
    const w = v1.width * scaleRef.current * zoomRef.current;
    const h = v1.height * scaleRef.current * zoomRef.current;
    ioRef.current?.disconnect();
    for (const el of pagesRef.current) {
      if (!el) continue;
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.querySelector("canvas")?.remove();
      el.querySelector(".vb-tl")?.remove();
    }
    renderedRef.current.clear();
    queueRef.current.clear();
    dataRef.current = [];
    observe();
    requestAnimationFrame(() => scrollToPage(keep, false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => relayout(), 280);
    return () => clearTimeout(t);
  }, [sheetOpen, outOpen, wide, relayout]);

  useEffect(() => {
    let t;
    const on = () => { clearTimeout(t); t = setTimeout(() => relayout(), 180); };
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
      clearTimeout(t);
    };
  }, [relayout]);

  const goDest = async (dest) => {
    try {
      const pdf = pdfRef.current;
      const d = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!d) return;
      const ref = d[0];
      const idx = typeof ref === "object" && ref !== null ? await pdf.getPageIndex(ref) : Number(ref);
      scrollToPage(idx + 1);
    } catch (e) { console.warn(e); }
  };

  const clearMarks = () => {
    viewRef.current?.querySelectorAll(".w.hit,.w.sent").forEach((e) => e.classList.remove("hit", "sent"));
  };

  /* ── 단어 / 문장 ── */
  const runWord = async (w, sentence) => {
    if (!w) return;
    const key = "w|" + w + "|" + sentence.slice(0, 120);
    if (cacheRef.current.has(key)) { setWord({ ...cacheRef.current.get(key), quote: sentence }); return; }
    setWord({ head: w, pos: "", senses: ["찾는 중…"], ctx: "", quote: sentence, live: true });
    wAbort.current?.abort();
    wAbort.current = new AbortController();
    const sig = wAbort.current.signal;
    let dictDone = false;

    if (cfgRef.current.useDict && /^[A-Za-z][A-Za-z'-]*$/.test(w)) {
      fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(w.toLowerCase()), { signal: sig })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!Array.isArray(j) || sig.aborted) return;
          const ms = [];
          for (const m of j[0].meanings || []) {
            const d0 = (m.definitions || [])[0];
            if (d0) ms.push(`(${m.partOfSpeech}) ${d0.definition}`);
            if (ms.length >= 3) break;
          }
          const pos = j[0]?.meanings?.[0]?.partOfSpeech || "";
          if (ms.length) { dictDone = true; setWord((s) => (s && s.head === w ? { ...s, senses: ms, pos } : s)); }
        })
        .catch(() => {});
    }

    let buf = "";
    try {
      await ask(SYS_WORD, `단어: ${w}\n문장: ${sentence}`, (c) => {
        buf += c;
        const { mean, ctx } = parseWord(buf);
        setWord((s) => {
          if (!s || s.head !== w) return s;
          const senses = mean && !dictDone ? mean.split(/\s*\/\s*/).filter(Boolean).slice(0, 4) : s.senses;
          return { ...s, senses, ctx: ctx || s.ctx };
        });
      }, sig);
      const { mean, ctx } = parseWord(buf);
      setWord((s) => {
        if (!s || s.head !== w) return s;
        const merged = {
          ...s, live: false, ctx: ctx || buf.trim(),
          senses: mean && !dictDone ? mean.split(/\s*\/\s*/).filter(Boolean).slice(0, 4) : s.senses,
        };
        cacheRef.current.set(key, { ...merged });
        return merged;
      });
    } catch (e) {
      if (e.name !== "AbortError") setWord((s) => (s && s.head === w ? { ...s, live: false, err: e.message } : s));
    }
  };

  const runSentence = async (text) => {
    if (!text) return;
    const key = "s|" + text.slice(0, 200);
    if (cacheRef.current.has(key)) { setSent({ trans: cacheRef.current.get(key), quote: text, live: false }); return; }
    setSent({ trans: "", quote: text, live: true });
    sAbort.current?.abort();
    sAbort.current = new AbortController();
    let buf = "";
    try {
      await ask(SYS_SENT, text, (c) => {
        buf += c;
        setSent((s) => (s && s.quote === text ? { ...s, trans: buf } : s));
      }, sAbort.current.signal);
      cacheRef.current.set(key, buf.trim());
      setSent((s) => (s && s.quote === text ? { ...s, trans: buf.trim(), live: false } : s));
    } catch (e) {
      if (e.name !== "AbortError") setSent((s) => (s && s.quote === text ? { ...s, live: false, err: e.message } : s));
    }
  };

  /* ── 탭 (한 번 / 두 번) ── */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const onDown = (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      const el = ev.target.closest?.(".w");
      if (!el) return;
      const n = +el.dataset.page;
      const pd = dataRef.current[n - 1];
      if (!pd) return;
      const off = +el.dataset.off;
      const now = Date.now();
      const dbl = now - tapRef.current.t < 320 && tapRef.current.page === n;
      tapRef.current = { t: now, page: n };
      const s = sentenceAt(pd.text, off);
      lastSentRef.current = s.text;
      if (dbl) {
        wAbort.current?.abort();
        clearMarks();
        for (const w of pd.words) {
          const o = +w.dataset.off;
          if (o >= s.start && o < s.end) w.classList.add("sent");
        }
        setSheetOpen(true);
        setTab("sent");
        runSentence(s.text);
      } else {
        clearMarks();
        el.classList.add("hit");
        setSheetOpen(true);
        setTab("word");
        runWord(wordAt(pd.text, off), s.text);
      }
    };
    view.addEventListener("pointerdown", onDown, { passive: true });
    return () => view.removeEventListener("pointerdown", onDown);
  }, [ask]);

  /* ── 두 손가락 핀치 줌 (아이패드) ── */
  useEffect(() => {
    const view = viewRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    let pinching = false, startD = 0, startZoom = 1, factor = 1, anchorPage = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e) => {
      if (e.touches.length !== 2 || !pdfRef.current) return;
      pinching = true;
      startD = dist(e.touches);
      startZoom = zoomRef.current;
      anchorPage = curRef.current;
      factor = 1;
    };
    const onMove = (e) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const raw = dist(e.touches) / startD;
      const next = Math.max(0.5, Math.min(3, startZoom * raw));
      factor = next / startZoom;
      stage.style.transform = `scale(${factor})`;
      setZoomPill(Math.round(next * 100) + "%");
    };
    const onEnd = (e) => {
      if (!pinching || e.touches.length >= 2) return;
      pinching = false;
      stage.style.transform = "";
      setZoomPill(null);
      const next = Math.max(0.5, Math.min(3, startZoom * factor));
      if (Math.abs(next - zoomRef.current) > 0.01) {
        zoomRef.current = next;
        persist();
        relayout(anchorPage);
      }
    };
    view.addEventListener("touchstart", onStart, { passive: true });
    view.addEventListener("touchmove", onMove, { passive: false });
    view.addEventListener("touchend", onEnd, { passive: true });
    view.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      view.removeEventListener("touchstart", onStart);
      view.removeEventListener("touchmove", onMove);
      view.removeEventListener("touchend", onEnd);
      view.removeEventListener("touchcancel", onEnd);
    };
  }, [relayout, persist]);

  /* ── 드래그 선택 ── */
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const t = sel ? sel.toString().trim() : "";
      if (!t || t.length < 2 || !viewRef.current?.contains(sel.anchorNode)) { setBubble(null); return; }
      selRef.current = t.replace(/\s+/g, " ");
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const host = viewRef.current.parentElement.getBoundingClientRect();
      setBubble({
        left: Math.max(8, Math.min(host.width - 150, r.left - host.left + r.width / 2 - 70)),
        top: Math.max(8, r.top - host.top - 48),
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  /* ── 키보드 (매직 키보드) ── */
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") { setSheetOpen(false); setOutOpen(false); setSetOpen(false); }
      if (!pdfRef.current) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); scrollToPage(Math.min(numPages, curRef.current + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); scrollToPage(Math.max(1, curRef.current - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages]);

  /* ── 질문 ── */
  const sendAsk = async () => {
    const q = askVal.trim();
    if (!q || asking) return;
    setAskVal("");
    setAsking(true);
    const idx = askLog.length + 1;
    setAskLog((l) => [...l, { role: "me", text: q }, { role: "ai", text: "", live: true }]);
    const pd = dataRef.current[curRef.current - 1];
    const excerpt = pd ? pd.text.replace(/\s+/g, " ").slice(0, 6000) : "(본문을 읽는 중)";
    const user = `[${curRef.current}쪽 본문]\n${excerpt}\n\n[방금 짚은 문장]\n${lastSentRef.current || "(없음)"}\n\n[질문]\n${q}`;
    let buf = "";
    try {
      await ask(SYS_ASK, user, (c) => {
        buf += c;
        setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: buf } : m)));
      });
      setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: buf, live: false } : m)));
    } catch (e) {
      setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: "", live: false, err: e.message } : m)));
    } finally {
      setAsking(false);
    }
  };

  const readFile = (f) => {
    const r = new FileReader();
    r.onload = () => loadPDF(new Uint8Array(r.result), f.name.replace(/\.pdf$/i, ""));
    r.readAsArrayBuffer(f);
  };

  const dragRef = useRef(null);
  const zoomBy = (f) => {
    zoomRef.current = Math.max(0.5, Math.min(3, zoomRef.current * f));
    setZoomPill(Math.round(zoomRef.current * 100) + "%");
    setTimeout(() => setZoomPill(null), 900);
    persist();
    relayout();
  };

  return (
    <div className={"vb-root" + (wide ? " wide" : "")} ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="vb-bar">
        <button className={"vb-tool" + (outOpen ? " on" : "")} onClick={() => setOutOpen((v) => !v)} aria-label="목차">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button className="vb-tool" onClick={() => fileRef.current?.click()} aria-label="PDF 열기">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
        </button>
        <span className="vb-name">{busy ? "여는 중…" : docName || "PDF를 열어 시작하세요"}</span>
        {numPages > 0 && <span className="vb-pill">{curPage} / {numPages}</span>}
        <span className={"vb-eng" + (engine === "Claude" ? " c" : engine === "Gemini" ? " g" : "")}>
          {engine || "대기"}
        </span>
        <button className="vb-tool" onClick={() => zoomBy(1 / 1.2)} aria-label="축소">−</button>
        <button className="vb-tool" onClick={() => zoomBy(1.2)} aria-label="확대">+</button>
        <button className="vb-tool" onClick={() => setSetOpen(true)} aria-label="설정">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.8 2.8 1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5 2 2 0 11-4 0 1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3 2 2 0 11-2.8-2.8 1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1 2 2 0 110-4 1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8 2 2 0 112.8-2.8 1.6 1.6 0 001.8.3 1.6 1.6 0 001-1.5 2 2 0 114 0 1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3 2 2 0 112.8 2.8 1.6 1.6 0 00-.3 1.8 1.6 1.6 0 001.5 1 2 2 0 110 4 1.6 1.6 0 00-1.5 1z" /></svg>
        </button>
        <button className={"vb-tool" + (sheetOpen ? " on" : "")} onClick={() => setSheetOpen((v) => !v)}>풀이</button>
      </div>

      <div className="vb-body">
        <aside className={"vb-out" + (wide ? (outOpen ? "" : " closed") : outOpen ? " open" : "")}>
          <h2>목차</h2>
          <div className="vb-olist">
            {outline.length === 0 && numPages === 0 && <div className="vb-oempty">PDF를 열면 목차가 나타납니다.</div>}
            {outline.length === 0 && numPages > 0 && (
              <>
                <div className="vb-oempty">이 PDF에는 목차 정보가 없습니다. 페이지로 바로 이동하세요.</div>
                {Array.from({ length: numPages }, (_, i) => (
                  <button key={i} className="vb-oi" onClick={() => { scrollToPage(i + 1); if (!wide) setOutOpen(false); }}>
                    {i + 1} 페이지
                  </button>
                ))}
              </>
            )}
            {outline.map((it, i) => (
              <button key={i} className={"vb-oi" + (it.depth ? " d" + it.depth : "")}
                onClick={() => { goDest(it.dest); if (!wide) setOutOpen(false); }}>
                {it.title}
              </button>
            ))}
          </div>
        </aside>
        <div className={"vb-scrim" + (outOpen && !wide ? " on" : "")} onClick={() => setOutOpen(false)} />

        <div className="vb-view" ref={viewRef}>
          <div className="vb-pages" ref={stageRef} />
        </div>

        {zoomPill && <div className="vb-zoompill">{zoomPill}</div>}

        {bubble && (
          <button className="vb-bubble" style={{ left: bubble.left, top: bubble.top }}
            onPointerDown={(e) => {
              e.preventDefault();
              setBubble(null);
              lastSentRef.current = selRef.current;
              setSheetOpen(true); setTab("sent");
              runSentence(selRef.current);
            }}>
            선택 구간 해석
          </button>
        )}

        {numPages === 0 && (
          <div className="vb-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); }}>
            <div className="vb-mk">여<em>백</em></div>
            <p>PDF를 올리면 굿노트처럼 이어서 읽습니다. 단어를 한 번 누르면 뜻과 이 문맥에서의 쓰임이, 두 번 누르면 문장 전체 해석이 옆에 뜹니다.</p>
            <button className="vb-pick" disabled={!ready} onClick={() => fileRef.current?.click()}>
              {ready ? "PDF 열기" : "준비 중…"}
            </button>
            <div className="vb-hint"><b>한 번 탭</b> 단어 풀이 · <b>두 번 탭</b> 문장 해석 · <b>길게 눌러 선택</b> 구간 해석 · <b>두 손가락</b> 확대</div>
            {loadErr && <div className="vb-err">{loadErr}</div>}
          </div>
        )}

        <section className={"vb-sheet" + (sheetOpen ? " open" : "")}
          style={{ height: wide ? "100%" : sheetFrac * 100 + "%" }}>
          <div className="vb-grip"
            onPointerDown={(e) => { dragRef.current = { y: e.clientY, h: sheetFrac }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dh = (dragRef.current.y - e.clientY) / boxRef.current.h;
              setSheetFrac(Math.max(0.2, Math.min(0.9, dragRef.current.h + dh)));
            }}
            onPointerUp={(e) => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <i />
          </div>
          <div className="vb-tabs">
            {[["word", "단어"], ["sent", "문장"], ["ask", "질문"]].map(([k, label]) => (
              <button key={k} className={"vb-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
            ))}
            <button className="vb-x" onClick={() => setSheetOpen(false)}>✕</button>
          </div>

          <div className="vb-panes">
            {tab === "word" && (!word ? (
              <div className="vb-ph">본문에서 단어를 한 번 누르면 여기에 뜻이 나옵니다.</div>
            ) : (
              <>
                <div className="vb-head">
                  <span className="vb-hw">{word.head}</span>
                  {word.pos && <span className="vb-pos">{word.pos}</span>}
                </div>
                <p className="vb-lbl" style={{ marginTop: 14 }}>뜻</p>
                <ol className="vb-senses">{(word.senses || []).map((s, i) => <li key={i}>{s}</li>)}</ol>
                <div className="vb-rule" />
                <p className="vb-lbl">이 문맥에서</p>
                <p className={"vb-txt" + (word.live ? " vb-cur" : "")}>{word.ctx}</p>
                {word.err && <p className="vb-err">답을 받지 못했습니다 — {word.err}</p>}
                <div className="vb-rule" />
                <p className="vb-lbl">원문</p>
                <p className="vb-txt vb-quote">{word.quote}</p>
              </>
            ))}

            {tab === "sent" && (!sent ? (
              <div className="vb-ph">단어를 두 번 연속으로 누르면 그 문장 전체를 해석합니다.</div>
            ) : (
              <>
                <p className="vb-lbl" style={{ marginTop: 6 }}>해석</p>
                <p className={"vb-txt" + (sent.live ? " vb-cur" : "")}>{sent.trans}</p>
                {sent.err && <p className="vb-err">답을 받지 못했습니다 — {sent.err}</p>}
                <div className="vb-rule" />
                <p className="vb-lbl">원문</p>
                <p className="vb-txt vb-quote">{sent.quote}</p>
              </>
            ))}

            {tab === "ask" && (
              <>
                <div className="vb-askctx" style={{ marginTop: 6 }}>
                  지금 보고 있는 {curPage}쪽 본문과 마지막으로 누른 문장을 근거로 답합니다.
                </div>
                {askLog.map((m, i) => (
                  <div key={i} className={"vb-msg " + m.role + (m.live ? " vb-cur" : "")}>
                    {m.err ? <span className="vb-err">답을 받지 못했습니다 — {m.err}</span> : m.text}
                  </div>
                ))}
                <div className="vb-askbar">
                  <textarea className="vb-askin" rows={1} value={askVal} placeholder="이 부분에 대해 물어보세요"
                    onChange={(e) => setAskVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && wide) { e.preventDefault(); sendAsk(); } }} />
                  <button className="vb-send" disabled={asking || !askVal.trim()} onClick={sendAsk}>보내기</button>
                </div>
              </>
            )}
          </div>
        </section>

        {setOpen && (
          <div className="vb-modal" onClick={(e) => { if (e.target === e.currentTarget) setSetOpen(false); }}>
            <div className="vb-card">
              <h3>엔진 설정</h3>
              <p className="vb-sub">기본은 Claude입니다. 사용량이 소진되거나 호출이 실패하면 자동으로 Gemini로 넘어가고, 이후 3분간 Gemini를 먼저 씁니다. 설정과 배율은 저장돼 다음에도 유지됩니다.</p>
              <div className="vb-field">
                <label>Gemini API 키</label>
                <input type="text" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                  value={cfg.geminiKey} onChange={(e) => setCfg({ ...cfg, geminiKey: e.target.value })} />
              </div>
              <div className="vb-field">
                <label>Gemini 모델</label>
                <input type="text" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                  value={cfg.geminiModel} onChange={(e) => setCfg({ ...cfg, geminiModel: e.target.value })} />
              </div>
              <label className="vb-row">
                <input type="checkbox" checked={cfg.forceGemini}
                  onChange={(e) => setCfg({ ...cfg, forceGemini: e.target.checked })} />
                처음부터 Gemini만 사용
              </label>
              <label className="vb-row">
                <input type="checkbox" checked={cfg.useDict}
                  onChange={(e) => setCfg({ ...cfg, useDict: e.target.checked })} />
                영어 단어는 사전 API를 먼저 조회 (더 빠름)
              </label>
              <button className="vb-done" onClick={() => { downRef.current = 0; persist(); setSetOpen(false); }}>닫기</button>
            </div>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
    </div>
  );
}
