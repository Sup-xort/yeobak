import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from "react";
import "katex/dist/katex.min.css";
import "./App.css";
import Rich from "./rich.jsx";
import AskView, { imageToJpeg } from "./AskView.jsx";
import MiniNote from "./MiniNote.jsx";
import { u } from "./paths.js";
import Bi from "./icons.jsx";
import { liveText } from "./liveText.js";
import { getPdf, pdfSource, dropPdf, cacheInfo, clearPdfs, CACHE_CAP, setReport } from "./pdfCache.js";
const sendDiag = (msg) => fetch(u("/api/diag"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg }) }).catch(() => {});
setReport(sendDiag);
import { drawStroke, hitStroke, isScribble, scribbleHits, strokeInLasso, polyBox, bbox as inkBox, snapLine, tidyPts, strokePath, HL_ALPHA } from "./ink.js";
import { CDN, DEFAULT_CFG, SESS_MAX, WIDE, SLOT_H, A4_RATIO, COARSE, IS_SAFARI, INK_PEN_COLORS, INK_HL_COLORS, INK_PEN_W, INK_HL_W, ZOOM_MIN, ZOOM_MAX, INK_W_RANGE, PT_MM, inkToolCfg } from "./consts.js";
import { callServer, AuthError } from "./ai.js";
import { freeCanvas, wordAt, sentenceAt, pageAt, markSpans, fmtSize, fmtDate, fmtRel, folderPath, folderTree } from "./text.js";
import { REN_MAX, parseNameJSON, cleanRenamed, firstPageText } from "./rename.js";
import { parseWord, SYS_WORD, SYS_SENT, SYS_ASK, SYS_FOLD, SYS_RENAME, SYS_CAP_READ, SYS_CAP_DESCRIBE, FIG_NOTE, SYS_CAP_SOLVE, SYS_OUTLINE } from "./prompts.js";

/* ───────────────── 컴포넌트 ───────────────── */
export default function VerbatimReader() {
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [docName, setDocName] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const [outline, setOutline] = useState([]);
  const [outOpen, setOutOpen] = useState(false);
  const [outlineGen, setOutlineGen] = useState(false); // 목차 자동 생성 진행 중
  const [outlineErr, setOutlineErr] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState("word");
  const [engine, setEngine] = useState("");
  const [remoteOn, setRemoteOn] = useState(false); // 리모트(폰) 모드 — server/remote.js 참고
  const [word, setWord] = useState(null);
  const [sent, setSent] = useState(null);
  const [sessions, setSessions] = useState([]);   // 질문 탭 대화 묶음. 최신이 앞
  const [curSess, setCurSess] = useState("");     // 지금 보고 있는 세션 id
  const [askVal, setAskVal] = useState("");
  const [asking, setAsking] = useState(false);
  const [sendFig, setSendFig] = useState(false);  // 후속 질문에 오려낸 그림을 같이 보낼지
  const [nowTick, setNowTick] = useState(0);      // 세션 남은 시간 표시를 1분마다 갱신
  const [setOpen, setSetOpen] = useState(false);
  const [pdfStore, setPdfStore] = useState(null); // 기기에 저장된 PDF {n, bytes} — 설정을 열 때 센다
  const [inbox, setInbox] = useState(null);
  const [inboxHelp, setInboxHelp] = useState(false); // 설정 — 단축어 만드는 법 펼침       // 단축어 받은편지함 — {enabled, token}, 설정을 열 때 받는다
  const [inboxCopied, setInboxCopied] = useState("");
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [busy, setBusy] = useState(false);
  const [sheetFrac, setSheetFrac] = useState(0.46);
  const [bubble, setBubble] = useState(null);
  const [wide, setWide] = useState(true);
  const [zoomPill, setZoomPill] = useState(null);
  const [jumpBack, setJumpBack] = useState(null); // 핀치 뒤 튀었을 때 띄우는 돌아가기 화살표 {page, fy}
  const [authed, setAuthed] = useState(null); // null = 확인 중
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [models, setModels] = useState([]);      // 질문 탭에서 고를 수 있는 모델
  const [askRank, setAskRank] = useState([]);    // 자동이 지금 고르는 순서 [{id,label,cls,text}] — 서버 models.rankNote
  const [defModel, setDefModel] = useState("");  // 서버 기본값
  const [tapModels, setTapModels] = useState([]); // 단어·문장 탭에서 고를 수 있는 모델
  const [tapDef, setTapDef] = useState("");
  const [mdlInfo, setMdlInfo] = useState({ updatedAt: 0, discovering: false }); // 서버가 모델 목록을 마지막으로 찾은 때
  const [health, setHealth] = useState({});      // 모델 id → {ok, status, at, ms}
  const [healthBusy, setHealthBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(true);  // 서재 화면 (문서가 없으면 항상 열림)
  const [lib, setLib] = useState({ folders: [], files: [] });
  const [libFolder, setLibFolder] = useState(""); // "" = 최상위
  const [libErr, setLibErr] = useState("");
  const [folInput, setFolInput] = useState(null); // 새 폴더 이름 입력 중이면 문자열
  const [folParent, setFolParent] = useState(""); // 새 폴더가 들어갈 곳
  const [folClosed, setFolClosed] = useState(() => new Set()); // 사이드바에서 접은 폴더
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem("yeobaek.side") === "1"; } catch { return false; } });
  const [dragId, setDragId] = useState("");       // 드래그 중인 파일 id
  const [dropTgt, setDropTgt] = useState("");     // 드래그가 올라가 있는 폴더 id ("" 아니면 강조)
  const [delAsk, setDelAsk] = useState("");       // 한 번 더 누르면 삭제할 대상 id
  const [vocab, setVocab] = useState([]);         // 단어장 (서버 data/vocab.json 과 동기화)
  const [folded, setFolded] = useState(() => new Set()); // 접힌 목차 항목 index
  const [upProg, setUpProg] = useState(null);     // 업로드 진행 {name, pct}
  const [renaming, setRenaming] = useState(null); // 문서명 편집 중이면 그 값, 아니면 null
  const [libQuery, setLibQuery] = useState("");   // 서재 검색어
  const [libSearchRes, setLibSearchRes] = useState(null); // null = 검색 중 아님, 배열 = 결과
  const [libSearching, setLibSearching] = useState(false);
  const [libView, setLibView] = useState("");     // "" = 전체 문서, "recent" = 최근 연 문서 스마트뷰
  const [docMenuId, setDocMenuId] = useState(""); // 열려 있는 문서 카드 ⋮ 메뉴
  const [docMoveId, setDocMoveId] = useState(""); // ⋮ 메뉴 안에서 "이동 ›" 서브메뉴가 펼쳐진 문서
  const [docRenameId, setDocRenameId] = useState(""); // 카드에서 인라인으로 이름 바꾸는 중인 문서
  const [docRenameVal, setDocRenameVal] = useState("");
  const [folDragId, setFolDragId] = useState(""); // 사이드바에서 드래그 정렬 중인 폴더 id (파일 드래그 dragId 와 별개)
  /* ── 이름 정리 ── 모델은 제안만 하고, 실제 변경은 미리보기에서 "적용"을 눌러야 일어난다 */
  const [renOpen, setRenOpen] = useState(false);
  const [renPrompt, setRenPrompt] = useState("");
  const [renBusy, setRenBusy] = useState("");   // "" 아니면 진행 단계 문구
  const [renErr, setRenErr] = useState("");
  const [renRows, setRenRows] = useState(null); // null = 아직 제안 전, 배열 = 미리보기
  const [renTargets, setRenTargets] = useState([]); // 버튼 누른 순간의 대상 목록(스냅샷)
  const renAbort = useRef(null);
  /* 표지 비율 캐시 {id: w/h}. f.ratio 는 나중에 추가된 필드라 예전 문서엔 없는데,
     그 문서를 열기 전까지는 서버가 비율을 모른다 — 그림이 뜨는 순간 naturalWidth 로 직접 잰다. */
  const [thumbRatio, setThumbRatio] = useState({});

  /* ── 리디자인(design_handoff_yeobaek_ai_panel, 채택안 4a) 상태 ──
     테마·패널모드는 기기에 저장한다(cfg 와 같은 persist 에 얹는다). */
  const [theme, setTheme] = useState("dark");           // "dark" | "light"
  const [invert, setInvert] = useState(false);          // 야간 반전 — 페이지(캔버스+텍스트레이어)만 filter:invert
  const [panelMode, setPanelMode] = useState("panel");  // "panel" | "card"
  // 문장 해석은 캔버스 위에 뜨는 카드다 — 페이지가 래스터라 실제 행간 삽입은 불가능해서
  // 원문 위치에 앵커한 오버레이로 대신한다. 위치는 트리거 시점에 한 번 계산한다(vb-bubble과 동일한 타협).
  const [sentPos, setSentPos] = useState(null); // {left, top} — .vb-body 기준. null 이면 카드 숨김
  const [interpLog, setInterpLog] = useState([]); // 기록 탭용 문장 해석 이력 (서버 data/interps.json 과 동기화)
  const [lookups, setLookups] = useState([]);     // 기록 탭용 단어 찾아본 이력 (★ 와 별개, data/lookups.json)

  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const pdfRef = useRef(null);
  const pagesRef = useRef([]);
  const dataRef = useRef([]);
  const renderedRef = useRef(new Set());
  const queueRef = useRef(new Set());
  const jobsRef = useRef(new Map());          // n → 진행 중인 renderPage 의 {task} — 취소·낡음 판정용
  const jumpRef = useRef(null);           // 핀치 직후 튐 감시 {page,fy,until,lastTop} — armJump 주석
  const jumpTimerRef = useRef(0);
  const holdRef = useRef(null);           // relayout 이 지키는 스크롤 자리 {top,left} — 그동안 syncPages 는 엇나간 위치를 무시한다
  const leftRef = useRef(new Set());          // relayout 뒤 옛 배율 캔버스가 아직 붙어 있는 쪽 — 멀어지면 syncPages 가 치운다
  const ioRef = useRef(null);
  const scaleRef = useRef(1);
  const zoomRef = useRef(1);
  const curRef = useRef(1);
  const cacheRef = useRef(new Map());
  const cfgRef = useRef(cfg);
  const wAbort = useRef(null);
  const sAbort = useRef(null);
  const lastSentRef = useRef("");
  const selRef = useRef("");
  const boxRef = useRef({ w: 1024, h: 768 });
  const layoutRef = useRef({ sheetOpen: false, outOpen: false, panelMode: "panel" });
  const pwRef = useRef(null);
  const curFileRef = useRef(null);            // 지금 열려 있는 서재 파일 {id, name}
  const bookTextRef = useRef([]);             // 질문 탭용 페이지별 전체 텍스트 (백그라운드 추출)
  const extractingRef = useRef(false);
  const delTimer = useRef(null);              // 두 번 눌러 삭제 타이머
  const lastPageTimer = useRef(null);          // "마지막으로 읽은 쪽" 저장 디바운스 타이머
  /* 지금 쪽 번호를 "읽은 쪽"으로 믿어도 되는가 — 사용자가 손대야(터치·휠·키) 켜지고,
     앱에 돌아온 순간과 문서를 새로 여는 순간 꺼진다. 돌아온 직후 사용자 입력 없이 쪽이 바뀌는 건
     읽은 게 아니라 화면이 밀린 것이다 — 2026-09-28 복귀 1초 만에 34→19 가 저장되고 5초 뒤
     탭이 새로 로드돼 앞쪽에서 열린 게 서버 [쪽] 로그에 그대로 찍혔다. */
  const pageOkRef = useRef(false);
  const layoutKeyRef = useRef({ cw: 0, zoom: 0 }); // 마지막 배치에 쓴 폭·배율 — 같으면 relayout 을 건너뛴다
  const baseRef = useRef(null);               // 1쪽의 배율 1 뷰포트 {w,h} — relayout 이 워커를 안 기다리게 재 둔다
  // 지금 하이라이트된 구간 {page, start, end, cls}. DOM 이 아니라 오프셋으로 들고 있어야
  // relayout 이 텍스트 레이어를 걷어내고 다시 그려도 하이라이트가 살아남는다.
  const markRef = useRef(null);
  const gestureRef = useRef(false);           // 핀치·트랙패드 줌이 진행 중인가
  const deferLayoutRef = useRef(false);       // 가려진 동안 미뤄 둔 relayout 이 있는가

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { layoutRef.current = { sheetOpen, outOpen, panelMode }; }, [sheetOpen, outOpen, panelMode]);

  /* 설정 저장 / 복원 */
  const themeRef = useRef(theme);
  const invertRef = useRef(invert);
  const panelModeRef = useRef(panelMode);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { invertRef.current = invert; }, [invert]);
  useEffect(() => { panelModeRef.current = panelMode; }, [panelMode]);

  /* 리모트 모드용 거울 ref — SSE 리스너는 remoteOn 이 켜질 때 한 번 붙고 오래 살아남으므로,
     그 안에서 docName/outline 을 state 로 직접 읽으면 그 뒤의 리로드·목차 생성 결과를
     못 보고 낡은 값에 갇힌다(다른 *Ref 거울들과 같은 이유). */
  const remoteOnRef = useRef(remoteOn);
  const docNameRef = useRef(docName);
  const outlineRef = useRef(outline);
  useEffect(() => { remoteOnRef.current = remoteOn; }, [remoteOn]);
  useEffect(() => { docNameRef.current = docName; }, [docName]);
  useEffect(() => { outlineRef.current = outline; }, [outline]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("yeobaek");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.cfg) setCfg((c) => ({ ...c, ...s.cfg }));
      if (s.zoom) zoomRef.current = s.zoom;
      if (s.theme === "light" || s.theme === "dark") setTheme(s.theme);
      if (typeof s.invert === "boolean") setInvert(s.invert);
      if (s.panelMode === "panel" || s.panelMode === "card") setPanelMode(s.panelMode);
      if (typeof s.penCapture === "boolean") setPenCapture(s.penCapture);
      if (s.ink && typeof s.ink === "object") {
        const k = { ...inkCfgRef.current, ...s.ink };
        k.pen = inkToolCfg(k.pen, INK_PEN_W, INK_PEN_COLORS);
        k.hl = inkToolCfg(k.hl, INK_HL_W, INK_HL_COLORS);
        inkCfgRef.current = k;
        setInkTool(k.tool); setInkPen(k.pen); setInkHl(k.hl);
      }
    } catch {}
  }, []);
  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        "yeobaek",
        JSON.stringify({
          cfg: cfgRef.current, zoom: zoomRef.current,
          theme: themeRef.current, invert: invertRef.current, panelMode: panelModeRef.current,
          penCapture: penCaptureRef.current, ink: inkCfgRef.current,
        })
      );
    } catch {}
  }, []);

  /* ───────── 질문 탭 세션 ─────────
     2026-09-29 부터 대화는 서버(server/remote.js 의 세션 저장소) 한 곳에 있다 — 아이패드·PC·폰이 같은 대화를 본다.
     예전엔 아이패드는 localStorage, 폰은 서버라 둘을 잇는 거울(remoteSessRef·mirrorCaptureToRemote)과
     폰 질문 전용 파이프라인(processRemoteQ)이 따로 있었다. 이제 전부 이 한 벌로 돈다.

     sessRef 가 원본이고 state 는 그 거울이다(스트리밍 콜백이 setState 반영 전에 다시 읽어야 한다).
     쓰기는 낙관적으로: 로컬을 먼저 바꾸고 서버에 보낸다. 단, 토큰마다 서버에 쓰지 않는다 —
     답이 흐르는 동안(sync=false)은 로컬만, 정착(질문 추가·답 완료/중단/실패)할 때만 서버에 쓴다.
     흐르는 모습은 relay("ask")로 다른 기기에 따로 흘린다. */
  const sessRef = useRef([]);
  const curSessRef = useRef("");
  useEffect(() => { curSessRef.current = curSess; }, [curSess]);
  // 이 창의 이름 — 폰 질문 답 자리를 맡을 때(claim) 쓴다. 새로고침해도 같은 창이면 같은 이름.
  const deviceRef = useRef("");
  if (!deviceRef.current) {
    try { deviceRef.current = sessionStorage.getItem("yeobaek.dev") || ""; } catch {}
    if (!deviceRef.current) {
      deviceRef.current = "d" + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem("yeobaek.dev", deviceRef.current); } catch {}
    }
  }
  const DEVICE_LABEL = typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 ? "아이패드" : "컴퓨터";

  const sapi = (url, method = "GET", body) => fetch(u(url), {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => {
    if (r.status === 401) { setAuthed(false); throw new AuthError(); }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "요청 실패 " + r.status);
    return r.json();
  });

  const commitSess = useCallback((ls, cur) => {
    sessRef.current = ls;
    setSessions(ls);
    if (cur !== undefined) {
      curSessRef.current = cur; setCurSess(cur);
      try { localStorage.setItem("yeobaek.askcur", cur); } catch {}
    }
  }, []);
  const mapSess = (sid, fn) => commitSess(sessRef.current.map((s) => (s.id === sid ? fn(s) : s)));

  // 서버에 보낼 모양 — 로컬 전용 표시(live)는 빼고, "아직 답 중"은 pending 으로
  const wire = (m) => {
    const { live, ...rest } = m;
    return live ? { ...rest, pending: true, claim: deviceRef.current, claimAt: Date.now() } : rest;
  };

  const newSess = async (title, extra = {}) => {
    const s = await sapi("/api/remote/sessions", "POST", { title: title || "새 대화", extra: { origin: "ipad", ...extra } });
    commitSess([s, ...sessRef.current.filter((x) => x.id !== s.id)].slice(0, SESS_MAX), s.id);
    return s.id;
  };

  /* 메시지를 넣거나 고칠 때마다 at 을 밀어 준다 — 대화가 이어지는 동안은 2시간이 다시 시작된다. */
  const addMsgs = (sid, arr) => {
    mapSess(sid, (s) => ({ ...s, at: Date.now(), msgs: [...s.msgs, ...arr] }));
    return sapi(`/api/remote/sessions/${sid}/msgs`, "POST", { msgs: arr.map(wire) }).catch(() => {});
  };

  const patchMsg = (sid, i, patch, sync = true) => {
    mapSess(sid, (s) => ({ ...s, at: Date.now(), msgs: s.msgs.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
    if (!sync) return;
    const { live, ...rest } = patch;
    if (live === false) rest.pending = false;
    if (live === true) Object.assign(rest, { pending: true, claim: deviceRef.current, claimAt: Date.now() });
    sapi(`/api/remote/sessions/${sid}/msgs/${i}`, "PATCH", { patch: rest }).catch(() => {});
  };

  /* 흐르는 답은 대화 state 에 넣지 않는다 — sessions 를 바꾸면 App 전체(5000줄)와 대화의 모든 메시지가
     글자 조각마다 다시 그려졌다(NIM 은 초당 수십 번). 흐르는 동안은 liveText 저장소에만 쓰고, 그걸 구독하는
     답 본문 칸만 다시 그린다(src/liveText.js). 정착(settle)할 때 최종 글을 state 에 한 번 넣고 저장소에서 지운다. */
  const streamPatcher = (sid, i) => {
    let last = "";
    return {
      live({ text }) { last = text; liveText.set(sid, i, text); },
      // 흐르던 글을 같이 싣는다(중단처럼 text 없이 정착하는 경우)
      settle(patch, sync = true) {
        const p = last && patch.text === undefined ? { text: last, ...patch } : patch;
        patchMsg(sid, i, p, sync);
        liveText.clear(sid, i);
      },
    };
  };

  const patchSess = (sid, patch) => {
    mapSess(sid, (s) => ({ ...s, ...patch }));
    sapi(`/api/remote/sessions/${sid}`, "PATCH", { patch }).catch(() => {});
  };

  const delSess = (id) => {
    const left = sessRef.current.filter((s) => s.id !== id);
    commitSess(left, id === curSessRef.current ? left[0]?.id || "" : curSessRef.current);
    sapi(`/api/remote/sessions/${id}`, "DELETE").catch(() => {});
  };

  const findSess = (sid) => sessRef.current.find((s) => s.id === sid) || null;

  /* 오려낸 그림은 서버에 파일로(세션에 속해 함께 지워진다), 모델에 보낼 base64 는 여기 캐시 */
  const imgCache = useRef(new Map()); // imgId → base64
  const putImg = async (sid, b64) => {
    const blob = await fetch("data:image/jpeg;base64," + b64).then((r) => r.blob());
    const r = await fetch(u(`/api/remote/sessions/${sid}/image`), {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob,
    });
    if (!r.ok) throw new Error("그림을 올리지 못했어요.");
    const { id } = await r.json();
    imgCache.current.set(id, b64);
    return id;
  };
  const getImg = async (sid, id) => {
    if (imgCache.current.has(id)) return imgCache.current.get(id);
    const blob = await fetch(u(`/api/remote/sessions/${sid}/image/${id}`)).then((r) => {
      if (!r.ok) throw new Error("그림을 불러오지 못했어요.");
      return r.blob();
    });
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] || "");
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    imgCache.current.set(id, b64);
    return b64;
  };
  const imgUrl = (id) => (String(id).startsWith("data:") ? id : u(`/api/remote/sessions/${curSessRef.current}/image/${id}`));

  /* 지난 문답을 모델이 받을 형태로 바꾼다.
     본문 컨텍스트(buildAskContext)는 여기 넣지 않는다 — 턴마다 다시 실으면
     48,000자짜리 본문이 대화 길이만큼 곱해져서 값도 지연도 폭발한다.
     hist 가 있으면 그걸 쓴다: 화면에는 "3쪽 영역 — 해석"만 보여도 모델에게는
     무엇을 시켰는지 문장으로 알려야 하기 때문이다. */
  /* upto: 이 번호 앞까지만(다시 답하기는 마지막 문답을 빼고 뽑는다).
     접힌 요약(sum)이 있으면 sumTo 앞은 요약이 대신하므로 그 뒤만 넘긴다. */
  const histOf = (sid, upto) => {
    const s = findSess(sid);
    return (s?.msgs || []).slice(s?.sum ? s.sumTo : 0, upto)
      /* err 가 붙었어도 받아 둔 답이 있으면 히스토리에 넣는다 — 끊긴 답을 빼 버리면
         "이어서 말해 줘"가 앞을 못 보고, 방금 고친 흐름 문제가 그대로 재현된다.
         답이 아예 없는 실패는 아래 text 검사에서 이미 걸러진다. */
      .filter((m) => !m.live && !m.pending && (m.hist || m.text || "").trim())
      .map((m) => ({ role: m.role === "me" ? "user" : "assistant", text: m.hist || m.text }));
  };

  /* ── 서버와 맞추기(SSE) ── 로그인한 동안 늘 붙어 있다. 다른 기기가 만든 대화·질문·답이 여기로 온다.
     내가 방금 낙관적으로 넣은 것의 메아리는 길이·id 로 걸러 두 번 들어가지 않게 한다.
     내가 흘리는 중인 답(live)은 서버 값이 덮어쓰지 못하게 지킨다. */
  const [peerLive, setPeerLive] = useState(null); // 다른 기기가 흘리는 답 { sid, i, text, run, device }
  const [remoteMode, setRemoteMode] = useState({ on: false, doc: null });
  useEffect(() => {
    if (authed !== true) return;
    const es = new EventSource(u("/api/remote/stream"));
    const keepLive = (srv) => {
      const mine = findSess(srv.id);
      if (!mine) return srv;
      return { ...srv, msgs: srv.msgs.map((m, k) => (mine.msgs[k]?.live ? mine.msgs[k] : m)) };
    };
    es.addEventListener("hello", (e) => {
      const d = JSON.parse(e.data);
      const ls = (d.sessions || []).map(keepLive);
      let cur = curSessRef.current;
      if (!ls.some((s) => s.id === cur)) {
        try { cur = localStorage.getItem("yeobaek.askcur") || ""; } catch {}
        if (!ls.some((s) => s.id === cur)) cur = ls[0]?.id || "";
      }
      commitSess(ls, cur);
      setRemoteMode(d.mode || { on: false, doc: null });
    });
    es.addEventListener("mode", (e) => setRemoteMode(JSON.parse(e.data)));
    es.addEventListener("sess-new", (e) => {
      const s = JSON.parse(e.data);
      if (findSess(s.id)) return;
      commitSess([s, ...sessRef.current]);
      // 폰에서 새로 연 대화는 따라가지 않는다 — 아이패드에서 읽던 대화가 멋대로 바뀌면 안 된다
    });
    es.addEventListener("sess-del", (e) => {
      const { id } = JSON.parse(e.data);
      if (!findSess(id)) return;
      const left = sessRef.current.filter((s) => s.id !== id);
      commitSess(left, id === curSessRef.current ? left[0]?.id || "" : undefined);
    });
    es.addEventListener("sess-patch", (e) => {
      const { id, patch } = JSON.parse(e.data);
      if (findSess(id)) mapSess(id, (s) => ({ ...s, ...patch, at: Date.now() }));
    });
    es.addEventListener("sess-msgs", (e) => {
      const { id, from, msgs } = JSON.parse(e.data);
      const s = findSess(id);
      if (!s || s.msgs.length >= from + msgs.length) return; // 내가 넣은 것의 메아리
      mapSess(id, (x) => ({ ...x, at: Date.now(), msgs: [...x.msgs.slice(0, from), ...msgs] }));
    });
    es.addEventListener("sess-msg-patch", (e) => {
      const { id, i, patch } = JSON.parse(e.data);
      const s = findSess(id);
      if (!s?.msgs[i] || s.msgs[i].live) return; // 내가 흘리는 중인 답은 건드리지 않는다
      mapSess(id, (x) => ({ ...x, msgs: x.msgs.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
      if (patch.pending === false) setPeerLive((p) => (p && p.sid === id && p.i === i ? null : p));
    });
    es.addEventListener("ask-cancel", (e) => {
      const { id, i } = JSON.parse(e.data);
      if (jobRef.current?.sid === id && (jobRef.current.i === undefined || jobRef.current.i === i)) stopAsk();
    });
    es.addEventListener("relay:ask", (e) => {
      const { payload } = JSON.parse(e.data);
      if (!payload || payload.from === deviceRef.current) return;
      setPeerLive(payload.done ? null : payload);
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  /* 흐르는 답을 다른 기기로 — 0.3초에 한 번만. 끝날 때는 done 으로 한 번 더(받는 쪽이 겹쳐 그리던 걸 치운다). */
  const askRelay = useRef({ seq: 0, t: 0, timer: 0, last: null });
  const relayAsk = (payload, now) => {
    const r = askRelay.current;
    r.last = payload;
    const send = () => {
      r.t = Date.now(); r.timer = 0;
      fetch(u("/api/remote/relay"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "ask", seq: ++r.seq, payload: { ...r.last, from: deviceRef.current, device: DEVICE_LABEL } }),
      }).catch(() => {});
    };
    if (now) { clearTimeout(r.timer); send(); return; }
    if (!r.timer) r.timer = setTimeout(send, Math.max(0, 300 - (Date.now() - r.t)));
  };

  /* 출석 — 폰이 "지금 답할 기기가 있나 · 몇 쪽을 보나"를 알 수 있게 30초마다(쪽이 바뀌면 곧바로) 알린다.
     문서가 열려 있을 때만 doc 을 싣는다 — 문서 없는 창은 폰 질문에 답하지 못한다(본문이 없다). */
  const presRef = useRef({ timer: 0 });
  const sendPresence = (bye = false) => {
    fetch(u("/api/remote/presence"), {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: bye,
      body: JSON.stringify({
        device: deviceRef.current, label: DEVICE_LABEL, bye,
        doc: pdfRef.current ? { id: curFileRef.current?.id || "", name: docNameRef.current, page: curRef.current } : null,
      }),
    }).catch(() => {});
  };
  useEffect(() => {
    if (authed !== true) return;
    clearTimeout(presRef.current.timer);
    presRef.current.timer = setTimeout(() => sendPresence(), 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, numPages, curPage, docName]);
  useEffect(() => {
    if (authed !== true) return;
    const t = setInterval(() => { if (!document.hidden) sendPresence(); }, 30_000);
    const bye = () => sendPresence(true);
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(t); window.removeEventListener("pagehide", bye); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  /* 남은 시간 표시용 1분 틱(청소는 서버가 한다 — sess-del 로 온다) */
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const sess = useMemo(() => sessions.find((s) => s.id === curSess) || null, [sessions, curSess]);
  const askLog = sess ? sess.msgs : [];
  /* "그림 함께 보내기" 기본값은 세션을 옮길 때만 다시 잡는다. 켜는 건 그림을 질문에 딸려
     보내야 하는 세션(fig)뿐이다 — "해석"은 그 자리에서 끝나고 번역문이 이미 지난 문답에
     남으므로 후속 질문에 그림을 다시 붙이지 않는다.
     imgDesc 가 채워질 때 이 effect 가 같이 돌면 안 된다: 오려낸 직후엔 설명이 아직 비어
     있어서, 방금 켠 것(runCaptureAsk 의 setSendFig(true))을 이 effect 가 곧바로 되돌려
     칩이 사라지고 그림 없이 질문이 나갔다. 설명이 늦게 와도 sendAsk 가 그때그때 골라
     쓰므로(있으면 설명, 없으면 원본 이미지) 여기서 다시 손댈 이유가 없다.
     vision 은 옛 세션 호환용 — 예전에 비전 모델이 직접 풀던 캡처만 그 표시를 갖는다. */
  useEffect(() => { setSendFig(!!(sess?.img && (sess?.fig || sess?.vision))); }, [curSess]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───────── 모델 상태와 중단 ─────────
     NIM 은 자주 식고(실측 콜드스타트 52초), 드물게는 연결만 붙은 채 아무것도 보내지 않는다.
     그런데 브라우저에서 "생각이 길다"와 "죽었다"는 똑같이 그냥 침묵이라 구분할 수 없다.
     그래서 절대 자동으로 끊지 않는다 — 어느 단계에서 몇 초째인지만 보여 주고 판단은 사람이 한다.
     [중단]을 누르면 fetch 를 abort 하고, 서버는 res 의 'close' 를 보고 업스트림 fetch 까지
     함께 끊는다. 그래야 붙잡고 있던 스트림과 커넥션이 바로 풀린다. */
  /* 경고선은 "정상적으로 오래 걸리는 경우"보다 넉넉해야 오경보가 안 난다.
     실측(2026-07-30): MiniMax M3 는 속생각을 안 흘리면서 첫 글자까지 40.9초가 걸린다.
     25초로 뒀더니 멀쩡한 요청에 경고가 떴다. 콜드스타트는 52초까지 가지만 그건
     "모델이 식었으면 1분까지" 라고 문구로 안내한다. */
  const STALL_WAIT = 45_000;  // 첫 글자를 이만큼 못 받으면 경고색
  const STALL_GAP = 12_000;   // 흐르던 스트림이 이만큼 끊기면 경고색
  const jobRef = useRef(null);          // 지금 도는 질문 탭 요청 { ac, sid }
  const statRef = useRef(null);
  const [aiStat, setAiStat] = useState(null);

  // ref 만 갱신하고 화면은 아래 타이머가 밀어 준다 — 토큰마다 setState 하면 렌더가 폭주한다.
  const bumpStat = (patch) => { statRef.current = statRef.current && { ...statRef.current, ...patch }; };
  const setStat = (patch) => {
    statRef.current = patch && { ...(statRef.current || {}), ...patch };
    setAiStat(statRef.current && { ...statRef.current });
  };

  /* 초 단위 갱신은 AskView 가 스스로 한다(runRef 로 statRef 를 직접 읽는다). 예전엔 여기서 0.5초마다
     setAiStat 을 해서 답이 도는 내내 App 전체가 초당 두 번 다시 그려졌다. */

  /* callServer 가 알려 주는 단계를 상태로 옮긴다. step 은 여러 단계짜리 캡처에서
     지금 어느 대목인지("옮겨적는 중" / "푸는 중") 보여 주기 위한 것. */
  /* 상태를 건드리는 쪽은 전부 자기 ac 가 아직 현재 요청인지 확인한다.
     끊긴 요청이 뒤늦게 끝나면서(abort 는 곧바로 예외를 던지지 않는다) 방금 시작한
     다음 요청의 상태줄을 지워 버리는 일이 실제로 일어난다. */
  const isCur = (ac) => jobRef.current?.ac === ac;
  const phaseHook = (ac, getChars) => (p, info) => {
    if (!isCur(ac)) return;
    // swap 은 단계가 아니라 "어느 모델이 대신 답했다"는 사실이다. 상태줄의 phase 를 덮으면
    // "차례를 기다리는 중"이 엉뚱하게 "답변 받는 중"으로 바뀐다 — 호출자가 따로 받는다.
    if (p === "swap") return;
    if (p === "tick") { bumpStat({ at: Date.now(), chars: getChars?.() ?? 0 }); return; }
    const now = Date.now();
    // 단계마다 처음 들어선 때를 적어 둔다 — 상태 섬의 4단계(보냄·연결·생각·답변) 소요 시간
    const marks = statRef.current?.marks || {};
    if (!marks[p]) bumpStat({ marks: { ...marks, [p]: now } });
    // 서버가 모델을 고르는 과정(progress) — 누구에게 묻는 중이고, 누가 왜 떨어졌나
    if (p === "try") { setStat({ phase: "try", tryLabel: info.label, at: now }); return; }
    if (p === "fail") { setStat({ trail: [...(statRef.current?.trail || []), { label: info.label, why: info.why }], at: now }); return; }
    if (p === "nap") { setStat({ phase: "nap", napSec: info.sec, at: now }); return; }
    if (p === "pick") {
      const st = statRef.current || {};
      const trail = info.why === "cont" && st.pickLabel ? [...(st.trail || []), { label: st.pickLabel, why: "끊김" }] : st.trail;
      setStat({ pickLabel: info.label, pickWhy: info.why, trail, engine: info.engine, model: info.model, at: now });
      return;
    }
    if (p === "think") {
      // 속생각도 토큰 단위로 쏟아진다 — 단계가 처음 바뀔 때만 그리고, 나머지는 ref 만 민다.
      const was = statRef.current?.phase;
      bumpStat({ at: Date.now(), think: info.think, engine: info.engine, model: info.model });
      if (was !== "think") setStat({ phase: "think" });
      return;
    }
    setStat({ phase: p, at: Date.now(), ...info });
  };

  const startJob = (sid, step) => {
    jobRef.current?.ac.abort();               // 앞의 요청이 남아 있으면 먼저 끊는다
    const ac = new AbortController();
    jobRef.current = { ac, sid };
    statRef.current = null; // 앞 요청의 떨어진 모델·단계 기록이 섞이지 않게
    const now = Date.now();
    setStat({ running: true, phase: "send", t0: now, at: now, chars: 0, step, engine: "", model: "", marks: { send: now } });
    return ac;
  };
  /* 끝난 요청은 lastRun 으로 남겨 상태 섬이 "완료 · 4.2초"를 잠깐 보여 주고, 펼치면 경과를 되짚을 수 있게 한다.
     outcome 은 부르는 쪽이 bumpStat 으로 적는다(없으면 답이 흐르기 시작했는지로 가늠). */
  const [lastRun, setLastRun] = useState(null);
  const keepRun = (outcome) => {
    const st = statRef.current;
    if (st?.running) setLastRun({ ...st, running: false, end: Date.now(), outcome: outcome || st.outcome || (st.phase === "stream" ? "done" : "error") });
  };
  const endJob = (ac) => {
    if (jobRef.current && !isCur(ac)) return;  // 이미 다음 요청이 자리를 잡았다
    keepRun();
    jobRef.current = null;
    setStat(null);
  };
  const stopAsk = () => { keepRun("stopped"); jobRef.current?.ac.abort(); jobRef.current = null; setStat(null); };

  /* 로그인 상태 확인 */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(u("/api/me"));
        const j = await r.json();
        setAuthed(!!j.authed);
      } catch { setAuthed(false); }
    })();
  }, []);

  /* 질문 탭 모델 목록 — 로그인 뒤 한 번만. 목록 자체는 캐시된 상태와 함께 즉시 온다. */
  useEffect(() => {
    if (authed !== true) return;
    (async () => {
      try {
        const r = await fetch(u("/api/models"));
        if (!r.ok) return;
        const j = await r.json();
        setModels(Array.isArray(j.models) ? j.models : []);
        setDefModel(j.default || "");
        setAskRank(Array.isArray(j.askRank) ? j.askRank : []);
        setTapModels(Array.isArray(j.tapModels) ? j.tapModels : []);
        setTapDef(j.tapDefault || "");
        setMdlInfo({ updatedAt: j.updatedAt || 0, discovering: !!j.discovering });
        // 서버 목록에서 빠진 모델(수명 종료 등)을 골라 둔 채면 드롭다운이 "모델"로만 뜬다 — 기본값으로 되돌린다
        const ids = new Set([...(j.models || []), ...(j.tapModels || [])].map((m) => m.id));
        setCfg((c) => (c.askModel && !ids.has(c.askModel)) || (c.tapModel && !ids.has(c.tapModel))
          ? { ...c, askModel: ids.has(c.askModel) ? c.askModel : "", tapModel: ids.has(c.tapModel) ? c.tapModel : "" }
          : c);
        setHealth(j.health || {});
      } catch {}
      refreshHealth(); // 접속하자마자 한 번 재 둬서, 드롭다운을 처음 열 때 이미 채워져 있게
    })();
  }, [authed]);

  /* 서버에 **저장돼 있는** 모델 상태를 가져온다. 이건 측정을 시키는 게 아니라 읽기다 —
     서버는 늘 저장값을 즉시 돌려주고, 그게 오래됐으면 응답을 보낸 뒤에 알아서 다시 잰다.
     그래서 이 호출은 언제 불러도 값싸고(실측 1ms), 새로 잰 값은 다음에 열 때 보인다.

     어떤 것도 await 하지 않는다. 모델 선택도 질문 전송도 이 값을 참조하지 않으므로,
     통째로 실패해도 배지만 안 뜨고 기능은 그대로 돈다. */
  const healthReq = useRef(false);
  const refreshHealth = () => {
    if (healthReq.current) return; // 이미 받아오는 중
    healthReq.current = true;
    setHealthBusy(true);
    fetch(u("/api/models"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (j.health) setHealth(j.health);
        /* "자동 — 지금 ○○" 도 같이 — 예전엔 로그인 때 한 번만 받아서 서버가 순서를 바꿔도 옛 이름이 떠 있었다 */
        if (j.default) setDefModel(j.default);
        if (Array.isArray(j.askRank)) setAskRank(j.askRank);
        if (j.tapDefault) setTapDef(j.tapDefault);
      })
      .catch(() => {})
      .finally(() => { healthReq.current = false; setHealthBusy(false); });
  };

  const refreshModels = refreshHealth; // 답이 끝날 때마다 — 자동 순서가 방금 결과로 바뀌었을 수 있다


  /* 상태 한 줄 요약. 판단이 애매하면 아무 말도 안 하는 쪽을 고른다 —
     멀쩡한 모델을 "붐빈다"고 적어 두는 게 제일 나쁘다(note 에서 수치를 걷어낸 이유). */
  const healthOf = (id) => {
    const h = health[id];
    // 아직 값이 없으면 재는 중이라고만 말한다. 재고 있지도 않은데 "측정 중"이라 적으면
    // 영영 안 바뀌는 문구가 되므로, 그때는 배지를 아예 안 띄운다.
    if (!h) return healthBusy ? { cls: "wait", text: "측정 중" } : null;
    if (h.ok) return h.ms > 4000 ? { cls: "busy", text: "혼잡" } : { cls: "ok", text: "정상" };
    if (h.status >= 429) return { cls: "jam", text: "붐빔" };    // 529 Overloaded 등
    if (h.status === -1) return { cls: "busy", text: "느림" };   // 8초 안에 무응답 — 콜드스타트일 수 있다
    if (h.status === 408) return { cls: "busy", text: "느림" };  // 실사용에서 첫 글자가 상한 안에 안 왔다
    return { cls: "jam", text: "응답 없음" };                     // 연결 자체가 안 됐다
  };

  /* 모델 id → 드롭다운에 보이는 이름. 목록에 없으면 id 의 뒷부분을 그대로 쓴다. */
  const modelName = (id) =>
    [...models, ...tapModels].find((m) => m.id === id)?.label || String(id || "").split("/").pop();

  /* ── 서재 ── */
  const libApi = useCallback(async (url, opt) => {
    const r = await fetch(u(url), opt);   // 서브패스 보정은 여기 한 곳에서 — paths.js 참고
    if (r.status === 401) { setAuthed(false); throw new AuthError(); }
    if (!r.ok) {
      let d = "";
      try { d = (await r.json()).error || ""; } catch {}
      throw new Error(d || "요청 실패 " + r.status);
    }
    return r;
  }, []);

  /* 마지막으로 읽은 쪽 — 페이지가 바뀔 때마다 그대로 서버에 쏘면 스크롤 한 번에
     요청이 수십 번 나가므로 디바운스한다. curFileRef 가 없으면(서재에 없는 임시 문서,
     또는 아직 업로드가 안 끝난 방금 연 로컬 파일) 저장할 대상이 없으니 조용히 넘어간다. */
  useEffect(() => {
    const id = curFileRef.current?.id;
    if (!id || !curPage) return;
    clearTimeout(lastPageTimer.current);
    lastPageTimer.current = setTimeout(() => {
      // 디바운스 대기 중 문서가 바뀌었으면 옛 문서의 쪽을 새 문서에 박지 않는다
      if (curFileRef.current?.id !== id || !pageOkRef.current) return;
      libApi("/api/library/file/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastPage: curPage }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(lastPageTimer.current);
  }, [curPage, libApi]);

  /* 리모트(폰)에 지금 쪽을 흘려준다 — 리모트가 꺼져 있으면 서버가 조용히 무시한다
     (server/remote.js). remoteOn 이 막 켜졌을 때도 이 effect 가 다시 돌아 즉시 한 번
     쏘도록 의존성에 넣는다. */
  const remotePageTimer = useRef(null);
  useEffect(() => {
    if (!remoteOn || !curPage) return;
    clearTimeout(remotePageTimer.current);
    remotePageTimer.current = setTimeout(() => {
      fetch(u("/api/remote/page"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: curFileRef.current?.id || "", docName: docNameRef.current, page: curRef.current }),
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(remotePageTimer.current);
  }, [curPage, remoteOn, docName]);

  /* 디바운스 타이머가 돌기 전에 탭을 닫거나 앱을 스와이프해 나가면 마지막 몇 쪽이
     안 남는다 — pagehide 에서 한 번 더 즉시 쏜다(keepalive 로 응답을 안 기다려도 전송은 됨).
     beforeunload 대신 pagehide 를 쓰는 건 iOS 사파리의 bfcache 때문 — beforeunload 는
     bfcache 진입을 막아버려서 뒤로가기 복원이 느려진다. */
  useEffect(() => {
    const flush = () => {
      const id = curFileRef.current?.id;
      if (!id || !curRef.current || !pageOkRef.current) return;
      try {
        fetch(u("/api/library/file/") + id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastPage: curRef.current }),
          keepalive: true,
        });
      } catch {}
    };
    /* 홈 화면으로 나가거나 앱을 바꿀 땐 pagehide 가 안 온다 — 가려지는 순간에도 쏜다.
       iOS 는 백그라운드의 탭을 말없이 죽이고 돌아올 때 새로 로드하므로 이게 마지막 기회다. */
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    const touched = () => { pageOkRef.current = true; };
    const onVis = () => { if (document.visibilityState === "visible") pageOkRef.current = false; };
    const opt = { capture: true, passive: true };
    for (const t of ["pointerdown", "wheel", "keydown"]) window.addEventListener(t, touched, opt);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      for (const t of ["pointerdown", "wheel", "keydown"]) window.removeEventListener(t, touched, opt);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* 서재 검색 — 제목(즉시 반영)과 본문(서버 왕복 필요) 둘 다 하나의 검색창에서.
     타이핑마다 부르지 않게 디바운스하고, 느린 요청이 나중 응답을 덮어쓰지 않게
     순번(seq)으로 막는다. */
  const libSearchTimer = useRef(null);
  const libSearchSeq = useRef(0);
  const runLibSearch = useCallback((q) => {
    clearTimeout(libSearchTimer.current);
    const query = q.trim();
    if (!query) { libSearchSeq.current++; setLibSearchRes(null); setLibSearching(false); return; }
    setLibSearching(true);
    libSearchTimer.current = setTimeout(async () => {
      const seq = ++libSearchSeq.current;
      try {
        const r = await libApi("/api/library/search?q=" + encodeURIComponent(query));
        const j = await r.json();
        if (seq === libSearchSeq.current) setLibSearchRes(j.results || []);
      } catch (e) {
        if (seq === libSearchSeq.current && e.name !== "AuthError") setLibSearchRes([]);
      } finally {
        if (seq === libSearchSeq.current) setLibSearching(false);
      }
    }, 300);
  }, [libApi]);
  const changeLibQuery = (v) => { setLibQuery(v); runLibSearch(v); };
  const clearLibQuery = () => { setLibQuery(""); libSearchSeq.current++; clearTimeout(libSearchTimer.current); setLibSearchRes(null); setLibSearching(false); };

  const refreshLib = useCallback(async () => {
    try {
      const r = await libApi("/api/library");
      const j = await r.json();
      setLib(j);
      setLibErr("");
      // 앱을 새로 불러올 때 딱 한 번만 인사말을 고른다 — 이후의 refreshLib 호출(업로드·
      // 이동·삭제 등)마다 다시 고르면 조작할 때마다 인사말이 바뀌어 산만하다.
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("서재 목록을 불러오지 못했습니다.");
    }
  }, [libApi]);

  const refreshVocab = useCallback(async () => {
    try {
      const r = await libApi("/api/vocab");
      setVocab((await r.json()).words || []);
    } catch {}
  }, [libApi]);

  const refreshInterps = useCallback(async () => {
    try {
      const r = await libApi("/api/interps");
      setInterpLog((await r.json()).items || []);
    } catch {}
  }, [libApi]);

  const refreshLookups = useCallback(async () => {
    try {
      const r = await libApi("/api/lookups");
      setLookups((await r.json()).items || []);
    } catch {}
  }, [libApi]);

  useEffect(() => {
    if (authed === true) { refreshLib(); refreshVocab(); refreshInterps(); refreshLookups(); }
  }, [authed, refreshLib, refreshVocab, refreshInterps, refreshLookups]);

  /* 단축어·공유 시트로 넣은 PDF 는 앱 밖에서 서재에 들어온다 — 앱으로 돌아올 때 목록을 다시 읽는다 */
  useEffect(() => {
    if (authed !== true) return;
    const on = () => { if (document.visibilityState === "visible") refreshLib(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [authed, refreshLib]);

  useEffect(() => {
    if (!setOpen || authed !== true) return;
    libApi("/api/inbox/info").then((r) => r.json()).then(setInbox).catch(() => {});
    setPdfStore(cacheInfo());
    refreshHealth(); // 모델 드롭다운 옆 "지금 붐빔" 표시용
  }, [setOpen, authed, libApi]);
  const copyInbox = (what, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setInboxCopied(what);
      setTimeout(() => setInboxCopied(""), 1600);
    }).catch(() => {});
  };

  /* fetch 는 업로드 진행률을 못 재서 XHR 을 쓴다 */
  const uploadPDF = (buf, name, folder) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", u(`/api/library/upload?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`));
      xhr.setRequestHeader("Content-Type", "application/pdf");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUpProg({ name, pct: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        setUpProg(null);
        if (xhr.status === 401) { setAuthed(false); reject(new AuthError()); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          let msg = "업로드 실패 (HTTP " + xhr.status + ")";
          if (xhr.status === 413) msg = "파일이 서버 허용 크기를 넘습니다 (HTTP 413)";
          else { try { const j = JSON.parse(xhr.responseText); if (j.error) msg += " — " + j.error; } catch {} }
          reject(new Error(msg)); return;
        }
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
      };
      xhr.onerror = () => { setUpProg(null); reject(new Error("네트워크 오류")); };
      setUpProg({ name, pct: 0 });
      xhr.send(buf);
    });

  /* 서재에서 책을 열 때 26MB 짜리를 통째로 받는 동안 화면이 아무 말 없이 멎어 있었다 —
     툴바의 "여는 중…"(busy)은 서재가 떠 있는 동안엔 툴바 자체가 안 그려져서 안 보인다.
     fetch 는 진행률을 못 주므로 업로드와 같은 이유로 XMLHttpRequest 를 쓰고,
     막대는 업로드가 쓰던 .vb-uppill 을 그대로 재사용한다(z-index 34 > 서재 32).
     xhr.open 은 libApi 를 안 타므로 서브패스 보정 u() 를 직접 걸어야 한다(paths.js). */
  /* 서재 PDF 받기 — 기기에 저장해 둔 게 있고 서버 것과 같으면(304) 받지 않는다(src/pdfCache.js).
     반환은 Blob(디스크에 있다) — loadPDF 가 pdf.js 에 필요한 조각만 잘라 준다. */
  const fetchPDF = async (id, name) => {
    setUpProg({ name, what: "확인 중", pct: null, loaded: 0 });
    try {
      const { blob } = await getPdf(u("/api/library/file/" + id), (frac, loaded) =>
        // Content-Length 가 없으면(프록시가 청크로 흘리는 경우) 퍼센트 대신 받은 양을 보여준다
        setUpProg(frac != null
          ? { name, what: "받는 중", pct: Math.round(frac * 100) }
          : { name, what: "받는 중", pct: null, loaded }));
      /* 다 받았다고 끝이 아니다 — pdf.js 가 파싱하고 buildPages 가 페이지 상자를
         전부 만드는 동안도 한참 멎어 있다. 막대를 채운 채 "여는 중" 으로 바꿔 두고,
         openLibFile 의 finally 가 치운다. */
      setUpProg({ name, what: "여는 중", pct: 100 });
      return blob;
    } catch (e) {
      setUpProg(null);
      if (e.name === "AuthError") { setAuthed(false); throw new AuthError(); }
      throw e;
    }
  };

  const saveToLib = async (buf, name) => {
    try {
      const j = await uploadPDF(buf, name, libFolder);
      curFileRef.current = { id: j.id, name: j.name, indexed: j.indexed };
      refreshLib();
      if (!j.thumb) sendThumb(j.id);
      attachAnnots(j.id);
    } catch (e) {
      if (e.name !== "AuthError")
        setLibErr(`서버에 저장하지 못했습니다 (${e.message}) — 문서는 열려 있지만 서재에는 없습니다.`);
    }
  };

  /* 표지 썸네일 — 방금 연 문서의 1페이지를 작게 렌더해 서버에 올린다 */
  const sendThumb = async (id) => {
    try {
      const pdf = pdfRef.current;
      if (!pdf || curFileRef.current?.id !== id) return;
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 300 / v1.width });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
      if (!blob) return;
      // v1 은 회전(/Rotate)까지 반영된 화면상 크기라, 매트 그리드에 실제로 보이는
      // 비율과 그대로 맞는다 — 서버는 이 비율을 서재 카드 크기 계산에만 쓴다.
      await libApi(`/api/library/thumb/${id}?w=${Math.round(v1.width)}&h=${Math.round(v1.height)}`, {
        method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob,
      });
      refreshLib();
    } catch {}
  };

  /* gotoPage 가 있으면(검색 결과 클릭 등) 그 쪽으로, 없으면 저장된 lastPage 로 연다.
     둘 다 없으면 기존처럼 1쪽. scrollToPage 는 pagesRef 의 실제 DOM 크기를 재는데,
     loadPDF 가 끝난 시점에는 buildPages 가 이미 동기로 크기를 잡아 둔 뒤라 바로 불러도
     되지만, 막 setLibOpen(false) 한 직후라 레이아웃이 아직 안 붙었을 수도 있어 rAF 로 한 틱 미룬다. */
  const openLibFile = async (f, gotoPage) => {
    try {
      setLibErr("");
      await flushInk();
      setMainAnn(null);
      resetInk();
      // 필기는 PDF 와 동시에 받는다 — 첫 렌더 전에 있어야 가져온 주석을 두 겹으로 안 그린다
      const annP = acquireAnn(f.id);
      let buf;
      try { buf = await fetchPDF(f.id, f.name); } catch (e) { annP.then((a) => a && releaseAnn(f.id)); throw e; }
      const ann = await annP;
      pageOkRef.current = false; // 로딩 중엔 curRef 가 아직 옛 문서의 쪽이다
      curFileRef.current = { id: f.id, name: f.name, indexed: f.indexed };
      setMainAnn(ann);
      setLibOpen(false);
      await loadPDF(buf, f.name);
      const target = gotoPage || f.lastPage;
      if (target && target > 1) requestAnimationFrame(() => scrollToPage(target, false));
      // 표지가 없던 책은 처음 열 때 만들어진다.
      // ratio 는 나중에 추가된 필드라 기존 문서엔 없다 — 표지가 있어도 비율이 없으면 이때 채운다
      // (sendThumb 이 표지를 다시 올리면서 w/h 를 같이 보낸다).
      if (!f.thumb || !(f.ratio > 0)) sendThumb(f.id);
      // 서재 인사말이 "이어읽기"인지 "오랜만"인지 가르는 시각 — 실패해도 읽기엔 지장 없다
      libApi("/api/library/file/" + f.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opened: true }),
      }).catch(() => {});
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("파일을 여는 데 실패했습니다.");
    } finally {
      setUpProg(null);
    }
  };

  const moveFile = async (id, folder) => {
    try {
      await libApi("/api/library/file/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("옮기지 못했습니다.");
    }
  };

  const renameFile = async (id, name, kind = "file") => {
    const n = name.trim();
    if (!n) { setDocRenameId(""); return; }
    try {
      await libApi(`/api/library/${kind}/` + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      setDocRenameId("");
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("이름을 바꾸지 못했습니다.");
    }
  };

  /* ── 이름 정리 ──────────────────────────────────────────────────────────
     흐름: 대상 스냅샷 → 각 문서 첫 쪽 본문 모으기 → 모델에 형식 지시와 함께 넘기기
     → JSON 제안 파싱 → 미리보기(수정·제외 가능) → 적용. 모델은 파일을 직접 못 건드린다. */

  const openRename = (files) => {
    setRenTargets(files.slice(0, REN_MAX));
    setRenRows(null); setRenBusy(""); setRenOpen(true);
    // 조용히 잘라내면 "몇 개는 왜 안 바뀌었지"가 된다 — 잘렸다는 사실을 카드에 남긴다
    setRenErr(files.length > REN_MAX
      ? `문서가 ${files.length}개라 앞의 ${REN_MAX}개만 다룹니다. 나머지는 한 번 더 실행해 주세요.`
      : "");
  };

  const closeRename = () => {
    renAbort.current?.abort();
    setRenOpen(false); setRenRows(null); setRenBusy(""); setRenErr("");
  };

  const suggestNames = async () => {
    const files = renTargets;
    if (!files.length || !renPrompt.trim()) return;
    renAbort.current?.abort();
    const ac = new AbortController();
    renAbort.current = ac;
    setRenErr(""); setRenRows(null);
    try {
      setRenBusy(`문서 ${files.length}개의 첫 쪽을 읽는 중…`);
      const texts = [];
      for (let i = 0; i < files.length; i++) {
        if (ac.signal.aborted) return;
        setRenBusy(`첫 쪽을 읽는 중… ${i + 1}/${files.length}`);
        texts.push((await firstPageText(files[i], libApi)).replace(/\s+/g, " ").trim().slice(0, 600));
      }
      if (ac.signal.aborted) return;

      const body = files.map((f, i) =>
        `${i}. 현재 이름: ${f.name}\n   첫 쪽: ${texts[i] || "(본문을 읽지 못했습니다)"}`).join("\n\n");
      setRenBusy("이름을 제안받는 중…");
      /* 토큰 예산을 크게 잡는 이유 — max_tokens 는 답(content)만이 아니라 추론 모델의
         속생각(reasoning)까지 함께 깎는다. 문서 4개짜리 실측에서 속생각만 2100~3100자
         (대략 700~1000토큰)를 먼저 쓰고 답은 그 뒤에 나왔다. 1980 을 줬더니 답이 중간에
         잘렸고, 3000 부터 완주했다. 그래서 기본을 3000 으로 두고 문서 수만큼 더 얹는다. */
      const out = await ask(SYS_RENAME,
        `[원하는 형식]\n${renPrompt.trim()}\n\n[문서 ${files.length}개]\n${body}`,
        undefined, ac.signal, { maxTokens: Math.min(8000, 3000 + files.length * 150) });
      if (ac.signal.aborted) return;

      const list = parseNameJSON(out);
      if (!list) throw new Error(out.trim()
        ? `형식을 알아볼 수 없는 답이 왔습니다 — ${out.trim().slice(0, 120)}`
        : "모델이 빈 답을 보냈습니다. 문서 수를 줄이고 다시 시도해 주세요.");

      const byIdx = new Map(list.map((x) => [Number(x?.i), x?.name]));
      const rows = files.map((f, i) => {
        const name = cleanRenamed(byIdx.get(i), f.name);
        return { id: f.id, from: f.name, name, same: name === f.name };
      });
      if (rows.every((r) => r.same)) {
        setRenErr("바꿀 이름을 찾지 못했습니다. 원하는 형식을 조금 더 구체적으로 적어보세요.");
        setRenBusy(""); return;
      }
      setRenRows(rows);
      setRenBusy("");
    } catch (e) {
      if (e.name === "AbortError" || ac.signal.aborted) return;
      setRenBusy("");
      setRenErr(e.name === "AuthError" ? "" : (e.message || "제안을 받지 못했습니다."));
    }
  };

  const applyRename = async () => {
    const todo = (renRows || []).filter((r) => r.name.trim() && r.name.trim() !== r.from);
    if (!todo.length) { closeRename(); return; }
    setRenBusy(`이름을 바꾸는 중… 0/${todo.length}`);
    let done = 0, failed = 0;
    for (const r of todo) {
      try {
        await libApi("/api/library/file/" + r.id, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: r.name.trim() }),
        });
        done++;
      } catch (e) {
        if (e.name === "AuthError") return;
        failed++;
      }
      setRenBusy(`이름을 바꾸는 중… ${done + failed}/${todo.length}`);
    }
    await refreshLib();
    setRenOpen(false); setRenRows(null); setRenBusy("");
    if (failed) setLibErr(`${done}개를 바꿨고 ${failed}개는 실패했습니다.`);
  };

  /* 사이드바 폴더 드래그 정렬 — 로컬 배열을 먼저 낙관적으로 바꿔 즉시 반응하게 하고,
     서버엔 최종 순서(id 배열)만 PATCH 한다. 실패해도 다음 refreshLib 에서 서버 순서로 되돌아온다. */
  const reorderFolders = async (ids) => {
    setLib((s) => {
      const byId = new Map(s.folders.map((f) => [f.id, f]));
      const ordered = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
      const seen = new Set(ordered.map((f) => f.id));
      for (const f of s.folders) if (!seen.has(f.id)) ordered.push(f);
      return { ...s, folders: ordered };
    });
    try {
      await libApi("/api/library/folders/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch (e) {
      if (e.name !== "AuthError") refreshLib(); // 실패하면 서버 상태로 되돌린다
    }
  };

  const makeFolder = async (name) => {
    const n = name.trim();
    if (!n) return;
    try {
      await libApi("/api/library/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, parent: folParent }),
      });
      setFolInput(null);
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 만들지 못했습니다.");
    }
  };

  const moveFolder = async (id, parent) => {
    try {
      await libApi("/api/library/folder/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent }),
      });
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 옮기지 못했습니다.");
    }
  };

  const delFile = async (id) => {
    try {
      await libApi("/api/library/file/" + id, { method: "DELETE" });
      dropPdf(u("/api/library/file/" + id));
      if (curFileRef.current?.id === id) { curFileRef.current = null; setMainAnn(null); }
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("지우지 못했습니다.");
    }
  };

  const delFolder = async (id) => {
    try {
      await libApi("/api/library/folder/" + id, { method: "DELETE" });
      if (libFolder === id) setLibFolder(lib.folders.find((f) => f.id === id)?.parent || "");
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 지우지 못했습니다.");
    }
  };

  /* 실수로 지우는 걸 막는 두 번 탭 삭제 — confirm() 은 홈 화면 웹앱에서 못 믿는다 */
  const tapDel = (key, fn) => {
    if (delAsk === key) {
      clearTimeout(delTimer.current);
      setDelAsk("");
      fn();
      return;
    }
    setDelAsk(key);
    clearTimeout(delTimer.current);
    delTimer.current = setTimeout(() => setDelAsk(""), 2600);
  };

  /* ── 단어장 ── */
  const addVocab = async () => {
    const w = word;
    if (!w?.head) return;
    try {
      const r = await libApi("/api/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: w.head,
          mean: (w.senses || []).filter((s) => s !== "찾는 중…").join(" / "),
          ctx: w.ctx || "",
          quote: w.quote || "",
          doc: docName,
        }),
      });
      const j = await r.json();
      setVocab((v) => [j, ...v.filter((x) => x.word.toLowerCase() !== j.word.toLowerCase())]);
    } catch (e) {
      if (e.name !== "AuthError") console.warn("vocab add", e);
    }
  };

  const delVocab = async (id) => {
    try {
      await libApi("/api/vocab/" + id, { method: "DELETE" });
      setVocab((v) => v.filter((x) => x.id !== id));
    } catch (e) {
      if (e.name !== "AuthError") console.warn("vocab del", e);
    }
  };

  /* 툴바의 문서명을 탭하면 편집 모드로 바뀐다. 서재에 저장된 문서(curFileRef 있음)는
     서버 이름도 함께 바꾸고, 아직 서재에 없는 문서(저장 실패 등)는 화면 표시만 바꾼다. */
  const renameCur = async (name) => {
    const n = name.trim();
    setRenaming(null);
    if (!n || n === docName) return;
    const id = curFileRef.current?.id;
    if (!id) { setDocName(n); return; }
    try {
      await libApi("/api/library/file/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      setDocName(n);
      curFileRef.current = { ...curFileRef.current, name: n };
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("이름을 바꾸지 못했습니다.");
    }
  };

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

  /* 프로바이더 선택과 폴백은 서버가 처리한다. 어느 쪽이 응답했는지는 X-Engine 헤더로 온다. */
  const ask = useCallback(async (system, user, onDelta, signal, opts) => {
    try {
      // opts.askModel: 이 질문만 다른 모델로(폰에서 고른 모델) — cfgRef 를 건드리지 않는다
      const cfg = opts?.askModel ? { ...cfgRef.current, askModel: opts.askModel } : cfgRef.current;
      const { text, engine } = await callServer(cfg, system, user, onDelta, signal, opts);
      if (engine) setEngine(engine);
      return text;
    } catch (e) {
      if (e.name === "AuthError") setAuthed(false);
      throw e;
    }
  }, []);

  /* ── 레이아웃 계산 ── */
  const contentWidth = () => {
    const { w } = boxRef.current;
    const isWide = w >= WIDE;
    const pad = isWide ? 56 : 12;
    const sh = isWide && layoutRef.current.sheetOpen && layoutRef.current.panelMode === "panel" ? 400 : 0;
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
    const job = { task: null };
    queueRef.current.add(n);
    jobsRef.current.set(n, job);
    /* 배율이 바뀌었거나(relayout 이 layoutKeyRef 를 새 객체로 바꾼다) 문서가 바뀌었거나 이 쪽이 치워졌으면
       하던 일을 버린다. 예전엔 옛 배율 렌더가 끝까지 돌아서, 확대·축소를 몇 번 하면 워커에 옛 렌더가
       줄줄이 쌓이고 그동안 새 쪽은 흰 캔버스로 기다렸다(2026-10-06 실기기 "하얗게 보인다"). */
    const key = layoutKeyRef.current;
    const pdf = pdfRef.current;
    const stale = () => layoutKeyRef.current !== key || pdfRef.current !== pdf || jobsRef.current.get(n) !== job;
    let cv = null, drawn = false;
    try {
      const page = await pdf.getPage(n);
      const el = pagesRef.current[n - 1];
      if (!el || stale()) return;
      const vp = page.getViewport({ scale: scaleRef.current * zoomRef.current });
      el.style.width = vp.width + "px";
      el.style.height = vp.height + "px";
      /* 캔버스 크기에 상한을 씌운다. 아이패드 사파리는 캔버스가 한계를 넘으면 예외를 던지지
         않고 조용히 빈(흰) 캔버스를 주고, 메모리 압박이 심해지면 탭을 통째로 리로드한다 —
         300% 확대에서 "흰 화면이 뜨고 갑자기 재시작"하던 원인이 이것이다.
         (영역 캡처 쪽에는 이미 같은 대비가 있었다: CAP_MAXPX)
         캔버스는 CSS 로 페이지 크기에 늘어나므로(.vb-page canvas{inset:0;width:100%;height:100%})
         상한에 걸리면 위치가 어긋나는 게 아니라 조금 흐려질 뿐이다 — 흰 화면보다는 낫다. */
      const MAX_PX = 12_000_000;  // 총 픽셀 (iOS 의 캔버스 면적 한계보다 넉넉히 아래)
      const MAX_SIDE = 8192;      // 한 변 길이
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.min(
        1,
        Math.sqrt(MAX_PX / Math.max(1, vp.width * vp.height * dpr * dpr)),
        MAX_SIDE / Math.max(1, vp.width * dpr),
        MAX_SIDE / Math.max(1, vp.height * dpr),
      );
      if (fit < 1) dpr *= fit;
      // 상한에 걸려 흐려진 쪽 — 화면에 보이는 부분만 선명하게 다시 그린다(renderDetails)
      el.dataset.lowres = fit < 0.98 ? "1" : "";
      cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width * dpr);
      cv.height = Math.floor(vp.height * dpr);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      // 이전 배율의 캔버스가 있으면 그 '아래'에 깔아 두고 그린다 — 완성될 때까지
      // 흐릿한 이전 그림이 보이고, 흰 화면이 번쩍이지 않는다.
      el.insertBefore(cv, el.firstChild);
      job.task = page.render({
        canvasContext: ctx, viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
        // PDF 주석을 필기로 가져온 문서는 원본 주석 외관을 끈다 — 안 그러면 같은 획이 두 겹으로 보이고,
        // 여백에서 지우거나 옮겨도 원본이 그 자리에 남는다
        annotationMode: annotsRef.current?.imported
          ? window.pdfjsLib.AnnotationMode.DISABLE : window.pdfjsLib.AnnotationMode.ENABLE,
      });
      await job.task.promise;
      if (stale()) return;
      // 완성 — 이전 캔버스(선명화 조각 포함)와 남아 있던 텍스트 레이어를 걷어낸다.
      // 필기(svg.vb-ink)는 벡터라 배율이 바뀌어도 그대로 두면 된다
      el.querySelectorAll("canvas").forEach((c) => { if (c !== cv) freeCanvas(c); });
      drawn = true;
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
      el.dataset.w1 = String(vp.width / vp.scale); // 이 쪽의 배율 1 크기 — 필기 좌표 환산 기준
      el.dataset.h1 = String(vp.height / vp.scale);
      if (!el.querySelector("svg.vb-ink")) paintInk(n);
      const layer = document.createElement("div");
      layer.className = "vb-tl";
      el.appendChild(layer);
      await buildTextLayer(page, vp, layer, n);
      if (stale()) { layer.remove(); return; }
      if (markRef.current?.page === n) applyMarks(); // 재배치로 지워진 하이라이트 복원
      renderedRef.current.add(n);
      leftRef.current.delete(n);
      if (el.dataset.lowres) scheduleDetail();
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") console.error("page " + n, e);
    } finally {
      // 끝까지 못 간 렌더의 흰 캔버스는 걷는다 — 옛 캔버스(흐릿해도 그림)가 다시 보이게
      if (cv && !drawn) freeCanvas(cv);
      else if (drawn && !renderedRef.current.has(n)) leftRef.current.add(n); // 다 그렸는데 낡았다 — 그림은 두고 멀어지면 치운다
      if (jobsRef.current.get(n) === job) { jobsRef.current.delete(n); queueRef.current.delete(n); }
    }
  };

  /* ── 선명화 조각(detail) ──
     확대하면 쪽 캔버스가 MAX_PX 상한에 걸려 해상도가 떨어진다(아이패드에서 1.5배쯤부터 눈에 띈다).
     상한을 올리면 사파리가 캔버스를 조용히 비우거나 탭을 리로드하므로, 대신 **화면에 보이는 부분만**
     기기 해상도로 한 번 더 그려 그 자리에 얹는다(pdf.js 5 의 detail view 와 같은 발상).
     스크롤이 멈추고 160ms 뒤에 그리며, 위아래로 반 화면씩 넉넉히 잡아 조금 스크롤해도 다시 안 그린다.
     흐린 쪽 캔버스가 바탕에 늘 있으니 조각이 늦거나 빠져도 흰 화면은 안 뜬다. */
  const detailRef = useRef(new Map()); // n → 진행 중인 RenderTask
  const detailTimerRef = useRef(0);
  const scheduleDetail = () => {
    clearTimeout(detailTimerRef.current);
    detailTimerRef.current = setTimeout(() => renderDetails(), 160);
  };
  const dropDetails = () => {
    for (const t of detailRef.current.values()) t.cancel();
    detailRef.current.clear();
    stageRef.current?.querySelectorAll("canvas.vb-detail").forEach(freeCanvas);
  };
  const renderDetails = () => {
    const view = viewRef.current;
    if (!view || !pdfRef.current || gestureRef.current) return;
    const vr = view.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const n of renderedRef.current) {
      const el = pagesRef.current[n - 1];
      if (!el) continue;
      const old = el.querySelector("canvas.vb-detail");
      const r = el.getBoundingClientRect();
      const vis = {
        x0: Math.max(r.left, vr.left) - r.left, x1: Math.min(r.right, vr.right) - r.left,
        y0: Math.max(r.top, vr.top) - r.top, y1: Math.min(r.bottom, vr.bottom) - r.top,
      };
      if (!el.dataset.lowres || vis.x1 <= vis.x0 || vis.y1 <= vis.y0) {
        old?.remove();
        detailRef.current.get(n)?.cancel();
        continue;
      }
      // 이미 그려 둔 조각이 보이는 부분을 다 덮으면 그대로 둔다
      const o = old && JSON.parse(old.dataset.reg);
      if (o && o.x <= vis.x0 && o.y <= vis.y0 && o.x + o.w >= vis.x1 && o.y + o.h >= vis.y1) continue;
      // 여유를 붙이되 픽셀 예산(10M) 안으로
      const W = el.offsetWidth, H = el.offsetHeight;
      const vh = vis.y1 - vis.y0, vw = vis.x1 - vis.x0;
      let reg = {
        x: Math.max(0, vis.x0 - vw * 0.25), y: Math.max(0, vis.y0 - vh * 0.5),
      };
      reg.w = Math.min(W, vis.x1 + vw * 0.25) - reg.x;
      reg.h = Math.min(H, vis.y1 + vh * 0.5) - reg.y;
      if (reg.w * reg.h * dpr * dpr > 10_000_000) reg = { x: vis.x0, y: vis.y0, w: vw, h: vh };
      reg = { x: Math.floor(reg.x), y: Math.floor(reg.y), w: Math.ceil(reg.w), h: Math.ceil(reg.h) };
      renderDetail(n, el, reg, dpr);
    }
  };
  const renderDetail = async (n, el, reg, dpr) => {
    detailRef.current.get(n)?.cancel();
    const key = layoutKeyRef.current;
    let task, cv = null, used = false;
    try {
      const page = await pdfRef.current.getPage(n);
      const vp = page.getViewport({ scale: scaleRef.current * zoomRef.current });
      cv = document.createElement("canvas");
      cv.className = "vb-detail";
      cv.width = Math.floor(reg.w * dpr);
      cv.height = Math.floor(reg.h * dpr);
      Object.assign(cv.style, { left: reg.x + "px", top: reg.y + "px", width: reg.w + "px", height: reg.h + "px" });
      cv.dataset.reg = JSON.stringify(reg);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      task = page.render({
        canvasContext: ctx, viewport: vp,
        transform: [dpr, 0, 0, dpr, -reg.x * dpr, -reg.y * dpr],
        annotationMode: annotsRef.current?.imported
          ? window.pdfjsLib.AnnotationMode.DISABLE : window.pdfjsLib.AnnotationMode.ENABLE,
      });
      detailRef.current.set(n, task);
      await task.promise;
      // 그리는 사이 배율이 바뀌었거나 쪽이 치워졌으면 버린다
      if (detailRef.current.get(n) !== task || layoutKeyRef.current !== key || !renderedRef.current.has(n)) return;
      const base = el.querySelector("canvas:not(.vb-detail)");
      if (!base) return;
      el.querySelectorAll("canvas.vb-detail").forEach(freeCanvas);
      base.after(cv);
      used = true;
    } catch (e) {
      if (e?.name !== "RenderingCancelledException") console.warn("선명화 실패 " + n, e);
    } finally {
      if (cv && !used) freeCanvas(cv); // 버려진 조각 — 붙인 적이 없어도 메모리는 이미 잡혀 있다
      if (detailRef.current.get(n) === task) detailRef.current.delete(n);
    }
  };
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const on = () => scheduleDetail();
    view.addEventListener("scroll", on, { passive: true });
    return () => { view.removeEventListener("scroll", on); clearTimeout(detailTimerRef.current); };
  }, []);

  const cancelJob = (n) => {
    const j = jobsRef.current.get(n);
    if (!j) return;
    j.task?.cancel();
    jobsRef.current.delete(n);
    queueRef.current.delete(n);
  };
  const cancelJobs = () => { for (const n of [...jobsRef.current.keys()]) cancelJob(n); };

  /* 그릴 쪽과 치울 쪽을 **화면 좌표로** 정한다 — 보이는 범위 위아래 SYNC_M 픽셀 안의 쪽은 그리고,
     거기서 2쪽 더 벗어난 쪽은 치운다. 스크롤마다(rAF)와 IntersectionObserver 보고 때 돈다.

     예전엔 IO 의 '들어옴' 보고로만 그리고 "현재 쪽 ±4" 밖을 치웠다. 축소하면 쪽이 작아져 1000px 여유
     안에 ±4 보다 많은 쪽이 들어오는데, 그 쪽들은 그리자마자 치워지고, IO 는 경계를 **넘을 때만** 보고하니
     나중에 화면 한가운데로 와도 다시 안 그려졌다 — 축소한 채 스크롤하면 흰 쪽만 남던 원인
     (2026-10-06 실기기, 37쪽 슬라이드 19~22쪽이 전부 흰색). */
  const SYNC_M = 1000;
  const syncPages = () => {
    const view = viewRef.current;
    const pages = pagesRef.current;
    if (!view || !pages.length || !pdfRef.current || gestureRef.current) return;
    if (document.visibilityState === "hidden") return;
    // relayout 이 자리를 지키는 중인데 스크롤이 엇나가 있다 — 곧 돌아온다(relayout 의 hold 주석)
    const h = holdRef.current;
    if (h && (Math.abs(view.scrollTop - h.top) > 4 || Math.abs(view.scrollLeft - h.left) > 4)) return;
    pickCur();
    const vr = view.getBoundingClientRect();
    const a = pageAt(pages, vr.top - SYNC_M);
    const b = pageAt(pages, vr.bottom + SYNC_M);
    const c = curRef.current;
    const want = [];
    for (let n = a; n <= b; n++) want.push(n);
    // 가운데 쪽부터 — 워커는 받은 순서대로 그린다
    want.sort((x, y) => Math.abs(x - c) - Math.abs(y - c));
    for (const n of want) renderPage(n);
    for (const n of new Set([...renderedRef.current, ...jobsRef.current.keys(), ...leftRef.current])) {
      if (n >= a - 2 && n <= b + 2) continue;
      cancelJob(n);
      if (!renderedRef.current.has(n) && !leftRef.current.has(n)) continue;
      leftRef.current.delete(n);
      const el = pagesRef.current[n - 1];
      if (el) {
        el.querySelectorAll("canvas").forEach(freeCanvas);
        el.querySelectorAll("svg.vb-ink").forEach((g) => g.remove());
        el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
      }
      detailRef.current.get(n)?.cancel();
      renderedRef.current.delete(n);
      dataRef.current[n - 1] = null;
    }
  };

  /* 현재 페이지 = 뷰포트 세로 중앙에 걸린 페이지.
     예전에는 IntersectionObserver 의 intersectionRatio 로 정했는데, root 에
     rootMargin:1000px 이 걸려 있어서 화면 밖 페이지도 비율이 0.35 를 쉽게 넘겼다.
     observe() 직후처럼 모든 페이지가 한꺼번에 보고될 때는 엔트리 순서에 따라
     화면 밖 페이지가 마지막에 이겨서 curRef 가 엉뚱한 곳을 가리켰고,
     그 뒤 relayout(keep=curRef) 이 그리로 스크롤해 "풀이창을 닫으면 앞 페이지로
     튄다"가 됐다. 이제 실제 화면 좌표로 판정한다. */
  const pickCur = () => {
    const view = viewRef.current;
    const pages = pagesRef.current;
    // 제스처 중에는 건드리지 않는다 — 임시 CSS scale 때문에 좌표가 계속 흔들리고,
    // 그 사이 prune 이 보고 있는 페이지를 지워 버릴 수 있다.
    if (!view || !pages.length || gestureRef.current) return;
    // 가려진 동안엔 쪽 번호를 굳힌다 — 백그라운드의 창 크기 변화로 움직인 스크롤을
    // "읽은 쪽"으로 저장하지 않게(아래 relayout 의 가려짐 주석)
    if (document.visibilityState === "hidden") return;
    const vr = view.getBoundingClientRect();
    const n = pageAt(pages, vr.top + vr.height / 2);
    watchJump(n);
    if (n !== curRef.current) { curRef.current = n; setCurPage(n); }
  };

  /* ── 핀치 뒤 튐 → 돌아가기 버튼 ──
     핀치 확정 뒤 쪽이 엉뚱하게 튀는 건(relayout 의 hold 주석 — iOS 가 우리가 넣은 scrollTop 을 덮어쓴다)
     여러 번 막았는데도 가끔 남는다(2026-10-12 사용자). 못 막은 경우를 위해 핀치 앞뒤를 지켜보다가
     튀면 원래 자리로 돌아가는 버튼을 잠깐 띄운다. 잡는 길은 셋:
     (1) 확정 뒤 몇 초 안에 스크롤 한 번에 화면 0.8배 넘게 움직였고(손가락·관성으론 한 프레임에 못 간다)
         기준 쪽에서 2쪽 이상 벗어났다
     (2) 확정할 때 손가락 아래 쪽(앵커)이 핀치를 시작할 때 화면에 보이던 쪽들 밖이다 — 핀치 **도중** 튄 것.
         첫 버전은 이걸 못 봤다: 앵커를 이미 튄 자리에서 잡아 "튄 자리"를 기준으로 삼았다(13:32 30→44 놓침)
     (3) 배율이 안 바뀌었거나 네이티브 스크롤이 제스처를 가져가 핀치를 버렸다 — 시작 때 자리를 기준으로 (1)
     자리는 "쪽 + 그 쪽 안에서 화면 가운데의 비율"로 기억한다 — 배율이 바뀌어도 되돌아갈 수 있게. */
  const JUMP_WATCH = 6000, JUMP_SHOW = 6000;
  const pinchAtRef = useRef(null); // 핀치 시작 때 자리 {page, fy, top, lo, hi, at}
  const jumpLogRef = useRef([]);   // 핀치 앞뒤 기록 — 튀었는데 못 잡았을 때 서버 로그로 보낸다
  const jlog = (m) => {
    const L = jumpLogRef.current;
    L.push(((performance.now() - (pinchAtRef.current?.at || 0)) / 1000).toFixed(2) + "s " + m);
    if (L.length > 30) L.shift();
  };
  const spotNow = () => {
    const view = viewRef.current, pages = pagesRef.current;
    const vr = view.getBoundingClientRect();
    const cy = vr.top + vr.height / 2;
    const page = pageAt(pages, cy);
    const r = pages[page - 1]?.getBoundingClientRect();
    return { page, fy: r && r.height ? (cy - r.top) / r.height : 0, top: view.scrollTop,
      lo: pageAt(pages, vr.top), hi: pageAt(pages, vr.bottom) };
  };
  const markPinch = () => { // 핀치(터치·트랙패드) 시작
    if (!viewRef.current || !pagesRef.current.length) return;
    jumpRef.current = null;
    hideJump();
    pinchAtRef.current = { ...spotNow(), at: performance.now() };
    jumpLogRef.current = [];
    const p = pinchAtRef.current;
    jlog(`시작 ${p.page}쪽(보임 ${p.lo}~${p.hi}) top ${Math.round(p.top)} 배율 ${zoomRef.current.toFixed(2)}`);
  };
  const showJump = (back, why) => {
    const cur = spotNow().page;
    jlog(`잡음(${why}) ${cur}쪽 → 버튼 ${back.page}쪽`);
    sendDiag(`[튐] 잡음 ${why} ${back.page}→${cur}쪽 | ` + jumpLogRef.current.join(" | "));
    setJumpBack(back);
    clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => setJumpBack(null), JUMP_SHOW);
  };
  // how: "commit"(배율 바뀜, anchor 있음) | "keep"(배율 그대로·버림 — 시작 자리가 기준)
  const armJump = (how, anchor) => {
    const view = viewRef.current, st = pinchAtRef.current;
    if (!view || !pagesRef.current.length) return;
    const now = spotNow();
    jlog(`${how} → ${now.page}쪽 top ${Math.round(now.top)}${anchor ? ` 앵커 ${anchor.page}쪽` : ""} 배율 ${zoomRef.current.toFixed(2)}`);
    if (how === "commit" && st && anchor && (anchor.page < st.lo - 1 || anchor.page > st.hi + 1)) {
      showJump({ page: st.page, fy: st.fy }, "도중");
      return;
    }
    const base = how === "keep" && st ? st : now;
    jumpRef.current = { page: base.page, fy: base.fy, until: Date.now() + JUMP_WATCH,
      lastTop: how === "keep" && st ? st.top : now.top, reported: false };
    // 버린 경우엔 이미 튀어 있을 수 있다 — 지금 자리로 곧바로 한 번 본다
    if (how === "keep") watchJump(now.page);
  };
  const hideJump = () => { clearTimeout(jumpTimerRef.current); setJumpBack(null); };
  const watchJump = (n) => {
    const w = jumpRef.current, view = viewRef.current;
    if (!w || !view) return;
    const far = Math.abs(n - w.page) >= 2;
    if (!far) hideJump(); // 원래 자리 근처로 돌아왔으면(hold 가 되돌렸거나 직접 돌아갔다) 거둔다
    if (Date.now() > w.until) {
      // 지켜보는 동안은 못 잡았는데 끝나고 보니 멀리 가 있다 — 다음에 고칠 재료로 남긴다
      if (Math.abs(n - w.page) >= 5 && !w.reported) {
        w.reported = true;
        jlog(`감시 끝 뒤 ${n}쪽`);
        sendDiag(`[튐] 놓침? 기준 ${w.page}쪽 → ${n}쪽 | ` + jumpLogRef.current.join(" | "));
      }
      if (Date.now() > w.until + 30000) jumpRef.current = null;
      return;
    }
    const dy = view.scrollTop - w.lastTop;
    const sudden = Math.abs(dy) > view.clientHeight * 0.8;
    w.lastTop = view.scrollTop;
    if (n !== w.lastN) { jlog(`${n}쪽 dy ${Math.round(dy)}`); w.lastN = n; }
    if (sudden && far) showJump({ page: w.page, fy: w.fy }, "뒤");
  };
  const goJumpBack = () => {
    const j = jumpBack, view = viewRef.current;
    hideJump();
    jumpRef.current = null;
    const el = j && pagesRef.current[j.page - 1];
    if (!el || !view) return;
    // 그 쪽의 같은 비율 지점을 화면 가운데로 — 배율이 바뀌었어도 맞는다
    const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
    view.scrollTop = top + j.fy * el.offsetHeight - view.clientHeight / 2;
  };

  const observe = () => {
    ioRef.current?.disconnect();
    ioRef.current = new IntersectionObserver(() => syncPages(),
      { root: viewRef.current, rootMargin: SYNC_M + "px 0px", threshold: 0 });
    pagesRef.current.forEach((el) => el && ioRef.current.observe(el));
  };

  const buildPages = (w1, h1, total) => {
    const stage = stageRef.current;
    stage.innerHTML = "";
    pagesRef.current = [];
    const cw = contentWidth();
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
    baseRef.current = { w: w1, h: h1 };
    scaleRef.current = cw / w1;
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
      leftRef.current.clear();
      cancelJobs();
      dataRef.current = [];
      bookTextRef.current = [];
      // buf: Uint8Array(방금 고른 로컬 파일) 또는 Blob(서재 — 기기에 저장된 것, 조각만 읽는다)
      const pdf = await window.pdfjsLib.getDocument({
        ...pdfSource(buf), cMapUrl: CDN + "cmaps/", cMapPacked: true,
        standardFontDataUrl: CDN + "standard_fonts/",
      }).promise;
      /* 앞 문서는 워커에서 놓아준다 — 안 그러면 원본 바이트와 파싱한 객체가 워커에 그대로 남아,
         한 번 쓰는 동안 여러 권을 열면 아이패드 메모리가 계속 쌓인다(작은 노트는 이미 그렇게 한다).
         새 문서를 받는 동안 옛 쪽 DOM 에서 시작된 렌더가 있을 수 있어 바꿔 끼운 뒤 한 번 더 비운다. */
      const old = pdfRef.current;
      pdfRef.current = pdf;
      cancelJobs();
      dropDetails();
      renderedRef.current.clear();
      leftRef.current.clear();
      if (old && old !== pdf) old.destroy().catch(() => {});
      setDocName(name);
      setNumPages(pdf.numPages);
      const p1 = await pdf.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      buildPages(v1.width, v1.height, pdf.numPages);
      observe();
      curRef.current = 1;
      setCurPage(1);
      let out = null;
      try { out = await pdf.getOutline(); } catch (e) { console.warn("목차 읽기 실패:", e); }
      if (!out?.length) console.info("이 PDF에는 목차(/Outlines)가 없습니다 — 주석 앱(굿노트 등)의 책갈피는 PDF 목차가 아닐 수 있습니다.");
      const flat = [];
      const walk = (items, depth) => {
        for (const it of items) {
          flat.push({ title: it.title, depth, dest: it.dest });
          if (it.items?.length && depth < 2) walk(it.items, depth + 1);
        }
      };
      if (out?.length) walk(out, 0);
      setOutline(flat);
      setFolded(new Set());
      outlinePages(pdf, flat);
      setTimeout(() => extractAll(pdf), 800); // 첫 렌더와 경쟁하지 않게 잠깐 뒤에
    } catch (e) {
      setLoadErr("PDF를 열지 못했습니다: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  /* 질문 탭용 전체 텍스트 — 페이지가 프룬되어도 남도록 별도로 한 번 훑어 둔다 */
  const extractAll = async (pdf) => {
    // 문서마다 따로 막는다 — 앞 문서를 뽑던 중에 새 문서를 열면 새 문서 몫이 통째로 건너뛰어졌다
    if (extractingRef.current === pdf) return;
    extractingRef.current = pdf;
    try {
      const arr = bookTextRef.current;
      /* 서버에 이 쪽수 그대로 본문이 올라가 있으면 그걸 받는다. 직접 뽑으면 pdf.js 가 모든 쪽을 읽느라
         파일 전체를 메모리에 올린다 — 서재 책은 보는 쪽 근처 조각만 읽게 바꿨는데(pdfSource) 그게 소용없어진다. */
      const id = curFileRef.current?.id;
      if (id && curFileRef.current?.indexed === pdf.numPages) {
        try {
          const j = await (await libApi(`/api/library/file/${id}/text?all`)).json();
          if (pdfRef.current !== pdf) return;
          if (Array.isArray(j.pages) && j.pages.length === pdf.numPages) {
            j.pages.forEach((t, i) => { if (arr[i] == null) arr[i] = typeof t === "string" ? t : ""; });
            return;
          }
        } catch (e) {
          if (e.name === "AuthError") return;
        }
      }
      for (let n = 1; n <= pdf.numPages; n++) {
        if (pdfRef.current !== pdf) return; // 다른 문서로 바뀜 — 중단
        if (arr[n - 1] != null) continue;
        try {
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          let t = "";
          for (const it of tc.items) {
            if (it.str) {
              if (t && !/\s$/.test(t) && !/^\s/.test(it.str)) t += " ";
              t += it.str;
            }
            if (it.hasEOL) t += "\n";
          }
          arr[n - 1] = t.replace(/\s+/g, " ").trim();
        } catch {
          arr[n - 1] = "";
        }
      }
    } finally {
      if (extractingRef.current === pdf) extractingRef.current = null;
    }
    // 서재 검색 인덱스 — 이 문서가 서재 파일이고(로컬에서 방금 연 파일이면 아직 id 가
    // 없을 수 있다), 다른 문서로 바뀌지 않았고, 전 쪽이 다 뽑혔을 때만 서버에 올린다.
    // 실패해도 조용히 넘어간다 — 검색이 안 되는 것뿐, 읽기엔 지장이 없다.
    if (pdfRef.current === pdf) {
      const id = curFileRef.current?.id;
      const full = bookTextRef.current;
      // 이미 같은 쪽수로 올라가 있으면 다시 안 보낸다 — 본문은 PDF 가 안 바뀌는 한 그대로인데,
      // 예전엔 열 때마다 책 전체(큰 책은 1.4MB)를 다시 올렸다
      const done = curFileRef.current?.indexed === pdf.numPages;
      if (id && !done && full.length === pdf.numPages && full.every((t) => t != null)) {
        libApi("/api/library/file/" + id + "/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pages: full, totalPages: pdf.numPages }),
        }).catch(() => {});
      }
    }
  };

  /* 질문에 딸려 보낼 본문 — 짧은 책은 통째로, 긴 책은 현재 쪽 주변으로 한도까지.
     통째로 들어가는 책은 후속 질문에서도 통째로 보낸다(아래 done 가지가 늘 ASK_CAP 을 본다).
     여기서 한도를 줄였더니 두 번째 질문부터 근거가 사라져, 모델이 "앞에서 말한 그거"를
     문서에서 못 찾고 딴소리를 했다 — 대화가 끊겨 보이던 원인의 절반이 이것이었다.
     한도 축소(ASK_CAP_MORE)는 애초에 통째로 안 들어가는 긴 책에만 남긴다. 그런 책은
     매번 48,000자를 다시 실으면 두 번째 질문부터 눈에 띄게 느려지고, 세션 안에서 화제는
     대개 보고 있는 쪽 근처에 머문다. */
  const ASK_CAP = 48000;
  const ASK_CAP_MORE = 24000;
  /* anchors: 이 대화에서 앞서 질문했던 쪽들. 긴 책에서 읽는 쪽이 넘어가면 앞 질문의 근거 쪽이
     범위 밖으로 밀려나 "아까 그거"를 문서에서 못 찾았다 — 지금 쪽 다음 순위로 먼저 넣는다. */
  const buildAskContext = (cap = ASK_CAP, anchors = []) => {
    const pdf = pdfRef.current;
    if (!pdf) return { scope: "", text: "(본문 없음)" };
    const N = pdf.numPages;
    const pages = bookTextRef.current;
    const pageText = (n) =>
      pages[n - 1] ?? (dataRef.current[n - 1]?.text || "").replace(/\s+/g, " ").trim();
    const done = Array.from({ length: N }, (_, i) => pages[i]).every((t) => t != null);
    if (done) {
      const total = pages.reduce((s, t) => s + t.length + 8, 0);
      if (total <= ASK_CAP)
        return { scope: `책 전체 ${N}쪽`, text: pages.map((t, i) => `[${i + 1}쪽] ${t}`).join("\n") };
    }
    const cur = curRef.current;
    const picked = [];
    const seen = new Set();
    let used = 0;
    const tryAdd = (n) => {
      if (n < 1 || n > N || seen.has(n)) return true;
      const t = pageText(n);
      if (used + t.length > cap) return false;
      picked.push({ n, t });
      seen.add(n);
      used += t.length + 8;
      return true;
    };
    tryAdd(cur);
    for (const a of anchors) if (used < cap / 2) tryAdd(a);
    for (let d = 1; d < N; d++) {
      const a = tryAdd(cur + d);
      const b = tryAdd(cur - d);
      if (!a && !b) break;
    }
    picked.sort((x, y) => x.n - y.n);
    let text = picked.map((p) => `[${p.n}쪽] ${p.t}`).join("\n");
    if (outlineRef.current.length) {
      const toc = outlineRef.current.slice(0, 40).map((o) => "  ".repeat(o.depth) + "- " + o.title).join("\n").slice(0, 1500);
      text = `[목차]\n${toc}\n\n${text}`;
    }
    // 앞 질문 쪽이 끼면 범위가 띄엄띄엄이다 — "3, 40–52쪽" 처럼 이어진 구간끼리 묶는다
    const runs = [];
    for (const { n } of picked) {
      const r = runs[runs.length - 1];
      if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]);
    }
    const span = runs.length ? runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ") : `${cur}`;
    return { scope: `${span}쪽 (전체 ${N}쪽 중)`, text };
  };

  /* ── 목차 자동 생성 ──
     buildAskContext 와 달리 "지금 보는 쪽 주변"이 아니라 책 전체를 훑어야 한다 —
     장이 어디서 시작할지 모르기 때문. 통째로 들어가면 그대로, 안 들어가면
     쪽마다 앞부분만 잘라서라도 전 쪽을 대표하게 한다(제목은 대개 쪽 맨 위에 있다). */
  const OUTLINE_CAP = 70000;
  const buildOutlineContext = () => {
    const pdf = pdfRef.current;
    const N = pdf.numPages;
    const pages = bookTextRef.current;
    const pageText = (n) => pages[n - 1] ?? (dataRef.current[n - 1]?.text || "").replace(/\s+/g, " ").trim();
    const full = Array.from({ length: N }, (_, i) => pageText(i + 1));
    const total = full.reduce((s, t) => s + t.length + 8, 0);
    if (total <= OUTLINE_CAP) return full.map((t, i) => `[${i + 1}쪽] ${t}`).join("\n");
    const perPage = Math.max(80, Math.floor(OUTLINE_CAP / N));
    return full.map((t, i) => `[${i + 1}쪽] ${t.slice(0, perPage)}`).join("\n");
  };

  // extractAll 이 아직 돌고 있으면 끝날 때까지 기다린다 — 일부만 보고 목차를 뽑으면
  // 아직 안 읽은 뒷부분의 장이 통째로 빠진다.
  const waitForExtraction = async (pdf) => {
    const N = pdf.numPages;
    while (pdfRef.current === pdf) {
      const arr = bookTextRef.current;
      if (Array.from({ length: N }, (_, i) => arr[i]).every((t) => t != null)) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };

  const generateOutline = async () => {
    const pdf = pdfRef.current;
    const id = curFileRef.current?.id;
    if (!pdf || !id || outlineGen) return;
    setOutlineErr("");
    setOutlineGen(true);
    try {
      await waitForExtraction(pdf);
      if (pdfRef.current !== pdf) return; // 기다리는 동안 다른 문서로 바뀜
      const context = buildOutlineContext();
      let buf = "";
      await ask(SYS_OUTLINE, context, (c) => { buf += c; }, undefined, { ask: true, maxTokens: 3000 });
      const s = buf.indexOf("["), e = buf.lastIndexOf("]");
      if (s < 0 || e < s) throw new Error("모델이 목차 형식으로 답하지 않았습니다.");
      let items;
      try { items = JSON.parse(buf.slice(s, e + 1)); } catch { throw new Error("모델 응답을 읽지 못했습니다."); }
      const clean = (Array.isArray(items) ? items : [])
        .filter((it) => it && typeof it.title === "string" && it.title.trim() && Number.isFinite(it.page))
        .map((it) => ({ title: it.title.trim(), page: Math.max(1, Math.round(it.page)), depth: it.depth === 1 ? 1 : 0 }));
      if (!clean.length) throw new Error("본문에서 목차를 찾지 못했습니다.");

      await libApi("/api/library/file/" + id + "/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: clean }),
      });

      // 서버 파일이 바뀌었다 — 다시 받아서 pdf.js 가 새 /Outlines 를 그대로 파싱하게 한다.
      // (커스텀 렌더링이 따로 필요 없다: 북마크가 진짜 PDF 구조로 박혀서 기존 목차 패널이 그대로 읽는다.)
      const name = docName;
      await loadPDF(await fetchPDF(id, name), name);
      setUpProg(null);
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setOutlineErr(e.message || "목차를 만들지 못했습니다.");
    } finally {
      setOutlineGen(false);
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

  /* 화면 좌표 (x,y) 아래의 페이지와 페이지 내 상대좌표.
     transform 이 걸린 상태에서도 getBoundingClientRect 는 변환 후 좌표를 주므로 그대로 쓴다.
     핀치 줌과 트랙패드 줌이 함께 쓴다. */
  const findAnchor = useCallback((x, y) => {
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const page = pageAt(pagesRef.current, y);
    const r = pagesRef.current[page - 1]?.getBoundingClientRect();
    return r
      ? { page, fx: clamp01((x - r.left) / r.width), fy: clamp01((y - r.top) / r.height), sx: x, sy: y }
      : { page, fx: 0.5, fy: 0, sx: x, sy: y };
  }, []);

  /* anchor 가 있으면(핀치 줌) 그 지점(페이지 내 fx/fy)이 화면의 같은 자리(sx/sy)로 돌아오게 복원한다.

     이 함수가 처음부터 끝까지 **동기**라는 게 핵심이다. 예전에는 여기서
     `await pdf.getPage(1)` 로 1쪽 뷰포트를 다시 받아 오고, 스크롤 복원은
     requestAnimationFrame 안에서 `scrollTop += …` 로 했다. 그 두 번의 틈 사이에
     813쪽짜리 교과서에서 이런 일이 연달아 벌어졌다:
       - 핀치가 끝나며 stage 의 CSS scale 은 이미 걷혔는데 페이지 상자는 아직 옛 크기라,
         보고 있던 자리가 화면 밖으로 밀린다 → 페이지가 없는 구간이 드러나 --t-desk 가
         그대로 보인다(흰 화면이 아니라 **검은 화면**)
       - onStart 가 끊어 둔 IntersectionObserver 가 아직 안 붙어 아무것도 다시 안 그려진다.
         extractAll 이 813쪽을 훑는 중이면 워커가 늦게 답해서 그 검은 화면이 길게 간다
       - 그 사이 페이지 크기가 바뀌면 scrollHeight 가 줄고 브라우저가 scrollTop 을 끝으로
         clamp 한다. 거기에 대고 `+=` 로 **상대** 보정을 하면 clamp 된 만큼이 그대로 오차가
         된다 — 쪽수가 많을수록 커져서, 축소할 때 수십 쪽을 앞질러 갔다
     그래서 (1) 1쪽 크기는 buildPages 때 baseRef 에 재 두고, (2) 목표 위치를 **절대값**으로
     계산해 scrollTop 에 직접 대입한다. await 가 없으니 브라우저는 중간 상태를 한 프레임도
     그리지 않는다 — 크기 변경과 스크롤 보정이 같은 페인트에 들어간다. */
  const relayout = useCallback((keepPage, anchor, keepWidth) => {
    const base = baseRef.current;
    const view = viewRef.current;
    if (!pdfRef.current || !base || !view) return;
    /* 가려진 동안엔 배치를 미루고, 돌아왔을 때(onShow) 한 번만 한다.
       iPadOS 는 앱을 나갈 때 앱 전환기 스냅숏을 찍느라 백그라운드에서 창 크기를 바꿔
       resize 를 쏜다(좁아지면 wide 도 뒤집힌다). 그때마다 전부 다시 배치·렌더하면
       (1) 돌아왔을 때 쪽이 밀려 있고 그 쪽이 lastPage 로 저장됐다 — 2026-09-28 로그에서
       돌아온 직후 몇 초 안에 lastPage PATCH 가 연달아 나가고 곧바로 페이지가 새로 로드되는
       패턴이 세 번 나왔다(31쪽에서 필기하다 나갔는데 앞쪽으로 저장). (2) 백그라운드에서
       캔버스를 새로 만드느라 메모리가 치솟아 탭이 죽고 새로 로드되는 원인도 된다. */
    if (document.visibilityState === "hidden") { deferLayoutRef.current = true; return; }
    const cw = contentWidth();
    // 폭도 배율도 그대로면 아무것도 하지 않는다 — 좁은 화면에서 풀이창을 여닫을 때마다
    // 전부 다시 그리면서 페이지가 튀던 문제의 원인이 이 불필요한 재배치였다.
    if (cw === layoutKeyRef.current.cw && zoomRef.current === layoutKeyRef.current.zoom) return;
    /* 옆 패널(풀이창·목차)을 여닫을 때는 보이던 쪽 너비를 그대로 둔다 — 폭에 맞춰 다시 맞추면 글자 크기가
       바뀌고 다시 그리느라 스크롤도 조금씩 어긋났다(2026-10-09 사용자). 맞춤 배율(scaleRef)이 바뀐 만큼
       확대율(zoomRef)을 거꾸로 바꿔 곱이 같게 한다 — 쪽 크기가 그대로라 다시 그릴 것도, 스크롤 고칠 것도 없다.
       layoutKeyRef 는 새 객체가 아니라 제자리에서 고친다: 새 객체면 그리던 쪽이 낡은 것으로 버려진다. */
    if (keepWidth && cw !== layoutKeyRef.current.cw) {
      const z = (scaleRef.current * zoomRef.current) / (cw / base.w);
      if (z >= ZOOM_MIN && z <= ZOOM_MAX) {
        scaleRef.current = cw / base.w;
        zoomRef.current = z;
        layoutKeyRef.current.cw = cw;
        layoutKeyRef.current.zoom = z;
        return;
      }
    }
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
    const keep = keepPage || curRef.current;

    /* 페이지의 '내용 좌표'(스크롤 콘텐츠 맨 위 기준). scrollTop 을 더해 상쇄하므로
       브라우저가 중간에 scrollTop 을 clamp 했어도 값이 흔들리지 않는다 —
       절대 대입을 할 수 있는 근거가 이것이다. */
    const contentTop = (el) =>
      el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;

    /* 앵커가 없으면(풀이창 여닫기·회전 등) 화면 **가운데** 가 가리키던 페이지 안의 지점을
       기억해 두고 그 점을 다시 가운데로 가져온다. 예전엔 keep 쪽의 '화면 맨 위' 비율을
       0~1 로 잘라 썼는데, keep 은 pickCur 이 가운데로 고른 쪽이라 맨 위가 그 쪽보다 위면
       비율이 0 으로 잘려 keep 쪽 머리가 화면 맨 위로 올라갔다 — 그러면 가운데 쪽이 바뀌고,
       relayout 이 연달아 오면(창 크기 변화) 한 번에 몇 쪽씩 밀렸다. */
    const prevEl = pagesRef.current[keep - 1];
    if (!anchor && prevEl && prevEl.offsetHeight) {
      const vr0 = view.getBoundingClientRect();
      const cy = vr0.top + vr0.height / 2;
      anchor = { fy: (cy - prevEl.getBoundingClientRect().top) / prevEl.offsetHeight, sy: cy, center: true };
    }

    scaleRef.current = cw / base.w;
    const w = base.w * scaleRef.current * zoomRef.current;
    const h = base.h * scaleRef.current * zoomRef.current;
    ioRef.current?.disconnect();
    dropDetails(); // 옛 배율의 선명화 조각 — 새 배율로 renderPage 가 끝나면 다시 그린다
    for (const el of pagesRef.current) {
      if (!el) continue;
      el.style.width = w + "px";
      el.style.height = h + "px";
      // 캔버스는 남긴다 — CSS 로 새 크기에 맞춰 늘어난 채(흐릿하게) 보이다가
      // renderPage 가 선명한 새 캔버스를 완성하면 그때 교체된다.
      // 텍스트 레이어는 옛 배율 좌표라 어긋나므로 걷어낸다.
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
    }
    for (const n of renderedRef.current) leftRef.current.add(n);
    renderedRef.current.clear();
    cancelJobs();
    dataRef.current = [];

    /* 새 크기가 반영된 뒤(첫 getBoundingClientRect 가 레이아웃을 확정시킨다) 목표를
       절대값으로 잡아 그대로 대입한다. `+=` 가 아니라 `=` 인 것이 요점 — 지금 scrollTop 이
       clamp 돼 있든 말든 결과가 같다. */
    const el = pagesRef.current[keep - 1];
    if (el) {
      const vr = view.getBoundingClientRect();
      const top = contentTop(el);
      view.scrollTop = anchor
        ? top + anchor.fy * el.offsetHeight - (anchor.sy - vr.top)
        : top;
      if (anchor && !anchor.center) {
        const lr = el.getBoundingClientRect();
        view.scrollLeft = lr.left - vr.left + view.scrollLeft + anchor.fx * lr.width - (anchor.sx - vr.left);
      }
      curRef.current = keep;
      setCurPage(keep);
      /* 대입한 자리를 몇 프레임 지킨다. 2026-10-06 37쪽 슬라이드 7쪽에서 축소하자 19쪽에 가 있었는데,
         이건 "scrollTop 이 옛 값 그대로 남고 쪽만 작아졌다"와 숫자가 맞는다(옛 위치 ÷ 배율 0.35 ≈ 19쪽).
         iOS 는 스크롤 위치를 UI 프로세스가 따로 들고 있어서, 손가락이 남아 있거나 관성이 살아 있으면
         우리가 넣은 값을 제 값으로 덮어쓴다. 사용자가 새로 만지기 전까지만 되돌린다. */
      const want = { top: view.scrollTop, left: view.scrollLeft };
      const key = layoutKeyRef.current;
      let touched = false;
      /* 지키는 동안엔 syncPages 가 엇나간 위치로 그리기·치우기를 하지 않는다(holdRef). 안 그러면 iOS 가
         옛 scrollTop 을 되돌려 놓은 그 한순간의 위치로 범위를 잡아, 정작 보고 있던 쪽의 캔버스를 치웠다가
         hold 가 제자리로 돌린 뒤 다시 그렸다 — 화면보다 작게 축소한 채 확대·축소하면 쪽이 꺼졌다 켜졌다
         하던 원인(2026-10-09 실기기). */
      holdRef.current = want;
      const done = () => { if (holdRef.current === want) holdRef.current = null; };
      const off = () => { touched = true; done(); };
      view.addEventListener("touchstart", off, { passive: true });
      view.addEventListener("wheel", off, { passive: true });
      const hold = () => {
        if (touched || layoutKeyRef.current !== key) return done();
        if (Math.abs(view.scrollTop - want.top) > 4) view.scrollTop = want.top;
        if (Math.abs(view.scrollLeft - want.left) > 4) view.scrollLeft = want.left;
      };
      requestAnimationFrame(() => { hold(); requestAnimationFrame(hold); });
      setTimeout(hold, 120);
      setTimeout(() => {
        hold();
        done();
        syncPages();
        view.removeEventListener("touchstart", off);
        view.removeEventListener("wheel", off);
      }, 350);
    }
    /* 관찰은 스크롤을 고친 **다음에** 붙인다. 사파리는 observe() 의 첫 보고를 0ms 타이머로
       흘려서 rAF 보다 먼저 올 수 있는데, 먼저 붙이면 아직 안 고친 위치를 기준으로
       pickCur 이 curRef 를 엉뚱하게 잡고 prune 이 보고 있는 페이지를 지워 버린다. */
    observe();
  }, []);

  // 패널 여닫기는 쪽 너비를 지킨다(relayout 의 keepWidth). wide 가 뒤집힌 건 창 크기가 바뀐 것이라 다시 맞춘다
  const wideWasRef = useRef(wide);
  useEffect(() => {
    const keepWidth = wideWasRef.current === wide;
    wideWasRef.current = wide;
    const t = setTimeout(() => relayout(undefined, undefined, keepWidth), 280);
    return () => clearTimeout(t);
  }, [sheetOpen, outOpen, wide, panelMode, relayout]);

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

  /* IntersectionObserver 는 페이지가 1000px 여유를 드나들 때만 깨어나므로
     쪽 번호가 뒤늦게 바뀐다. 스크롤 중에도 rAF 로 한 번씩 현재 페이지를 다시 잡는다
     (pickCur 은 이진 탐색이라 1000쪽짜리도 프레임당 rect 10번 남짓이다). */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let raf = 0;
    const on = () => {
      if (raf) return;
      // 그리기·치우기도 같이 — IO 는 경계를 넘을 때만 깨어나서 그것만으론 빈 쪽이 남았다(syncPages)
      raf = requestAnimationFrame(() => { raf = 0; syncPages(); });
    };
    view.addEventListener("scroll", on, { passive: true });
    return () => { view.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
    // syncPages·renderPage 는 ref 만 읽으므로 첫 렌더의 클로저를 그대로 써도 안전하다(relayout 도 그렇게 쓴다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* markRef 의 오프셋 구간을 해당 페이지에 다시 그린다.
     renderPage 가 텍스트 레이어를 새로 만들 때마다 호출되므로,
     확대/축소나 풀이창 여닫기로 재배치가 일어나도 하이라이트가 유지된다. */
  const applyMarks = () => {
    const m = markRef.current;
    if (!m) return;
    const pd = dataRef.current[m.page - 1];
    const el = pagesRef.current[m.page - 1];
    if (!pd || !el) return;
    el.querySelectorAll(".vb-hl").forEach((h) => h.remove());
    markSpans(pd.words.filter((w) => {
      const o = +w.dataset.off;
      return o >= m.start && o < m.end;
    }), m.cls);
  };

  const setMark = (page, start, end, cls) => {
    markRef.current = { page, start, end, cls };
    applyMarks();
  };

  const clearMarks = () => {
    markRef.current = null;
    viewRef.current?.querySelectorAll(".vb-hl").forEach((e) => e.remove());
  };

  /* ── 단어 / 문장 ── */
  const runWord = async (w, sentence) => {
    if (!w) return;
    const key = "w|" + w + "|" + sentence.slice(0, 120);
    if (cacheRef.current.has(key)) {
      setWord({ ...cacheRef.current.get(key), quote: sentence });
      return; // 기록 저장은 아래 word state 를 지켜보는 useEffect 가 일괄 처리한다
    }
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
      }); // 기록 저장은 아래 word state 를 지켜보는 useEffect 가 일괄 처리한다
    } catch (e) {
      if (e.name !== "AbortError") setWord((s) => (s && s.head === w ? { ...s, live: false, err: e.message } : s));
    }
  };

  const runSentence = async (text) => {
    if (!text) return;
    const key = "s|" + text.slice(0, 200);
    if (cacheRef.current.has(key)) {
      const trans = cacheRef.current.get(key);
      setSent({ trans, quote: text, live: false });
      pushInterp(text, trans);
      return;
    }
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
      pushInterp(text, buf.trim());
    } catch (e) {
      if (e.name !== "AbortError") setSent((s) => (s && s.quote === text ? { ...s, live: false, err: e.message } : s));
    }
  };

  /* 기록 탭용 해석 이력 — 서버에 저장해야 새로고침·다른 기기에서도 남는다(단어장과 동일 구조) */
  const pushInterp = async (quote, trans) => {
    if (!trans) return;
    try {
      const r = await libApi("/api/interps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote, trans, doc: docName, page: curRef.current }),
      });
      const entry = await r.json();
      setInterpLog((v) => [entry, ...v]);
    } catch (e) {
      if (e.name !== "AuthError") console.warn("interp save", e);
    }
  };

  /* 기록 탭에 뜨는 "이 문서에서 찾아본 단어" — ★ 로 담은 단어장(vocab)과 별개다.
     탭할 때마다(캐시로 즉시 뜨든 새로 물어보든) 서버에 남겨서 기록 탭이 "이 파일에서
     질문한 단어"를 보여주게 한다. 같은 문서 안에서 같은 단어를 다시 찾으면 서버가
     알아서 맨 앞으로 옮긴다(POST /api/lookups 참고). */
  const pushLookup = async (word, senses, ctx, quote) => {
    const mean = (senses || []).filter((s) => s && s !== "찾는 중…").join(" / ");
    if (!mean) return;
    try {
      const r = await libApi("/api/lookups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, mean, ctx: ctx || "", quote: quote || "", doc: docName }),
      });
      const entry = await r.json();
      setLookups((v) => [entry, ...v.filter((x) => !(x.word.toLowerCase() === entry.word.toLowerCase() && x.doc === entry.doc))]);
    } catch (e) {
      if (e.name !== "AuthError") console.warn("lookup save", e);
    }
  };

  /* word 상태가 "완료"로 가라앉는 순간을 감지해서 기록한다 — runWord 안에서
     setWord(updater) 직후 cacheRef.current.get(key) 를 바로 읽어 pushLookup 을 부르면,
     React 가 그 updater 를 아직 안 돌렸을 때(배치 타이밍) 조용히 빈 결과를 읽어 기록이
     통째로 빠졌다(실제로 겪은 버그 — 새로 찾은 단어는 거의 다 안 남고 캐시로 재조회한
     것만 남았다). 커밋된 word state 자체를 보면 이 타이밍 문제가 아예 없다. */
  const loggedWordKeyRef = useRef("");
  useEffect(() => {
    if (!word || word.live || word.err) return;
    const key = "w|" + word.head + "|" + (word.quote || "").slice(0, 120);
    if (loggedWordKeyRef.current === key) return;
    loggedWordKeyRef.current = key;
    pushLookup(word.head, word.senses, word.ctx, word.quote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  /* 리모트(폰)의 단어/문장 탭은 이 값이 스트리밍되는 그대로를 받아 그린다(src/Remote.jsx
     의 word/sent 슬롯). 최신 state 를 통째로 보내고 seq 로 낡은 응답만 걸러낸다.
     흐르는 중(live)에는 슬롯마다 0.25초에 한 번만 — 예전엔 글자 조각마다 POST 가 하나씩 나갔다.
     끝난 것(live 아님)은 기다리던 걸 버리고 곧바로 보낸다. */
  const remoteSeqRef = useRef({ word: 0, sent: 0 });
  const relayWait = useRef({});
  const relay = (slot, payload) => {
    if (!remoteOnRef.current) return;
    const w = (relayWait.current[slot] ||= { t: 0, at: 0, last: null });
    const send = () => {
      w.t = 0; w.at = Date.now();
      remoteSeqRef.current[slot] += 1;
      fetch(u("/api/remote/relay"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, seq: remoteSeqRef.current[slot], payload: w.last }),
      }).catch(() => {});
    };
    w.last = payload;
    if (!payload?.live) { clearTimeout(w.t); send(); return; }
    if (!w.t) w.t = setTimeout(send, Math.max(0, 250 - (Date.now() - w.at)));
  };
  useEffect(() => {
    if (!word) return;
    relay("word", {
      head: word.head, pos: word.pos, ctx: word.ctx, senses: word.senses,
      quote: word.quote, page: curRef.current, doc: docNameRef.current,
      live: !!word.live, err: word.err || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);
  useEffect(() => {
    if (!sent) return;
    relay("sent", { text: sent.trans, live: !!sent.live, err: sent.err || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent]);

  /* 문장/구간 해석은 캔버스로 렌더된 페이지 위에 뜨는 유리 카드로 보여준다 — 드래그 선택
     ("선택 구간 해석" 말풍선)이나 단어 탭의 "문장 해석" 버튼에서 들어온다.
     두 번 탭 제스처는 리디자인에서 뺐다. */
  const showQuoteInterp = (text) => {
    const hostR = viewRef.current?.parentElement?.getBoundingClientRect();
    setSentPos(hostR ? { left: Math.max(8, hostR.width / 2 - 160), top: 60 } : { left: 20, top: 60 });
    runSentence(text);
  };

  /* ── 단어 탭 ──
     pointerdown 에서 바로 실행하면 핀치의 첫 손가락·스크롤 시작·길게 눌러 선택까지
     전부 단어 풀이로 오인한다. 후보만 잡아 두고 pointerup 에서 판정한다:
     둘째 손가락이 오거나, 8px 넘게 움직이거나, 350ms 를 넘기면 탭이 아니다.
     (예전엔 두 번 탭 = 문장 번역이었지만 리디자인에서 뺐다 — 문장 해석은 드래그 선택으로만 들어간다.) */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let pend = null; // {el, x, y, id, t}
    const cancel = () => { pend = null; };
    const onDown = (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) { pend = null; return; }
      // 필기 모드에선 펜·마우스는 쓰는 도구다 — 단어 풀이는 손가락 탭으로만
      if (inkOnRef.current && ev.pointerType !== "touch") { pend = null; return; }
      const el = ev.target.closest?.(".w");
      if (!el) { pend = null; return; }
      pend = { el, x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: Date.now() };
    };
    const onMove = (ev) => {
      if (pend && ev.pointerId === pend.id &&
        Math.hypot(ev.clientX - pend.x, ev.clientY - pend.y) > 8) pend = null;
    };
    const onTouchStart = (e) => { if (e.touches.length >= 2) pend = null; };
    const onUp = (ev) => {
      if (!pend || ev.pointerId !== pend.id) return;
      const { el, t } = pend;
      pend = null;
      if (Date.now() - t > 350) return; // 길게 누름 — 선택 제스처에 양보
      const n = +el.dataset.page;
      const pd = dataRef.current[n - 1];
      if (!pd) return;
      const off = +el.dataset.off;
      const s = sentenceAt(pd.text, off);
      lastSentRef.current = s.text;
      // 한 번 탭 = 항상 단어 풀이. 문장 해석은 드래그 선택(구간 해석)으로만 들어간다.
      setSentPos(null);
      clearMarks();
      setMark(n, off, off + el.textContent.length, "");
      // 리모트 모드에선 폰이 단어 패널을 보여주므로 아이패드 쪽 시트는 자동으로 열지 않는다 —
      // 탭 버튼을 직접 누르면 그때는 연다(3533번째 줄 토글은 그대로 동작).
      if (!remoteOnRef.current) setSheetOpen(true);
      setTab("word");
      runWord(wordAt(pd.text, off), s.text);
    };
    view.addEventListener("pointerdown", onDown, { passive: true });
    view.addEventListener("pointermove", onMove, { passive: true });
    view.addEventListener("pointerup", onUp, { passive: true });
    view.addEventListener("pointercancel", cancel, { passive: true });
    view.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      view.removeEventListener("pointerdown", onDown);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", cancel);
      view.removeEventListener("touchstart", onTouchStart);
    };
  }, [ask]);

  /* ── 두 손가락 핀치 줌 (아이패드) ──
     제스처 중에는 CSS scale + 두 손가락 팬(스크롤 직접 이동)만 하고,
     끝나는 순간 손가락 중점 아래의 지점을 앵커로 잡아 relayout 이
     같은 점을 같은 화면 자리로 되돌린다.
     브라우저의 네이티브 스크롤이 먼저 제스처를 가져가면(touchmove 가
     cancelable 이 아니게 되면) 즉시 핀치를 포기한다 — 안 그러면
     네이티브 스크롤과 우리 변환이 겹쳐 페이지가 몇 장씩 튄다. */
  useEffect(() => {
    const view = viewRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    let pinching = false, startD = 0, startZoom = 1, factor = 1, lastMid = null, ids = new Set();
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const reset = () => {
      stage.style.transform = "";
      stage.style.transformOrigin = "";
      setZoomPill(null);
    };

    /* 끝을 못 보고 굳은 핀치를 푼다.
       터치 이벤트의 target 은 처음 닿은 요소로 고정되는데, 그 요소(텍스트 레이어의 .w 스팬)가
       제스처 도중 DOM 에서 빠지면 — 핀치 전에 시작된 renderPage 가 끝나며 옛 .vb-tl 을
       지우는 경우 — touchmove/touchend/touchcancel 이 떨어져 나간 요소에서만 발화하고 view 까지
       버블링되지 않는다. 그러면 pinching·gestureRef·stage 의 임시 transform·끊긴 IO 가
       전부 남아(아래 abort 주석의 증상 그대로) 다음 축소 때 페이지가 튀고, 앱을 껐다 켜야 풀렸다.
       그래서 (1) 손가락이 닿은 요소에도 이벤트를 직접 걸어 떨어져 나갔을 때만 대신 받고,
       (2) 핀치 중인데 새 touchstart 가 2손가락 이하면(= 끝을 놓쳤다) 먼저 원상복구한다. */
    const hooked = new Set();
    const stray = (e) => {
      if (e.currentTarget.isConnected) return; // 붙어 있으면 view 가 버블링으로 받는다
      if (e.type === "touchmove") onMove(e);
      else if (e.type === "touchend") onEnd(e);
      else abort();
    };
    const unhook = () => {
      for (const tg of hooked) {
        tg.removeEventListener("touchmove", stray);
        tg.removeEventListener("touchend", stray);
        tg.removeEventListener("touchcancel", stray);
      }
      hooked.clear();
    };
    const hook = (e) => {
      for (const t of e.touches) {
        const tg = t.target;
        if (!tg || tg === view || hooked.has(tg)) continue;
        tg.addEventListener("touchmove", stray, { passive: false });
        tg.addEventListener("touchend", stray, { passive: true });
        tg.addEventListener("touchcancel", stray, { passive: true });
        hooked.add(tg);
      }
    };
    const onStart = (e) => {
      if (pinching) {
        // 한 손가락을 남긴 채 다른 손가락을 다시 댔다 — 같은 핀치를 지금 배율에서 이어 간다
        const kept = [...e.touches].filter((t) => ids.has(t.identifier));
        if (e.touches.length === 2 && kept.length === 1) {
          hook(e);
          ids = new Set([...e.touches].map((t) => t.identifier));
          startD = dist(e.touches) / factor;
          lastMid = mid(e.touches);
          return;
        }
        // 그 밖에 손가락이 2개 이하로 새로 닿았다 — 지난 제스처의 끝을 놓친 것.
        // 세 번째 손가락이 닿았으면 작은 노트 제스처다 — 핀치를 버린다
        if (e.touches.length !== 2) abort();
      }
      if (e.touches.length !== 2 || !pdfRef.current) return;
      // 필기 중 손바닥이 닿아 생긴 '두 손가락'은 핀치가 아니다
      if (inkOnRef.current && [...e.touches].some((t) => t.touchType === "stylus")) return;
      /* 여기서 preventDefault 로 네이티브 팬을 원천 차단해 보려 했지만 되돌렸다 —
         렉이 걸리고, 페이지 크기는 그대로인데 내용만 작아지고 상하반전되는 렌더 깨짐이 생겼다.
         핀치 중 튀는 문제는 아래 onMove 의 e.cancelable 사후 방어로만 다룬다. */
      pinching = true;
      gestureRef.current = true;
      markPinch();
      hook(e);
      ids = new Set([...e.touches].map((t) => t.identifier));
      startD = dist(e.touches);
      startZoom = zoomRef.current;
      factor = 1;
      lastMid = mid(e.touches);
      // 제스처 중에는 렌더/프룬이 끼어들지 않게 관찰을 멈춘다
      ioRef.current?.disconnect();
      const sr = stage.getBoundingClientRect();
      stage.style.transformOrigin = `${lastMid.x - sr.left}px ${lastMid.y - sr.top}px`;
    };
    const onMove = (e) => {
      if (!pinching) return;
      /* 한 손가락을 먼저 뗀 뒤 남은 손가락 — 다 뗄 때까지 확정을 미루므로 그동안 네이티브 스크롤을
         막는다. 막을 수 없으면(이미 네이티브가 가져갔으면) 지금 확정한다. */
      if (e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        else commit();
        return;
      }
      if (e.touches.length !== 2) return;
      if (!e.cancelable) {
        // 네이티브 스크롤이 이미 제스처를 가져갔다 — 핀치를 포기한다
        pinching = false;
        gestureRef.current = false;
        unhook();
        reset();
        observe();
        armJump("keep");
        return;
      }
      e.preventDefault();
      const m = mid(e.touches);
      // 두 손가락 팬: 중점 이동량만큼 우리가 직접 스크롤한다
      view.scrollTop -= m.y - lastMid.y;
      view.scrollLeft -= m.x - lastMid.x;
      lastMid = m;
      const raw = dist(e.touches) / startD;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startZoom * raw));
      factor = next / startZoom;
      stage.style.transform = `scale(${factor})`;
      setZoomPill(Math.round(next * 100) + "%");
    };
    /* 제스처를 중간에 버린다 — 확대율은 손대지 않고 임시 상태만 원상복구한다.
       onStart 가 걸어둔 것들(pinching, gestureRef, stage 의 임시 transform, 끊어둔
       IntersectionObserver)은 오직 onEnd 에서만 풀리는데, onEnd 에는
       `e.touches.length >= 2` 가드가 있다. iOS 는 앱을 나갈 때 진행 중이던 터치를
       touchcancel 로 끊으면서 e.touches 에 그 손가락들을 그대로 담아 보내기 때문에,
       touchcancel 을 onEnd 로 보내면 이 가드에 걸려 아무것도 안 풀고 돌아간다.

       그러면 다른 앱에 갔다 온 뒤 이렇게 된다:
       - IO 가 끊긴 채라 스크롤해도 새 페이지가 안 그려지고 prune 도 안 돈다
       - gestureRef 가 켜진 채라 pickCur 이 계속 조기 반환해 현재 쪽이 굳는다
       - stage 에 지난 제스처의 transform 과 transformOrigin 이 남아, 다음에 축소하면
         내용이 화면 밖으로 밀려 데스크 배경만 보인다(까만 화면)
       앱을 껐다 켜면 멀쩡해지는 게 이게 전부 메모리 상태라서다. */
    const abort = () => {
      if (!pinching) return;
      pinching = false;
      gestureRef.current = false;
      unhook();
      reset();
      lastMid = null;
      observe();
      armJump("keep");
    };

    /* 확정은 손가락이 **전부** 떨어진 뒤에 한다. 예전엔 하나만 떼도 확정했는데, 그러면 남은
       손가락이 곧바로 네이티브 스크롤을 시작해 iOS 가 relayout 이 넣은 scrollTop 을 옛 값으로
       덮어쓸 수 있었다(relayout 의 hold 주석) — 쪽은 작아지고 위치는 그대로라 한참 아래로 갔다. */
    const onEnd = (e) => {
      if (!pinching) return;
      if (e.touches.length === 0) commit();
      else ids = new Set([...e.touches].map((t) => t.identifier));
    };
    const commit = () => {
      if (!pinching) return;
      pinching = false;
      unhook();
      // 앵커는 끝나는 순간의 중점에서 계산한다 (변환이 걸린 채로 측정)
      // gestureRef 는 앵커를 잡은 뒤에 내린다 — 그전에 pickCur 이 끼어들면 안 된다
      const anchor = lastMid ? findAnchor(lastMid.x, lastMid.y) : null;
      gestureRef.current = false;
      reset();
      lastMid = null;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startZoom * factor));
      if (Math.abs(next - zoomRef.current) > 0.01) {
        zoomRef.current = next;
        persist();
        relayout(anchor?.page, anchor);
        armJump("commit", anchor);
      } else {
        observe();
        armJump("keep");
      }
    };
    /* 화면이 가려질 때도 제스처를 버린다 — touchcancel 이 항상 오리라고 믿을 수 없다.
       (앱 전환·전화 수신·제어센터 등 경로마다 iOS 가 주는 이벤트가 다르다.) */
    const onHide = () => { if (document.visibilityState !== "visible") abort(); };
    view.addEventListener("touchstart", onStart, { passive: true });
    view.addEventListener("touchmove", onMove, { passive: false });
    view.addEventListener("touchend", onEnd, { passive: true });
    view.addEventListener("touchcancel", abort, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", abort);
    return () => {
      unhook();
      view.removeEventListener("touchstart", onStart);
      view.removeEventListener("touchmove", onMove);
      view.removeEventListener("touchend", onEnd);
      view.removeEventListener("touchcancel", abort);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", abort);
    };
  }, [relayout, persist, findAnchor]);

  /* ── 트랙패드 핀치 / Ctrl+휠 줌 (데스크톱) ──
     브라우저는 트랙패드 두 손가락 핀치를 ctrlKey 가 붙은 wheel 이벤트로 준다
     (Ctrl+마우스휠도 같은 모양이라 함께 잡힌다). preventDefault 를 안 하면
     브라우저 자체 페이지 확대가 먹어 버리므로 passive:false 로 등록한다.
     터치 핀치와 같은 2단계 구조 — 굴리는 동안엔 stage 에 CSS scale 만 걸고,
     휠이 멎으면(140ms) 커서 아래 지점을 앵커로 잡아 relayout 으로 다시 그린다. */
  useEffect(() => {
    const view = viewRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    let zooming = false, startZoom = 1, factor = 1, last = null, timer = 0;
    const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const commit = () => {
      if (!zooming) return;
      zooming = false;
      const anchor = last ? findAnchor(last.x, last.y) : null;
      gestureRef.current = false;
      stage.style.transform = "";
      stage.style.transformOrigin = "";
      setZoomPill(null);
      last = null;
      const next = clampZoom(startZoom * factor);
      if (Math.abs(next - zoomRef.current) > 0.01) {
        zoomRef.current = next;
        persist();
        relayout(anchor?.page, anchor);
        armJump("commit", anchor);
      } else {
        observe();
        armJump("keep");
      }
    };
    const onWheel = (e) => {
      if (!e.ctrlKey || !pdfRef.current) return;
      e.preventDefault();
      if (!zooming) {
        zooming = true;
        gestureRef.current = true;
        markPinch();
        startZoom = zoomRef.current;
        factor = 1;
        ioRef.current?.disconnect(); // 제스처 중에는 렌더/프룬이 끼어들지 않게
        const sr = stage.getBoundingClientRect();
        stage.style.transformOrigin = `${e.clientX - sr.left}px ${e.clientY - sr.top}px`;
      }
      last = { x: e.clientX, y: e.clientY };
      // deltaMode 는 픽셀(0)/줄(1)/페이지(2) — 줄·페이지 단위면 픽셀로 환산한다.
      // 트랙패드는 작은 값이 연속으로, 마우스 휠은 한 칸에 100 안팎이 뚝뚝 떨어진다.
      // 한 번에 튀지 않게 상한을 씌워, 휠 한 칸이 약 20% 가 되게 맞췄다.
      const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const px = Math.max(-50, Math.min(50, raw));
      const next = clampZoom(startZoom * factor * Math.exp(-px / 220));
      factor = next / startZoom;
      stage.style.transform = `scale(${factor})`;
      setZoomPill(Math.round(next * 100) + "%");
      clearTimeout(timer);
      timer = setTimeout(commit, 140);
    };
    // 굴리는 도중에 화면이 가려지면 140ms 타이머를 기다리지 않고 바로 확정한다 —
    // 정지된 탭에서 타이머가 언제 깨어날지는 보장이 없고, 그동안 stage 에 임시 transform 과
    // 끊어진 IO 가 남는다(터치 핀치 쪽 abort 주석과 같은 사고).
    const onHide = () => { if (document.visibilityState !== "visible") { clearTimeout(timer); commit(); } };
    view.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      view.removeEventListener("wheel", onWheel);
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer);
    };
  }, [relayout, persist, findAnchor]);

  /* 돌아왔을 때의 마지막 그물 — 어떤 경로로든 관찰이 끊긴 채였다면 여기서 되살린다.
     제스처 뒷정리는 각 핸들러가 하지만, iOS 가 어떤 이벤트를 주는지는 경로마다 달라서
     "관찰이 끊겨 스크롤해도 아무것도 안 그려지는" 상태만은 무조건 풀고 시작한다.
     observe() 는 끊고 다시 거는 함수라 여러 번 불러도 안전하다. */
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      if (!pdfRef.current || gestureRef.current) return;
      // 가려진 동안 미뤄 둔 배치 — curRef 는 나갈 때의 쪽에 굳어 있으니 그 쪽으로 돌아온다
      if (deferLayoutRef.current) { deferLayoutRef.current = false; relayout(curRef.current); }
      observe();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [relayout]);

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
      if (e.key === "Escape") { setSheetOpen(false); setOutOpen(false); setSetOpen(false); closeRename(); }
      if (!pdfRef.current) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); scrollToPage(Math.min(numPages, curRef.current + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); scrollToPage(Math.max(1, curRef.current - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages]);

  /* ── 질문 ── */
  const sendAsk = async (text) => {
    // text: 빈 화면의 추천 질문처럼 입력창을 거치지 않고 곧바로 보낼 때
    const typed = typeof text !== "string";
    const q = (typed ? askVal : text).trim();
    if (!q || asking) return;
    if (typed) setAskVal("");

    setAsking(true); // 새 대화를 여는 동안 두 번 눌리지 않게
    // 세션이 없으면(처음이거나 2시간이 지나 청소됐으면) 첫 질문을 제목 삼아 하나 연다.
    let sid = curSessRef.current && findSess(curSessRef.current) ? curSessRef.current : "";
    if (!sid) {
      try { sid = await newSess(q.length > 16 ? q.slice(0, 16) + "…" : q); } catch (e) {
        setAsking(false); if (typed) setAskVal(q); return;
      }
    }

    const s = findSess(sid);
    const history = histOf(sid);              // 반드시 이번 문답을 넣기 전에 뽑는다
    const idx = (s?.msgs.length || 0) + 1;    // 방금 넣을 ai 자리
    const img = sendFig && s?.img ? s.img : "";
    // pg: 이 질문을 어느 쪽에서 했나 — 뒤의 질문들이 이 쪽을 근거 범위에 계속 붙인다(buildAskContext)
    addMsgs(sid, [{ role: "me", text: q, pg: curRef.current, ...(img ? { img } : {}) }, { role: "ai", text: "", live: true }]);
    await answerInto(sid, idx, q, history, { img });
  };

  /* 마지막 답을 지우고 같은 질문을 다시 보낸다 — 실패했거나, 모델을 바꿔 다시 듣고 싶을 때.
     지난 답은 뒤의 문답이 딛고 있으므로 마지막 것만. 캡처로 시작한 첫 답(hist 가 있는 것)은
     다른 경로(그림 풀이)라 여기서 다시 하지 않는다. */
  const redoAsk = async () => {
    if (asking) return;
    const sid = curSessRef.current;
    const s = findSess(sid);
    const idx = (s?.msgs.length || 0) - 1;
    const qm = s?.msgs[idx - 1];
    if (idx < 1 || qm?.role !== "me" || qm.hist || s.msgs[idx]?.live) return;
    const history = histOf(sid, idx - 1);
    patchMsg(sid, idx, { text: "", live: true, err: "", stopped: false, swap: null, by: null });
    await answerInto(sid, idx, qm.text, history, { img: qm.img || "", model: qm.model });
  };

  /* 답 하나를 채운다(새 질문·다시 답하기·폰 질문 공용). idx 는 채울 ai 자리, history 는 그 앞의 문답.
     opts.img: 딸려 보낼 그림 id(서버에 저장된 것), opts.model: 폰에서 고른 모델(없으면 이 기기의 선택). */
  const answerInto = async (sid, idx, q, history, opts = {}) => {
    setAsking(true);
    const sp = streamPatcher(sid, idx);
    const s = findSess(sid);

    /* 그림이 딸린 질문: 옮겨 적은 글(imgDesc, 같은 그림의 것)이 있으면 그 글로, 없으면 그림째 Gemini 에게(visionDirect).
       Gemini 가 막혀 있으면 그 자리에서 비전 모델이 옮겨 적고, 고른 질문 탭 모델이 그 글로 답한다 —
       옮긴 글은 세션에 남아 다음 질문부터는 곧장 텍스트로 간다. */
    let image = "";
    let figBlock = "";
    if (opts.img) {
      if (s?.imgDesc && (s.imgDescFor || s.img) === opts.img) figBlock = `\n\n${FIG_NOTE}\n${s.imgDesc}`;
      else { try { image = await getImg(sid, opts.img); } catch {} }
    }

    /* 본문·쪽·짚은 문장은 user 턴이 아니라 system 에 싣는다. user 턴에 얹으면 지난 턴들은
       질문 한 줄인데 이번 턴만 수만 자짜리 덩어리가 되어, 모델이 "지금 새 자료를 받았다"로
       읽고 앞의 문답을 놓친다 — "아까 그거"가 안 통하던 이유가 이거다. system 으로 옮기면
       대화 쪽에는 사람 말만 남아 history 와 모양이 같아지고, 흐름이 그대로 보인다. */
    const anchors = [...new Set((s?.msgs || []).slice(0, idx).map((m) => m.pg).filter(Boolean).reverse())].slice(0, 3);
    const { scope, text } = buildAskContext(history.length ? ASK_CAP_MORE : ASK_CAP, anchors);
    // 접어 둔 앞 대화(maybeFold)는 문서보다 앞에 — 튜터가 "지금까지의 흐름"부터 읽게
    const folded = s?.sum ? `\n\n[앞선 대화 요약 — 이미 나눈 이야기다. 아래 대화는 그 뒤부터 이어진다]\n${s.sum}` : "";
    const sysBase =
      `${SYS_ASK}${folded}\n\n[문서: ${docName || "제목 없음"} — 제공 범위: ${scope || "없음"}]\n${text}\n\n` +
      `[읽는 이가 지금 보고 있는 쪽] ${curRef.current}쪽\n[방금 짚은 문장] ${lastSentRef.current || "(없음)"}`;
    let buf = "";
    let cut = false;   // 길이 상한에 걸려 말이 끊겼는가
    let swap = null;   // 고른 모델이 붐벼서 다른 모델이 대신 답했는가
    // 누가 답했나 — 답 아래 작은 줄로(떨어진 모델 경로 · 첫 글자 초). 첫 글자는 보낸 때부터
    const t0 = Date.now();
    const by = { label: "", trail: [], first: 0 };
    const ac = startJob(sid, image ? "그림과 함께" : (figBlock ? "그림 설명과 함께" : ""));
    jobRef.current.i = idx; // 폰의 [멈추기](ask-cancel)가 어느 답인지 알아보게
    try {
      const hook = phaseHook(ac, () => buf.length);
      const onPhase = (p, info) => {
        if (p === "cut") cut = true;
        if (p === "swap") swap = info;
        if (p === "fail") by.trail.push({ label: info.label, why: info.why });
        if (p === "pick") {
          if (info.why === "cont" && by.label) by.trail.push({ label: by.label, why: "끊김" });
          by.label = info.label;
        }
        if (p === "stream" && !by.first) by.first = Math.round((Date.now() - t0) / 1000);
        hook(p, info);
      };
      const onDelta = (c) => {
        buf += c;
        sp.live({ text: buf }); // 흐르는 동안은 답 본문 칸만 — 정착할 때 state 와 서버에
        relayAsk({ sid, i: idx, text: buf, run: statRef.current });
      };
      const onPhaseR = onPhase;
      const onPhaseRelay = (p, info) => { onPhaseR(p, info); if (p !== "tick") relayAsk({ sid, i: idx, text: buf, run: statRef.current }); };
      const mdl = opts.model !== undefined && opts.model !== "" ? { askModel: opts.model } : {};
      let done = false;
      if (image) {
        try {
          await ask(sysBase, q, onDelta, ac.signal, { ask: true, history, image, visionDirect: true, onPhase: onPhaseRelay, ...mdl });
          done = true;
        } catch (e) {
          if (e.name === "AbortError" || e.name === "AuthError" || buf) throw e;
          /* Gemini 가 막혔다 — 예전 두 단계: 비전 모델이 옮겨 적고, 고른 질문 탭 모델이 그 글로 답한다.
             옮긴 글은 세션에 남겨 다음 질문부터는 옮겨적기 없이 곧장 간다. */
          let desc = "";
          await ask(SYS_CAP_DESCRIBE, `[${curRef.current}쪽에서 오려낸 영역] 이 이미지를 옮겨 적어라.`,
            (c) => { desc += c; }, ac.signal, { image });
          if (!desc.trim()) throw new Error("그림을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
          patchSess(sid, { imgDesc: desc.trim(), imgDescFor: opts.img });
          image = "";
          figBlock = `\n\n${FIG_NOTE}\n${desc.trim()}`;
        }
      }
      if (!done) await ask(sysBase + figBlock, q, onDelta, ac.signal, {
        ask: true, history,
        onPhase: onPhaseRelay, ...mdl,
      });
      // 끊긴 걸 표시해 두지 않으면 답이 원래 그렇게 끝난 줄 안다.
      // swap 은 text 가 아니라 별도 칸에 둔다 — text 에 섞으면 다음 턴 히스토리까지 따라간다.
      sp.settle({
        text: buf + (cut ? "\n\n*(답변이 길어 여기서 끊겼어요. \"이어서\"라고 보내면 계속해요.)*" : ""),
        live: false,
        swap: swap && { wanted: modelName(swap.wanted), model: modelName(swap.model) },
        by: by.label ? { ...by, trail: by.trail.slice(-4) } : null,
      });
      if (isCur(ac)) bumpStat({ outcome: "done" });
      maybeFold(sid);
      refreshModels();
    } catch (e) {
      /* 여기까지 받은 답은 무슨 일이 있어도 지우지 않는다. [중단]을 눌렀을 때는 원래 남겼는데,
         스트림이 끊겨서 온 예외는 text 를 ""로 덮어쓰고 있었다 — 잘 나오던 답이 통째로
         사라지고 "답을 받지 못했습니다"만 남았다. 아이패드에서 망이 잠깐 끊기거나 앱을
         나갔다 오면 늘 이 경로다. 서버 로그에는 아무것도 안 남는다(연결만 끊긴 것이라). */
      const stopped = e.name === "AbortError";
      if (isCur(ac)) bumpStat({ outcome: stopped ? "stopped" : "error", err: e.message });
      sp.settle({
        text: buf,
        live: false,
        stopped: stopped && !!buf,
        // 답이 이미 있으면 "못 받았다"가 아니라 "여기서 끊겼다"가 맞는 말이다
        err: stopped ? "" : e.message,
      });
    } finally {
      endJob(ac);
      setAsking(false);
      relayAsk({ sid, i: idx, done: true }, true);
    }
  };

  /* ── 다른 기기(폰)가 남긴 질문에 답한다 ──
     답 자리가 pending 인데 아무도 맡지 않았으면(또는 맡은 기기가 3분 넘게 조용하면) 이 창이 맡는다.
     문서가 열려 있어야 한다 — 책 본문을 쥔 게 이 창이기 때문이다. 한 번에 하나씩, 내 질문이 도는 중이면 기다린다. */
  const peerBusy = useRef(new Set());
  useEffect(() => {
    if (authed !== true || asking || !numPages) return;
    for (const s of sessions) {
      const i = s.msgs.length - 1;
      const a = s.msgs[i], q = s.msgs[i - 1];
      if (!a || a.role !== "ai" || !a.pending || a.live || a.text || q?.role !== "me") continue;
      if (a.claim && a.claim !== deviceRef.current && Date.now() - (a.claimAt || 0) < 180_000) continue;
      const key = s.id + ":" + i;
      if (peerBusy.current.has(key)) continue;
      peerBusy.current.add(key);
      sapi(`/api/remote/sessions/${s.id}/msgs/${i}/claim`, "POST", { by: deviceRef.current })
        .then(() => {
          mapSess(s.id, (x) => ({ ...x, msgs: x.msgs.map((m, k) => (k === i ? { ...m, live: true } : m)) }));
          return answerInto(s.id, i, q.text, histOf(s.id, i - 1), { img: q.img || "", model: q.model });
        })
        .catch(() => {})
        .finally(() => peerBusy.current.delete(key)); // 폰에서 [다시 답변]을 누르면 같은 자리가 다시 pending 이 된다
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, asking, authed, numPages]);

  /* ── 긴 대화 접기 ──
     최근 FOLD_KEEP 개 메시지(6문답)는 그대로 두고, 그보다 오래된 것이 2문답 이상 쌓이면 요약 하나로 접는다.
     답이 끝난 뒤 뒤에서 조용히 돈다 — 다음 질문이 기다리지 않게. 탭 쪽(속생각 끈 빠른 모델, NIM 먼저)으로
     불러 Gemini 한도를 안 쓴다. 실패하면 그냥 안 접힌 채로 둔다(서버가 최근 16턴만 남기는 예전 동작). */
  const FOLD_KEEP = 12;
  const foldBusy = useRef(new Set());
  const maybeFold = async (sid) => {
    const s = findSess(sid);
    if (!s || foldBusy.current.has(sid)) return;
    const from = s.sum ? s.sumTo : 0;
    const end = s.msgs.length - FOLD_KEEP;
    if (end - from < 4) return;
    const chunk = s.msgs.slice(from, end)
      .filter((m) => (m.hist || m.text || "").trim())
      .map((m) => (m.role === "me" ? "학생: " : "튜터: ") + (m.hist || m.text).slice(0, 6000))
      .join("\n\n");
    foldBusy.current.add(sid);
    try {
      const { text } = await callServer(cfgRef.current, SYS_FOLD,
        (s.sum ? `[지금까지의 요약]\n${s.sum}\n\n` : "") + `[새로 접을 문답]\n${chunk}`,
        undefined, undefined, { maxTokens: 1500 });
      if (text.trim() && findSess(sid)) patchSess(sid, { sum: text.trim().slice(0, 4000), sumTo: end });
    } catch (e) {
      console.warn("[여백] 대화 접기 실패:", e.message);
    } finally {
      foldBusy.current.delete(sid);
    }
  };


  const toggleRemote = () => {
    const v = !remoteOn;
    setRemoteOn(v);
    fetch(u("/api/remote/mode"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: v }),
    }).catch(() => {});
  };

  /* ── 영역 캡처 ──
     모드에 들어가면 .vb-view 위에 오버레이가 덮이고 입력을 독점한다. 그래서 탭 판정·핀치·
     스크롤 핸들러와 경쟁하지 않고, 텍스트 레이어의 data-off 오프셋 기계도 건드리지 않는다
     (픽셀만 읽으므로 스캔 PDF 처럼 텍스트가 없는 문서에서도 그대로 동작한다).
     좌표는 오버레이 기준(capSel)으로 두고, 자를 때만 페이지 실측 사각형으로 환산한다. */
  const CAP_TARGET = 1400;      // 크롭 긴 변 목표 픽셀 — 작은 수식도 읽히도록
  const CAP_MAXPX = 4_000_000;  // 아이패드 사파리가 캔버스를 조용히 비우지 않도록 총 픽셀 상한
  const CAP_MIN = 16;           // 이보다 작으면 스친 것으로 보고 선택을 버린다
  const [capMode, setCapMode] = useState(false);
  const [capBox, setCapBox] = useState(null); // 오버레이 위치 = .vb-view 실측 사각형
  const [capSel, setCapSel] = useState(null); // {x,y,w,h} 오버레이 기준
  const [capBusy, setCapBusy] = useState("");
  const capDragRef = useRef(null);
  const capAbort = useRef(null);
  const capModeRef = useRef(false); // 애플펜슬 이펙트가 리렌더마다 다시 걸리지 않고 최신 capMode 를 읽는 용도
  useEffect(() => { capModeRef.current = capMode; }, [capMode]);
  const [penCapture, setPenCapture] = useState(true); // 애플펜슬로 그으면 자동 캡처(사파리 전용)
  const penCaptureRef = useRef(penCapture);
  // 필기 모드 — 켜면 애플펜슬은 필기, 끄면 위의 펜 캡처. 나머지 필기 상태는 아래 "필기(잉크)" 절
  const [inkOn, setInkOn] = useState(false);
  const inkOnRef = useRef(false);
  useEffect(() => { inkOnRef.current = inkOn; }, [inkOn]);
  /* 작은 노트(src/MiniNote.jsx) — 세 손가락으로 위로 쓸면 열고, 아래로 쓸면 닫는다.
     창 어디서든(본문·작은 노트 위) 받도록 window 에 건다. 서재 화면에선 안 연다. */
  const [miniOpen, setMiniOpen] = useState(false);
  const inLibRef = useRef(true);
  useEffect(() => {
    let s0 = null, done = false;
    const avg = (t) => {
      let x = 0, y = 0;
      for (const p of t) { x += p.clientX; y += p.clientY; }
      return [x / t.length, y / t.length];
    };
    const onS = (e) => {
      if (e.touches.length === 3) { s0 = avg(e.touches); done = false; }
      else if (e.touches.length > 3) s0 = null; // 네 손가락 이상은 iPadOS 몫
    };
    const onM = (e) => {
      if (!s0 || done || e.touches.length !== 3 || inLibRef.current) return;
      const [x, y] = avg(e.touches);
      const dx = x - s0[0], dy = y - s0[1];
      if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) { done = true; setMiniOpen(dy < 0); }
    };
    const onE = (e) => { if (!e.touches.length) s0 = null; };
    const o = { passive: true, capture: true };
    window.addEventListener("touchstart", onS, o);
    window.addEventListener("touchmove", onM, o);
    window.addEventListener("touchend", onE, o);
    window.addEventListener("touchcancel", onE, o);
    return () => {
      window.removeEventListener("touchstart", onS, o);
      window.removeEventListener("touchmove", onM, o);
      window.removeEventListener("touchend", onE, o);
      window.removeEventListener("touchcancel", onE, o);
    };
  }, []);
  useEffect(() => { penCaptureRef.current = penCapture; }, [penCapture]);
  const [penSel, setPenSel] = useState(null); // 펜 드래그 중 미리보기(.vb-view 기준, pointer-events:none)

  const measureCap = () => {
    const r = viewRef.current?.getBoundingClientRect();
    if (r) setCapBox({ left: r.left, top: r.top, width: r.width, height: r.height });
  };
  /* NIM 모델은 한동안 안 쓰면 콜드스타트가 있다 — 실측으로 식었을 때 비전 52초·질문 탭 44초,
     데워지면 각각 2.3초·1초대. 모드에 들어가면 사용자가 영역을 그리는 몇 초가 생기므로
     그 사이에 미리 깨운다. 문제풀이는 비전 → 질문 탭 모델을 연달아 쓰므로 둘 다 건드린다.
     실패해도 무시한다(어차피 본 요청이 다시 시도한다). */
  const warmRef = useRef(0);
  const warmModels = () => {
    if (Date.now() - warmRef.current < 5 * 60 * 1000) return;
    warmRef.current = Date.now();
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const c = cv.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 1, 1);
    const poke = (body) =>
      fetch(u("/api/chat"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: "ok", user: ".", maxTokens: 1, ...body }),
      }).then((r) => r.body?.cancel()).catch(() => {});
    poke({ image: cv.toDataURL("image/jpeg").split(",")[1] }); // 비전 모델
    poke({ ask: true, model: cfgRef.current.askModel || "" }); // 풀이 담당 모델
  };
  /* continueSid 를 넘기면 이번 캡처의 "질문" 은 새 세션이 아니라 그 세션에 이어 붙는다.
     질문 탭에서 대화 중에 "＋ 오려내기" 를 누른 경우가 이거다 — 지금 보고 있는 대화에
     그림 하나를 새로 얹고 싶은 거지, 그 문제만 따로 새 대화를 열고 싶은 게 아니다.
     해석·문제풀이는 여전히 늘 새 세션이다(다른 문제의 조건이 섞이면 안 되므로) — 아래
     runCapture 참고. 인자를 안 주면(툴바 버튼·펜슬 제스처) null 로 리셋돼 원래대로 돈다. */
  const capContinueRef = useRef(null);
  const enterCap = (continueSid = null) => {
    capContinueRef.current = continueSid;
    measureCap(); setCapSel(null); setCapBusy(""); setCapMode(true);
    warmModels();
  };
  const exitCap = () => {
    capAbort.current?.abort();
    setCapMode(false); setCapSel(null); setCapBusy("");
    capDragRef.current = null;
  };
  // 모드 중에 창이 바뀌면 오버레이도 따라가야 한다. Escape 로 빠져나온다.
  useEffect(() => {
    if (!capMode) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); exitCap(); } };
    window.addEventListener("resize", measureCap);
    window.addEventListener("orientationchange", measureCap);
    window.addEventListener("keydown", onKey, true); // 캡처 단계에서 먼저 먹는다
    return () => {
      window.removeEventListener("resize", measureCap);
      window.removeEventListener("orientationchange", measureCap);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [capMode]);

  /* ── 애플펜슬로 그으면 캡처 ──
     이 기능은 세 번 헛짚고 나서야 제자리를 찾았다. 남은 함정이 전부 여기 적혀 있다.

     1) 제스처 도중에 DOM 을 건드리면 안 된다. 예전엔 그리는 도중에 바로 진짜 캡처
        오버레이(.vb-cap, touch-action:none, position:fixed)를 띄웠는데, 누르고 있는 지점 위에
        touch-action:none 인 요소가 새로 올라오면 사파리가 진행 중인 터치 시퀀스를 통째로
        취소한다 — 펜을 뗐다 다시 대지 않는 한 같은 제스처로는 다시 안 잡힌다.
        그래서 드래그 중에는 pointer-events:none 인 시각 미리보기(penSel)만 갱신하고,
        펜을 뗀 뒤에야 enterCap() 으로 진짜 오버레이를 띄운다.

     2) 포인터 이벤트로는 스크롤을 못 막는다. iOS 의 PointerEvent 는 터치 이벤트에서 파생된
        호환 이벤트라서 pointermove 의 preventDefault() 로는 네이티브 스크롤이 안 멈춘다
        (그래서 "드래그가 아예 안 된다" — 실은 페이지가 스크롤되고 있었다). 게다가
        .vb-view 는 touch-action:pan-x pan-y 라 첫 move 시점엔 이미 스크롤이 시작돼 있어
        그때 막아도 늦다. 그래서 touchstart 단계에서 preventDefault() 로 스크롤이 시작조차
        못 하게 한다. 펜 판별은 웹킷 전용 Touch.touchType === "stylus" 로 한다
        (PointerEvent.pointerType 과 달리 터치 이벤트 쪽에서 바로 읽을 수 있다).

     3) .vb-view 에 non-passive pointermove 를 걸면 핀치줌이 깨진다. 그렇게 걸었더니
        "핀치할 때 페이지가 몇 장씩 넘어가는" 예전 버그가 되살아났다 — 브라우저의 스크롤
        판정 경로가 바뀌면서 핀치 핸들러가 기대는 touchmove 의 e.cancelable 전제가 무너진다.
        그래서 여기서는 포인터 이벤트를 아예 쓰지 않고 터치 이벤트만 쓴다.

     손가락과는 부딪히지 않는다: 펜은 touchType 으로 갈라내고, 핀치는 두 손가락일 때만
     동작하므로(여기는 한 손가락짜리 stylus 만 받는다) 서로 배타적이다. */
  useEffect(() => {
    const view = viewRef.current;
    // 꺼져 있으면 리스너를 아예 안 붙인다 — non-passive 터치 리스너의 존재 자체가
    // 핀치줌의 e.cancelable 판정에 영향을 줄 수 있어서, 껐을 때는 예전과 100% 같은 상태여야 한다
    if (!view || !IS_SAFARI || !penCapture || inkOn) return; // 필기 모드면 펜은 필기 몫
    let pend = null; // {x0, y0}

    const isPen = (e) =>
      e.touches.length === 1 && e.touches[0].touchType === "stylus";

    const onStart = (e) => {
      pend = null;
      if (capModeRef.current || !isPen(e)) return;
      // 여기서 막아야 스크롤이 시작조차 안 한다 — touchmove 에서 막으면 이미 늦다
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      pend = { x0: t.clientX, y0: t.clientY };
    };
    /* 미리보기는 .vb-cap 과 같은 화면 고정(fixed) 좌표로 들고 있는다 —
       .vb-view 안에 absolute 로 넣으면 스크롤 컨테이너라 스크롤된 만큼 어긋난다. */
    const onMove = (e) => {
      if (!pend || !isPen(e)) return;
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      const r = view.getBoundingClientRect();
      const cx = (v) => Math.max(r.left, Math.min(r.right, v));
      const cy = (v) => Math.max(r.top, Math.min(r.bottom, v));
      const x0 = cx(pend.x0), y0 = cy(pend.y0);
      const x1 = cx(t.clientX), y1 = cy(t.clientY);
      setPenSel({
        left: Math.min(x0, x1), top: Math.min(y0, y1),
        w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
      });
    };
    const onEnd = () => {
      if (!pend) return;
      pend = null;
      setPenSel((sel) => {
        if (sel && sel.w >= CAP_MIN && sel.h >= CAP_MIN) {
          // capSel 은 오버레이(=.vb-view 실측 사각형) 기준이라 화면 좌표에서 되돌려 준다
          const r = view.getBoundingClientRect();
          enterCap();                // 이제서야 오버레이를 띄운다 — 제스처는 이미 끝났다
          capDragRef.current = null; // 크기 조절(핸들)은 이제부터 새 조작이니 비워 둔다
          setCapSel({ x: sel.left - r.left, y: sel.top - r.top, w: sel.w, h: sel.h });
        }
        return null; // 미리보기는 항상 치운다
      });
    };
    const onCancel = () => { pend = null; setPenSel(null); };

    view.addEventListener("touchstart", onStart, { passive: false });
    view.addEventListener("touchmove", onMove, { passive: false });
    view.addEventListener("touchend", onEnd, { passive: true });
    view.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      view.removeEventListener("touchstart", onStart);
      view.removeEventListener("touchmove", onMove);
      view.removeEventListener("touchend", onEnd);
      view.removeEventListener("touchcancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penCapture, inkOn]);

  /* ───────── 필기(잉크) ─────────
     획 데이터는 annotsRef(ref)에만 있다 — 긋는 동안 React 리렌더 0회. 좌표계·획 모양은 src/ink.js 머리말.
     화면: 쪽마다 svg.vb-ink.hl(형광펜, multiply) + svg.vb-ink.pen 두 장(벡터)이 pdf 캔버스 위·텍스트 레이어
     아래에 깔린다(renderPage → paintInk). 긋는 중인 획만 화면에 고정된 '젖은' 캔버스(.vb-wet)에
     입력 이벤트 안에서 곧바로 그리고(rAF 도 안 기다린다), 펜을 떼면 쪽 SVG 에 path 하나로 옮긴다.
     저장은 쪽 단위 PUT 을 800ms 디바운스 — 굿노트에서 온 쪽은 1300획·1MB 가까이 된다. */
  const [inkTool, setInkTool] = useState("pen");               // pen | hl | eraser | lasso
  const [inkPen, setInkPen] = useState(() => inkToolCfg(null, INK_PEN_W, INK_PEN_COLORS));
  const [inkHl, setInkHl] = useState(() => inkToolCfg(null, INK_HL_W, INK_HL_COLORS));
  const inkCfgRef = useRef({ tool: "pen", pen: inkToolCfg(null, INK_PEN_W, INK_PEN_COLORS), hl: inkToolCfg(null, INK_HL_W, INK_HL_COLORS) });
  const [inkWEdit, setInkWEdit] = useState(false); // 굵기 슬라이더가 열려 있나(고른 칸을 한 번 더 누르면 열린다)
  useEffect(() => { if (!inkOn) setInkWEdit(false); }, [inkOn]);
  const annotsRef = useRef(null);            // {id, imported, pages:{n:[stroke]}} — null 이면 필기 불가
  const inkHistRef = useRef({ undo: [], redo: [] });
  const [inkHist, setInkHist] = useState({ u: 0, r: 0 });
  const [inkSel, setInkSel] = useState(null); // 올가미로 고른 획 {n, ids:Set, box:[x0,y0,x1,y1]}
  const inkSelRef = useRef(null);
  const inkDirtyRef = useRef(new Set());
  const inkTimerRef = useRef(0);
  const wetIdleRef = useRef(null);           // 젖은 캔버스를 비우고 선택 상자만 다시 그린다(이펙트가 채움)
  const [inkErr, setInkErr] = useState("");
  const miniApiRef = useRef(null);           // 작은 노트(MiniNote)의 실행취소 창구

  const setInkCfg = (patch) => {
    const k = { ...inkCfgRef.current, ...patch };
    inkCfgRef.current = k;
    setInkTool(k.tool); setInkPen(k.pen); setInkHl(k.hl);
    persist();
  };

  const inkStrokes = (n) => annotsRef.current?.pages?.[n] || [];

  const setSel = (sel) => {
    inkSelRef.current = sel;
    setInkSel(sel);
    wetIdleRef.current?.();
  };

  const resetInk = () => {
    inkHistRef.current = { undo: [], redo: [] };
    setInkHist({ u: 0, r: 0 });
    inkSelRef.current = null;
    setInkSel(null);
    setInkErr("");
  };

  /* 쪽 n 의 필기를 SVG 두 장(형광펜 multiply / 펜)으로 통째로 새로 만들어 바꿔 끼운다.
     viewBox 가 배율 1 좌표라 확대·relayout 때 다시 그릴 필요가 없다(벡터).
     hide = 그리지 않을 획 id(올가미로 끄는 중) */
  const SVGNS = "http://www.w3.org/2000/svg";
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
  const paintInk = (n, hide) => {
    const el = pagesRef.current[n - 1];
    if (!el) return;
    const old = el.querySelectorAll("svg.vb-ink");
    const strokes = inkStrokes(n);
    const w1 = +el.dataset.w1, h1 = +el.dataset.h1;
    if (!strokes.length || !w1 || !h1) { old.forEach((c) => c.remove()); return; }
    const mk = (cls) => {
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "vb-ink " + cls);
      svg.setAttribute("viewBox", `0 0 ${w1} ${h1}`);
      svg.setAttribute("preserveAspectRatio", "none");
      return svg;
    };
    const hl = mk("hl"), pen = mk("pen");
    for (const s of strokes) if (!hide?.has(s.id)) (s.t === "hl" ? hl : pen).appendChild(inkPathEl(s));
    const tl = el.querySelector(".vb-tl");
    el.insertBefore(hl, tl);
    el.insertBefore(pen, tl);
    old.forEach((c) => c.remove());
  };

  /* 획 하나만 덧붙인다 — 새 획마다 1300획을 다 다시 만들지 않게 */
  const drawInkOne = (n, s) => {
    const el = pagesRef.current[n - 1];
    const svg = el?.querySelector("svg.vb-ink." + (s.t === "hl" ? "hl" : "pen"));
    if (!svg) { paintInk(n); return; }
    svg.appendChild(inkPathEl(s));
  };

  const flushInk = async () => {
    clearTimeout(inkTimerRef.current);
    const a = annotsRef.current;
    const dirty = [...inkDirtyRef.current];
    inkDirtyRef.current.clear();
    if (!a?.id || !dirty.length) return;
    await Promise.all(dirty.map((n) =>
      libApi(`/api/library/file/${a.id}/annots/${n}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokes: a.pages[n] || [] }),
      }).then(() => setInkErr("")).catch((e) => {
        if (e.name === "AuthError") return;
        if (annotsRef.current === a) inkDirtyRef.current.add(n); // 다음 저장 때 다시 보낸다
        setInkErr("필기를 저장하지 못했습니다 — " + e.message);
      })
    ));
  };
  const markInk = (n) => {
    inkDirtyRef.current.add(n);
    // 작은 노트에 같은 문서가 떠 있으면 그 쪽도 다시 그린다(데이터는 같은 객체라 그리기만)
    const mini = miniApiRef.current;
    if (mini && annotsRef.current && mini.id() === annotsRef.current.id) mini.repaint(n);
    clearTimeout(inkTimerRef.current);
    inkTimerRef.current = setTimeout(flushInk, 800);
  };
  // 앱 전환·홈 화면으로 나갈 때 기다리던 저장을 바로 보낸다
  useEffect(() => {
    const on = () => { if (document.visibilityState !== "visible") flushInk(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const loadAnnots = async (id) => {
    try {
      const j = await (await libApi(`/api/library/file/${id}/annots`)).json();
      return { id, imported: !!j.imported, pages: j.pages || {} };
    } catch (e) {
      // 못 읽었는데 쓰게 두면 그 쪽의 서버 필기를 빈 쪽으로 덮어쓴다 — 아예 막는다
      if (e.name !== "AuthError") setInkErr("필기를 불러오지 못했습니다 — " + e.message);
      return null;
    }
  };

  /* 필기 데이터는 문서마다 **한 벌**만 메모리에 둔다 — 본문과 작은 노트가 같은 문서를 열면 같은 객체를
     나눠 쓴다. 따로 받으면 두 곳이 각자 옛 쪽 내용을 PUT 해서 서로의 획을 지운다(그래서 예전엔 작은 노트에서
     본문 문서를 못 열게 막았다). 같은 객체면 어느 쪽이 보내든 늘 최신 쪽 전체가 간다.
     쓰는 곳이 하나도 없으면 버린다 — 다음에 열 때 서버에서 새로 받는다. */
  const annStoreRef = useRef(new Map()); // id → { n: 쓰는 곳 수, p: Promise<ann|null> }
  const acquireAnn = (id) => {
    const m = annStoreRef.current;
    let e = m.get(id);
    if (!e) {
      e = { n: 0, p: loadAnnots(id) };
      m.set(id, e);
      e.p.then((a) => { if (!a && m.get(id) === e) m.delete(id); }); // 실패는 남기지 않는다 — 다음에 다시 받는다
    }
    e.n++;
    return e.p;
  };
  const releaseAnn = (id) => {
    const m = annStoreRef.current, e = m.get(id);
    if (e && --e.n <= 0) m.delete(id);
  };
  // 본문의 필기 데이터를 바꿔 끼운다(앞 것은 놓는다). ann 은 acquireAnn 으로 받은 것이어야 한다.
  const setMainAnn = (ann) => {
    const old = annotsRef.current;
    if (old && old !== ann) releaseAnn(old.id);
    annotsRef.current = ann;
  };
  /* 로컬 파일을 열면 업로드가 끝나야 id 가 생긴다 — 그때 필기를 붙인다(같은 PDF 를 다시 올린 경우
     서재에 있던 필기가 돌아온다). 주석을 가져온 문서면 원본 주석을 끈 채 다시 그려야 한다. */
  const attachAnnots = async (id) => {
    const ann = await acquireAnn(id);
    if (!ann) return;
    if (curFileRef.current?.id !== id) { releaseAnn(id); return; }
    setMainAnn(ann);
    const ns = [...renderedRef.current];
    if (ann.imported) {
      renderedRef.current.clear();
      ns.forEach((n) => renderPage(n));
    } else ns.forEach((n) => paintInk(n));
  };

  /* ── 실행취소 ── op: add{n,s} · del{n,items:[{s,i}]} · move{n,ids,dx,dy} · color{n,ids,from,to}
     del 의 items 는 지운 순서대로 쌓이고, 되돌릴 땐 거꾸로 제자리(i)에 꽂는다 — 그러면 지우개로
     여러 번에 걸쳐 지운 것도 정확히 원래 순서로 돌아온다. */
  const inkApply = (op, dir) => {
    if (op.mini) { miniApiRef.current?.apply(op, dir); return; } // 작은 노트의 획
    const a = annotsRef.current;
    if (!a) return;
    const list = (a.pages[op.n] ||= []);
    const idx = (id) => list.findIndex((s) => s.id === id);
    if (op.k === "add") {
      if (dir > 0) list.push(op.s);
      else { const i = idx(op.s.id); if (i >= 0) list.splice(i, 1); }
    } else if (op.k === "del") {
      if (dir > 0) for (const { s } of op.items) { const i = idx(s.id); if (i >= 0) list.splice(i, 1); }
      else for (const { s, i } of [...op.items].reverse()) list.splice(Math.min(i, list.length), 0, s);
    } else if (op.k === "move") {
      const dx = op.dx * dir, dy = op.dy * dir;
      for (const s of list) if (op.ids.has(s.id))
        s.pts = s.pts.map((p) => (p.length > 2 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy]));
    } else if (op.k === "color") {
      for (const s of list) if (op.ids.has(s.id)) s.c = dir > 0 ? op.to : op.from[s.id];
    }
    if (!list.length) delete a.pages[op.n];
    paintInk(op.n);
    markInk(op.n);
  };
  const inkPush = (op) => {
    const h = inkHistRef.current;
    h.undo.push(op);
    if (h.undo.length > 300) h.undo.shift();
    h.redo = [];
    setInkHist({ u: h.undo.length, r: 0 });
  };
  const inkUndo = () => {
    const h = inkHistRef.current;
    const op = h.undo.pop();
    if (!op) return;
    setSel(null);
    inkApply(op, -1);
    h.redo.push(op);
    setInkHist({ u: h.undo.length, r: h.redo.length });
  };
  const inkRedo = () => {
    const h = inkHistRef.current;
    const op = h.redo.pop();
    if (!op) return;
    setSel(null);
    inkApply(op, 1);
    h.undo.push(op);
    setInkHist({ u: h.undo.length, r: h.redo.length });
  };

  const selBox = (strokes) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) {
      const b = inkBox(s);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    return [x0, y0, x1, y1];
  };
  const inkSelDelete = () => {
    const sel = inkSelRef.current;
    const list = annotsRef.current?.pages?.[sel?.n];
    if (!sel || !list) return;
    const items = [];
    for (let i = list.length - 1; i >= 0; i--) if (sel.ids.has(list[i].id)) items.push({ s: list.splice(i, 1)[0], i });
    if (!list.length) delete annotsRef.current.pages[sel.n];
    if (items.length) inkPush({ k: "del", n: sel.n, items });
    setSel(null);
    paintInk(sel.n);
    markInk(sel.n);
  };
  const inkSelColor = (c) => {
    const sel = inkSelRef.current;
    if (!sel) return;
    const from = {};
    for (const s of inkStrokes(sel.n)) if (sel.ids.has(s.id)) from[s.id] = s.c;
    const op = { k: "color", n: sel.n, ids: sel.ids, from, to: c };
    inkApply(op, 1);
    inkPush(op);
  };

  const inkExport = async () => {
    const id = annotsRef.current?.id;
    if (!id) return;
    await flushInk();
    const a = document.createElement("a");
    a.href = u(`/api/library/file/${id}?dl=1&annots=1`);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* ── 입력 ──
     역할을 둘로 나눈다.
     - 시작·끝·스크롤 차단은 **터치 이벤트**: stylus 만, touchstart 에서 preventDefault(펜 캡처와 같은 원칙 —
       포인터 이벤트의 preventDefault 로는 iOS 스크롤이 안 멈춘다).
     - 좌표는 **포인터 이벤트(passive)** 에서 받는다. 터치 이벤트는 화면 주사율(60~120Hz)로만 오는데,
       Safari 18.2+ 의 pointermove 는 getCoalescedEvents() 로 펜슬의 240Hz 샘플을 다 주고
       getPredictedEvents() 로 OS 가 예측한 앞쪽 점도 준다. 처음 터치 이벤트만 썼을 땐 곡선이 꺾여 보이고
       획이 펜 끝에서 5mm 쯤 뒤처졌다(2026-09-23 실기기). passive 라 핀치 판정(e.cancelable)도 안 건드린다
       — 핀치를 깨뜨렸던 건 non-passive pointermove 였다(펜 캡처 주석 3).
       포인터 이벤트가 안 오는 브라우저면 touchmove 좌표로 그대로 그린다(cur.ptr 가 false 인 동안).
     필기 모드가 꺼지면 리스너 자체를 뗀다. 손가락은 전혀 안 건드린다 — 스크롤·핀치·단어 탭이 그대로다.
     마우스·데스크톱 펜은 터치 화면이 아닐 때만 포인터 이벤트로 시작·끝까지 받는다. */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !inkOn) return;
    const wet = document.createElement("canvas");
    wet.className = "vb-wet";
    // body 에 붙인다 — .vb-pages 는 will-change:transform 이라 그 안의 fixed 는 화면 고정이 안 된다
    document.body.appendChild(wet);
    let ctx = null, vr = null, dpr = 1, cur = null;

    const fit = () => {
      const r = view.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!vr || r.left !== vr.left || r.top !== vr.top || r.width !== vr.width || r.height !== vr.height) {
        Object.assign(wet.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
        wet.width = Math.round(r.width * dpr);
        wet.height = Math.round(r.height * dpr);
        ctx = wet.getContext("2d", { desynchronized: true });
      }
      vr = r;
      // 야간 반전이면 쪽 캔버스와 같은 색으로 보이게 — 안 그러면 펜을 떼는 순간 색이 뒤집힌다
      wet.style.filter = invertRef.current ? "invert(1) hue-rotate(180deg)" : "";
    };
    const geo = (n) => {
      const el = pagesRef.current[n - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const w1 = +el.dataset.w1 || baseRef.current?.w;
      return w1 ? { r, k: r.width / w1 } : null;
    };
    const wk = (g) => [g.k * dpr, (g.r.left - vr.left) * dpr, (g.r.top - vr.top) * dpr];

    const drawBox = (b, g, dx = 0, dy = 0) => {
      const [k, ox, oy] = wk(g);
      const pad = 5 * dpr;
      const x = (b[0] + dx) * k + ox - pad, y = (b[1] + dy) * k + oy - pad;
      const w = (b[2] - b[0]) * k + pad * 2, h = (b[3] - b[1]) * k + pad * 2;
      ctx.save();
      ctx.fillStyle = "rgba(37,99,235,.07)";
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    };
    const idle = (skipSel) => {
      if (!ctx) fit();
      ctx.clearRect(0, 0, wet.width, wet.height);
      const sel = inkSelRef.current;
      if (sel && !skipSel) { const g = geo(sel.n); if (g) drawBox(sel.box, g); }
    };
    wetIdleRef.current = () => idle();

    const render = (pred) => {
      if (!cur) { idle(); return; }
      idle(cur.kind === "drag");
      const g = geo(cur.n);
      if (!g) return;
      const [k, ox, oy] = wk(g);
      if (cur.kind === "draw") {
        const s = cur.s, P = s.pts;
        let ds = s;
        // 예측 꼬리 — 펜이 곧 갈 자리를 임시로 이어 그린다(다음 이벤트에 진짜 점으로 바뀐다).
        // OS 예측(getPredictedEvents)이 있으면 그걸, 없으면 마지막 속도로 한 이벤트만큼.
        if (!cur.snapped && pred?.length) ds = { ...s, pts: [...P, ...pred] };
        else if (!cur.snapped && P.length >= 2) {
          const a = P[P.length - 2], b = P[P.length - 1];
          ds = { ...s, pts: [...P, [b[0] + (b[0] - a[0]) * 0.8, b[1] + (b[1] - a[1]) * 0.8]] };
        }
        drawStroke(ctx, ds, k, ox, oy);
      } else if (cur.kind === "erase" && cur.at) {
        ctx.save();
        ctx.strokeStyle = "rgba(120,120,120,.9)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(cur.at[0] * k + ox, cur.at[1] * k + oy, cur.r * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (cur.kind === "lasso") {
        ctx.save();
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        cur.poly.forEach((p, i) => (i ? ctx.lineTo(p[0] * k + ox, p[1] * k + oy) : ctx.moveTo(p[0] * k + ox, p[1] * k + oy)));
        ctx.stroke();
        ctx.restore();
      } else if (cur.kind === "drag") {
        for (const s of cur.strokes) drawStroke(ctx, s, k, ox + cur.dx * k, oy + cur.dy * k);
        drawBox(inkSelRef.current.box, g, cur.dx, cur.dy);
      }
    };

    const eraseAt = (pt) => {
      const list = annotsRef.current?.pages?.[cur.n];
      cur.at = pt;
      if (!list) return;
      let hit = false;
      for (let i = list.length - 1; i >= 0; i--) {
        if (hitStroke(list[i], pt[0], pt[1], cur.r)) { cur.gone.push({ s: list.splice(i, 1)[0], i }); hit = true; }
      }
      if (hit) {
        if (!list.length) delete annotsRef.current.pages[cur.n];
        paintInk(cur.n);
      }
    };

    const armSnap = () => {
      clearTimeout(cur.still);
      const c = cur;
      c.still = setTimeout(() => {
        if (cur !== c || c.snapped) return;
        const P = c.s.pts, a = P[0], b = P[P.length - 1];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) return; // 짧은 점·획은 펴지 않는다
        c.snapped = true;
        c.s.pts = snapLine(P);
        render();
      }, 450);
    };

    const begin = (x, y) => {
      fit();
      const a = annotsRef.current;
      const n = pageAt(pagesRef.current, y);
      const g = geo(n);
      if (!g || x < g.r.left || x > g.r.right || y < g.r.top || y > g.r.bottom) return false;
      if (!a?.id) { setInkErr("서재에 저장된 문서에만 필기할 수 있습니다."); return false; }
      const pt = [(x - g.r.left) / g.k, (y - g.r.top) / g.k];
      const cfg = inkCfgRef.current;
      const sel = inkSelRef.current;
      if (cfg.tool === "pen" || cfg.tool === "hl") {
        const c = cfg.tool === "pen" ? cfg.pen : cfg.hl;
        const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: cfg.tool, c: c.c, w: c.w, pts: [pt] };
        cur = { kind: "draw", n, s };
        wet.style.mixBlendMode = cfg.tool === "hl" ? "multiply" : "";
        if (sel) setSel(null);
      } else if (cfg.tool === "eraser") {
        cur = { kind: "erase", n, gone: [], r: 9 / g.k }; // 화면에서 반지름 9px
        eraseAt(pt);
      } else {
        const pad = 8 / g.k;
        if (sel && sel.n === n && pt[0] >= sel.box[0] - pad && pt[0] <= sel.box[2] + pad &&
          pt[1] >= sel.box[1] - pad && pt[1] <= sel.box[3] + pad) {
          cur = { kind: "drag", n, p0: pt, dx: 0, dy: 0, strokes: inkStrokes(n).filter((s) => sel.ids.has(s.id)) };
          wet.style.mixBlendMode = "";
          paintInk(n, sel.ids); // 끄는 동안은 쪽에서 빼고 젖은 캔버스에만 그린다
        } else {
          if (sel) setSel(null);
          cur = { kind: "lasso", n, poly: [pt] };
        }
      }
      render();
      return true;
    };

    /* 화면 좌표 → 쪽 좌표. 쪽 위치는 이벤트마다 다시 잰다(g 를 넘겨 한 이벤트 안에선 한 번만) —
       긋는 중에 손바닥이 스크롤을 일으켜도 획이 쪽에 붙어 있게 */
    const toPage = (g, x, y) => [(x - g.r.left) / g.k, (y - g.r.top) / g.k];
    const add = (g, x, y) => {
      const pt = toPage(g, x, y);
      if (cur.kind === "draw") {
        const s = cur.s;
        if (cur.snapped) { s.pts = snapLine([s.pts[0], pt]); return; }
        const l = s.pts[s.pts.length - 1];
        if (Math.abs(pt[0] - l[0]) + Math.abs(pt[1] - l[1]) < 0.04) return;
        s.pts.push(pt);
        if (s.t === "hl") armSnap();
      } else if (cur.kind === "erase") eraseAt(pt);
      else if (cur.kind === "lasso") cur.poly.push(pt);
      else { cur.dx = pt[0] - cur.p0[0]; cur.dy = pt[1] - cur.p0[1]; }
    };

    const end = () => {
      const c = cur;
      cur = null;
      if (!c) return;
      clearTimeout(c.still);
      const a = annotsRef.current;
      if (c.kind === "draw" && a) {
        const s = c.s;
        s.pts = tidyPts(s.pts, 0.04);
        // 펜으로 지그재그를 그어 그 밑 획을 지웠으면, 지그재그 자신은 남기지 않는다
        const gone = s.t === "pen" && isScribble(s.pts) && a.pages[c.n] ? scribbleHits(a.pages[c.n], s) : [];
        if (gone.length) {
          if (!a.pages[c.n].length) delete a.pages[c.n];
          paintInk(c.n);
          inkPush({ k: "del", n: c.n, items: gone });
          markInk(c.n);
          wet.style.mixBlendMode = "";
          render();
          return;
        }
        (a.pages[c.n] ||= []).push(s);
        drawInkOne(c.n, s); // 쪽 캔버스에 먼저 그리고, 같은 틱에 젖은 캔버스를 비운다 → 번쩍임 없음
        inkPush({ k: "add", n: c.n, s });
        markInk(c.n);
      } else if (c.kind === "erase") {
        if (c.gone.length) { inkPush({ k: "del", n: c.n, items: c.gone }); markInk(c.n); }
      } else if (c.kind === "lasso") {
        const poly = c.poly;
        if (poly.length > 2) {
          const pb = polyBox(poly);
          const hits = inkStrokes(c.n).filter((s) => strokeInLasso(s, poly, pb));
          if (hits.length) setSel({ n: c.n, ids: new Set(hits.map((s) => s.id)), box: selBox(hits) });
        }
      } else if (c.kind === "drag") {
        const sel = inkSelRef.current;
        if (sel && Math.abs(c.dx) + Math.abs(c.dy) > 0.01) {
          const op = { k: "move", n: c.n, ids: sel.ids, dx: c.dx, dy: c.dy };
          inkApply(op, 1);
          inkPush(op);
          const b = sel.box;
          setSel({ ...sel, box: [b[0] + c.dx, b[1] + c.dy, b[2] + c.dx, b[3] + c.dy] });
        } else paintInk(c.n);
      }
      wet.style.mixBlendMode = "";
      render();
    };

    // ── 애플펜슬: 시작·끝·스크롤 차단(터치 이벤트) ──
    let tid = null;
    const stylus = (list) => { for (const t of list) if (t.touchType === "stylus") return t; return null; };
    const onTS = (e) => {
      if (cur) { if (e.cancelable) e.preventDefault(); return; } // 긋는 중 닿은 손바닥이 스크롤로 새지 않게
      const t = stylus(e.changedTouches);
      if (!t) return;
      if (begin(t.clientX, t.clientY)) {
        tid = t.identifier;
        if (e.cancelable) e.preventDefault();
      }
    };
    const onTM = (e) => {
      if (!cur || tid == null) return;
      if (e.cancelable) e.preventDefault();
      if (cur.ptr) return; // 좌표는 pointermove 가 더 촘촘히 받고 있다
      const g = geo(cur.n);
      if (!g) return;
      let moved = false;
      for (const t of e.changedTouches) if (t.identifier === tid) { add(g, t.clientX, t.clientY); moved = true; }
      if (moved) render();
    };
    const onTE = (e) => {
      if (!cur || tid == null) return;
      for (const t of e.changedTouches) if (t.identifier === tid) { tid = null; end(); }
    };
    view.addEventListener("touchstart", onTS, { passive: false });
    view.addEventListener("touchmove", onTM, { passive: false });
    view.addEventListener("touchend", onTE, { passive: true });
    view.addEventListener("touchcancel", onTE, { passive: true });

    // ── 좌표(포인터 이벤트) — 애플펜슬은 passive 로 좌표만, 데스크톱은 시작·끝까지 ──
    let pid = null;
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
      if (begin(e.clientX, e.clientY)) {
        pid = e.pointerId;
        e.preventDefault();
        view.setPointerCapture?.(e.pointerId);
      }
    };
    const onPU = (e) => { if (e.pointerId === pid) { pid = null; end(); } };
    view.addEventListener("pointermove", onPM, { passive: true });
    if (!COARSE) {
      view.addEventListener("pointerdown", onPD);
      view.addEventListener("pointerup", onPU);
      view.addEventListener("pointercancel", onPU);
    }

    // 손가락으로 스크롤하면 선택 상자를 따라 옮겨 그린다
    const onScroll = () => { if (!cur && inkSelRef.current) idle(); };
    view.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => { vr = null; fit(); idle(); };
    window.addEventListener("resize", onResize);

    return () => {
      view.removeEventListener("touchstart", onTS);
      view.removeEventListener("touchmove", onTM);
      view.removeEventListener("touchend", onTE);
      view.removeEventListener("touchcancel", onTE);
      view.removeEventListener("pointerdown", onPD);
      view.removeEventListener("pointermove", onPM);
      view.removeEventListener("pointerup", onPU);
      view.removeEventListener("pointercancel", onPU);
      view.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (cur) end();
      wet.remove();
      wetIdleRef.current = null;
      inkSelRef.current = null;
      setInkSel(null);
      flushInk();
    };
  }, [inkOn]);

  // 도구를 바꾸면 올가미 선택은 풀린다
  useEffect(() => { if (inkTool !== "lasso" && inkSelRef.current) setSel(null); }, [inkTool]);

  const capDown = (e) => {
    if (capBusy || !capBox) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX - capBox.left, y = e.clientY - capBox.top;
    const h = e.target.dataset?.caph;
    if (h && capSel) capDragRef.current = { mode: h, x, y, orig: { ...capSel } };
    else if (e.target.classList?.contains("vb-capsel") && capSel)
      capDragRef.current = { mode: "move", x, y, orig: { ...capSel } };
    else { capDragRef.current = { mode: "new", x, y }; setCapSel({ x, y, w: 0, h: 0 }); }
  };
  const capMove = (e) => {
    const d = capDragRef.current;
    if (!d || !capBox) return;
    const x = Math.max(0, Math.min(capBox.width, e.clientX - capBox.left));
    const y = Math.max(0, Math.min(capBox.height, e.clientY - capBox.top));
    if (d.mode === "new") {
      setCapSel({ x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) });
      return;
    }
    const o = d.orig;
    if (d.mode === "move") {
      setCapSel({
        x: Math.max(0, Math.min(capBox.width - o.w, o.x + (x - d.x))),
        y: Math.max(0, Math.min(capBox.height - o.h, o.y + (y - d.y))),
        w: o.w, h: o.h,
      });
      return;
    }
    // 네 꼭지점 — 잡은 반대쪽 모서리를 고정하고 다시 그린다
    const l = d.mode.includes("w") ? x : o.x;
    const r = d.mode.includes("e") ? x : o.x + o.w;
    const t = d.mode.includes("n") ? y : o.y;
    const b = d.mode.includes("s") ? y : o.y + o.h;
    setCapSel({ x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) });
  };
  const capUp = () => {
    const d = capDragRef.current;
    capDragRef.current = null;
    if (d?.mode === "new") setCapSel((s) => (s && (s.w < CAP_MIN || s.h < CAP_MIN) ? null : s));
  };

  /* 선택과 가장 많이 겹치는 페이지를 고른다. 페이지 사이 여백에 걸쳐도 안전하다.
     v1 은 한 페이지로 자른다 — 여러 페이지 합성은 다음 단계. */
  const capPage = (sel) => {
    if (!capBox) return null;
    const L = capBox.left + sel.x, T = capBox.top + sel.y;
    const R = L + sel.w, B = T + sel.h;
    let best = null, bestA = 0;
    pagesRef.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(R, r.right) - Math.max(L, r.left);
      const h = Math.min(B, r.bottom) - Math.max(T, r.top);
      if (w > 0 && h > 0 && w * h > bestA) { bestA = w * h; best = { n: i + 1, r }; }
    });
    return best;
  };

  /* 화면 캔버스를 확대하면 흐려서 모델이 글자를 놓친다.
     그래서 그 영역만 pdf.js 로 고배율 재렌더해서 자른다. */
  const cropRegion = async (sel) => {
    const hit = capPage(sel);
    const pdf = pdfRef.current;
    if (!hit || !pdf) throw new Error("영역이 페이지 위에 없습니다.");
    const { n, r } = hit;
    const L = Math.max(capBox.left + sel.x, r.left), T = Math.max(capBox.top + sel.y, r.top);
    const R = Math.min(capBox.left + sel.x + sel.w, r.right), B = Math.min(capBox.top + sel.y + sel.h, r.bottom);
    const fx = (L - r.left) / r.width, fy = (T - r.top) / r.height;
    const fw = (R - L) / r.width, fh = (B - T) / r.height;
    if (fw <= 0 || fh <= 0) throw new Error("영역이 페이지 위에 없습니다.");

    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const cw = v1.width * fw, ch = v1.height * fh;
    let hi = Math.min(8, Math.max(1, CAP_TARGET / Math.max(cw, ch)));
    if (cw * ch * hi * hi > CAP_MAXPX) hi = Math.sqrt(CAP_MAXPX / (cw * ch));
    const vp = page.getViewport({ scale: hi });
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(vp.width * fw));
    cv.height = Math.max(1, Math.round(vp.height * fh));
    const ctx = cv.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({
      canvasContext: ctx, viewport: vp,
      transform: [1, 0, 0, 1, -vp.width * fx, -vp.height * fy],
    }).promise;
    return { page: n, url: cv.toDataURL("image/jpeg", 0.85) };
  };

  /* 오려내기가 실패하면 질문 탭에 한 쌍(무엇을 하려 했나 + 왜 실패했나)으로 남긴다 */
  const capFail = async (e, what = "영역 오려내기") => {
    setTab("ask"); setSheetOpen(true);
    try {
      const sid = curSessRef.current && findSess(curSessRef.current) ? curSessRef.current : await newSess("영역 캡처");
      addMsgs(sid, [{ role: "me", text: what }, { role: "ai", text: "", err: e.message }]);
    } catch {}
  };

  /* 그림 하나를 대화에 얹는다 — continueSid 가 살아 있으면 그 대화에, 아니면 새 대화를 열어서.
     fig: 이 세션의 질문에는 그림(또는 그 설명)을 딸려 보낸다는 표시 — 위 sendFig effect 참고 */
  const attachFig = async (b64, title, continueSid) => {
    const target = continueSid && findSess(continueSid);
    const sid = target ? target.id : await newSess(title, { fig: true });
    const img = await putImg(sid, b64); // 그림은 서버에 — 폰에서도 이 대화에 붙은 그림이 보인다
    patchSess(sid, { img, imgDesc: "", imgDescFor: "", fig: true }); // 새 그림이 오면 옛 설명은 비운다
    setSendFig(true);
  };
  /* 질문 탭에 붙여넣거나 끌어다 놓은 그림(스크린숏·복사한 그림) — 지금 대화에 얹는다 */
  const pasteFig = async (file) => {
    try {
      const { b64 } = await imageToJpeg(file);
      await attachFig(b64, "붙인 그림", curSessRef.current);
    } catch (e) {
      await capFail(e, "그림 붙이기");
    }
  };

  /* "질문" — 해석/문제풀이처럼 정해진 프롬프트를 바로 쏘지 않고, 오려낸 그림만 새 세션에
     붙여 질문 탭으로 넘긴다. 사용자가 직접 무엇을 물어볼지 타이핑하게 두는 쪽. */
  const runCaptureAsk = async () => {
    if (!capSel || capBusy) return;
    setCapBusy("ask");
    let shot;
    try {
      shot = await cropRegion(capSel);
    } catch (e) {
      exitCap();
      await capFail(e);
      return;
    }
    const b64 = shot.url.split(",")[1];
    exitCap();
    setTab("ask");
    setSheetOpen(true);

    /* 대화 중에 그림만 새로 얹는다 — 앞의 문답은 그대로 두고, 다음 질문부터 이 그림이
       딸려 간다. askLog 에 me/ai 를 넣지 않는다 — qaPairs 가 두 개씩 묶어 읽으므로
       짝 없는 me 하나를 끼우면 그다음 진짜 질문·답이 한 칸씩 밀려 잘못 묶인다.
       첨부 사실은 입력창 위 vb-chip(기존 "그림 함께" 표시)이 그대로 보여준다 —
       새 그림이 오면 그 칩의 썸네일도 자동으로 바뀐다. */
    try {
      await attachFig(b64, `${shot.page}쪽 질문`, capContinueRef.current);
    } catch (e) {
      await capFail(e);
    }
    setCapBusy("");

    /* 미리 옮겨 적지 않는다 — 질문이 오면 sendAsk 가 그림째 Gemini 에게 보내고, Gemini 가 막혔을
       때만 그 자리에서 옮겨 적는다(예전엔 여기서 무조건 비전 모델을 한 번 불렀다). */
  };

  /* kind: "read" = 해석(비전 모델 한 번) / "solve" = 문제풀이(옮겨적기 → 질문 탭 모델이 풀이) */
  const runCapture = async (kind) => {
    if (!capSel || capBusy) return;
    setCapBusy(kind);
    let shot;
    try {
      shot = await cropRegion(capSel);
    } catch (e) {
      // 오버레이(z42)가 시트(z35)를 가리므로, 모드에서 나온 뒤에 알린다
      exitCap();
      await capFail(e);
      return;
    }
    const b64 = shot.url.split(",")[1];
    exitCap();
    setTab("ask");
    setSheetOpen(true);

    const label = kind === "solve" ? "문제풀이" : "해석";

    /* 캡처는 늘 새 세션에서 시작한다. 앞의 대화와 섞이면 모델이 다른 문제의 조건을
       끌어다 쓴다. 오려낸 그림(b64)은 세션에 남겨 둔다 — 후속 질문에서 다시 붙일 수 있게.
       fig 는 문제풀이만 켠다: 후속 질문("이 단계 왜 이래?")이 문제를 다시 봐야 하기 때문이다.
       해석은 번역문이 이미 지난 문답에 남아 그림을 다시 붙일 이유가 없다. */
    let sid, img;
    try {
      sid = await newSess(`${shot.page}쪽 ${label}`, { fig: kind === "solve" });
      img = await putImg(sid, b64);
      patchSess(sid, { img });
    } catch (e) {
      await capFail(e);
      setCapBusy("");
      return;
    }
    const idx = 1; // 방금 연 세션이라 [me, ai] 중 ai 는 1번
    addMsgs(sid, [
      {
        role: "me",
        text: `${shot.page}쪽 영역 — ${label}`,
        img,
        // 화면에 보이는 짧은 라벨 대신, 모델에게는 무엇을 시켰는지 문장으로 남긴다
        hist: kind === "solve"
          ? `[${shot.page}쪽에서 오려낸 문제] 이 문제를 풀어 달라.`
          : `[${shot.page}쪽에서 오려낸 영역] 이 영역을 해석해 달라.`,
      },
      { role: "ai", text: "", live: true },
    ]);
    // 흐르는 동안은 로컬만, 끝(extra 가 있을 때)에 서버로 — 다른 기기에는 relay 로
    const sp = streamPatcher(sid, idx);
    const put = (t, extra) => {
      if (extra) sp.settle({ text: t, ...extra });
      else sp.live({ text: t });
      if (!extra) relayAsk({ sid, i: idx, text: t, run: statRef.current });
    };

    /* 상태 표시줄이 "몇 초째 어느 단계인지"를 대신 알려 준다(모델이 식으면 첫 글자까지 실측 52초).
       중단은 이 ac 하나로 끊는다 — 캡처의 두 단계가 이어 달려도 늘 지금 도는 쪽을 가리킨다. */
    const ac = startJob(sid, kind === "solve" ? "푸는 중" : "해석하는 중");
    capAbort.current = ac;
    const stepped = (name, getChars) => { setStat({ step: name, phase: "send", at: Date.now() }); return phaseHook(ac, getChars); };

    setAsking(true);
    try {
      if (kind === "read") {
        let buf = "";
        await ask(SYS_CAP_READ,
          `[문서: ${docName || "제목 없음"} — ${shot.page}쪽에서 오려낸 영역]\n이 영역을 해석해 달라.`,
          (c) => { buf += c; put(buf); }, ac.signal,
          { image: b64, onPhase: stepped("해석하는 중", () => buf.length) });
        put(buf, { live: false });
      } else {
        /* 먼저 Gemini 에게 그림째 한 번에 맡긴다. 한 글자라도 받았으면 그걸로 끝 —
           막혀서 한 글자도 못 받았을 때만 두 단계로 넘어간다. 후속 질문도 같은 경로를 타도록
           imgDesc 는 비워 둔다(sendAsk 가 그림째 다시 보낸다). */
        let buf = "";
        let direct = false;
        try {
          await ask(SYS_CAP_SOLVE,
            `[문서: ${docName || "제목 없음"} / ${shot.page}쪽에서 오려낸 문제]\n이 그림의 문제를 풀어라.`,
            (c) => { buf += c; put(buf); }, ac.signal,
            { ask: true, image: b64, visionDirect: true, onPhase: stepped("푸는 중", () => buf.length) });
          direct = true;
        } catch (e) {
          if (e.name === "AbortError" || e.name === "AuthError" || buf) throw e;
        }
        if (direct) put(buf, { live: false });
        else {
        // (Gemini 가 막혔을 때) 1단계: 비전 모델이 눈 역할 — 옮겨적기. 읽은 내용을 그대로 보여줘서
        // 모델이 수식을 잘못 읽었을 때 사용자가 바로 알아챌 수 있게 한다.
        let ocr = "";
        await ask(SYS_CAP_DESCRIBE, `[${shot.page}쪽에서 오려낸 영역] 이 이미지를 옮겨 적어라.`,
          (c) => { ocr += c; put(`[읽은 내용]\n${ocr}`); }, ac.signal,
          { image: b64, onPhase: stepped("옮겨적는 중", () => ocr.length) });
        if (!ocr.trim()) throw new Error("이미지에서 글자를 읽지 못했습니다.");
        const head = `[읽은 내용]\n${ocr.trim()}\n\n`;

        /* 옮겨 적은 글은 이 세션의 후속 질문에도 그대로 얹힌다(sendAsk 의 imgDesc). */
        patchSess(sid, { imgDesc: ocr.trim() });

        put(head + "풀이 중…");
        // 2단계: 추론은 질문 탭 모델이 한다 — 이미지 없이 텍스트로.
        buf = "";
        await ask(SYS_CAP_SOLVE,
          `[문서: ${docName || "제목 없음"} / ${shot.page}쪽에서 오려낸 문제]\n` +
          `${FIG_NOTE}\n${ocr.trim()}\n\n위 문제를 풀어라.`,
          (c) => { buf += c; put(head + buf); }, ac.signal,
          { ask: true, onPhase: stepped("푸는 중", () => buf.length) });
        put(head + buf, { live: false });
        }
      }
    } catch (e) {
      // 중단은 사고가 아니다 — 여기까지 받은 내용을 남기고 조용히 끝낸다.
      if (e.name === "AbortError") sp.settle({ live: false, stopped: true });
      else put("", { live: false, err: e.message, stopped: false });
    } finally {
      endJob(ac);
      setAsking(false);
      relayAsk({ sid, i: idx, done: true }, true);
    }
  };

  const readFile = (f) => {
    const r = new FileReader();
    r.onload = async () => {
      const buf = r.result;
      const name = f.name.replace(/\.pdf$/i, "");
      await flushInk();
      curFileRef.current = null;
      setMainAnn(null);
      resetInk();
      setLibOpen(false);
      // pdf.js 가 버퍼를 워커로 가져가 비워 버리므로, 업로드용 원본과 분리한 복사본을 넘긴다
      await loadPDF(new Uint8Array(buf).slice(), name);
      saveToLib(buf, name); // 열면서 서재에도 저장한다 (문서가 로드된 뒤라 표지도 바로 만든다)
    };
    r.readAsArrayBuffer(f);
  };

  /* 파일을 여러 개 고르거나 끌어다 놓았을 때 — 한 번에 읽을 수 있는 문서는 하나뿐이라
     "여는" 건 의미가 없다. 딱 한 개면 기존처럼 열면서 저장하고, 여러 개면 전부 서재에만
     올린다(순서대로, 업로드 진행률 알약이 파일마다 갱신된다). 표지는 기존과 같이
     처음 열 때 만들어진다 — 일괄 업로드에서는 만들지 않는다. */
  const readFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (!files.length) return;
    if (files.length === 1) { readFile(files[0]); return; }
    (async () => {
      setLibErr("");
      let ok = 0, fail = 0;
      for (const f of files) {
        try {
          const buf = await f.arrayBuffer();
          await uploadPDF(buf, f.name.replace(/\.pdf$/i, ""), libFolder);
          ok++;
        } catch (e) {
          if (e.name === "AuthError") return;
          fail++;
        }
      }
      refreshLib();
      if (fail) setLibErr(`${ok}개 추가, ${fail}개는 업로드하지 못했습니다.`);
    })();
  };

  const dragRef = useRef(null);
  const zoomBy = (f) => {
    zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * f));
    setZoomPill(Math.round(zoomRef.current * 100) + "%");
    setTimeout(() => setZoomPill(null), 900);
    persist();
    relayout();
  };

  /* 비밀번호는 숫자 6자리 고정 — 6자리가 다 차면 엔터 없이 바로 확인한다 */
  const submitPw = async (v) => {
    if (pwBusy || !v) return;
    setPwBusy(true);
    setPwErr("");
    try {
      const r = await fetch(u("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: v }),
      });
      if (!r.ok) {
        let d = "";
        try { d = (await r.json()).error || ""; } catch {}
        setPwErr(d || "비밀번호가 맞지 않습니다.");
        setPw("");
        return;
      }
      setPw("");
      setAuthed(true);
    } catch {
      setPwErr("서버에 연결하지 못했습니다.");
    } finally {
      setPwBusy(false);
    }
  };

  /* 화면 키패드 — 입력칸의 포커스를 뺏지 않아야 키보드 입력을 이어서 할 수 있다.
     (터치에서는 click 만 오므로 mousedown 억제로 충분하다) */
  const holdFocus = (e) => e.preventDefault();
  const pwKey = (k) => {
    setPwErr("");
    const nv = k === "del" ? pw.slice(0, -1) : pw.length >= 6 || !/^\d$/.test(k) ? pw : pw + k;
    setPw(nv);
    if (nv.length === 6) submitPw(nv);
    // 터치 기기에서 포커스를 주면 OS 키보드가 올라와 키패드를 가린다.
    if (!COARSE) pwRef.current?.focus();
  };

  const defLabel = models.find((m) => m.id === defModel)?.label || "";
  const askNote = models.find((m) => m.id === (cfg.askModel || defModel))?.note || "";
  const folders = lib.folders; // 서버가 준 배열 순서 그대로 — 사이드바 드래그 정렬이 이 순서를 바꾼다
  const shownFiles = lib.files
    .filter((f) => (f.folder || "") === libFolder)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const recentFiles = [...lib.files]
    .filter((f) => f.lastOpenedAt)
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  const subFolders = folders.filter((fo) => (fo.parent || "") === libFolder);
  const folderTreeList = folderTree(folders);
  const crumbs = []; // 서재 › … › 지금 폴더 — 조상부터
  for (let f = lib.folders.find((x) => x.id === libFolder); f && crumbs.length < 20; f = lib.folders.find((x) => x.id === f.parent))
    crumbs.unshift(f);
  // 파일·폴더를 끌어다 놓은 곳으로 옮긴다("" = 최상위)
  const dropInto = (target) => {
    setDropTgt("");
    if (dragId) moveFile(dragId, target);
    else if (folDragId && folDragId !== target) moveFolder(folDragId, target);
    setFolDragId("");
  };
  const hasKids = (id) => folders.some((f) => f.parent === id);
  const sideTree = (() => {
    const out = [];
    let skip = Infinity; // 접힌 폴더의 깊이 — 그보다 깊은 건 숨긴다
    for (const fo of folderTreeList) {
      if (fo.depth > skip) continue;
      skip = folClosed.has(fo.id) ? fo.depth : Infinity;
      out.push(fo);
    }
    return out;
  })();
  const toggleSide = (v) => {
    setSideOpen(v);
    try { localStorage.setItem("yeobaek.side", v ? "1" : ""); } catch {}
  };
  const goFolder = (id) => { setLibFolder(id); setLibView(""); if (!wide) toggleSide(false); };
  const folCount = (id) =>
    lib.files.filter((f) => f.folder === id).length + lib.folders.filter((f) => f.parent === id).length;
  const folderArt = (
    <svg className="vb-folart" viewBox="0 0 120 92">
      <path className="b" d="M4 12a8 8 0 018-8h28a8 8 0 016 2.7L52 13h56a8 8 0 018 8v59a8 8 0 01-8 8H12a8 8 0 01-8-8z" />
      <path className="f" d="M4 28a8 8 0 018-8h96a8 8 0 018 8v52a8 8 0 01-8 8H12a8 8 0 01-8-8z" />
    </svg>
  );
  // ⋮ → 이동 의 폴더 나무. 지금 있는 곳은 못 누르고, 폴더를 옮길 땐 자기와 그 아래는 뺀다
  const moveTree = (cur, pick, self) => {
    const under = (id) => { for (let a = id; a; a = folders.find((f) => f.id === a)?.parent) if (a === self) return true; return false; };
    return (
      <div className="vb-docsubmenu">
        {[{ id: "", name: "서재", depth: -1 }, ...folderTreeList.filter((fo) => !self || !under(fo.id))].map((fo) => (
          <button key={fo.id || "__root__"} disabled={fo.id === cur} style={{ paddingLeft: 9 + (fo.depth + 1) * 14 }}
            onClick={() => { pick(fo.id); setDocMenuId(""); setDocMoveId(""); }}>
            <Bi name={fo.id ? "folder2" : "collection"} /><span>{fo.name}</span>
          </button>
        ))}
      </div>
    );
  };
  const renderFolderCard = (fo) => {
    const key = "fo:" + fo.id;
    const menuOpen = docMenuId === key;
    const renaming = docRenameId === key;
    return (
      <div key={fo.id} draggable={!renaming}
        className={"vb-mdoc vb-mfol" + (dropTgt === fo.id ? " over" : "") + (folDragId === fo.id ? " drag" : "")}
        onClick={() => !renaming && setLibFolder(fo.id)}
        onDragStart={(e) => {
          setFolDragId(fo.id);
          e.dataTransfer.setData("text/plain", fo.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => { setFolDragId(""); setDropTgt(""); }}
        onDragOver={(e) => { if (dragId || (folDragId && folDragId !== fo.id)) { e.preventDefault(); setDropTgt(fo.id); } }}
        onDragLeave={() => setDropTgt((t) => (t === fo.id ? "" : t))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropInto(fo.id); }}>
        <div className="vb-slot">{folderArt}</div>
        <button className="vb-mmenu" onClick={(e) => {
          e.stopPropagation();
          setDocMenuId(menuOpen ? "" : key); setDocMoveId("");
        }} aria-label="더보기" title="더보기">⋮</button>
        {menuOpen && (
          <div className="vb-docmenu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setDocRenameId(key); setDocRenameVal(fo.name); setDocMenuId(""); }}>이름 바꾸기</button>
            <button onClick={() => setDocMoveId(docMoveId === key ? "" : key)}>
              이동 <span className="vb-menuarrow">›</span>
            </button>
            {docMoveId === key && moveTree(fo.parent || "", (t) => moveFolder(fo.id, t), fo.id)}
            <button className="vb-docmenu-del"
              onClick={() => tapDel(key, () => { delFolder(fo.id); setDocMenuId(""); })}>
              {delAsk === key ? "정말 삭제할까요?" : "삭제"}
            </button>
          </div>
        )}
        <div className="vb-mbody">
          {renaming ? (
            <input className="vb-mrename" autoFocus value={docRenameVal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDocRenameVal(e.target.value)}
              onBlur={() => renameFile(fo.id, docRenameVal, "folder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); renameFile(fo.id, docRenameVal, "folder"); }
                if (e.key === "Escape") { e.preventDefault(); setDocRenameId(""); }
              }} />
          ) : (
            <div className="vb-fname" title={fo.name}>{fo.name}</div>
          )}
          <div className="vb-fmeta">{folCount(fo.id)}개</div>
        </div>
      </div>
    );
  };
  const isSearchMode = libQuery.trim().length > 0; // 검색어가 있으면 폴더 뷰 대신 검색 결과를 보여준다
  const folderName = (id) => folderPath(lib.folders, id);
  /* 매트 처리 — 칸(슬롯)은 모두 같은 자리를 차지하고, 그 안에서 종이가 원본 비율
     (f.ratio = w/h)대로 축소돼 가운데 놓인다. 잘리는 데 없이, 격자는 안 흐트러지게.

     높이를 일정하게 맞추면 16:9 슬라이드가 A4 옆에서 두 배 넓어져 옆 칸을 침범한다.
     그래서 시안 8a 의 규격(16:9→148×83 · A4→90×127 · 4:3→132×99)이 쓰는 "넓이 일정"
     규칙을 그대로 옮겼다: w=√(A·r), h=√(A/r). A=12000 이면 위 세 값과 ±3px 안에서 맞는다.
     파노라마 스캔·아주 긴 세로 문서는 상한에 걸려 비율만 유지한 채 줄어든다. */
  const PAPER_AREA = 12000;
  /* floor 인 건 반올림이 상한을 1px 넘겨 칸 높이를 삐져나오는 걸 막으려는 것 */
  const matteWidth = (r, s = 1) => Math.floor(Math.min(
    Math.sqrt(PAPER_AREA * s * s * r), // 넓이 일정
    SLOT_H * s * r,                    // 칸 높이를 넘지 않게 (아주 긴 세로 문서)
    160 * s,                           // 옆 칸을 침범하지 않게 (파노라마 스캔)
  ));
  const measureThumb = (id, img) => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    setThumbRatio((m) => (m[id] ? m : { ...m, [id]: w / h }));
  };
  /* 카드 종이 한 장. 비율을 알면 폭을 정해 주고(칸보다 좁으면 min() 으로 같이 줄어든다),
     아직 모르면 그림이 스스로 정하게 두었다가 onLoad 에서 잰 값으로 자리를 잡는다.
     폭만 주고 aspect-ratio 로 높이를 받아 두면 레터박스(위아래 흰 띠)가 아예 안 생긴다. */
  const renderPaper = (f, s = 1) => {
    const r = f.ratio > 0 ? f.ratio : thumbRatio[f.id] || (f.thumb ? 0 : A4_RATIO);
    const style = r ? { width: `min(${matteWidth(r, s)}px, 100%)`, aspectRatio: String(r) } : undefined;
    return (
      <div className={"vb-slot" + (s < 1 ? " sm" : "")}>
        <div className={"vb-paper" + (r ? "" : " auto")} style={style}>
          {f.thumb ? (
            <img src={u("/api/library/thumb/") + f.id} alt="" loading="lazy"
              onLoad={(e) => measureThumb(f.id, e.currentTarget)} />
          ) : (
            <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" /></svg>
          )}
          {f.lastPage > 1 && f.totalPages > 1 && (
            <span className="vb-prog"><i style={{ width: Math.min(100, (f.lastPage / f.totalPages) * 100) + "%" }} /></span>
          )}
        </div>
      </div>
    );
  };

  /* wide 레이아웃 서재 카드 — 매트 처리한 종이 + ⋮ 메뉴.
     좁은 화면 카드(vb-doc)는 종이만 같고 아이콘 액션이 붙어 있어 렌더가 따로다. */
  const renderDocCard = (f, opt = {}) => {
    const menuOpen = docMenuId === f.id;
    const moveOpen = docMoveId === f.id;
    const renaming = docRenameId === f.id;
    return (
      <div key={f.id} draggable={!renaming}
        className={"vb-mdoc" + (dragId === f.id ? " drag" : "")}
        onClick={() => !renaming && openLibFile(f)}
        onDragStart={(e) => {
          setDragId(f.id);
          e.dataTransfer.setData("text/plain", f.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => { setDragId(""); setDropTgt(""); }}>
        {renderPaper(f)}
        <button className="vb-mmenu" onClick={(e) => {
          e.stopPropagation();
          setDocMenuId(menuOpen ? "" : f.id); setDocMoveId("");
        }} aria-label="더보기" title="더보기">⋮</button>
        {menuOpen && (
          <div className="vb-docmenu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setDocRenameId(f.id); setDocRenameVal(f.name); setDocMenuId(""); }}>
              이름 바꾸기
            </button>
            <button onClick={() => setDocMoveId(moveOpen ? "" : f.id)}>
              이동 <span className="vb-menuarrow">›</span>
            </button>
            {moveOpen && moveTree(f.folder || "", (t) => moveFile(f.id, t))}
            <a className="vb-docmenu-dl" href={u("/api/library/file/") + f.id + "?dl=1"} download
              onClick={() => setDocMenuId("")}>다운로드</a>
            <button className="vb-docmenu-del"
              onClick={() => tapDel(f.id, () => { delFile(f.id); setDocMenuId(""); })}>
              {delAsk === f.id ? "정말 삭제할까요?" : "삭제"}
            </button>
          </div>
        )}
        <div className="vb-mbody">
          {renaming ? (
            <input className="vb-mrename" autoFocus value={docRenameVal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDocRenameVal(e.target.value)}
              onBlur={() => renameFile(f.id, docRenameVal)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); renameFile(f.id, docRenameVal); }
                if (e.key === "Escape") { e.preventDefault(); setDocRenameId(""); }
              }} />
          ) : (
            <div className="vb-fname" title={f.name}>{f.name}</div>
          )}
          <div className="vb-fmeta">
            {opt.folderLabel ? opt.folderLabel + " · " : ""}{fmtRel(f.lastOpenedAt || f.at)}
          </div>
          {opt.matches?.length > 0 && (
            <div className="vb-hits">
              {opt.matches.map((m) => (
                <button key={m.page} className="vb-hit"
                  onClick={(e) => { e.stopPropagation(); openLibFile(f, m.page); }}>
                  <span className="vb-hitpg">{m.page}쪽</span>{m.snippet}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };
  const savedVocab = word?.head
    ? vocab.find((v) => v.word.toLowerCase() === word.head.toLowerCase())
    : null;

  /* 질문 탭에 넘길 것 — 다른 기기가 흘리는 중인 답(peerLive)은 그 자리에 겹쳐 그린다 */
  const askMsgs = useMemo(() => {
    if (!peerLive || peerLive.sid !== curSess || !askLog[peerLive.i]) return askLog;
    return askLog.map((m, k) => (k === peerLive.i && !m.live ? { ...m, text: peerLive.text || m.text, pending: true } : m));
  }, [askLog, peerLive, curSess]);
  const askRun = aiStat?.running ? aiStat : peerLive?.run?.running ? { ...peerLive.run, device: peerLive.device } : null;

  const pickModel = (id) => {
    const next = { ...cfg, askModel: id };
    setCfg(next); cfgRef.current = next; persist();
  };



  /* ── 기록 탭: 단어·해석·질문 이력을 시각순으로 병합 ── */
  const logItems = useMemo(() => {
    const items = [];
    // ★ 단어장이 아니라 "이 문서에서 찾아본 단어" — lookups 는 문서별로 저장되므로 doc 로 거른다
    for (const l of lookups) {
      if (l.doc !== docName) continue;
      items.push({ id: "l" + l.id, at: l.at || 0, type: "word", title: l.word, sub: l.mean || l.ctx || "", data: l });
    }
    for (const it of interpLog) {
      if (it.doc !== docName) continue;
      items.push({
        id: it.id, at: it.at, type: "interp",
        title: it.quote.length > 44 ? it.quote.slice(0, 44) + "…" : it.quote, sub: it.trans, data: it,
      });
    }
    for (const s of sessions) {
      const firstQ = s.msgs.find((m) => m.role === "me");
      if (firstQ) items.push({ id: "s" + s.id, at: s.at || 0, type: "ask", title: s.title, sub: firstQ.text || "", data: s });
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 200);
  }, [lookups, interpLog, sessions, docName]);

  const openLogItem = (it) => {
    if (it.type === "word") {
      const v = it.data;
      setWord({ head: v.word, pos: "", senses: (v.mean || "").split(/\s*\/\s*/).filter(Boolean), ctx: v.ctx || "", quote: v.quote || "", live: false });
      setTab("word");
    } else if (it.type === "ask") {
      setCurSess(it.data.id);
      setTab("ask");
    } else if (it.data.page) {
      setTab("word");
      scrollToPage(it.data.page);
    }
  };
  /* 목차 항목마다 몇 쪽인지 — "지금 보는 절" 표시용. 목적지(dest)를 쪽 번호로 푸는 건 비동기라
     목차를 먼저 띄우고 뒤에서 채운다. 문서가 바뀌었으면 버린다. */
  const outlinePages = async (pdf, flat) => {
    const pages = await Promise.all(flat.map(async (it) => {
      try {
        const d = typeof it.dest === "string" ? await pdf.getDestination(it.dest) : it.dest;
        if (!d) return 0;
        const ref = d[0];
        return (typeof ref === "object" && ref !== null ? await pdf.getPageIndex(ref) : Number(ref)) + 1;
      } catch { return 0; }
    }));
    if (pdfRef.current !== pdf) return;
    setOutline(flat.map((it, i) => ({ ...it, page: pages[i] || 0 })));
  };
  /* 지금 보는 절 = 시작 쪽이 지금 쪽 이하인 항목 중 가장 늦게 시작하는 것(같은 쪽이면 목록에서 뒤 — 더 깊은 절).
     chain 은 그 절과 윗단위들(목차 순서상 앞쪽의 더 얕은 항목). */
  const curSec = useMemo(() => {
    let best = -1;
    outline.forEach((it, i) => {
      if (it.page > 0 && it.page <= curPage && (best < 0 || it.page >= outline[best].page)) best = i;
    });
    const chain = new Set();
    if (best >= 0) {
      chain.add(best);
      let d = outline[best].depth;
      for (let i = best - 1; i >= 0 && d > 0; i--) if (outline[i].depth < d) { chain.add(i); d = outline[i].depth; }
    }
    return { i: best, chain, top: chain.size ? Math.min(...chain) : -1 };
  }, [outline, curPage]);
  /* 목차를 열면 지금 절의 맨 윗단위가 목록 맨 위에 오게 — 접혀 있으면 그 줄기를 편다 */
  const olistRef = useRef(null);
  useEffect(() => {
    if (!outOpen || curSec.top < 0) return;
    setFolded((f) => {
      if (![...curSec.chain].some((i) => f.has(i) && i !== curSec.i)) return f;
      const n = new Set(f);
      for (const i of curSec.chain) if (i !== curSec.i) n.delete(i);
      return n;
    });
    const raf = requestAnimationFrame(() => {
      const list = olistRef.current;
      const row = list?.querySelector(`[data-oi="${curSec.top}"]`);
      if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    return () => cancelAnimationFrame(raf);
    // 열 때만 — 읽는 중 절이 바뀔 때마다 목록이 움직이면 산만하다(표시는 따라 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOpen, curSec.top >= 0]);

  /* 접힌 항목의 하위(depth 가 더 깊은 뒤따르는 항목)는 숨긴다 */
  const visibleOutline = (() => {
    const v = [];
    let skip = -1;
    outline.forEach((it, i) => {
      if (skip >= 0 && it.depth > skip) return;
      skip = -1;
      v.push(i);
      if (folded.has(i)) skip = it.depth;
    });
    return v;
  })();

  /* 입력칸에 포커스가 없어도 키보드로 바로 칠 수 있게 한다.
     (iPad + 매직 키보드에서는 키패드를 가리지 않으려고 자동 포커스를 껐다) */
  useEffect(() => {
    if (authed !== false) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === pwRef.current) return;
      if (e.key === "Enter") { e.preventDefault(); submitPw(pw); return; }
      if (e.key === "Backspace") pwKey("del");
      else if (/^\d$/.test(e.key)) pwKey(e.key);
      else return;
      e.preventDefault();
      pwRef.current?.focus(); // 이후 타이핑은 입력칸이 받는다
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 의존성 배열 없음 — 매 렌더마다 다시 걸어 pw/submitPw 의 최신 값을 본다

  // 서재가 홈 화면인 동안(문서를 안 열었거나 서재를 띄운 동안)은 읽기 도구창을 숨긴다
  const inLib = libOpen || numPages === 0;
  inLibRef.current = inLib;

  return (
    <div className={"vb-root" + (wide ? " wide" : "") + (theme === "light" ? " light" : "")} ref={rootRef}>
      {authed === false && (
        <div className="vb-modal" style={{ zIndex: 100 }}>
          <form className="vb-card" onSubmit={(e) => { e.preventDefault(); submitPw(pw); }}>
            <h3>여백</h3>
            <p className="vb-sub">숫자 6자리 비밀번호를 입력하세요. 6자리가 다 차면 자동으로 들어갑니다. 이 기기에서는 30일간 유지됩니다.</p>
            <div className="vb-field">
              <label>비밀번호</label>
              <input ref={pwRef} type="password" inputMode="numeric" autoFocus={!COARSE}
                className="pw6" maxLength={6}
                value={pw} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                autoComplete="current-password"
                onChange={(e) => {
                  setPwErr("");
                  const nv = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setPw(nv);
                  if (nv.length === 6) submitPw(nv);
                }} />
            </div>
            <div className="vb-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className="vb-key"
                  onMouseDown={holdFocus} onClick={() => pwKey(d)}>{d}</button>
              ))}
              <button type="button" className="vb-key sm" onMouseDown={holdFocus}
                onClick={() => pwKey("del")} aria-label="지우기">⌫</button>
              <button type="button" className="vb-key" onMouseDown={holdFocus}
                onClick={() => pwKey("0")}>0</button>
              <button type="submit" className="vb-key go" disabled={pwBusy || !pw}
                onMouseDown={holdFocus} aria-label="들어가기">↵</button>
            </div>
            {pwErr && <p className="vb-sub" style={{ color: "#E4713F", margin: "14px 0 0" }}>{pwErr}</p>}
            <button className="vb-done" type="submit" disabled={pwBusy} style={{ marginTop: 16 }}>
              {pwBusy ? "확인 중…" : "들어가기"}
            </button>
          </form>
        </div>
      )}

      {!inLib && <div className="vb-bar">
        <button className={"vb-tool" + (outOpen ? " on" : "")} onClick={() => setOutOpen((v) => !v)} aria-label="목차">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button className={"vb-tool" + (libOpen ? " on" : "")}
          onClick={() => { setLibOpen(true); refreshLib(); }} aria-label="서재">
          <svg viewBox="0 0 24 24"><path d="M4 4.5h4V20H4zM10 4.5h4V20h-4zM15.6 6l3.9-1L22 19l-3.9 1z" /></svg>
        </button>
        {renaming !== null ? (
          <input className="vb-nameedit" autoFocus value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => renameCur(renaming)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); renameCur(renaming); }
              if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
            }} />
        ) : (
          <button className="vb-name" disabled={!numPages}
            onClick={() => numPages && setRenaming(docName)}
            title={numPages ? "탭해서 이름 바꾸기" : undefined}>
            {busy ? "여는 중…" : docName || "PDF를 열어 시작하세요"}
          </button>
        )}
        {numPages > 0 && <span className="vb-pill">{curPage} / {numPages}</span>}
        <span className={"vb-eng" + (engine === "NIM" ? " c" : engine === "Gemini" ? " g" : "")}>
          {engine || "대기"}
        </span>
        {numPages > 0 && (
          <button className={"vb-tool" + (capMode ? " on" : "")} onClick={() => (capMode ? exitCap() : enterCap())}
            aria-label="영역 캡처">
            <svg viewBox="0 0 24 24"><path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4" /><rect x="8" y="8" width="8" height="8" strokeDasharray="2.5 2" /></svg>
          </button>
        )}
        {numPages > 0 && (
          <button className={"vb-tool" + (inkOn ? " on" : "")} onClick={() => setInkOn((v) => !v)}
            aria-label="필기" title="필기 — 애플펜슬로 쓰고, 손가락으로는 넘기고 단어를 누른다">
            <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
          </button>
        )}
        {numPages > 0 && (
          <button className={"vb-tool" + (miniOpen ? " on" : "")} onClick={() => setMiniOpen((v) => !v)}
            aria-label="작은 노트" title="작은 노트 — 세 손가락으로 위로 쓸어 올려도 열린다">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" /><path d="M10 15.5h4" /></svg>
          </button>
        )}
        {IS_SAFARI && numPages > 0 && !inkOn && (
          <button className={"vb-tool" + (penCapture ? " on" : "")}
            onClick={() => {
              const v = !penCapture;
              setPenCapture(v); penCaptureRef.current = v; persist();
            }}
            aria-label="애플펜슬로 긋기 캡처" title="애플펜슬로 그으면 자동으로 캡처 영역을 그린다">
            <svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
          </button>
        )}
        <button className="vb-tool" onClick={() => zoomBy(1 / 1.2)} aria-label="축소">−</button>
        <button className="vb-tool" onClick={() => zoomBy(1.2)} aria-label="확대">+</button>
        {/* 리모트는 한 번 켜 두고 마는 것이라 툴바가 아니라 ⚙ 설정 안에 있다.
            켜져 있는 동안만 ⚙ 에 점 하나로 알린다 */}
        <button className={"vb-tool" + (remoteOn ? " dot" : "")} onClick={() => setSetOpen(true)}
          aria-label={remoteOn ? "설정 — 리모트 켜짐" : "설정"}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.8 2.8 1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5 2 2 0 11-4 0 1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3 2 2 0 11-2.8-2.8 1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1 2 2 0 110-4 1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8 2 2 0 112.8-2.8 1.6 1.6 0 001.8.3 1.6 1.6 0 001-1.5 2 2 0 114 0 1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3 2 2 0 112.8 2.8 1.6 1.6 0 00-.3 1.8 1.6 1.6 0 001.5 1 2 2 0 110 4 1.6 1.6 0 00-1.5 1z" /></svg>
        </button>
        <button className="vb-tool" style={{ background: "var(--t-fill)" }}
          onClick={() => {
            const t = theme === "dark" ? "light" : "dark";
            setTheme(t); themeRef.current = t; persist();
          }} aria-label="테마 전환">
          {theme === "dark" ? "☀" : "☾"}
        </button>
        {numPages > 0 && (
          <button className={"vb-tool" + (invert ? " on" : "")}
            onClick={() => {
              const v = !invert;
              setInvert(v); invertRef.current = v; persist();
            }} aria-label="야간 반전" title="야간 반전 — 페이지 색만 뒤집는다">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" /></svg>
          </button>
        )}
        <div className="vb-vsep" />
        {wide && (
          <div className="vb-seg2" role="group" aria-label="패널·카드 배치">
            <button className={panelMode === "panel" ? "on" : ""}
              onClick={() => { setPanelMode("panel"); panelModeRef.current = "panel"; persist(); }}>
              <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></svg>
              패널
            </button>
            <button className={panelMode === "card" ? "on" : ""}
              onClick={() => { setPanelMode("card"); panelModeRef.current = "card"; persist(); }}>
              <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="8" y="8" width="8" height="8" /></svg>
              카드
            </button>
          </div>
        )}
        <div className="vb-seg2" style={{ marginLeft: 6 }} role="group" aria-label="단어·질문·기록">
          {[["word", "단어"], ["ask", "질문"], ["log", "기록"]].map(([k, label]) => (
            <button key={k} className={sheetOpen && tab === k ? "on" : ""}
              onClick={() => {
                if (sheetOpen && tab === k) setSheetOpen(false);
                else { setTab(k); setSheetOpen(true); }
              }}>{label}</button>
          ))}
        </div>
      </div>}

      <div className="vb-body">
        <aside className={"vb-out" + (wide ? (outOpen ? "" : " closed") : outOpen ? " open" : "")}>
          <h2>목차</h2>
          <div className="vb-olist" ref={olistRef}>
            {outline.length === 0 && numPages === 0 && <div className="vb-oempty">PDF를 열면 목차가 나타납니다.</div>}
            {outline.length === 0 && numPages > 0 && (
              <>
                <div className="vb-oempty">이 PDF에는 목차 정보가 없습니다. 페이지로 바로 이동하세요.</div>
                {curFileRef.current?.id && (
                  <div style={{ padding: "0 8px 12px" }}>
                    <button className="vb-libbtn" style={{ width: "100%", justifyContent: "center" }}
                      disabled={outlineGen} onClick={generateOutline}>
                      {outlineGen ? "목차 만드는 중…" : "AI로 목차 만들기"}
                    </button>
                    {outlineErr && <div className="vb-err" style={{ marginTop: 8, padding: "0 2px" }}>{outlineErr}</div>}
                  </div>
                )}
                <div className="vb-pgrid">
                  {Array.from({ length: numPages }, (_, i) => (
                    <button key={i} className={"vb-pg" + (curPage === i + 1 ? " on" : "")}
                      onClick={() => { scrollToPage(i + 1); if (!wide) setOutOpen(false); }}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </>
            )}
            {visibleOutline.map((i) => {
              const it = outline[i];
              const kids = outline[i + 1]?.depth > it.depth; // walk 는 하위 항목을 바로 뒤에 넣는다
              return (
                <div key={i} data-oi={i}
                  className={"vb-orow" + (it.depth ? " d" + it.depth : "") +
                    (curSec.i === i ? " cur" : curSec.chain.has(i) ? " curp" : "")}>
                  <button className={"vb-ochev" + (kids ? "" : " off") + (folded.has(i) ? " fold" : "")}
                    tabIndex={kids ? 0 : -1}
                    onClick={() => setFolded((s) => {
                      const n = new Set(s);
                      n.has(i) ? n.delete(i) : n.add(i);
                      return n;
                    })}
                    aria-label="하위 목차 접기/펼치기">
                    <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button className="vb-oi" onClick={() => { goDest(it.dest); if (!wide) setOutOpen(false); }}>
                    {it.title}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <div className={"vb-scrim" + (outOpen && !wide ? " on" : "")} onClick={() => setOutOpen(false)} />

        <div className={"vb-view" + (wide && sheetOpen && panelMode === "panel" ? " shr" : "")} ref={viewRef}>
          <div className={"vb-pages" + (invert ? " inv" : "")} ref={stageRef} />
        </div>

        {zoomPill && <div className="vb-zoompill">{zoomPill}</div>}
        {jumpBack && (
          <button className="vb-jumpback" onClick={goJumpBack} aria-label={jumpBack.page + "쪽으로 돌아가기"}>
            <Bi name="arrow-return-left" />
          </button>
        )}

        {inkOn && numPages > 0 && (() => {
          const tools = [
            ["pen", "펜", <path key="p" d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />],
            ["hl", "형광펜", <path key="h" d="M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4" />],
            ["eraser", "지우개", <path key="e" d="M20 20H7L3 16a1.5 1.5 0 010-2.1L13.9 3a1.5 1.5 0 012.1 0L21 8a1.5 1.5 0 010 2.1L11 20M6 11l7 7" />],
            ["lasso", "올가미", <path key="l" d="M7 22a5 5 0 01-2-4M3.3 14A7 5 0 1112 17c-1.4 0-2.7-.3-3.8-.8M5 18a2 2 0 100-4 2 2 0 000 4z" />],
          ];
          const isHl = inkTool === "hl";
          const cur = isHl ? inkHl : inkPen;
          const colors = isHl ? INK_HL_COLORS : INK_PEN_COLORS;
          const [wMin, wMax] = INK_W_RANGE[isHl ? "hl" : "pen"];
          const setCur = (patch) => setInkCfg(isHl ? { hl: { ...inkHl, ...patch } } : { pen: { ...inkPen, ...patch } });
          // 칸 점 크기 — 굵기에 비례하되 버튼 안에 들어가게(펜 4~16px, 형광펜 6~18px)
          const dot = (w) => Math.round(isHl ? 6 + (w - wMin) / (wMax - wMin) * 12 : 4 + (w - wMin) / (wMax - wMin) * 12);
          const mm = (w) => { const v = w * PT_MM; return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + "mm"; };
          const showW = inkWEdit && !inkSel && (inkTool === "pen" || inkTool === "hl");
          return (
            <>
            <div className="vb-inkbar" role="toolbar" aria-label="필기 도구">
              {tools.map(([k, label, icon]) => (
                <button key={k} className={"vb-inkb" + (inkTool === k ? " on" : "")} aria-label={label} title={label}
                  onClick={() => { setInkWEdit(false); setInkCfg({ tool: k }); }}>
                  <svg viewBox="0 0 24 24">{icon}</svg>
                </button>
              ))}
              <i className="vb-inksep" />
              {inkSel ? (
                <>
                  <span className="vb-inkmsg">{inkSel.ids.size}획</span>
                  {INK_PEN_COLORS.map((c) => (
                    <button key={c} className="vb-inkc" style={{ "--c": c }} aria-label="이 색으로" onClick={() => inkSelColor(c)} />
                  ))}
                  <button className="vb-inkb" aria-label="선택 지우기" title="지우기" onClick={inkSelDelete}>
                    <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </>
              ) : inkTool === "pen" || inkTool === "hl" ? (
                <>
                  {colors.map((c) => (
                    <button key={c} className={"vb-inkc" + (cur.c === c ? " on" : "")} style={{ "--c": c }}
                      aria-label={"색 " + c} onClick={() => setCur({ c })} />
                  ))}
                  <i className="vb-inksep" />
                  {cur.ws.map((w, i) => (
                    <button key={i} className={"vb-inkw" + (cur.wi === i ? " on" : "")}
                      aria-label={["가늘게", "보통", "굵게"][i] + " " + mm(w) + (cur.wi === i ? " — 한 번 더 누르면 굵기 조절" : "")}
                      onClick={() => {
                        if (cur.wi === i) setInkWEdit((v) => !v);
                        else { setInkWEdit(false); setCur({ wi: i, w }); }
                      }}>
                      <b style={{ width: dot(w), height: dot(w), background: cur.c }} />
                    </button>
                  ))}
                </>
              ) : (
                <span className="vb-inkmsg">{inkTool === "eraser" ? "닿은 획을 지운다" : "둘러서 고르고, 상자 안을 끌어 옮긴다"}</span>
              )}
              <i className="vb-inksep" />
              <button className="vb-inkb" disabled={!inkHist.u} aria-label="실행취소" onClick={inkUndo}>
                <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>
              </button>
              <button className="vb-inkb" disabled={!inkHist.r} aria-label="다시 실행" onClick={inkRedo}>
                <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></svg>
              </button>
              <button className="vb-inkb" aria-label="필기 포함 PDF 내려받기" title="필기 포함 PDF 내려받기" onClick={inkExport}>
                <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
              </button>
              {inkErr && <span className="vb-inkerr">{inkErr}</span>}
            </div>
            {showW && (
              <div className="vb-inkwpop" role="group" aria-label="굵기 조절">
                <svg className="vb-inkwprev" viewBox="0 0 120 32" aria-hidden="true">
                  <path d="M8 22C32 6 52 6 64 16S100 28 112 10" stroke={cur.c} fill="none"
                    strokeWidth={Math.min(28, cur.w * 1.6)} strokeLinecap={isHl ? "butt" : "round"} strokeLinejoin="round"
                    strokeOpacity={isHl ? HL_ALPHA * 1.6 : 1} />
                </svg>
                <input type="range" min={wMin} max={wMax} step={isHl ? 0.5 : 0.1} value={cur.w}
                  aria-label="굵기" onChange={(e) => {
                    const w = Math.round(+e.target.value * 10) / 10;
                    const ws = cur.ws.map((v, j) => (j === cur.wi ? w : v));
                    setCur({ w, ws });
                  }} />
                <span className="vb-inkwval">{mm(cur.w)}</span>
                <button className="vb-inkwreset" onClick={() => {
                  const d = (isHl ? INK_HL_W : INK_PEN_W)[cur.wi];
                  setCur({ w: d, ws: cur.ws.map((v, j) => (j === cur.wi ? d : v)) });
                }}>기본값</button>
              </div>
            )}
            </>
          );
        })()}

        {upProg && (
          <div className="vb-uppill" role="status">
            <i style={{ width: (upProg.pct ?? 0) + "%" }} />
            <span>
              {upProg.name} — {upProg.what || "올리는 중"}
              {upProg.pct != null ? ` ${upProg.pct}%` : upProg.loaded ? ` ${fmtSize(upProg.loaded)}` : "…"}
            </span>
          </div>
        )}

        {!inLib && (
          <MiniNote open={miniOpen} onClose={() => setMiniOpen(false)} lib={lib} mainId={curFileRef.current?.id}
            libApi={libApi} cdn={CDN} inkOn={inkOn} inkCfgRef={inkCfgRef} onInkOp={(op) => inkPush(op)}
            apiRef={miniApiRef} invert={invert} coarse={COARSE}
            acquireAnn={acquireAnn} releaseAnn={releaseAnn}
            onInkPaint={(id, n) => { if (annotsRef.current?.id === id) paintInk(n); }} />
        )}

        {bubble && (
          <button className="vb-bubble" style={{ left: bubble.left, top: bubble.top }}
            onPointerDown={(e) => {
              e.preventDefault();
              setBubble(null);
              lastSentRef.current = selRef.current;
              setSentPos({ left: bubble.left, top: bubble.top + 36 });
              runSentence(selRef.current);
            }}>
            선택 구간 해석
          </button>
        )}

        {sentPos && sent && (
          <div className="vb-sentcard" style={{ left: sentPos.left, top: sentPos.top }}>
            <div className="vb-lbl">
              해석
              <button onClick={() => setSentPos(null)} aria-label="닫기">✕</button>
            </div>
            {sent.err
              ? <p className="vb-err">답을 받지 못했습니다 — {sent.err}</p>
              : <p className={sent.live ? "vb-cur" : ""}>{sent.trans}</p>}
          </div>
        )}

        {inLib && (
          <div className="vb-lib"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              readFiles(e.dataTransfer?.files); // 파일 앱에서 끌어다 놓으면 저장하고(한 개면 바로 연다)
            }}>
            <div className="vb-libhead">
              <button className={"vb-libbtn" + (sideOpen ? " on" : "")} onClick={() => toggleSide(!sideOpen)}
                aria-label="사이드바" title="사이드바"><Bi name="layout-sidebar" /></button>
              <div className="vb-brandmk">
                <img className="vb-brandicon" src={u("/brand/yeobaek-icon.svg")} alt="" />
                <span className="vb-brandword">여백</span>
                <span className="vb-branddiv" />
                <span className="vb-brandlbl">YEOBAEK</span>
              </div>
              <div className="vb-libsearch">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
                <input value={libQuery} onChange={(e) => changeLibQuery(e.target.value)}
                  placeholder="제목이나 본문으로 찾기" />
                {libQuery && (
                  <button onClick={clearLibQuery} aria-label="검색어 지우기" title="지우기">✕</button>
                )}
              </div>
              <div className="vb-libact">
                <button className="vb-libbtn" onClick={() => { setTab("log"); setSheetOpen(true); }}
                  aria-label="단어장·기록" title="단어장·기록">
                  <svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" /></svg>
                </button>
                {/* 리더 툴바(.vb-bar)에만 있던 다크 토글 — 서재에 머무는 동안엔 테마를 못 바꿨어서 추가 */}
                <button className="vb-libbtn" onClick={() => {
                  const t = theme === "dark" ? "light" : "dark";
                  setTheme(t); themeRef.current = t; persist();
                }} aria-label="다크 모드" title="다크 모드">
                  {theme === "dark" ? "☀" : "☾"}
                </button>
                {/* 이름 정리 — 지금 보고 있는 목록(폴더 안이면 그 폴더)의 이름을 한 번에 맞춘다 */}
                {(libView === "recent" ? recentFiles : shownFiles).length > 1 && (
                  <button className="vb-libbtn"
                    onClick={() => openRename(libView === "recent" ? recentFiles : shownFiles)}
                    aria-label="이름 정리" title="이름 정리">
                    <svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7A2 2 0 013 12.2V5a2 2 0 012-2h7.2a2 2 0 011.4.6l7 7a2 2 0 010 2.8z" /><circle cx="7.8" cy="7.8" r="1.4" /></svg>
                  </button>
                )}
                <button className="vb-libbtn" onClick={() => setSetOpen(true)} aria-label="설정" title="설정">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.8 2.8 1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5 2 2 0 11-4 0 1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3 2 2 0 11-2.8-2.8 1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1 2 2 0 110-4 1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8 2 2 0 112.8-2.8 1.6 1.6 0 001.8.3 1.6 1.6 0 001-1.5 2 2 0 114 0 1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3 2 2 0 112.8 2.8 1.6 1.6 0 00-.3 1.8 1.6 1.6 0 001.5 1 2 2 0 110 4 1.6 1.6 0 00-1.5 1z" /></svg>
                </button>
                {numPages > 0 && (
                  <button className="vb-libbtn" onClick={() => setLibOpen(false)} aria-label="읽던 문서로" title="읽던 문서로">
                    <svg viewBox="0 0 24 24"><path d="M2.5 5.6C5 4.3 8 4.3 12 6.1v12.3C8 16.7 5 16.7 2.5 17.9zM21.5 5.6C19 4.3 16 4.3 12 6.1v12.3c4-1.7 7-1.7 9.5-.5z" /></svg>
                  </button>
                )}
              </div>
            </div>
            {(libErr || loadErr) && (
              <div className="vb-err" style={{ padding: "10px 20px 0" }}>{libErr || loadErr}</div>
            )}
            {/* 굿노트처럼 — 사이드바는 접어 두고(기본), 폴더와 문서를 한 격자에 같은 크기로. 좁은 화면에선 사이드바가 위에 얹힌다 */}
            <div className={"vb-libwrap" + (wide ? "" : " narrow")}>
              {docMenuId && (
                <div className="vb-menuscrim" onClick={() => { setDocMenuId(""); setDocMoveId(""); }} />
              )}
              {sideOpen && !wide && <div className="vb-sidescrim" onClick={() => toggleSide(false)} />}
              {sideOpen && (
                <nav className="vb-libside">
                  <div className="vb-smartnav">
                    <button className={"vb-navitem" + (libFolder === "" && libView === "" ? " on" : "") +
                        (dropTgt === "__root__" ? " over" : "")}
                      onClick={() => goFolder("")}
                      onDragOver={(e) => { if (dragId || folDragId) { e.preventDefault(); setDropTgt("__root__"); } }}
                      onDragLeave={() => setDropTgt((t) => (t === "__root__" ? "" : t))}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropInto(""); }}>
                      <Bi name="collection" className="vb-folico" /><span>서재</span>
                      <span className="vb-navn">{lib.files.length}</span>
                    </button>
                    <button className={"vb-navitem" + (libView === "recent" ? " on" : "")}
                      onClick={() => { setLibView("recent"); if (!wide) toggleSide(false); }}>
                      <Bi name="clock-history" className="vb-folico" /><span>최근 연 문서</span>
                    </button>
                  </div>
                  <div className="vb-folnavlist">
                    {sideTree.map((fo) => (
                      <div key={fo.id} style={{ paddingLeft: 4 + fo.depth * 16 }}
                        className={"vb-folnav" +
                          (dropTgt === fo.id ? " over" : "") +
                          (folDragId === fo.id ? " dragging" : "") +
                          (libFolder === fo.id && libView === "" ? " on" : "")}
                        draggable
                        onClick={() => goFolder(fo.id)}
                        onDragStart={(e) => {
                          setFolDragId(fo.id);
                          e.dataTransfer.setData("text/plain", fo.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setFolDragId("")}
                        onDragOver={(e) => { e.preventDefault(); if (dragId) setDropTgt(fo.id); }}
                        onDragLeave={() => setDropTgt((t) => (t === fo.id ? "" : t))}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          if (dragId) { setDropTgt(""); moveFile(dragId, fo.id); return; }
                          const src = folders.find((x) => x.id === folDragId);
                          // 형제끼리는 순서 바꾸기, 다른 가지의 폴더 위에 놓으면 그 안으로
                          if (src && (src.parent || "") !== (fo.parent || "")) { dropInto(fo.id); return; }
                          if (folDragId && folDragId !== fo.id) {
                            const ids = folders.map((x) => x.id);
                            const from = ids.indexOf(folDragId), to = ids.indexOf(fo.id);
                            ids.splice(to, 0, ids.splice(from, 1)[0]);
                            reorderFolders(ids);
                          }
                          setFolDragId("");
                        }}>
                        {hasKids(fo.id) ? (
                          <button className={"vb-foltog" + (folClosed.has(fo.id) ? "" : " open")} aria-label="펼치기·접기"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolClosed((s) => { const n = new Set(s); n.has(fo.id) ? n.delete(fo.id) : n.add(fo.id); return n; });
                            }}>
                            <Bi name="chevron-right" />
                          </button>
                        ) : <span className="vb-foltog" />}
                        <Bi name={libFolder === fo.id && libView === "" ? "folder2-open" : "folder2"} className="vb-folico" />
                        <span className="vb-folnavname">{fo.name}</span>
                      </div>
                    ))}
                  </div>
                </nav>
              )}

              <div className="vb-libbody">
                <div className="vb-libtitle">
                  {!isSearchMode && libView === "" && libFolder && (
                    <div className="vb-libpath">
                      {[{ id: "", name: "서재" }, ...crumbs.slice(0, -1)].map((c) => (
                        <Fragment key={c.id || "__root__"}>
                          <button className={dropTgt === (c.id || "__root__") ? "tgt" : ""}
                            onClick={() => setLibFolder(c.id)}
                            onDragOver={(e) => { if (dragId || folDragId) { e.preventDefault(); setDropTgt(c.id || "__root__"); } }}
                            onDragLeave={() => setDropTgt((t) => (t === (c.id || "__root__") ? "" : t))}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropInto(c.id); }}>
                            {c.name}
                          </button>
                          <Bi name="chevron-right" />
                        </Fragment>
                      ))}
                    </div>
                  )}
                  <div className="vb-libtrow">
                    <h1>
                      {isSearchMode ? "검색 결과" : libView === "recent" ? "최근 연 문서" : crumbs.at(-1)?.name || "서재"}
                    </h1>
                    {isSearchMode && <span className="vb-navn">{libSearching ? "찾는 중…" : libSearchRes ? libSearchRes.length + "건" : ""}</span>}
                    <span className="sp" />
                    {!isSearchMode && libView === "" && (
                      <button className="vb-libbtn" onClick={() => { setFolParent(libFolder); setFolInput(""); }}
                        aria-label="새 폴더" title="새 폴더"><Bi name="folder-plus" /></button>
                    )}
                    <button className="vb-libbtn pri" disabled={!ready} onClick={() => fileRef.current?.click()}
                      aria-label={ready ? "PDF 추가" : "준비 중"} title="PDF 추가"><Bi name="plus-lg" /></button>
                  </div>
                </div>

                {isSearchMode ? (
                  !libSearching && libSearchRes && libSearchRes.length === 0 ? (
                    <div className="vb-oempty">"{libQuery.trim()}"에 해당하는 자료가 없어요.</div>
                  ) : (
                    <div className="vb-mgrid">
                      {(libSearchRes || []).map((f) => renderDocCard(f, {
                        matches: f.matches,
                        folderLabel: f.folder ? folderName(f.folder) : "",
                      }))}
                    </div>
                  )
                ) : libView === "recent" ? (
                  recentFiles.length === 0 ? <div className="vb-oempty">아직 연 문서가 없어요.</div> : (
                    <div className="vb-mgrid">{recentFiles.map((f) => renderDocCard(f))}</div>
                  )
                ) : lib.files.length === 0 && folders.length === 0 && folInput === null ? (
                  <div className="vb-hero">
                    <img className="vb-herobrand" src={u("/brand/yeobaek-icon.svg")} alt="" />
                    <p>PDF를 추가하면 표지와 함께 이 서재에 꽂혀요.</p>
                    <button className="vb-libbtn pri" style={{ padding: "13px 26px", fontSize: 15 }}
                      disabled={!ready} onClick={() => fileRef.current?.click()}>
                      {ready ? "첫 PDF 추가" : "준비 중…"}
                    </button>
                  </div>
                ) : subFolders.length === 0 && shownFiles.length === 0 && folInput === null ? (
                  <div className="vb-oempty">비어 있어요. PDF를 끌어다 놓거나 ＋로 넣으세요.</div>
                ) : (
                  <div className="vb-mgrid">
                    {folInput !== null && (
                      <div className="vb-mdoc vb-mfol">
                        <div className="vb-slot">{folderArt}</div>
                        <form className="vb-mbody" onSubmit={(e) => { e.preventDefault(); makeFolder(folInput); }}>
                          <input className="vb-mrename" value={folInput} autoFocus placeholder="새 폴더 이름"
                            onChange={(e) => setFolInput(e.target.value)}
                            onBlur={() => { if (!folInput.trim()) setFolInput(null); }}
                            onKeyDown={(e) => { if (e.key === "Escape") setFolInput(null); }} />
                        </form>
                      </div>
                    )}
                    {subFolders.map(renderFolderCard)}
                    {shownFiles.map((f) => renderDocCard(f))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={"vb-scrim" + (panelMode === "card" && sheetOpen ? " on" : "")}
          onClick={() => panelMode === "card" && setSheetOpen(false)} />

        <section className={"vb-surf " + panelMode + " t-" + tab + (sheetOpen ? " open" : "")}
          style={!wide && panelMode === "panel" ? { height: sheetFrac * 100 + "%" } : undefined}>
          <div className="vb-griphandle"
            onPointerDown={(e) => { dragRef.current = { y: e.clientY, h: sheetFrac }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dh = (dragRef.current.y - e.clientY) / boxRef.current.h;
              setSheetFrac(Math.max(0.2, Math.min(0.9, dragRef.current.h + dh)));
            }}
            onPointerUp={(e) => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <i />
          </div>

          <div className="vb-shead">
            {[["word", "단어"], ["ask", "질문"], ["log", "기록"]].map(([k, label]) => (
              <button key={k} className={"vb-shtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
                {label}<i />
              </button>
            ))}
            {wide && (
              <button className="vb-modebtn" title="패널/카드 전환"
                onClick={() => {
                  const m = panelMode === "panel" ? "card" : "panel";
                  setPanelMode(m); panelModeRef.current = m; persist();
                }}>
                <svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 011-1h4M20 15v4a1 1 0 01-1 1h-4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4" /></svg>
              </button>
            )}
            <button className="vb-closebtn" style={!wide ? { marginLeft: "auto" } : undefined}
              onClick={() => setSheetOpen(false)} aria-label="닫기">✕</button>
          </div>

          {tab === "word" && (
            <div className="vb-panes">
              <div className="vb-pe">
                {!word ? (
                  <div className="vb-ph">본문에서 단어를 탭하면 여기에 뜻이 나옵니다.</div>
                ) : (
                  <div className="vb-wpane">
                    <div className="vb-head">
                      <div>
                        <div className="vb-hw">{word.head}</div>
                        {word.pos && <span className="vb-pos">{word.pos}</span>}
                      </div>
                      <button className={"vb-star" + (savedVocab ? " on" : "")}
                        onClick={() => (savedVocab ? delVocab(savedVocab.id) : addVocab())}
                        aria-label={savedVocab ? "단어장에서 빼기" : "단어장에 담기"}>
                        <svg viewBox="0 0 24 24"><path d="M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" /></svg>
                      </button>
                    </div>
                    <div className="vb-accbox">
                      <p className="vb-lbl">이 문맥에서</p>
                      <p className={"vb-acctxt" + (word.live ? " vb-cur" : "")}>{word.ctx}</p>
                      {word.err && <p className="vb-err">답을 받지 못했습니다 — {word.err}</p>}
                    </div>
                    <p className="vb-lbl" style={{ marginTop: 22 }}>사전</p>
                    <ol className="vb-senses">
                      {(word.senses || []).map((s, i) => <li key={i}><i>{i + 1}</i><span>{s}</span></li>)}
                    </ol>
                    <p className="vb-lbl" style={{ marginTop: 22 }}>원문 · {curPage}쪽</p>
                    <p className="vb-quote">{word.quote}</p>
                    <div className="vb-wacts">
                      <button className="vb-wactbtn"
                        onClick={() => showQuoteInterp(word.quote)}>
                        문장 해석
                      </button>
                      <button className="vb-wactbtn"
                        onClick={() => { setAskVal(`"${word.head}" — `); setTab("ask"); setSheetOpen(true); }}>
                        이 낱말로 질문
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "ask" && (
            <AskView
              theme={theme} active={sheetOpen} wideEnter={wide}
              sessions={sessions} curId={curSess}
              onPickSess={(id) => commitSess(sessRef.current, id)}
              onNewSess={() => { newSess("새 대화").catch(() => {}); }}
              onDelSess={delSess}
              msgs={askMsgs} imgUrl={imgUrl}
              value={askVal} onChange={setAskVal} onSend={sendAsk} onStop={stopAsk} busy={asking}
              placeholder={`${curPage}쪽 내용에 대해 물어보세요`}
              empty={{
                title: "이 문서에 대해 물어보세요",
                text: `짧은 문서는 전체를, 긴 문서는 지금 보는 ${curPage}쪽 주변과 목차를 읽고 답해요. 같은 대화 안에서는 앞의 질문을 기억해요.`,
                suggestions: [`${curPage}쪽 핵심만 정리해 줘`, "이 문서는 어떤 내용이야?", "이 쪽에서 어려운 개념을 쉽게 설명해 줘"],
              }}
              attach={sess?.img && sendFig ? { src: imgUrl(sess.img), label: "첨부한 그림", onRemove: () => setSendFig(false) } : null}
              capture={{ icon: "crop", label: "영역 오려내기", onClick: () => enterCap(curSessRef.current) }}
              models={models} askRank={askRank} selModel={cfg.askModel || ""} onPickModel={pickModel}
              onModelsOpen={refreshHealth} healthOf={healthOf} defLabel={defLabel}
              run={askRun} runRef={statRef} lastRun={lastRun}
              onRedo={redoAsk} canRedo={(p) => !p.q.hist}
              onImage={pasteFig}
            />
          )}

          {tab === "log" && (
            <div className="vb-panes">
              <div className="vb-lpane vb-pe">
                <div className="vb-lhead"><span>{curPage}쪽</span><b /></div>
                {logItems.length === 0 ? (
                  <div className="vb-ph">단어를 탭해 ★ 로 담거나, 문장을 해석하거나, 질문을 하면 여기 모입니다.</div>
                ) : logItems.map((it) => (
                  <button key={it.id} className="vb-litem" onClick={() => openLogItem(it)}>
                    <span className="vb-lrow">
                      <i className="vb-ldot" style={{
                        background: it.type === "word" ? "var(--t-star)" : it.type === "ask" ? "#FFD84D" : "var(--t-mark2)",
                      }} />
                      <span className="vb-ltitle" style={it.type === "word" ? { fontFamily: "var(--serif)" } : undefined}>
                        {it.title}
                      </span>
                      <span className="vb-lat">{fmtDate(it.at)}</span>
                    </span>
                    {it.sub && <span className="vb-lsub">{it.sub}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {setOpen && (() => {
          const tapNow = tapModels.find((m) => m.id === (cfg.tapModel || tapDef));
          const askNow = models.find((m) => m.id === (cfg.askModel || defModel));
          const close = () => { persist(); setSetOpen(false); setInboxHelp(false); };
          const Sw = ({ on, onChange, label }) => (
            <button className={"vb-sw" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label}
              onClick={onChange}><i /></button>
          );
          return (
          <div className="vb-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <div className="vb-card vb-set">
              <div className="vb-sethead">
                <h3>설정</h3>
                <button className="vb-setx" onClick={close} aria-label="닫기"><Bi name="x-lg" /></button>
              </div>

              <div className="vb-setgrp">AI</div>
              <div className="vb-setlist">
                {tapModels.length > 0 && (
                  <label className="vb-setrow">
                    <Bi name="stars" className="ic" />
                    <span className="tx"><b>단어 탭</b>{tapNow?.note && <small>{tapNow.note}</small>}</span>
                    <span className="vb-setsel">
                      <select value={cfg.tapModel || ""} onChange={(e) => setCfg({ ...cfg, tapModel: e.target.value })}>
                        <option value="">자동{tapModels.find((m) => m.id === tapDef) ? ` · ${tapModels.find((m) => m.id === tapDef).label}` : ""}</option>
                        {tapModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}{health[m.id] && !health[m.id].ok ? ` (${healthOf(m.id)?.text})` : ""}
                          </option>
                        ))}
                      </select>
                      <Bi name="chevron-expand" />
                    </span>
                  </label>
                )}
                {models.length > 0 && (
                  <label className="vb-setrow">
                    <Bi name="chat" className="ic" />
                    <span className="tx"><b>질문</b>{askNow?.note && <small>{askNow.note}</small>}</span>
                    <span className="vb-setsel">
                      <select value={cfg.askModel || ""} onChange={(e) => setCfg({ ...cfg, askModel: e.target.value })}>
                        <option value="">자동{defLabel ? ` · ${defLabel}` : ""}</option>
                        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                      <Bi name="chevron-expand" />
                    </span>
                  </label>
                )}
                <div className="vb-setrow">
                  <Bi name="book" className="ic" />
                  <span className="tx"><b>영어 사전 먼저</b></span>
                  <Sw on={cfg.useDict} label="영어 사전 먼저" onChange={() => setCfg({ ...cfg, useDict: !cfg.useDict })} />
                </div>
                <div className="vb-setrow">
                  <Bi name="cpu" className="ic" />
                  <span className="tx">
                    <b>모델 목록</b>
                    <small>
                      {mdlInfo.discovering ? "찾는 중…"
                        : mdlInfo.updatedAt ? `${new Date(mdlInfo.updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })} · 질문 ${models.length} · 탭 ${tapModels.length}` : ""}
                    </small>
                  </span>
                  <button className={"vb-setic" + (mdlInfo.discovering ? " spin" : "")} disabled={mdlInfo.discovering}
                    aria-label="다시 찾기" onClick={async () => {
                      try { await libApi("/api/models/refresh", { method: "POST" }); } catch {}
                      setMdlInfo((m) => ({ ...m, discovering: true }));
                    }}><Bi name="arrow-repeat" /></button>
                </div>
              </div>

              <div className="vb-setgrp">기기</div>
              <div className="vb-setlist">
                <div className="vb-setrow">
                  <Bi name="phone" className="ic" />
                  <span className="tx"><b>폰 리모트</b><small>단어·문장 탭을 폰에 보여요</small></span>
                  <Sw on={remoteOn} label="폰 리모트" onChange={toggleRemote} />
                </div>
                {pdfStore && (
                  <div className="vb-setrow">
                    <Bi name="hdd" className="ic" />
                    <span className="tx"><b>저장된 PDF</b>
                      <small>{pdfStore.n}권 · {(pdfStore.bytes / 1024 ** 2).toFixed(0)}MB · 이틀 안 열면 지워요</small></span>
                    <button className="vb-setic" disabled={!pdfStore.n} aria-label="모두 지우기" onClick={async () => {
                      await clearPdfs();
                      setPdfStore(cacheInfo());
                    }}><Bi name="trash3" /></button>
                  </div>
                )}
              </div>

              {inbox?.enabled && (<>
                <div className="vb-setgrp">
                  단축어로 PDF 넣기
                  <button className={"vb-sethelp" + (inboxHelp ? " on" : "")} onClick={() => setInboxHelp((v) => !v)}
                    aria-label="설정 방법"><Bi name="question-circle" /></button>
                </div>
                <div className="vb-setlist">
                  <div className="vb-setrow">
                    <Bi name="link-45deg" className="ic" />
                    <span className="tx"><code>{location.origin + u("/api/inbox")}</code></span>
                    <button className="vb-setic" aria-label="주소 복사"
                      onClick={() => copyInbox("url", location.origin + u("/api/inbox"))}>
                      <Bi name={inboxCopied === "url" ? "check2" : "copy"} />
                    </button>
                  </div>
                  <div className="vb-setrow">
                    <Bi name="key" className="ic" />
                    <span className="tx"><code>Bearer {inbox.token.slice(0, 6)}…</code></span>
                    <button className="vb-setic" aria-label="토큰 복사"
                      onClick={() => copyInbox("tok", "Bearer " + inbox.token)}>
                      <Bi name={inboxCopied === "tok" ? "check2" : "copy"} />
                    </button>
                  </div>
                </div>
                {inboxHelp && (
                  <p className="vb-setnote">
                    <b>URL 콘텐츠 가져오기</b> · 메소드 <b>POST</b> · 헤더 <b>Authorization</b>에 토큰 ·
                    본문 <b>양식</b>, 키 <b>file</b>에 PDF. 폴더는 주소 끝에 <b>?folder=이름</b>.
                  </p>
                )}
              </>)}
            </div>
          </div>
          );
        })()}

        {/* 이름 정리 — 형식을 적어 제안을 받고, 미리보기에서 고치거나 빼고, 적용을 눌러야 반영된다 */}
        {renOpen && (
          <div className="vb-modal" onClick={(e) => { if (e.target === e.currentTarget && !renBusy) closeRename(); }}>
            <div className="vb-card ren">
              <h3>이름 정리</h3>
              {!renRows ? (
                <>
                  <p className="vb-sub">
                    지금 보고 있는 문서 {renTargets.length}개의 이름을 원하는 형식으로 맞춥니다.
                    각 문서의 첫 쪽을 읽어 제목을 찾고 <b>제안만</b> 보여줍니다 — 확인하고 적용을 눌러야 실제로 바뀝니다.
                  </p>
                  <div className="vb-field">
                    <label>원하는 형식</label>
                    <textarea className="vb-rentext" rows={3} autoFocus value={renPrompt}
                      disabled={!!renBusy}
                      onChange={(e) => setRenPrompt(e.target.value)}
                      placeholder={'예: 논리회로 강의 노트들이야. "논리회로 3주차 — 카르노맵"처럼 과목·주차·주제 순으로 통일해줘'} />
                  </div>
                </>
              ) : (
                <>
                  <p className="vb-sub">
                    {renRows.filter((r) => !r.same).length}개를 바꿉니다. 이름을 직접 고칠 수 있고,
                    ✕ 로 뺀 문서는 그대로 둡니다.
                  </p>
                  <div className="vb-renlist">
                    {renRows.map((r) => {
                      const f = lib.files.find((x) => x.id === r.id);
                      return (
                        <div className={"vb-renrow" + (r.same ? " same" : "")} key={r.id}>
                          <div className="vb-renthumb">
                            {f?.thumb ? (
                              <img src={u("/api/library/thumb/") + r.id} alt="" loading="lazy" />
                            ) : (
                              <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" /></svg>
                            )}
                          </div>
                          <div className="vb-rencol">
                            <input className="vb-reninput" value={r.name}
                              onChange={(e) => setRenRows((rs) => rs.map((x) =>
                                x.id === r.id ? { ...x, name: e.target.value, same: e.target.value === x.from } : x))} />
                            <div className="vb-renfrom" title={r.from}>
                              {r.same ? "그대로" : r.from}
                            </div>
                          </div>
                          <button className="vb-ib" aria-label="목록에서 빼기" title="목록에서 빼기"
                            onClick={() => setRenRows((rs) => rs.filter((x) => x.id !== r.id))}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {renBusy && <div className="vb-renbusy">{renBusy}</div>}
              {renErr && <div className="vb-err">{renErr}</div>}
              <div className="vb-renfoot">
                <button className="vb-libbtn" onClick={closeRename}>취소</button>
                {!renRows ? (
                  <button className="vb-libbtn pri" disabled={!renPrompt.trim() || !!renBusy}
                    onClick={suggestNames}>제안받기</button>
                ) : (
                  <button className="vb-libbtn pri"
                    disabled={!!renBusy || !renRows.some((r) => !r.same)}
                    onClick={applyRename}>적용</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 애플펜슬로 긋는 동안의 미리보기 — 오버레이와 같은 .vb-root 직속(position:fixed).
          pointer-events:none 이라 진행 중인 터치를 건드리지 않는다. */}
      {penSel && (
        <div className="vb-pensel"
          style={{ left: penSel.left, top: penSel.top, width: penSel.w, height: penSel.h }} />
      )}

      {/* 영역 캡처 오버레이 — .vb-root 직속이라 position:fixed 가 뷰포트 기준으로 잡힌다 */}
      {capMode && capBox && (
        <div className={"vb-cap" + (capBusy ? " busy" : "")}
          style={{ left: capBox.left, top: capBox.top, width: capBox.width, height: capBox.height }}
          onPointerDown={capDown} onPointerMove={capMove}
          onPointerUp={capUp} onPointerCancel={capUp}>
          {!capSel && <div className="vb-caphint">읽고 싶은 부분을 드래그해서 감싸세요 · Escape 로 나가기</div>}
          {capSel && (
            <>
              <div className="vb-capsel"
                style={{ left: capSel.x, top: capSel.y, width: capSel.w, height: capSel.h }} />
              {[["nw", 0, 0], ["ne", 1, 0], ["sw", 0, 1], ["se", 1, 1]].map(([k, cx, cy]) => (
                <div key={k} className="vb-caph" data-caph={k}
                  style={{ left: capSel.x + capSel.w * cx - 11, top: capSel.y + capSel.h * cy - 11 }} />
              ))}
              <div className="vb-capmenu"
                style={{
                  left: Math.max(4, Math.min((capBox.width || 0) - 310, capSel.x + capSel.w / 2 - 155)),
                  top: capSel.y > 62 ? capSel.y - 58 : capSel.y + capSel.h + 10,
                }}
                onPointerDown={(e) => e.stopPropagation()}>
                <button className="vb-capbtn" disabled={!!capBusy} onClick={() => runCapture("read")}>
                  {capBusy === "read" ? "읽는 중…" : "해석"}
                </button>
                <button className="vb-capbtn" disabled={!!capBusy} onClick={() => runCapture("solve")}>
                  {capBusy === "solve" ? "읽는 중…" : "문제풀이"}
                </button>
                <button className="vb-capbtn" disabled={!!capBusy} onClick={runCaptureAsk}>
                  {capBusy === "ask" ? "여는 중…" : "질문"}
                </button>
                <button className="vb-capbtn ghost" disabled={!!capBusy} onClick={() => setCapSel(null)}>다시</button>
                <button className="vb-capbtn ghost" disabled={!!capBusy} onClick={exitCap}>닫기</button>
              </div>
            </>
          )}
        </div>
      )}

      <input ref={fileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
        onChange={(e) => { readFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
