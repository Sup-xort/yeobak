import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import "katex/dist/katex.min.css";
import "./App.css";
import Rich from "./rich.jsx";

/* ───────────────────────── 설정 ───────────────────────── */
const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
/* API 키는 전부 서버(.env)에 있다. 브라우저는 /api/chat 만 부른다. */
const DEFAULT_CFG = {
  forceGemini: false,
  useDict: true,
  askModel: "", // 질문 탭 모델. 빈 값이면 서버 기본값
};

/* ── 질문 탭 세션 ──
   대화는 세션 단위로 묶인다. 세션 안에서만 모델이 앞의 문답을 기억한다.
   영역을 캡처하면 늘 새 세션이 열린다 — 캡처는 대개 앞의 대화와 무관한
   새 문제이고, 섞이면 모델이 엉뚱한 문제의 조건을 끌고 온다.
   2시간이 지난 세션은 버린다. 마지막 활동 기준이라 대화가 이어지는 동안은 살아 있다. */
const SESS_TTL = 2 * 60 * 60 * 1000;
const SESS_MAX = 20;      // 이보다 많아지면 오래된 것부터 버린다
const SESS_KEY = "yeobaek.ask";
const WIDE = 880;
/* 서재 카드의 "매트" 규격 — 슬롯 높이(px)와 좁은 화면 축소율, 비율을 모를 때 쓰는 A4 세로.
   SLOT_H 는 App.css 의 .vb-slot / .vb-slot.sm 높이와 같이 움직여야 한다. */
const SLOT_H = 132;
const NARROW_S = 114 / SLOT_H; // .vb-slot.sm 이 114px
const A4_RATIO = 210 / 297;
/* 터치 기기 여부 — 로그인 키패드에서 OS 키보드를 언제 띄울지 정하는 데만 쓴다 */
const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer:coarse)").matches;
/* 애플펜슬 드래그 캡처 토글을 사파리에서만 보여준다 — 이 제스처는 사파리/웹킷의
   PointerEvent pointerType:"pen" 구분에 기대는데, 크롬 계열은 아이패드에서도 펜을
   touch 로 뭉뚱그려 보고할 때가 있어 다른 브라우저에서는 조용히 안 켜지는 게 낫다. */
const IS_SAFARI =
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

/* ── 서재 인사말 ──
   시간대(새벽·아침·낮·저녁·밤) × 맥락(처음·이어읽기·오랜만) 두 축에서 문장을 고른다.
   문구 구조는 design_handoff_yeobaek_library_and_brand/여백 서재.dc.html 의 SLOTS 를
   그대로 옮겼다 — 다만 그 시안은 전부 더미 문구("7쪽" 같은 고정 숫자)라, 여기서는 실제
   서재 데이터(최근 연 문서 제목·쪽수)로 채운다. "이어읽기" 인지 "오랜만" 인지는 그 문서의
   lastOpenedAt 이 갈라서 정한다(48시간 기준).
   같은 문장이 연달아 뜨지 않도록 직전에 보여준 조합의 키를 localStorage 에 남겨 두고
   다음 선택에서 제외한다 — 서재 화면은 매번 새로 마운트되지 않으니(SPA), 서재를 다시
   열 때마다가 아니라 앱을 새로 불러올 때 한 번만 고른다(walk-in 인사말이지 실시간 위젯이 아니다). */
const GREET_STAMP = ["새벽", "아침", "낮", "저녁", "밤"];
const greetTimeIdx = (h) => (h < 5 ? 0 : h < 11 ? 1 : h < 17 ? 2 : h < 21 ? 3 : 4);
const GREET_DORMANT_HOURS = 96; // 이보다 오래 안 열었으면 "오랜만"

const GREET_NEW = [
  ["처음 오셨네요.", "PDF를 끌어다 놓거나 위의 'PDF 추가'로 서재를 채워보세요."],
  ["여백에 오신 걸 환영합니다.", "단어는 탭 한 번, 문장은 두 번, 구간은 드래그로 풀이합니다."],
  ["빈 서재입니다.", "자료를 넣으면 표지와 함께 여기 꽂힙니다."],
];
const greetDormant = (at) => [
  ["오랜만이네요.", at ? `${at}가 그대로 남아 있습니다.` : "서재를 둘러볼까요?"],
  ["다시 만나 반갑습니다.", "새로 시작해도, 이어서 봐도 좋습니다."],
  ["한동안 안 오셨네요.", at ? `${at}에서 이어가 볼까요?` : "새 자료를 열어볼까요?"],
];
const greetResume = (at) => [
  [ // 새벽
    ["아직 아무도 깨지 않았네요.", "조용한 시간엔 어려운 장이 더 잘 읽히더군요."],
    ["밤을 넘기셨군요.", "15분만 더 읽고 덮는 것도 좋은 선택입니다."],
    ["불 켜진 방이 여기 하나.", at ? `${at}에서 이어가시겠어요?` : "이어서 읽어볼까요?"],
  ],
  [ // 아침
    ["좋은 아침입니다.", at ? `${at}에서 멈추셨어요.` : "오늘도 좋은 하루 보내세요."],
    ["오늘 첫 페이지를 열어볼까요.", "아침엔 새 챕터를 시작하기 좋습니다."],
    ["일찍 오셨네요.", at ? `${at}, 짧게 이어가 볼까요?` : "짧게 한 챕터 어떠세요."],
  ],
  [ // 낮
    ["이어서 읽을 준비가 되셨나요.", at ? `${at}에서 기다리고 있습니다.` : "새 자료를 열어볼까요?"],
    ["한낮의 30분.", at ? `${at}로 돌아가 볼까요?` : "잠깐 짬을 내 읽어볼까요?"],
    ["다시 오셨군요.", "읽던 자리로 바로 갈까요, 아니면 새 자료를 열까요?"],
  ],
  [ // 저녁
    ["하루를 덮기 전에, 한 챕터.", at ? `${at}가 기다리고 있습니다.` : "가볍게 한 챕터 어떠세요."],
    ["저녁입니다.", "가벼운 걸 읽어도 좋고, 읽던 곳으로 돌아가도 좋습니다."],
    ["수고하셨어요.", at ? `${at}가 그대로 있습니다.` : "오늘 하루도 고생 많으셨어요."],
  ],
  [ // 밤
    ["늦은 시간이네요.", "짧게 읽고 덮으시겠어요? 자리는 기억해두겠습니다."],
    ["오늘의 마지막 페이지.", "어려운 장은 내일 아침으로 미뤄도 괜찮습니다."],
    ["조용한 밤입니다.", at ? `${at}에서 이어가 볼까요?` : "화면을 어둡게 해두었어요."],
  ],
];

export function pickGreeting(libData, storageKey = "yeobaek.greet") {
  const now = new Date();
  const timeIdx = greetTimeIdx(now.getHours());
  const stamp = `${GREET_STAMP[timeIdx]} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const files = libData?.files || [];
  const recent = files.length
    ? [...files].sort((a, b) => (b.lastOpenedAt || b.at || 0) - (a.lastOpenedAt || a.at || 0))[0]
    : null;
  const hoursSince = recent ? (Date.now() - (recent.lastOpenedAt || recent.at || 0)) / 3_600_000 : Infinity;
  const at = recent
    ? `《${recent.name}》 ${recent.lastPage || 1}쪽${recent.totalPages ? ` · 전체 ${recent.totalPages}쪽` : ""}`
    : "";

  let mode, pool;
  if (!files.length) { mode = "new"; pool = GREET_NEW; }
  else if (hoursSince > GREET_DORMANT_HOURS) { mode = "dormant"; pool = greetDormant(at); }
  else { mode = "resume"; pool = greetResume(at)[timeIdx]; }

  let last = "";
  try { last = localStorage.getItem(storageKey) || ""; } catch {}
  const keyOf = (i) => `${mode}:${timeIdx}:${i}`;
  const idxPool = pool.map((_, i) => i);
  const candidates = idxPool.filter((i) => keyOf(i) !== last);
  const pick = candidates.length ? candidates : idxPool;
  const idx = pick[Math.floor(Math.random() * pick.length)];
  try { localStorage.setItem(storageKey, keyOf(idx)); } catch {}

  const [line, sub] = pool[idx];
  return { stamp, line, sub };
}


/* ───────────────── AI 호출 (Claude → Gemini) ───────────────── */
async function readSSE(res, pick, onDelta, onThink, onStop) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("event-stream")) {
    const j = await res.json();
    const t = pick.whole(j);
    if (t) onDelta?.(t);
    const fr = pick.stop?.(j);
    if (fr) onStop?.(fr);
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
      if (t) { out += t; onDelta?.(t); }
      // 추론 모델의 속생각. 화면에는 안 쓰지만 "살아 있다"는 유일한 증거다.
      const k = pick.think?.(j);
      if (k) onThink?.(k);
      const fr = pick.stop?.(j);
      if (fr) onStop?.(fr);
    }
  }
  return out;
}

/* 서버는 프로바이더와 무관하게 항상 OpenAI 형식 SSE 로 응답한다.
   reasoning_content 는 Nemotron 같은 추론 모델이 답 이전에 흘리는 속생각이다.
   답(content)과 섞으면 안 되지만(실측 Nemotron: 생각 879자 → 답 862자),
   버리기만 하면 그동안 화면이 비어 멈춘 것처럼 보인다 — 상태줄에서만 쓴다. */
const PICK_OPENAI = {
  delta: (j) => j.choices?.[0]?.delta?.content || "",
  think: (j) => j.choices?.[0]?.delta?.reasoning_content || "",
  whole: (j) => j.choices?.[0]?.message?.content || "",
  // "length" 면 상한에 걸려 말이 끊긴 것이다 — 정상 종료("stop")와 반드시 갈라야 한다
  stop: (j) => j.choices?.[0]?.finish_reason || "",
};

class AuthError extends Error {
  constructor() { super("로그인이 필요합니다."); this.name = "AuthError"; }
}

/* opts.ask = true 면 서버가 질문 탭 전용 모델(opts.model 또는 서버 기본값)로 부른다. */
async function callServer(cfg, system, user, onDelta, signal, opts = {}) {
  const res = await fetch("/api/chat", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system, user,
      // 영역 캡처 이미지(base64 JPEG). 있으면 서버가 비전 모델 체인으로 보낸다.
      image: opts.image || "",
      // 같은 세션의 지난 문답. 서버가 system 과 현재 user 사이에 끼워 넣는다.
      history: opts.history || [],
      // 질문 탭은 길게 쓰는 모델(DeepSeek V4 Pro·MiniMax M3)이 2000 에서 말을 하다 말았다.
      // 추론 모델은 이 예산으로 속생각까지 쓰므로 더 빨리 닿는다 — 서버 상한(8000)까지 연다.
      maxTokens: opts.maxTokens ?? (opts.ask ? 8000 : 1000),
      forceGemini: !!cfg.forceGemini,
      ask: !!opts.ask,
      model: opts.ask ? cfg.askModel || "" : "",
    }),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    let d = "";
    try { d = (await res.json()).error || ""; } catch {}
    throw new Error("요청 실패 " + res.status + (d ? ": " + d : ""));
  }
  const engine = res.headers.get("X-Engine") || "";
  const model = res.headers.get("X-Model") || "";
  // 고른 모델이 붐벼서 다른 모델이 대신 답했으면 서버가 원래 고른 쪽을 여기 담아 준다.
  const wanted = res.headers.get("X-Wanted") || "";
  if (wanted) opts.onPhase?.("swap", { wanted, model });
  /* 여기까지 왔다는 건 서버가 업스트림에 붙는 데 성공했다는 뜻이다.
     이 시점부터 첫 글자까지의 침묵은 "모델이 생각 중"과 "죽었다"를 구분할 수 없다 —
     그래서 상태만 알리고 끊는 판단은 사람에게 맡긴다. */
  opts.onPhase?.("wait", { engine, model });
  let first = true;
  let think = 0;
  let stop = "";
  const text = await readSSE(res, PICK_OPENAI, (c) => {
    if (first) { first = false; opts.onPhase?.("stream", { engine, model }); }
    opts.onPhase?.("tick");
    // 스트림을 화면에 안 뿌리는 호출자(이름 정리처럼 결과 전체만 쓰는 쪽)는 onDelta 를 안 넘긴다
    onDelta?.(c);
  }, (k) => {
    // 속생각이 흐르는 동안은 답이 한 글자도 안 나온다. 그래도 모델은 일하고 있다.
    think += k.length;
    opts.onPhase?.("think", { engine, model, think });
  }, (fr) => { stop = fr; });
  // 상한에 걸려 끊긴 걸 조용히 넘기면 화면에는 "다 답했다"로 보인다 — 호출자에게 알린다
  if (stop === "length") opts.onPhase?.("cut", { engine, model });
  return { text, engine, model, truncated: stop === "length" };
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
/* 화면 세로좌표 y 아래에 있는 페이지 번호(1-based).
   페이지는 세로 한 줄로 쌓이므로 rect.top 이 인덱스에 대해 단조 증가한다 — 이진 탐색으로 찾는다.
   curRef 가 얼마나 어긋나 있든 답이 옳다는 게 핵심이다. 예전엔 curRef 주변 ±10쪽만 훑어서,
   핀치나 빠른 스크롤로 curRef 가 멀어지면 창 안에서 아무것도 못 찾고 그대로 굳었다.
   그 결과 쪽번호가 실제 화면과 어긋나고, prune 이 보고 있는 페이지를 지워 흰 화면이 뜨고,
   핀치 앵커가 엉뚱한 페이지를 가리켜 이상한 곳으로 넘어갔다.
   변환(핀치 중 CSS scale)이 걸려 있어도 getBoundingClientRect 는 변환 후 좌표라 그대로 쓴다. */
const pageAt = (pages, y) => {
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
const markSpans = (els, cls) => {
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
const fmtSize = (b) =>
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
function parseWord(s) {
  const m = s.match(/뜻\s*:\s*([\s\S]*?)(?:\n\s*문맥\s*:|$)/);
  const c = s.match(/문맥\s*:\s*([\s\S]*)$/);
  return { mean: m ? m[1].trim() : "", ctx: c ? c[1].trim() : "" };
}

const SYS_WORD = `너는 한국 대학생이 영어 원서·논문을 읽을 때 옆에서 짚어주는 사람이다.
답은 한국어로, 군더더기 없이 짧게. 인사·서론·마무리 문장 금지. 마크다운 기호 금지.
반드시 아래 두 줄 형식만 출력한다:
뜻: <사전적 의미 1~3개를 ' / '로 구분해 한 줄>
문맥: <"여기서는 '…'" 로 그 낱말이 취한 뜻을 말하는 한 문장. 그게 전부다.>

문맥 줄에서 설명할 대상은 문장이 아니라 낱말 하나다. 이걸 어기는 답이 제일 흔하다.
- 한 문장으로 끝낸다. 뜻을 말한 뒤에 이 문장이 무슨 얘기인지 덧붙이지 않는다.
- 문장을 번역하거나 요약하지 않는다. 문장이 무슨 상황을 말하는지도 쓰지 않는다.
  그건 이 앱의 다른 기능(문장 해석)이 따로 한다.
- 문장에 나오는 다른 낱말(주어·목적어·수식)의 내용을 옮겨 적지 않는다.
- 뜻이 정말 갈리는 낱말일 때만 "…가 아니라" 로 아닌 쪽을 짚어준다.
  거의 같은 뜻끼리 억지로 대비시키지 않는다("'산출하다'가 아니라 '초래한다'" 같은 건 틀린 대비다).
- 보기) 문장 "The reaction yields a stable compound." 의 낱말 yields
  좋음 → 문맥: 여기서는 '양보하다'가 아니라 '(결과로) 내놓다·산출하다'. 무엇이 나오는지를 이끄는 동사다.
  나쁨 → 문맥: 그 반응이 안정한 화합물을 만들어낸다는 뜻이다. (낱말이 아니라 문장을 풀었으므로 안 된다)`;

const SYS_SENT = `너는 영어 원서·논문을 읽는 한국 대학생의 번역 파트너다.
입력 문장을 자연스러운 한국어로 옮긴다. 직역투를 피하고 전문 용어는 원어를 괄호로 병기한다.
번역문만 출력한다. 인사·설명·마크다운 금지.
문장 구조가 까다로울 때만 마지막 줄에 "핵심: "으로 시작하는 한 줄을 덧붙인다.`;

/* 답변은 마크다운·LaTeX 로 그린다(src/rich.jsx). 세 캡처 프롬프트도 같은 규칙을 쓴다. */
const FMT_RICH = `마크다운으로 쓴다. 소제목·목록·표·굵게를 필요한 만큼만 쓰고 장식용으로 남발하지 않는다.
수식과 기호는 반드시 LaTeX 로 쓴다 — 문장 안에서는 $…$, 따로 세울 때는 $$…$$.
(예: $O(n\\log n)$, $\\frac{\\partial f}{\\partial x}$) 유니코드 첨자나 ASCII 흉내는 쓰지 않는다.`;

const SYS_ASK = `너는 한국 대학생이 읽고 있는 문서를 함께 보는 튜터다.
아래에 [문서] 블록이 이어진다. 그건 상대가 방금 건넨 말이 아니라 둘이 같이 펼쳐 놓고 보는 자료다.
질문은 오직 대화 쪽에만 있다. 문서에서 근거를 찾아 한국어로 답하고, 필요하면 원문 표현을 쪽수와 함께 인용한다.

이건 이어지는 하나의 대화다. 답하기 전에 앞에서 무엇을 물었고 무엇이라 답했는지부터 떠올린다.
- "그럼", "왜", "그거", "아까 그건", "더 자세히", "예를 들면" 처럼 혼자서는 뜻이 서지 않는 말은
  전부 바로 앞 문답을 가리킨다. 무엇을 말하는 거냐고 되묻지 말고 그대로 이어받는다.
- 앞에서 이미 한 설명을 처음부터 다시 늘어놓지 않는다. 이어질 부분만 말한다.
- 앞에서 쓴 기호·용어·가정을 그대로 유지한다. 바꿔야 하면 바뀌었다고 밝히고 바꾼다.
- 화제가 정말 바뀐 게 아니면 앞의 화제 안에서 답한다. 읽는 쪽이 넘어갔다고 화제까지 넘기지 않는다.
- 앞의 답이 틀렸다는 지적을 받으면 변명하지 말고 고쳐서 다시 답한다.

짧고 정확하게. 본문에 없는 내용은 추측이라고 밝힌다. 인사말 없이 바로 답한다.
${FMT_RICH}`;

/* ── 이름 정리 프롬프트 ──
   서재의 여러 문서 이름을 사용자가 말한 형식으로 한 번에 맞춘다. 모델은 파일을 건드리지 않고
   "제안"만 JSON 으로 내놓는다 — 실제 변경은 사용자가 미리보기에서 확인하고 누를 때 일어난다.
   지어내기를 막는 줄("근거가 없으면 현재 이름 그대로")이 핵심이다. 회차 번호를 상상해서 붙이면
   겉보기엔 그럴듯한데 전부 틀린 이름이 한꺼번에 박힌다. */
const SYS_RENAME = `너는 사용자의 문서 서재를 정리하는 사서다.
사용자가 원하는 이름 형식과 문서 목록(현재 이름 + 첫 쪽 본문 일부)을 받는다.

규칙:
- JSON 만 출력한다. 설명·인사·코드펜스 금지.
- 형식: {"names":[{"i":0,"name":"새 이름"},{"i":1,"name":"새 이름"}]}
- i 는 입력에 적힌 번호를 그대로 쓴다. 목록의 모든 문서를 빠짐없이 포함한다.
- 확장자(.pdf)는 붙이지 않는다.
- / \\ : * ? " < > | 문자는 쓰지 않는다. 이름은 80자를 넘기지 않는다.
- 현재 이름과 첫 쪽 본문에 실제로 있는 정보만 쓴다. 회차·주차·장 번호를 지어내지 않는다.
  근거가 없으면 현재 이름을 그대로 name 에 넣는다.
- 사용자가 말한 종류에 해당하지 않는 문서는 형식을 억지로 맞추지 말고 현재 이름을 그대로 둔다.
  예를 들어 강의 노트 형식을 요청했는데 그 문서가 교재·문제지·시험지·논문이면 건드리지 않는다.
  전체를 다 바꾸는 것보다 아닌 것을 안 바꾸는 쪽이 중요하다.
- 사용자가 말한 형식을 모든 문서에 같은 방식으로 적용한다.`;

/* ── 영역 캡처 프롬프트 ──
   "해석"만 비전 모델이 한 번에 처리한다 — 오려내고 바로 읽는 가벼운 동작이라
   옮겨적기가 끝날 때까지 첫 글자를 못 보는 쪽이 더 나쁘고, 원문 번역은 그림을
   보면서 하는 편이 자연스럽기 때문이다.
   나머지("문제풀이", 질문 탭에 얹은 그림)는 두 단계로 나눈다: 비전 모델이 눈 역할로
   옮겨적고(SYS_CAP_DESCRIBE), 실제 추론은 질문 탭 모델(DeepSeek 등)이 한다.
   비전 모델은 글자를 잘 읽지만 추론은 텍스트 전용 모델이 더 낫기 때문이다. */
const SYS_CAP_READ = `너는 한국 대학생이 읽는 원서·교재의 한 부분을 함께 보는 번역·해설자다.
주어진 이미지는 지금 읽고 있는 쪽에서 오려낸 영역이다. 이미지에 보이는 것만 근거로 삼는다.
먼저 보이는 본문을 자연스러운 한국어로 옮기고, 이어서 이해에 필요한 만큼만 짧게 풀어 설명한다.
수식·기호·표는 읽은 그대로 옮기고 각 기호가 무엇을 뜻하는지 밝힌다.
전문 용어는 원어를 괄호로 병기한다. 인사말·마무리 문장 금지.
이미지가 흐리거나 글자를 알아볼 수 없으면 추측하지 말고 그 사실을 먼저 밝힌다.
${FMT_RICH}`;

/* gemma는 "보는" 역할만 하고 실제 풀이·답변은 늘 사용자가 고른 질문 탭 모델이다
   (그래서 SYS_CAP_SOLVE처럼 풀거나 해설하지 않는다). 그림·회로도·그래프도
   [그림: 한 줄]로 뭉개지 않고 그 자체를 글로 자세히 옮긴다 — 이 설명이 나간 뒤로는
   아무도 원본 이미지를 다시 안 보므로, 여기서 빠진 건 영영 없는 셈이 된다.
   옮긴 결과는 화면에도 그대로 뜬다 — 잘못 읽은 걸 사용자가 알아챌 유일한 창구다.
   그래서 수식만 LaTeX 로 받고 나머지 마크다운은 시키지 않는다(원문 그대로가 중요하다).

   "이름을 붙이기 전에 모양부터 확인하라"는 문단은 실측으로 넣었다(2026-08-03, CH4 31쪽의
   전가산기 회로도를 게이트만 오려내 시험). 그 문단이 없으면 gemma 는 XOR 을 OR 로 읽었고
   (두 번 다), 그 글을 받은 질문 탭 모델은 흠 없는 풀이로 Sum = x + y + c_in 이라는 오답을
   냈다 — 전제만 틀리고 추론은 완벽해서 알아채기 가장 어려운 종류다. 되물을 수 있게 해도
   못 고친다: 설명이 빠진 게 아니라 틀렸을 때는 모델이 의심할 근거 자체가 없다.
   근거를 괄호에 적게 하는 건 판정을 건너뛰지 못하게 붙잡는 장치다. 이름만 적게 하면
   다시 틀리고, 모양만 적게 하면("입력 쪽 두 겹") 답변 모델이 그 표현을 사용자의 말로 알고
   모양 설명까지 늘어놓는다. */
const SYS_CAP_DESCRIBE = `이미지에 보이는 내용을 글로 옮긴다. 해석·풀이·요약은 하지 않는다.
글자·수식은 있는 그대로 옮긴다 — 수식은 LaTeX로($…$, 필요하면 $$…$$).
그림·회로도·그래프가 있으면, 이걸 못 보는 사람이 이 글만 읽고도 알 수 있도록 자세히 묘사한다
(부품 종류와 연결 관계, 축 이름과 눈금, 곡선의 모양과 변화 등 — 한 줄로 뭉뚱그리지 않는다).
기호에 이름을 붙일 때는 모양을 먼저 확인하고 정한다 — OR 은 입력 쪽 선이 한 겹, XOR 은 두 겹,
출력 쪽 작은 동그라미는 부정(NAND/NOR/NOT)이다. 확인한 근거는 이름 뒤 괄호에 짧게 적는다
(예: "XOR 게이트(입력 쪽 두 겹)"). 모양이 애매하면 이름 대신 본 모양을 적는다.
표는 행마다 줄을 나눠 옮긴다. 문제 번호와 보기 기호(①, (a) 등)를 빠뜨리지 않는다.
알아볼 수 없는 글자는 [?]로 표시한다. 옮긴 내용만 출력한다.`;

/* 옮겨 적은 글을 답변 모델에게 넘길 때 늘 앞에 붙인다. 출처를 안 밝히면 모델이 이 글을
   읽는 이가 직접 쓴 말로 알고 거기 눈높이를 맞춘다 — 실제로 "두 겹 게이트는 XOR을
   의미한다"처럼, 사람은 쓴 적도 없는 표현을 붙들고 설명을 늘어놓는 일이 있었다.
   기계가 옮긴 글이라고 알려 주면 그 표현은 판정 근거로만 쓰고 답에는 안 끌고 나온다. */
const FIG_NOTE = "[오려낸 그림을 비전 모델(gemma)이 글로 옮긴 것 — 읽는 이가 쓴 말이 아니고, " +
  "잘못 읽었을 수 있다. 앞뒤가 안 맞으면 짚어 주고, 이 글의 표현을 그대로 인용하지는 않는다]";

const SYS_CAP_SOLVE = `너는 한국 대학생의 문제풀이 조교다. 주어진 문제를 한국어로 푼다.
답만 던지지 말고 풀이 과정을 단계로 나눠 보여주되, 군더더기 없이 짧게.
근거가 되는 정의·법칙은 이름을 밝힌다(예: 드모르간 법칙).
이어지는 질문이 오면 앞의 풀이를 기억하고 그 위에서 답한다.
마지막 줄에 "**답:** "으로 시작하는 한 줄로 최종 답을 적는다.
문제가 불완전해서 풀 수 없으면 무엇이 빠졌는지 밝힌다. 인사말 금지.
${FMT_RICH}`;

/* ── 목차 자동 생성 ──
   출력은 JSON 배열 하나뿐이어야 한다 — 코드펜스나 설명이 섞이면 클라이언트의
   "첫 [ 부터 마지막 ] 까지"파싱이 그 안의 텍스트까지 함께 집어삼켜 깨진다. */
const SYS_OUTLINE = `너는 책의 각 쪽 본문을 보고 목차(장·절 제목과 시작 쪽번호)를 뽑아내는 도구다.
입력은 "[N쪽] 본문 일부" 형식으로 여러 쪽이 이어져 있다. 그중 장(chapter)·절(section) 제목으로
보이는 부분만 골라 아래와 같은 JSON 배열 하나만 출력한다 — 설명, 인사말, 마크다운 코드펜스 없이 순수 JSON만:
[{"title": "1장 서론", "page": 3, "depth": 0}, {"title": "1.1 배경", "page": 4, "depth": 1}]
규칙:
- title 은 원문에 실제로 나온 제목 그대로 옮긴다(번역·요약·재작성 금지).
- depth 는 0(장/큰 제목) 또는 1(절/작은 제목)만 쓴다.
- page 는 그 제목이 시작되는 쪽의 번호([N쪽] 표시)를 그대로 쓴다.
- 표지·저작권·목차 자체·참고문헌·색인·연습문제처럼 장/절 제목이 아닌 것은 넣지 않는다.
- 확신이 없으면 넣지 않는다. 최소 3개, 최대 80개.`;

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
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [busy, setBusy] = useState(false);
  const [sheetFrac, setSheetFrac] = useState(0.46);
  const [bubble, setBubble] = useState(null);
  const [wide, setWide] = useState(true);
  const [zoomPill, setZoomPill] = useState(null);
  const [authed, setAuthed] = useState(null); // null = 확인 중
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [models, setModels] = useState([]);      // 질문 탭에서 고를 수 있는 모델
  const [defModel, setDefModel] = useState("");  // 서버 기본값
  const [health, setHealth] = useState({});      // 모델 id → {ok, status, at, ms}
  const [healthBusy, setHealthBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(true);  // 서재 화면 (문서가 없으면 항상 열림)
  const [lib, setLib] = useState({ folders: [], files: [] });
  const [libFolder, setLibFolder] = useState(""); // "" = 최상위
  const [libErr, setLibErr] = useState("");
  const [folInput, setFolInput] = useState(null); // 새 폴더 이름 입력 중이면 문자열
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
  const [greet, setGreet] = useState(null);       // 서재 인사말 {stamp, line, sub}, 앱 로드 시 한 번만 고른다
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
  const [sessMenuOpen, setSessMenuOpen] = useState(false);
  const [mdlMenuOpen, setMdlMenuOpen] = useState(false);
  const [expandSet, setExpandSet] = useState(() => new Set()); // 펼친 지난 문답 "sid:i"
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
  const greetInitRef = useRef(false);          // 서재 인사말을 이미 골랐는가 (앱 로드당 한 번)
  const layoutKeyRef = useRef({ cw: 0, zoom: 0 }); // 마지막 배치에 쓴 폭·배율 — 같으면 relayout 을 건너뛴다
  // 지금 하이라이트된 구간 {page, start, end, cls}. DOM 이 아니라 오프셋으로 들고 있어야
  // relayout 이 텍스트 레이어를 걷어내고 다시 그려도 하이라이트가 살아남는다.
  const markRef = useRef(null);
  const gestureRef = useRef(false);           // 핀치·트랙패드 줌이 진행 중인가

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
    } catch {}
  }, []);
  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        "yeobaek",
        JSON.stringify({
          cfg: cfgRef.current, zoom: zoomRef.current,
          theme: themeRef.current, invert: invertRef.current, panelMode: panelModeRef.current,
          penCapture: penCaptureRef.current,
        })
      );
    } catch {}
  }, []);

  /* ───────── 질문 탭 세션 ─────────
     sessRef 가 원본이고 state 는 그 거울이다. ask() 가 스트리밍 도중 부르는 콜백은
     setState 가 반영되기 전에 다시 세션을 읽어야 하는데, state 로만 두면
     같은 tick 안에서 방금 만든 세션이 안 보인다(캡처가 세션을 만들자마자 메시지를 넣는다). */
  const sessRef = useRef([]);
  const curSessRef = useRef("");
  useEffect(() => { curSessRef.current = curSess; }, [curSess]);

  const saveSess = useCallback((ls, cur) => {
    /* 오려낸 그림은 data URL 이라 크다. localStorage 가 넘치면 그림부터 버리고,
       그래도 안 되면 최근 세션만 남긴다. 저장 실패로 대화가 날아가지는 않는다. */
    const strip = (s) => ({ ...s, img: "", msgs: s.msgs.map((m) => ({ ...m, img: "" })) });
    const tries = [
      () => ls,
      () => ls.map((s, i) => (i === 0 ? s : strip(s))),
      () => ls.map(strip),
      () => ls.slice(0, 3).map(strip),
    ];
    for (const build of tries) {
      try {
        localStorage.setItem(SESS_KEY, JSON.stringify({ v: 1, cur, sessions: build() }));
        return;
      } catch {}
    }
    try { localStorage.removeItem(SESS_KEY); } catch {}
  }, []);

  /* 저장은 미뤄서 한다. commitSess 는 스트리밍 중 토큰마다 불리는데,
     그때마다 세션 전체를 JSON 으로 굳히면 답 하나 받는 동안 수백 번 직렬화한다. */
  const saveTimer = useRef(0);
  const commitSess = useCallback((ls, cur) => {
    sessRef.current = ls;
    setSessions(ls);
    if (cur !== undefined) { curSessRef.current = cur; setCurSess(cur); }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSess(sessRef.current, curSessRef.current), 800);
  }, [saveSess]);

  // 탭을 닫거나 홈 화면으로 나가면 미뤄 둔 저장을 흘리지 말고 지금 쓴다.
  useEffect(() => {
    const flush = () => { clearTimeout(saveTimer.current); saveSess(sessRef.current, curSessRef.current); };
    const onHide = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [saveSess]);

  const newSess = useCallback((title, extra = {}) => {
    const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const s = { id, title: title || "새 대화", at: Date.now(), msgs: [], img: "", ...extra };
    commitSess([s, ...sessRef.current].slice(0, SESS_MAX), id);
    return id;
  }, [commitSess]);

  /* 메시지를 넣거나 고칠 때마다 at 을 밀어 준다 — 대화가 이어지는 동안은 2시간이 다시 시작된다. */
  const addMsgs = useCallback((sid, arr) => commitSess(
    sessRef.current.map((s) => (s.id === sid ? { ...s, at: Date.now(), msgs: [...s.msgs, ...arr] } : s))
  ), [commitSess]);

  const patchMsg = useCallback((sid, i, patch) => commitSess(
    sessRef.current.map((s) => (s.id === sid
      ? { ...s, at: Date.now(), msgs: s.msgs.map((m, k) => (k === i ? { ...m, ...patch } : m)) }
      : s))
  ), [commitSess]);

  const patchSess = useCallback((sid, patch) => commitSess(
    sessRef.current.map((s) => (s.id === sid ? { ...s, ...patch } : s))
  ), [commitSess]);

  const findSess = (sid) => sessRef.current.find((s) => s.id === sid) || null;

  /* 지난 문답을 모델이 받을 형태로 바꾼다.
     본문 컨텍스트(buildAskContext)는 여기 넣지 않는다 — 턴마다 다시 실으면
     48,000자짜리 본문이 대화 길이만큼 곱해져서 값도 지연도 폭발한다.
     hist 가 있으면 그걸 쓴다: 화면에는 "3쪽 영역 — 해석"만 보여도 모델에게는
     무엇을 시켰는지 문장으로 알려야 하기 때문이다. */
  const histOf = (sid) =>
    (findSess(sid)?.msgs || [])
      /* err 가 붙었어도 받아 둔 답이 있으면 히스토리에 넣는다 — 끊긴 답을 빼 버리면
         "이어서 말해 줘"가 앞을 못 보고, 방금 고친 흐름 문제가 그대로 재현된다.
         답이 아예 없는 실패는 아래 text 검사에서 이미 걸러진다. */
      .filter((m) => !m.live && (m.hist || m.text || "").trim())
      .map((m) => ({ role: m.role === "me" ? "user" : "assistant", text: m.hist || m.text }));

  /* 복원 + 2시간 지난 세션 청소 */
  useEffect(() => {
    let cur = "";
    let ls = [];
    try {
      const raw = localStorage.getItem(SESS_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        ls = (Array.isArray(j?.sessions) ? j.sessions : [])
          .filter((s) => s && s.id && Array.isArray(s.msgs) && Date.now() - (s.at || 0) < SESS_TTL)
          /* 새로고침으로 끊긴 답변은 스트리밍 상태로 굳어 있다 — 커서가 영영 깜박인다. */
          .map((s) => ({ ...s, msgs: s.msgs.map((m) => (m.live ? { ...m, live: false } : m)) }));
        cur = ls.some((s) => s.id === j?.cur) ? j.cur : ls[0]?.id || "";
      }
    } catch {}
    commitSess(ls, cur);

    const sweep = () => {
      setNowTick((n) => n + 1); // 남은 시간 표시 갱신
      const live = sessRef.current.filter((s) => Date.now() - (s.at || 0) < SESS_TTL);
      if (live.length === sessRef.current.length) return;
      commitSess(live, live.some((s) => s.id === curSessRef.current) ? curSessRef.current : live[0]?.id || "");
    };
    const t = setInterval(sweep, 60_000);
    return () => clearInterval(t);
  }, [commitSess]);

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
  const [statTick, setStatTick] = useState(0);

  // ref 만 갱신하고 화면은 아래 타이머가 밀어 준다 — 토큰마다 setState 하면 렌더가 폭주한다.
  const bumpStat = (patch) => { statRef.current = statRef.current && { ...statRef.current, ...patch }; };
  const setStat = (patch) => {
    statRef.current = patch && { ...(statRef.current || {}), ...patch };
    setAiStat(statRef.current && { ...statRef.current });
  };

  useEffect(() => {
    if (!aiStat?.running) return;
    const t = setInterval(() => {
      setAiStat(statRef.current && { ...statRef.current });
      setStatTick((n) => n + 1);
    }, 500);
    return () => clearInterval(t);
  }, [aiStat?.running]);

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
    setStat({ running: true, phase: "send", t0: Date.now(), at: Date.now(), chars: 0, step, engine: "", model: "" });
    return ac;
  };
  const endJob = (ac) => {
    if (jobRef.current && !isCur(ac)) return;  // 이미 다음 요청이 자리를 잡았다
    jobRef.current = null;
    setStat(null);
  };
  const stopAsk = () => { jobRef.current?.ac.abort(); jobRef.current = null; setStat(null); };

  const statView = useMemo(() => {
    const st = aiStat;
    if (!st?.running) return null;
    const sec = Math.max(0, Math.round((Date.now() - st.t0) / 1000));
    const gap = Math.max(0, Math.round((Date.now() - (st.at || st.t0)) / 1000));
    const who = st.engine ? `${st.engine}${st.model ? " " + st.model.split("/").pop() : ""}` : "";
    const step = st.step ? `${st.step} · ` : "";
    /* send 와 wait 는 성격이 다르다. send 는 업스트림 응답 헤더조차 아직 안 온 상태 —
       아직 배정을 못 받았다는 뜻이다. wait 는 헤더는 왔는데 토큰이 없는 상태로,
       모델이 실제로 계산 중이다. 시간을 재서 짐작하는 게 아니라 헤더가 왔는지 안 왔는지의
       구조적 차이라, 라벨만 정확히 갈라 준다.
       send 에서도 오래 끌면 경고한다 — 배정조차 못 받은 채 45초면 알려야 한다. */
    if (st.phase === "send")
      return { text: `${step}차례를 기다리는 중 · ${sec}초`, warn: sec * 1000 >= STALL_WAIT };
    /* 속생각이 흐르는 동안은 답이 한 글자도 안 나오지만 모델은 분명히 살아 있다.
       여기서만은 "느리다"와 "죽었다"를 구분할 수 있으므로 절대 경고하지 않는다. */
    if (st.phase === "think")
      return {
        text: `${step}생각하는 중 · ${st.think || 0}자 · ${sec}초${who ? ` · ${who}` : ""}`,
        warn: false,
      };
    if (st.phase === "wait") {
      const warn = sec * 1000 >= STALL_WAIT;
      return {
        text: warn
          ? `${step}${sec}초째 첫 글자가 오지 않습니다${who ? ` · ${who}` : ""} — 모델이 식었으면 1분까지 걸립니다`
          : `${step}모델이 계산 중 · ${sec}초${who ? ` · ${who}` : ""}`,
        warn,
      };
    }
    const warn = gap * 1000 >= STALL_GAP;
    return {
      text: warn
        ? `${step}${gap}초째 멈춰 있습니다 — 생각 중일 수도, 끊겼을 수도 있습니다${who ? ` · ${who}` : ""}`
        : `${step}답변 받는 중 · ${st.chars || 0}자 · ${sec}초${who ? ` · ${who}` : ""}`,
      warn,
    };
  }, [aiStat, statTick]);

  /* 새 문답은 맨 위("최신")에 꽂힌다 — 문답이 하나 늘거나 세션을 옮기면 맨 위로 올린다.
     스트리밍 중(토큰 추가)에는 askLog.length 가 안 변하므로 따라가지 않는다 —
     답을 읽으려고 아래로 내려 둔 화면을 토큰마다 끌어올리면 읽을 수가 없다. */
  const panesRef = useRef(null);
  useEffect(() => {
    if (tab !== "ask" || !sheetOpen) return;
    const el = panesRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = 0; });
  }, [askLog.length, curSess, tab, sheetOpen]);

  const ttlLeft = useMemo(() => {
    if (!sess) return "";
    const ms = SESS_TTL - (Date.now() - (sess.at || 0));
    if (ms <= 0) return "";
    const min = Math.ceil(ms / 60000);
    return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분 남음` : `${min}분 남음`;
  }, [sess, nowTick]);

  /* 로그인 상태 확인 */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me");
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
        const r = await fetch("/api/models");
        if (!r.ok) return;
        const j = await r.json();
        setModels(Array.isArray(j.models) ? j.models : []);
        setDefModel(j.default || "");
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
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.health) setHealth(j.health); })
      .catch(() => {})
      .finally(() => { healthReq.current = false; setHealthBusy(false); });
  };

  /* 드롭다운이 열려 있는 동안만 저장값을 2초마다 다시 읽는다. 읽기는 2ms 짜리라 부담이
     없고, 서버가 뒤에서 다시 재고 있는 값이 보고 있는 사이에 채워진다. 닫으면 멈춘다. */
  useEffect(() => {
    if (!mdlMenuOpen) return;
    const t = setInterval(refreshHealth, 2000);
    return () => clearInterval(t);
  }, [mdlMenuOpen]);

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
    return { cls: "jam", text: "응답 없음" };                     // 연결 자체가 안 됐다
  };

  /* 모델 id → 드롭다운에 보이는 이름. 목록에 없으면 id 의 뒷부분을 그대로 쓴다. */
  const modelName = (id) =>
    models.find((m) => m.id === id)?.label || String(id || "").split("/").pop();

  /* ── 서재 ── */
  const libApi = useCallback(async (url, opt) => {
    const r = await fetch(url, opt);
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
      const nowId = curFileRef.current?.id; // 디바운스 대기 중 문서가 바뀌었을 수 있다
      if (!nowId) return;
      libApi("/api/library/file/" + nowId, {
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
      fetch("/api/remote/page", {
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
      if (!id || !curRef.current) return;
      try {
        fetch("/api/library/file/" + id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastPage: curRef.current }),
          keepalive: true,
        });
      } catch {}
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
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
      if (!greetInitRef.current) { greetInitRef.current = true; setGreet(pickGreeting(j)); }
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

  /* fetch 는 업로드 진행률을 못 재서 XHR 을 쓴다 */
  const uploadPDF = (buf, name, folder) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/library/upload?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`);
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

  const saveToLib = async (buf, name) => {
    try {
      const j = await uploadPDF(buf, name, libFolder);
      curFileRef.current = { id: j.id, name: j.name };
      refreshLib();
      if (!j.thumb) sendThumb(j.id);
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
      const r = await libApi("/api/library/file/" + f.id);
      const buf = await r.arrayBuffer();
      curFileRef.current = { id: f.id, name: f.name };
      setLibOpen(false);
      await loadPDF(new Uint8Array(buf), f.name);
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

  const renameFile = async (id, name) => {
    const n = name.trim();
    if (!n) { setDocRenameId(""); return; }
    try {
      await libApi("/api/library/file/" + id, {
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
  const REN_MAX = 40; // 한 번에 다루는 문서 수 상한 — 넘으면 응답이 길어져 JSON 이 잘린다

  /* 모델 답에서 이름 목록을 건져낸다. 프롬프트로 "JSON 만" 이라고 못박아도 코드펜스로 감싸거나
     {"names":…} 를 빼고 배열만 주는 경우가 있어서, 되는 해석을 차례로 시도한다. */
  const parseNameJSON = (out) => {
    let s = String(out || "").trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const cand = [];
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) cand.push(s.slice(a, b + 1));   // {"names":[…]}
    const c = s.indexOf("["), d = s.lastIndexOf("]");
    if (c >= 0 && d > c) cand.push(s.slice(c, d + 1));   // […] 만 준 경우
    for (const t of cand) {
      try {
        const j = JSON.parse(t);
        const list = Array.isArray(j) ? j : j?.names;
        if (Array.isArray(list)) return list;
      } catch {}
    }
    return null;
  };

  /* 모델이 준 이름을 그대로 믿지 않는다. 제어문자·경로문자 제거, 길이 제한,
     확장자는 모델 출력이 아니라 원래 이름을 따라간다(서재에 .pdf 붙은 이름과 안 붙은 이름이 섞여 있다). */
  const cleanRenamed = (raw, orig) => {
    const ext = /\.pdf$/i.test(orig) ? orig.slice(orig.lastIndexOf(".")) : "";
    let n = String(raw || "")
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.pdf$/i, "")
      .trim()
      .slice(0, 80)
      .trim();
    return n ? n + ext : orig;
  };

  /* 이름 지을 근거로 쓸 앞쪽 본문 — 검색 인덱스에 있으면 그걸 쓰고(대부분), 한 번도 안 연
     문서일 때만 PDF 를 받아 pdf.js 로 직접 뽑는다. 뷰어의 pdfRef 는 건드리지 않는 별도 문서다.
     1쪽만 보지 않는 이유는 표지가 이미지 한 장이라 글자가 하나도 없는 문서가 흔해서다
     (실제로 서재 문서 하나가 그랬다) — 앞 3쪽 중 처음으로 글자가 있는 쪽을 쓴다. */
  const firstPageText = async (f) => {
    const pick = (pages) => (pages || []).find((t) => t && t.trim()) || "";
    try {
      const r = await libApi(`/api/library/file/${f.id}/text?pages=3`);
      const t = pick((await r.json()).pages);
      if (t) return t;
    } catch {}
    try {
      const r = await libApi("/api/library/file/" + f.id);
      const buf = await r.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({
        data: new Uint8Array(buf), cMapUrl: CDN + "cmaps/", cMapPacked: true,
      }).promise;
      const pages = [];
      for (let n = 1; n <= Math.min(3, pdf.numPages); n++) {
        const tc = await (await pdf.getPage(n)).getTextContent();
        pages.push(tc.items.map((i) => i.str).join(" "));
      }
      pdf.destroy?.();
      return pick(pages);
    } catch { return ""; }
  };

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
        texts.push((await firstPageText(files[i])).replace(/\s+/g, " ").trim().slice(0, 600));
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
        body: JSON.stringify({ name: n }),
      });
      setFolInput(null);
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 만들지 못했습니다.");
    }
  };

  const delFile = async (id) => {
    try {
      await libApi("/api/library/file/" + id, { method: "DELETE" });
      if (curFileRef.current?.id === id) curFileRef.current = null;
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("지우지 못했습니다.");
    }
  };

  const delFolder = async (id) => {
    try {
      await libApi("/api/library/folder/" + id, { method: "DELETE" });
      if (libFolder === id) setLibFolder("");
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
      const { text, engine } = await callServer(cfgRef.current, system, user, onDelta, signal, opts);
      if (engine) setEngine(engine);
      return text;
    } catch (e) {
      if (e.name === "AuthError") setAuthed(false);
      throw e;
    }
  }, []);

  /* ask() 와 같지만 질문 탭 모델을 그때그때 다른 값으로 지정할 수 있다 — 리모트(폰)가
     고른 모델로 답해야 하는데, cfgRef.current.askModel 을 건드리면 동시에 도는 아이패드
     자체 질문과 서로 값을 덮어써서 경합한다. */
  const remoteAsk = useCallback(async (system, user, model, onDelta, signal, opts) => {
    try {
      const { text, engine } = await callServer(
        { ...cfgRef.current, askModel: model || cfgRef.current.askModel },
        system, user, onDelta, signal, opts
      );
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
    queueRef.current.add(n);
    try {
      const pdf = pdfRef.current;
      const page = await pdf.getPage(n);
      const el = pagesRef.current[n - 1];
      if (!el) return;
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
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width * dpr);
      cv.height = Math.floor(vp.height * dpr);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      // 이전 배율의 캔버스가 있으면 그 '아래'에 깔아 두고 그린다 — 완성될 때까지
      // 흐릿한 이전 그림이 보이고, 흰 화면이 번쩍이지 않는다.
      el.insertBefore(cv, el.firstChild);
      await page.render({
        canvasContext: ctx, viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      // 완성 — 이전 캔버스와 남아 있던 텍스트 레이어를 걷어낸다
      el.querySelectorAll("canvas").forEach((c) => { if (c !== cv) c.remove(); });
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
      const layer = document.createElement("div");
      layer.className = "vb-tl";
      el.appendChild(layer);
      await buildTextLayer(page, vp, layer, n);
      if (markRef.current?.page === n) applyMarks(); // 재배치로 지워진 하이라이트 복원
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
          el.querySelectorAll("canvas").forEach((c) => c.remove());
          el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
        }
        renderedRef.current.delete(n);
        dataRef.current[n - 1] = null;
      }
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
    const vr = view.getBoundingClientRect();
    const n = pageAt(pages, vr.top + vr.height / 2);
    if (n !== curRef.current) { curRef.current = n; setCurPage(n); }
  };

  const observe = () => {
    ioRef.current?.disconnect();
    ioRef.current = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) renderPage(+e.target.dataset.n);
      pickCur();
      prune();
    }, { root: viewRef.current, rootMargin: "1000px 0px", threshold: 0 });
    pagesRef.current.forEach((el) => el && ioRef.current.observe(el));
  };

  const buildPages = (w1, h1, total) => {
    const stage = stageRef.current;
    stage.innerHTML = "";
    pagesRef.current = [];
    const cw = contentWidth();
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
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
      queueRef.current.clear();
      dataRef.current = [];
      bookTextRef.current = [];
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
      setTimeout(() => extractAll(pdf), 800); // 첫 렌더와 경쟁하지 않게 잠깐 뒤에
    } catch (e) {
      setLoadErr("PDF를 열지 못했습니다: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  /* 질문 탭용 전체 텍스트 — 페이지가 프룬되어도 남도록 별도로 한 번 훑어 둔다 */
  const extractAll = async (pdf) => {
    if (extractingRef.current) return;
    extractingRef.current = true;
    try {
      const arr = bookTextRef.current;
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
      extractingRef.current = false;
    }
    // 서재 검색 인덱스 — 이 문서가 서재 파일이고(로컬에서 방금 연 파일이면 아직 id 가
    // 없을 수 있다), 다른 문서로 바뀌지 않았고, 전 쪽이 다 뽑혔을 때만 서버에 올린다.
    // 실패해도 조용히 넘어간다 — 검색이 안 되는 것뿐, 읽기엔 지장이 없다.
    if (pdfRef.current === pdf) {
      const id = curFileRef.current?.id;
      const full = bookTextRef.current;
      if (id && full.length === pdf.numPages && full.every((t) => t != null)) {
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
  const buildAskContext = (cap = ASK_CAP) => {
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
    let used = 0;
    const tryAdd = (n) => {
      if (n < 1 || n > N) return true;
      const t = pageText(n);
      if (used + t.length > cap) return false;
      picked.push({ n, t });
      used += t.length + 8;
      return true;
    };
    tryAdd(cur);
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
    const from = picked[0]?.n ?? cur;
    const to = picked[picked.length - 1]?.n ?? cur;
    return { scope: `${from}–${to}쪽 (전체 ${N}쪽 중)`, text };
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
      const r = await libApi("/api/library/file/" + id);
      const nbuf = await r.arrayBuffer();
      await loadPDF(new Uint8Array(nbuf), name);
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

  /* anchor 가 있으면(핀치 줌) 그 지점(페이지 내 fx/fy)이 화면의 같은 자리(sx/sy)로 돌아오게 복원한다 */
  const relayout = useCallback(async (keepPage, anchor) => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    const cw = contentWidth();
    // 폭도 배율도 그대로면 아무것도 하지 않는다 — 좁은 화면에서 풀이창을 여닫을 때마다
    // 전부 다시 그리면서 페이지가 튀던 문제의 원인이 이 불필요한 재배치였다.
    if (cw === layoutKeyRef.current.cw && zoomRef.current === layoutKeyRef.current.zoom) return;
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
    const keep = keepPage || curRef.current;
    const view = viewRef.current;
    // 페이지 맨 위로 스냅하지 않도록, 보고 있던 페이지 안의 위치(비율)를 기억해 둔다
    let frac = 0;
    const prevEl = pagesRef.current[keep - 1];
    if (view && prevEl && prevEl.offsetHeight) {
      const top = prevEl.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
      frac = Math.max(0, Math.min(1, (view.scrollTop - top) / prevEl.offsetHeight));
    }
    const p1 = await pdf.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    scaleRef.current = cw / v1.width;
    const w = v1.width * scaleRef.current * zoomRef.current;
    const h = v1.height * scaleRef.current * zoomRef.current;
    ioRef.current?.disconnect();
    for (const el of pagesRef.current) {
      if (!el) continue;
      el.style.width = w + "px";
      el.style.height = h + "px";
      // 캔버스는 남긴다 — CSS 로 새 크기에 맞춰 늘어난 채(흐릿하게) 보이다가
      // renderPage 가 선명한 새 캔버스를 완성하면 그때 교체된다.
      // 텍스트 레이어는 옛 배율 좌표라 어긋나므로 걷어낸다.
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
    }
    renderedRef.current.clear();
    queueRef.current.clear();
    dataRef.current = [];
    observe();
    requestAnimationFrame(() => {
      const el = pagesRef.current[keep - 1];
      if (!el || !view) return;
      if (anchor) {
        const r = el.getBoundingClientRect();
        view.scrollTop += r.top + anchor.fy * r.height - anchor.sy;
        view.scrollLeft += r.left + anchor.fx * r.width - anchor.sx;
      } else {
        const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
        view.scrollTo({ top: top + frac * el.offsetHeight, behavior: "auto" });
      }
      curRef.current = keep;
      setCurPage(keep);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => relayout(), 280);
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
      raf = requestAnimationFrame(() => { raf = 0; pickCur(); });
    };
    view.addEventListener("scroll", on, { passive: true });
    return () => { view.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
    // pickCur 은 ref 만 읽으므로 첫 렌더의 클로저를 그대로 써도 안전하다
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
     의 word/sent 슬롯). word/sent state 가 바뀔 때마다(토큰 단위 포함) 그대로 흘려보낸다 —
     끊어 보내지 않고 최신 state 를 매번 통째로 보내는 게 단순하고, seq 로 낡은 응답만
     걸러내면 되므로 순서만 지키면 된다. */
  const remoteSeqRef = useRef({ word: 0, sent: 0 });
  const relay = (slot, payload) => {
    if (!remoteOnRef.current) return;
    remoteSeqRef.current[slot] += 1;
    fetch("/api/remote/relay", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, seq: remoteSeqRef.current[slot], payload }),
    }).catch(() => {});
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
    let pinching = false, startD = 0, startZoom = 1, factor = 1, lastMid = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const reset = () => {
      stage.style.transform = "";
      stage.style.transformOrigin = "";
      setZoomPill(null);
    };

    const onStart = (e) => {
      if (e.touches.length !== 2 || !pdfRef.current) return;
      /* 여기서 preventDefault 로 네이티브 팬을 원천 차단해 보려 했지만 되돌렸다 —
         렉이 걸리고, 페이지 크기는 그대로인데 내용만 작아지고 상하반전되는 렌더 깨짐이 생겼다.
         핀치 중 튀는 문제는 아래 onMove 의 e.cancelable 사후 방어로만 다룬다. */
      pinching = true;
      gestureRef.current = true;
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
      if (!pinching || e.touches.length !== 2) return;
      if (!e.cancelable) {
        // 네이티브 스크롤이 이미 제스처를 가져갔다 — 핀치를 포기한다
        pinching = false;
        gestureRef.current = false;
        reset();
        observe();
        return;
      }
      e.preventDefault();
      const m = mid(e.touches);
      // 두 손가락 팬: 중점 이동량만큼 우리가 직접 스크롤한다
      view.scrollTop -= m.y - lastMid.y;
      view.scrollLeft -= m.x - lastMid.x;
      lastMid = m;
      const raw = dist(e.touches) / startD;
      const next = Math.max(0.3, Math.min(3, startZoom * raw));
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
      reset();
      lastMid = null;
      observe();
    };

    const onEnd = (e) => {
      if (!pinching || e.touches.length >= 2) return;
      pinching = false;
      // 앵커는 끝나는 순간의 중점에서 계산한다 (변환이 걸린 채로 측정)
      // gestureRef 는 앵커를 잡은 뒤에 내린다 — 그전에 pickCur 이 끼어들면 안 된다
      const anchor = lastMid ? findAnchor(lastMid.x, lastMid.y) : null;
      gestureRef.current = false;
      reset();
      lastMid = null;
      const next = Math.max(0.3, Math.min(3, startZoom * factor));
      if (Math.abs(next - zoomRef.current) > 0.01) {
        zoomRef.current = next;
        persist();
        relayout(anchor?.page, anchor);
      } else {
        observe();
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
    const clampZoom = (z) => Math.max(0.3, Math.min(3, z));
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
      } else {
        observe();
      }
    };
    const onWheel = (e) => {
      if (!e.ctrlKey || !pdfRef.current) return;
      e.preventDefault();
      if (!zooming) {
        zooming = true;
        gestureRef.current = true;
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
      observe();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

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
  const sendAsk = async () => {
    const q = askVal.trim();
    if (!q || asking) return;
    setAskVal("");
    setAsking(true);

    // 세션이 없으면(처음이거나 2시간이 지나 청소됐으면) 첫 질문을 제목 삼아 하나 연다.
    const sid = curSessRef.current && findSess(curSessRef.current)
      ? curSessRef.current
      : newSess(q.length > 16 ? q.slice(0, 16) + "…" : q);

    const s = findSess(sid);
    const history = histOf(sid);              // 반드시 이번 문답을 넣기 전에 뽑는다
    const idx = (s?.msgs.length || 0) + 1;    // 방금 넣을 ai 자리
    addMsgs(sid, [{ role: "me", text: q }, { role: "ai", text: "", live: true }]);

    /* 그림이 딸린 세션의 질문이면 그림 맥락을 붙인다. imgDesc(gemma가 미리 옮겨 적은 설명)가
       있으면 그 글만 시스템 프롬프트에 얹고 image 는 안 보낸다 — 그래야 실제로 답하는 건
       늘 아래에서 고른 질문 탭 모델이다. imgDesc 가 없는(=회로도라 처음부터 직접 봐야 했던,
       runCapture 의 hasFig 경로로 표시만 된) 옛 세션은 예전처럼 image 를 그대로 보낸다. */
    let image = "";
    let figBlock = "";
    if (sendFig && s?.img) {
      if (s.imgDesc) figBlock = `\n\n${FIG_NOTE}\n${s.imgDesc}`;
      else image = s.img;
    }

    /* 본문·쪽·짚은 문장은 user 턴이 아니라 system 에 싣는다. user 턴에 얹으면 지난 턴들은
       질문 한 줄인데 이번 턴만 수만 자짜리 덩어리가 되어, 모델이 "지금 새 자료를 받았다"로
       읽고 앞의 문답을 놓친다 — "아까 그거"가 안 통하던 이유가 이거다. system 으로 옮기면
       대화 쪽에는 사람 말만 남아 history 와 모양이 같아지고, 흐름이 그대로 보인다. */
    const { scope, text } = buildAskContext(history.length ? ASK_CAP_MORE : ASK_CAP);
    const sys =
      `${SYS_ASK}\n\n[문서: ${docName || "제목 없음"} — 제공 범위: ${scope || "없음"}]\n${text}\n\n` +
      `[읽는 이가 지금 보고 있는 쪽] ${curRef.current}쪽\n[방금 짚은 문장] ${lastSentRef.current || "(없음)"}` +
      figBlock;
    let buf = "";
    let cut = false;   // 길이 상한에 걸려 말이 끊겼는가
    let swap = null;   // 고른 모델이 붐벼서 다른 모델이 대신 답했는가
    const ac = startJob(sid, image ? "그림과 함께" : (figBlock ? "그림 설명과 함께" : ""));
    try {
      const hook = phaseHook(ac, () => buf.length);
      await ask(sys, q, (c) => {
        buf += c;
        patchMsg(sid, idx, { text: buf });
      }, ac.signal, {
        ask: true, history, image,
        onPhase: (p, info) => {
          if (p === "cut") cut = true;
          if (p === "swap") swap = info;
          hook(p, info);
        },
      });
      // 끊긴 걸 표시해 두지 않으면 답이 원래 그렇게 끝난 줄 안다.
      // swap 은 text 가 아니라 별도 칸에 둔다 — text 에 섞으면 다음 턴 히스토리까지 따라간다.
      patchMsg(sid, idx, {
        text: buf + (cut ? "\n\n*(길이 제한에 걸려 여기서 끊겼습니다 — 이어서 물어보세요)*" : ""),
        live: false,
        swap: swap && { wanted: modelName(swap.wanted), model: modelName(swap.model) },
      });
    } catch (e) {
      /* 여기까지 받은 답은 무슨 일이 있어도 지우지 않는다. [중단]을 눌렀을 때는 원래 남겼는데,
         스트림이 끊겨서 온 예외는 text 를 ""로 덮어쓰고 있었다 — 잘 나오던 답이 통째로
         사라지고 "답을 받지 못했습니다"만 남았다. 아이패드에서 망이 잠깐 끊기거나 앱을
         나갔다 오면 늘 이 경로다. 서버 로그에는 아무것도 안 남는다(연결만 끊긴 것이라). */
      const stopped = e.name === "AbortError";
      patchMsg(sid, idx, {
        text: buf,
        live: false,
        stopped: stopped && !!buf,
        // 답이 이미 있으면 "못 받았다"가 아니라 "여기서 끊겼다"가 맞는 말이다
        err: stopped ? "" : buf ? "연결이 끊겨 여기서 멈췄습니다 — " + e.message : e.message,
      });
    } finally {
      endJob(ac);
      setAsking(false);
    }
  };

  /* ── 리모트(폰)가 만든 질문을 아이패드가 실행 ──
     폰은 서버 세션(/api/remote/sessions)에 질문 + 빈 답 자리만 만든다(src/Remote.jsx
     sendChat). 여기 아이패드 쪽 로컬 질문 탭(sessRef/sendAsk, localStorage 에 저장)과는
     완전히 별개의 저장소다 — 화면에 그리지 않고 백그라운드로 채우기만 하므로 ref 로만
     들고 있는다. 세션 전체 사본을 들고 있는 건 history(지난 문답)를 구성하려면
     그 세션의 지난 메시지가 필요한데, SSE 의 sess-msgs 이벤트는 새로 추가된 것만 주기
     때문이다 — hello 로 받는 최초 스냅샷에는 전체가 있다. */
  const remoteSessRef = useRef([]);
  const remoteBusyRef = useRef(new Set()); // 이미 처리했거나 처리 중인 "세션id:메시지인덱스"

  const processRemoteQ = async (sid, idx) => {
    const key = sid + ":" + idx;
    if (remoteBusyRef.current.has(key)) return;
    remoteBusyRef.current.add(key);
    const s = remoteSessRef.current.find((x) => x.id === sid);
    const qMsg = s?.msgs[idx - 1];
    if (!s || !qMsg) return;

    let image = "";
    if (qMsg.img) {
      try {
        const blob = await fetch(`/api/remote/sessions/${sid}/image/${qMsg.img}`).then((r) => r.blob());
        image = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1] || "");
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
      } catch {}
    }

    // 답이 이미 있는 지난 문답만 history 로 — 지금 채우려는 자리(idx) 자체는 뺀다.
    const history = s.msgs.slice(0, idx - 1)
      .filter((m) => (m.text || "").trim())
      .map((m) => ({ role: m.role, text: m.text }));
    const { scope, text } = buildAskContext(history.length ? ASK_CAP_MORE : ASK_CAP);
    const sys =
      `${SYS_ASK}\n\n[문서: ${docNameRef.current || "제목 없음"} — 제공 범위: ${scope || "없음"}]\n${text}\n\n` +
      `[읽는 이가 지금 보고 있는 쪽] ${curRef.current}쪽\n[방금 짚은 문장] ${lastSentRef.current || "(없음)"}`;
    let buf = "";
    let cut = false;
    try {
      await remoteAsk(sys, qMsg.text, qMsg.model, (c) => { buf += c; }, undefined, {
        ask: true, history, image,
        onPhase: (p) => { if (p === "cut") cut = true; },
      });
      await fetch(`/api/remote/sessions/${sid}/msgs/${idx}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: {
          text: buf + (cut ? "\n\n*(길이 제한에 걸려 여기서 끊겼습니다 — 이어서 물어보세요)*" : ""),
          pending: false,
        } }),
      });
    } catch (e) {
      await fetch(`/api/remote/sessions/${sid}/msgs/${idx}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { text: buf, pending: false, err: buf ? "연결이 끊겨 여기서 멈췄습니다 — " + e.message : e.message } }),
      }).catch(() => {});
    }
  };

  // 세션의 맨 끝이 "빈 답 + pending" 이면 그 자리가 아직 안 채워진 질문이다.
  const scanRemotePending = (s) => {
    const i = s.msgs.length - 1;
    if (i >= 0 && s.msgs[i]?.role === "assistant" && s.msgs[i]?.pending && !s.msgs[i]?.text) processRemoteQ(s.id, i);
  };

  /* remoteOn 이 켜져 있는 동안만 붙는다 — 리모트를 안 쓰면 아이패드가 굳이 이 스트림을
     열어 둘 이유가 없다. hello 로 받는 최초 스냅샷에서 이미 쌓여 있던 미답 질문(아이패드가
     꺼져 있는 동안 폰이 물어본 것)까지 훑는다. */
  useEffect(() => {
    if (!remoteOn) return;
    const es = new EventSource("/api/remote/stream");
    es.addEventListener("hello", (e) => {
      const d = JSON.parse(e.data);
      remoteSessRef.current = Array.isArray(d.sessions) ? d.sessions : [];
      for (const s of remoteSessRef.current) scanRemotePending(s);
    });
    es.addEventListener("sess-new", (e) => {
      const s = JSON.parse(e.data);
      remoteSessRef.current = [s, ...remoteSessRef.current.filter((x) => x.id !== s.id)];
    });
    es.addEventListener("sess-del", (e) => {
      const { id } = JSON.parse(e.data);
      remoteSessRef.current = remoteSessRef.current.filter((x) => x.id !== id);
    });
    es.addEventListener("sess-patch", (e) => {
      const { id, patch } = JSON.parse(e.data);
      remoteSessRef.current = remoteSessRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s));
    });
    es.addEventListener("sess-msgs", (e) => {
      const { id, msgs } = JSON.parse(e.data);
      let updated = null;
      remoteSessRef.current = remoteSessRef.current.map((s) => {
        if (s.id !== id) return s;
        updated = { ...s, msgs: [...s.msgs, ...msgs] };
        return updated;
      });
      if (updated) scanRemotePending(updated);
    });
    es.addEventListener("sess-msg-patch", (e) => {
      const { id, i, patch } = JSON.parse(e.data);
      remoteSessRef.current = remoteSessRef.current.map((s) => {
        if (s.id !== id) return s;
        const msgs = s.msgs.slice();
        if (msgs[i]) msgs[i] = { ...msgs[i], ...patch };
        return { ...s, msgs };
      });
    });
    return () => es.close();
  }, [remoteOn]);

  const toggleRemote = () => {
    const v = !remoteOn;
    setRemoteOn(v);
    fetch("/api/remote/mode", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: v }),
    }).catch(() => {});
  };

  const delSess = (id) => {
    const left = sessRef.current.filter((s) => s.id !== id);
    commitSess(left, id === curSessRef.current ? left[0]?.id || "" : curSessRef.current);
  };

  /* ── 오려내기 "질문"을 폰에도 그대로 얹는다 ──
     아이패드의 로컬 질문 탭(sessRef)과 서버 세션(/api/remote/sessions)은 완전히 별개
     저장소라, 오려낸 그림도 따로 올려야 폰이 볼 수 있다. 세션 자체에 img(=imgId)를
     얹어 두면(질문 텍스트 없이도) 폰이 "그림 첨부됨" 칩으로 보여주고, 사용자가 폰에서
     직접 물음을 타이핑해 보내면 이미 있는 processRemoteQ 파이프라인이 그대로 답한다.
     로컬 세션 하나가 여러 번 이어서 캡처될 수 있어 sid → 원격 세션 id 매핑을 들고
     있다가, 이미 매핑된 세션이면 새로 만들지 않고 img 만 갈아 끼운다. */
  const remoteMirrorRef = useRef(new Map()); // 로컬 sid -> 원격 sid
  const mirrorCaptureToRemote = async (localSid, title, dataURL) => {
    if (!remoteOnRef.current) return;
    try {
      const blob = await fetch(dataURL).then((r) => r.blob());
      let remoteSid = remoteMirrorRef.current.get(localSid);
      if (!remoteSid || !remoteSessRef.current.some((s) => s.id === remoteSid)) {
        const s = await fetch("/api/remote/sessions", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).then((r) => r.json());
        remoteSid = s.id;
        remoteMirrorRef.current.set(localSid, remoteSid);
      }
      const up = await fetch(`/api/remote/sessions/${remoteSid}/image`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob,
      }).then((r) => r.json());
      await fetch(`/api/remote/sessions/${remoteSid}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { img: up.id } }),
      });
    } catch {}
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
      fetch("/api/chat", {
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
    if (!view || !IS_SAFARI || !penCapture) return;
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
  }, [penCapture]);

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
      const sid = curSessRef.current && findSess(curSessRef.current) ? curSessRef.current : newSess("영역 캡처");
      addMsgs(sid, [{ role: "ai", text: "", live: false, err: e.message }]);
      setTab("ask"); setSheetOpen(true);
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
    const continueSid = capContinueRef.current;
    const target = continueSid && findSess(continueSid);
    const title = `${shot.page}쪽 질문`;
    // fig: 이 세션의 질문에는 그림(또는 그 설명)을 딸려 보낸다는 표시 — 위 sendFig effect 참고
    const sid = target ? target.id : newSess(title, { img: b64, fig: true });
    if (target) patchSess(sid, { img: b64, imgDesc: "", fig: true }); // 새 그림이 오면 옛 설명은 비운다
    setSendFig(true);
    mirrorCaptureToRemote(sid, target ? target.title : title, shot.url);
    setCapBusy("");

    /* gemma 는 "보는" 역할만 한다 — 실제 질문에 답하는 건 늘 사용자가 고른 질문 탭
       모델이다(SYS_CAP_DESCRIBE 참고). 여기서 미리 옮겨 적어 세션에 박아 두면 sendAsk
       는 그림을 다시 안 보내고 이 글만 얹는다. 설명이 오기 전에 질문이 먼저 나가면
       sendAsk 가 원본 이미지로 그 한 턴만 대신 처리한다 — 실패해도 질문 자체는 안 막는다. */
    try {
      let desc = "";
      await ask(SYS_CAP_DESCRIBE, `[${shot.page}쪽에서 오려낸 영역] 이 이미지를 자세히 설명해라.`,
        (c) => { desc += c; }, undefined, { image: b64 });
      patchSess(sid, { imgDesc: desc.trim() });
    } catch (e) { /* 그림(img)은 남아 있으니 sendAsk 가 대신 처리한다 */ }
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
      const sid = curSessRef.current && findSess(curSessRef.current)
        ? curSessRef.current : newSess("영역 캡처");
      addMsgs(sid, [{ role: "ai", text: "", live: false, err: e.message }]);
      setTab("ask"); setSheetOpen(true);
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
    const sid = newSess(`${shot.page}쪽 ${label}`, { img: b64, fig: kind === "solve" });
    const idx = 1; // 방금 연 세션이라 [me, ai] 중 ai 는 1번
    addMsgs(sid, [
      {
        role: "me",
        text: `${shot.page}쪽 영역 — ${label}`,
        img: shot.url,
        // 화면에 보이는 짧은 라벨 대신, 모델에게는 무엇을 시켰는지 문장으로 남긴다
        hist: kind === "solve"
          ? `[${shot.page}쪽에서 오려낸 문제] 이 문제를 풀어 달라.`
          : `[${shot.page}쪽에서 오려낸 영역] 이 영역을 해석해 달라.`,
      },
      { role: "ai", text: "", live: true },
    ]);
    const put = (t, extra) => patchMsg(sid, idx, { text: t, ...extra });

    /* 상태 표시줄이 "몇 초째 어느 단계인지"를 대신 알려 준다(모델이 식으면 첫 글자까지 실측 52초).
       중단은 이 ac 하나로 끊는다 — 캡처의 두 단계가 이어 달려도 늘 지금 도는 쪽을 가리킨다. */
    const ac = startJob(sid, kind === "solve" ? "옮겨적는 중" : "해석하는 중");
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
        // 1단계: 비전 모델이 눈 역할 — 옮겨적기. 읽은 내용을 그대로 보여줘서
        // 모델이 수식을 잘못 읽었을 때 사용자가 바로 알아챌 수 있게 한다.
        let ocr = "";
        await ask(SYS_CAP_DESCRIBE, `[${shot.page}쪽에서 오려낸 영역] 이 이미지를 옮겨 적어라.`,
          (c) => { ocr += c; put(`[읽은 내용]\n${ocr}`); }, ac.signal,
          { image: b64, onPhase: stepped("옮겨적는 중", () => ocr.length) });
        if (!ocr.trim()) throw new Error("이미지에서 글자를 읽지 못했습니다.");
        const head = `[읽은 내용]\n${ocr.trim()}\n\n`;

        /* 회로도·그래프가 있어도 2단계는 건너뛰지 않는다 — SYS_CAP_DESCRIBE 가 그림 자체를
           글로 옮겨 놓으므로 텍스트 모델이 그 글만 읽고 풀 수 있다. 예전에는 여기서
           [그림: …] 한 줄을 발견하면 비전 모델에게 직접 풀렸는데, 추론 체급이 낮은 쪽에
           문제를 통째로 넘기는 셈이라 접었다. 옮겨 적은 글은 이 세션의 후속 질문에도
           그대로 얹힌다(sendAsk 의 imgDesc) — 그래서 그림을 다시 보낼 일이 없다. */
        patchSess(sid, { imgDesc: ocr.trim() });

        put(head + "풀이 중…");
        // 2단계: 추론은 질문 탭 모델(기본 DeepSeek)이 한다 — 이미지 없이 텍스트로.
        let buf = "";
        await ask(SYS_CAP_SOLVE,
          `[문서: ${docName || "제목 없음"} / ${shot.page}쪽에서 오려낸 문제]\n` +
          `${FIG_NOTE}\n${ocr.trim()}\n\n위 문제를 풀어라.`,
          (c) => { buf += c; put(head + buf); }, ac.signal,
          { ask: true, onPhase: stepped("푸는 중", () => buf.length) });
        put(head + buf, { live: false });
      }
    } catch (e) {
      // 중단은 사고가 아니다 — 여기까지 받은 내용을 남기고 조용히 끝낸다.
      if (e.name === "AbortError") patchMsg(sid, idx, { live: false, stopped: true });
      else put("", { live: false, err: e.message, stopped: false });
    } finally {
      endJob(ac);
      setAsking(false);
    }
  };

  const readFile = (f) => {
    const r = new FileReader();
    r.onload = async () => {
      const buf = r.result;
      const name = f.name.replace(/\.pdf$/i, "");
      curFileRef.current = null;
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
    zoomRef.current = Math.max(0.3, Math.min(3, zoomRef.current * f));
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
      const r = await fetch("/api/login", {
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
  const curFolName = lib.folders.find((f) => f.id === libFolder)?.name || "";
  const isSearchMode = libQuery.trim().length > 0; // 검색어가 있으면 폴더 뷰 대신 검색 결과를 보여준다
  const folderName = (id) => lib.folders.find((fo) => fo.id === id)?.name || "";
  const lastMeta = (f) =>
    f.lastPage ? `마지막 ${f.lastPage}쪽${f.totalPages ? " · 총 " + f.totalPages + "쪽" : ""} · ` : "";
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
            <img src={"/api/library/thumb/" + f.id} alt="" loading="lazy"
              onLoad={(e) => measureThumb(f.id, e.currentTarget)} />
          ) : (
            <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" /></svg>
          )}
          {f.lastPage > 0 && <span className="vb-ribbon" />}
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
        className="vb-mdoc"
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
            {moveOpen && (
              <div className="vb-docsubmenu">
                <button onClick={() => { moveFile(f.id, ""); setDocMenuId(""); setDocMoveId(""); }}>서재(최상위)</button>
                {folders.map((fo) => (
                  <button key={fo.id} onClick={() => { moveFile(f.id, fo.id); setDocMenuId(""); setDocMoveId(""); }}>
                    {fo.name}
                  </button>
                ))}
              </div>
            )}
            <a className="vb-docmenu-dl" href={"/api/library/file/" + f.id + "?dl=1"} download
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
            {opt.folderLabel ? opt.folderLabel + " · " : ""}{lastMeta(f)}{fmtRel(f.lastOpenedAt || f.at)}
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

  /* ── 질문 탭: 문답을 쌍으로 묶고 최신이 위로 오게 뒤집는다 ── */
  const qaPairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < askLog.length; i += 2) {
      if (askLog[i]) pairs.push({ q: askLog[i], a: askLog[i + 1] || null, i });
    }
    return pairs.reverse();
  }, [askLog]);

  const pickModel = (id) => {
    const next = { ...cfg, askModel: id };
    setCfg(next); cfgRef.current = next; persist();
    setMdlMenuOpen(false);
  };

  /* 상태줄을 "보냄·배정·생각·답변" 4단계로 뭉뚱그린다.
     wait(헤더는 왔지만 토큰 전)와 think(속생각)는 둘 다 "아직 답이 안 나왔다"는 같은 뜻이라
     한 칸(생각)으로 합친다 — 다르게 나누면 4칸이 애매해진다. */
  const statSteps = aiStat?.running
    ? (() => {
        const idx = { send: 1, wait: 2, think: 2, stream: 3 }[aiStat.phase] ?? 0;
        return ["보냄", "배정", "생각", "답변"].map((label, i) => ({
          label, cls: i < idx ? "done" : i === idx ? "now" : "",
        }));
      })()
    : null;

  // 드롭다운(대화·모델) 바깥을 누르면 닫는다
  useEffect(() => {
    if (!sessMenuOpen && !mdlMenuOpen) return;
    const onDown = (e) => {
      if (sessMenuOpen && !e.target.closest(".vb-sessbtn") && !e.target.closest(".vb-dropmenu")) setSessMenuOpen(false);
      if (mdlMenuOpen && !e.target.closest(".vb-mdlbtn") && !e.target.closest(".vb-dropmenu")) setMdlMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sessMenuOpen, mdlMenuOpen]);

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
        {IS_SAFARI && numPages > 0 && (
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
        <button className={"vb-tool" + (remoteOn ? " on" : "")} onClick={toggleRemote}
          aria-label="리모트 모드" title="리모트 모드 — 폰에서 이 책을 따라 보고 질문할 수 있게 켭니다">
          <svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" strokeLinecap="round" /></svg>
        </button>
        <button className="vb-tool" onClick={() => setSetOpen(true)} aria-label="설정">
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
          <div className="vb-olist">
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
                <div key={i} className={"vb-orow" + (it.depth ? " d" + it.depth : "")}>
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

        {upProg && (
          <div className="vb-uppill" role="status">
            <i style={{ width: upProg.pct + "%" }} />
            <span>{upProg.name} — 올리는 중 {upProg.pct}%</span>
          </div>
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
              <div className="vb-brandmk">
                <img className="vb-brandicon" src="/brand/yeobaek-icon.svg" alt="" />
                <span className="vb-brandword">여백</span>
                <span className="vb-branddiv" />
                <span className="vb-brandlbl">YEOBAEK</span>
              </div>
              {/* 시안 8a 헤더에는 경로가 없다 — 콘텐츠 영역의 메타 줄이 그 역할을 한다.
                  wide 에서는 사이드바가 이동을 맡으므로 헤더 경로를 접고,
                  사이드바가 없는 narrow 에서만 남긴다(최상위로 꺼내는 드롭 타깃도 겸한다). */}
              {!wide && (
                <div className="vb-crumb">
                  <button className={dropTgt === "__root__" ? "tgt" : ""}
                    onClick={() => setLibFolder("")}
                    onDragOver={(e) => { if (dragId && libFolder) { e.preventDefault(); setDropTgt("__root__"); } }}
                    onDragLeave={() => setDropTgt((t) => (t === "__root__" ? "" : t))}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDropTgt("");
                      if (dragId) moveFile(dragId, ""); // 최상위로 꺼내기
                    }}>
                    서재
                  </button>
                  {libFolder && <><span>›</span><button onClick={() => {}}>{curFolName}</button></>}
                </div>
              )}
              <div className="vb-libsearch">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
                <input value={libQuery} onChange={(e) => changeLibQuery(e.target.value)}
                  placeholder="제목이나 본문으로 찾기" />
                {libQuery && (
                  <button onClick={clearLibQuery} aria-label="검색어 지우기" title="지우기">✕</button>
                )}
              </div>
              {/* 시안 8a 의 헤더 우측은 ★단어장 · ☾다크 · ⚙설정 셋뿐이고 알약 묶음이 없다.
                  "새 폴더"와 "자료 넣기"는 시안에서 사이드바로 내려갔으므로 wide 에서는 헤더에 두지 않는다
                  (사이드바가 없는 narrow 에서만 남긴다). "읽던 문서로"는 시안에 없는 이 앱 고유 기능이라 유지. */}
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
                {!wide && (
                  <button className="vb-libbtn" onClick={() => setFolInput(folInput === null ? "" : null)}
                    aria-label="새 폴더" title="새 폴더">
                    <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M12 10.5v5M9.5 13h5" /></svg>
                  </button>
                )}
                {!wide && (
                  <button className="vb-libbtn pri" disabled={!ready} onClick={() => fileRef.current?.click()}
                    aria-label={ready ? "PDF 추가" : "준비 중"} title="PDF 추가">
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                )}
              </div>
            </div>
            {!wide && folInput !== null && (
              // wide 에서는 사이드바 안에 인라인 입력이 따로 있다(같은 folInput 상태 공유)
              <form className="vb-newfol" onSubmit={(e) => { e.preventDefault(); makeFolder(folInput); }}>
                <input value={folInput} autoFocus placeholder="폴더 이름"
                  onChange={(e) => setFolInput(e.target.value)} />
                <button className="vb-libbtn pri" type="submit" disabled={!folInput.trim()}>만들기</button>
              </form>
            )}
            {(libErr || loadErr) && (
              <div className="vb-err" style={{ padding: "10px 20px 0" }}>{libErr || loadErr}</div>
            )}
            {!wide ? (
              /* 좁은 화면 — 사이드바를 얹을 폭이 안 나와서 기존 방식(폴더 카드 클릭해서 들어가기,
                 고정 3:4 표지, 호버 아이콘)을 그대로 쓴다. 아이패드 세로 등. */
              <div className="vb-libbody">
                {isSearchMode ? (
                  <>
                    <div className="vb-sect">
                      검색 결과
                      {libSearching ? " · 찾는 중…" : libSearchRes ? ` ${libSearchRes.length}건` : ""}
                    </div>
                    {!libSearching && libSearchRes && libSearchRes.length === 0 ? (
                      <div className="vb-oempty">"{libQuery.trim()}"에 해당하는 자료가 없습니다.</div>
                    ) : (
                      <div className="vb-grid">
                        {(libSearchRes || []).map((f) => (
                          <div key={f.id} className="vb-doc" onClick={() => openLibFile(f)}>
                            {renderPaper(f, NARROW_S)}
                            <div className="vb-fname" title={f.name}>{f.name}</div>
                            <div className="vb-fmeta">
                              {f.folder ? folderName(f.folder) + " · " : ""}{lastMeta(f)}{fmtSize(f.size)} · {fmtDate(f.at)}
                            </div>
                            {f.matches?.length > 0 && (
                              <div className="vb-hits">
                                {f.matches.map((m) => (
                                  <button key={m.page} className="vb-hit"
                                    onClick={(e) => { e.stopPropagation(); openLibFile(f, m.page); }}>
                                    <span className="vb-hitpg">{m.page}쪽</span>{m.snippet}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {libFolder === "" && greet && (
                      <div className="vb-greet">
                        <div className="vb-greetstamp">{greet.stamp}</div>
                        <div className="vb-greetline">{greet.line}</div>
                        <div className="vb-greetsub">{greet.sub}</div>
                      </div>
                    )}
                    {libFolder === "" && folders.length > 0 && (
                      <>
                        <div className="vb-sect">폴더 {folders.length}</div>
                        <div className="vb-grid">
                          {folders.map((fo) => (
                            <div key={fo.id}
                              className={"vb-fol" + (dropTgt === fo.id ? " over" : "")}
                              onClick={() => setLibFolder(fo.id)}
                              onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTgt(fo.id); } }}
                              onDragLeave={() => setDropTgt((t) => (t === fo.id ? "" : t))}
                              onDrop={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                setDropTgt("");
                                if (dragId) moveFile(dragId, fo.id);
                              }}>
                              <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                              <div className="vb-fname">{fo.name}</div>
                              <div className="vb-fmeta">{lib.files.filter((f) => f.folder === fo.id).length}개</div>
                              <div className="vb-dact">
                                <button className={"vb-ib del" + (delAsk === "fo" + fo.id ? " ask" : "")}
                                  onClick={(e) => { e.stopPropagation(); tapDel("fo" + fo.id, () => delFolder(fo.id)); }}
                                  aria-label="폴더 삭제">
                                  {delAsk === "fo" + fo.id ? "삭제?" : "✕"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {!(libFolder === "" && folders.length === 0 && shownFiles.length === 0) && (
                      <div className="vb-sect">
                        {libFolder ? "이 폴더의 PDF" : "PDF"} {shownFiles.length}권
                      </div>
                    )}
                    {shownFiles.length === 0 ? (
                      libFolder === "" && folders.length === 0 ? (
                        <div className="vb-hero">
                          <img className="vb-herobrand" src="/brand/yeobaek-icon.svg" alt="" />
                          <p>PDF를 추가하면 표지와 함께 이 서재에 꽂힙니다.<br />
                            읽을 때는 단어 한 번 탭 = 뜻 · 두 번 탭 = 문장 해석 · 드래그 = 구간 해석.</p>
                          <button className="vb-libbtn pri" style={{ padding: "13px 26px", fontSize: 15 }}
                            disabled={!ready} onClick={() => fileRef.current?.click()}>
                            {ready ? "첫 PDF 추가" : "준비 중…"}
                          </button>
                        </div>
                      ) : (
                        <div className="vb-oempty">
                          {libFolder
                            ? "이 폴더는 비어 있습니다. 서재에서 PDF를 끌어다 놓으세요."
                            : "아직 저장된 PDF가 없습니다. 'PDF 추가'를 누르거나 파일을 끌어다 놓으세요."}
                        </div>
                      )
                    ) : (
                      <div className="vb-grid">
                        {shownFiles.map((f) => (
                          <div key={f.id} draggable
                            className={"vb-doc" + (dragId === f.id ? " drag" : "")}
                            onClick={() => openLibFile(f)}
                            onDragStart={(e) => {
                              setDragId(f.id);
                              e.dataTransfer.setData("text/plain", f.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => { setDragId(""); setDropTgt(""); }}>
                            {renderPaper(f, NARROW_S)}
                            <div className="vb-fname" title={f.name}>{f.name}</div>
                            <div className="vb-fmeta">{lastMeta(f)}{fmtSize(f.size)} · {fmtDate(f.at)}</div>
                            <div className="vb-dact">
                              <a className="vb-ib" href={"/api/library/file/" + f.id + "?dl=1"} download
                                onClick={(e) => e.stopPropagation()} aria-label="다운로드">⤓</a>
                              <button className={"vb-ib del" + (delAsk === f.id ? " ask" : "")}
                                onClick={(e) => { e.stopPropagation(); tapDel(f.id, () => delFile(f.id)); }}
                                aria-label="삭제">
                                {delAsk === f.id ? "삭제?" : "✕"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="vb-hint" style={{ marginTop: 26 }}>
                  <b>탭</b> 열기 · <b>끌어서 폴더에 놓기</b> 이동 · <b>⤓</b> 다운로드 · <b>✕ 두 번</b> 삭제<br />
                  읽기 화면 — <b>탭</b> 단어 풀이 · <b>길게 눌러 선택</b> 구간 해석 · <b>두 손가락</b> 확대
                </div>
              </div>
            ) : (
              /* wide — 8a 시안: 왼쪽 고정 사이드바 + 매트 처리한 문서 그리드 */
              <div className="vb-libwrap">
                {docMenuId && (
                  <div className="vb-menuscrim" onClick={() => { setDocMenuId(""); setDocMoveId(""); }} />
                )}
                <div className="vb-libside">
                  <div className="vb-smartnav">
                    {/* 헤더 경로를 접었으므로 "최상위로 꺼내기" 드롭 타깃은 여기가 맡는다 */}
                    <button className={"vb-navitem" + (libFolder === "" && libView === "" ? " on" : "") +
                        (dropTgt === "__root__" ? " over" : "")}
                      onClick={() => { setLibFolder(""); setLibView(""); }}
                      onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTgt("__root__"); } }}
                      onDragLeave={() => setDropTgt((t) => (t === "__root__" ? "" : t))}
                      onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setDropTgt("");
                        if (dragId) moveFile(dragId, "");
                      }}>
                      <span>전체 문서</span><span className="vb-navn">{lib.files.length}</span>
                    </button>
                    <button className={"vb-navitem" + (libView === "recent" ? " on" : "")}
                      onClick={() => setLibView("recent")}>
                      <span>최근 연 문서</span><span className="vb-navn">{recentFiles.length}</span>
                    </button>
                  </div>
                  {folders.length > 0 && (
                    <div className="vb-folnavlist">
                      {folders.map((fo) => (
                        <div key={fo.id}
                          className={"vb-folnav" +
                            (dropTgt === fo.id ? " over" : "") +
                            (folDragId === fo.id ? " dragging" : "") +
                            (libFolder === fo.id && libView === "" ? " on" : "")}
                          draggable
                          onClick={() => { setLibFolder(fo.id); setLibView(""); }}
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
                            if (folDragId && folDragId !== fo.id) {
                              const ids = folders.map((x) => x.id);
                              const from = ids.indexOf(folDragId), to = ids.indexOf(fo.id);
                              ids.splice(to, 0, ids.splice(from, 1)[0]);
                              reorderFolders(ids);
                            }
                            setFolDragId("");
                          }}>
                          <span className="vb-folnavname">{fo.name}</span>
                          <span className="vb-navn">{lib.files.filter((f) => f.folder === fo.id).length}</span>
                          <button className={"vb-ib del sm" + (delAsk === "fo" + fo.id ? " ask" : "")}
                            onClick={(e) => { e.stopPropagation(); tapDel("fo" + fo.id, () => delFolder(fo.id)); }}
                            aria-label="폴더 삭제">
                            {delAsk === "fo" + fo.id ? "삭제?" : "✕"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {folInput !== null ? (
                    <form className="vb-folnewinline" onSubmit={(e) => { e.preventDefault(); makeFolder(folInput); }}>
                      <input value={folInput} autoFocus placeholder="폴더 이름"
                        onChange={(e) => setFolInput(e.target.value)}
                        onBlur={() => { if (!folInput.trim()) setFolInput(null); }}
                        onKeyDown={(e) => { if (e.key === "Escape") setFolInput(null); }} />
                    </form>
                  ) : (
                    <button className="vb-foladd" onClick={() => setFolInput("")}>＋ 폴더 추가</button>
                  )}
                  <span className="vb-sidespacer" />
                  <button className="vb-sideadd" disabled={!ready} onClick={() => fileRef.current?.click()}>
                    ＋ 자료 넣기
                  </button>
                </div>

                <div className="vb-libbody">
                  {isSearchMode ? (
                    <>
                      <div className="vb-sect">
                        검색 결과
                        {libSearching ? " · 찾는 중…" : libSearchRes ? ` ${libSearchRes.length}건` : ""}
                      </div>
                      {!libSearching && libSearchRes && libSearchRes.length === 0 ? (
                        <div className="vb-oempty">"{libQuery.trim()}"에 해당하는 자료가 없습니다.</div>
                      ) : (
                        <div className="vb-mgrid">
                          {(libSearchRes || []).map((f) => renderDocCard(f, {
                            matches: f.matches,
                            folderLabel: f.folder ? folderName(f.folder) : "",
                          }))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {libFolder === "" && libView === "" && greet && (
                        <div className="vb-greet">
                          <div className="vb-greetstamp">{greet.stamp}</div>
                          <div className="vb-greetline">{greet.line}</div>
                          <div className="vb-greetsub">{greet.sub}</div>
                        </div>
                      )}
                      {/* 시안 8a 의 메타 줄 — 경로 / 정렬 / 개수 */}
                      <div className="vb-libmeta">
                        <span className="f">서재</span>
                        <span className="f">/</span>
                        <span className="cur">
                          {libView === "recent" ? "최근 연 문서" : libFolder ? curFolName : "전체 문서"}
                        </span>
                        <span className="sp" />
                        <span className="f">{libView === "recent" ? "최근 연 순" : "최근 추가 순"}</span>
                        <span className="div" />
                        <span className="f">{(libView === "recent" ? recentFiles : shownFiles).length}개</span>
                      </div>
                      {(libView === "recent" ? recentFiles : shownFiles).length === 0 ? (
                        libView !== "recent" && libFolder === "" && folders.length === 0 ? (
                          <div className="vb-hero">
                            <img className="vb-herobrand" src="/brand/yeobaek-icon.svg" alt="" />
                            <p>PDF를 추가하면 표지와 함께 이 서재에 꽂힙니다.<br />
                              읽을 때는 단어 한 번 탭 = 뜻 · 두 번 탭 = 문장 해석 · 드래그 = 구간 해석.</p>
                            <button className="vb-libbtn pri" style={{ padding: "13px 26px", fontSize: 15 }}
                              disabled={!ready} onClick={() => fileRef.current?.click()}>
                              {ready ? "첫 PDF 추가" : "준비 중…"}
                            </button>
                          </div>
                        ) : (
                          <div className="vb-oempty">
                            {libView === "recent"
                              ? "아직 연 문서가 없습니다."
                              : libFolder
                              ? "이 폴더는 비어 있습니다. 서재에서 PDF를 끌어다 놓으세요."
                              : "아직 저장된 PDF가 없습니다. 'PDF 추가'를 누르거나 파일을 끌어다 놓으세요."}
                          </div>
                        )
                      ) : (
                        <div className="vb-mgrid">
                          {(libView === "recent" ? recentFiles : shownFiles).map((f) => renderDocCard(f))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="vb-hint" style={{ marginTop: 26 }}>
                    <b>탭</b> 열기 · <b>⋮</b> 이름 바꾸기·이동·다운로드·삭제 · <b>끌어서 폴더에 놓기</b> 이동<br />
                    읽기 화면 — <b>탭</b> 단어 풀이 · <b>길게 눌러 선택</b> 구간 해석 · <b>두 손가락</b> 확대
                  </div>
                </div>
              </div>
            )}
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
            <div className="vb-askwrap">
              <div className="vb-atop">
                <div className="vb-sessrow">
                  <div style={{ position: "relative" }}>
                    <button className={"vb-sessbtn" + (sessMenuOpen ? " open" : "")}
                      onClick={() => { setSessMenuOpen((v) => !v); setMdlMenuOpen(false); }}>
                      <i />
                      <span>{sess ? sess.title : "대화 없음"}</span>
                      <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {sessMenuOpen && (
                      <div className="vb-dropmenu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 230, zIndex: 5 }}>
                        <div className="vb-dropscroll">
                          {sessions.length === 0 && <div className="vb-dropfoot">대화가 없습니다.</div>}
                          {sessions.map((s) => (
                            <div key={s.id} className={"vb-sessitem" + (s.id === curSess ? " on" : "")}
                              style={{ cursor: "pointer" }}
                              onClick={() => { setCurSess(s.id); setSessMenuOpen(false); }}>
                              <i />
                              <span className="t">{s.img ? "◨ " : ""}{s.title}</span>
                              <span className="m">{fmtDate(s.at)}</span>
                              <button className={"x" + (delAsk === "as" + s.id ? " ask" : "")}
                                onClick={(e) => { e.stopPropagation(); tapDel("as" + s.id, () => delSess(s.id)); }}
                                aria-label="대화 삭제">
                                {delAsk === "as" + s.id ? "삭제?" : "✕"}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="vb-dropfoot">
                          한 대화 안에서만 앞의 문답을 기억합니다 · 마지막 질문에서 2시간 뒤 사라짐 · 영역을 오려내면 새 대화가 열립니다
                        </div>
                      </div>
                    )}
                  </div>
                  {ttlLeft && <span className="vb-ttl">{ttlLeft}</span>}
                  <button className="vb-newsess" onClick={() => { newSess("새 대화"); setSessMenuOpen(false); }}>＋ 새 대화</button>
                </div>

                <div className="vb-composer">
                  <textarea className="vb-askin" rows={1} value={askVal} placeholder={`${curPage}쪽을 근거로 물어보기`}
                    onChange={(e) => setAskVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && wide) { e.preventDefault(); sendAsk(); } }} />
                  <button className="vb-send" disabled={asking || !askVal.trim()} onClick={sendAsk} aria-label="보내기">
                    <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </div>

                <div className="vb-attrow">
                  {sess?.img && sendFig && (
                    <span className="vb-chip">
                      <img src={"data:image/jpeg;base64," + sess.img} alt="" />
                      영역 1
                      <button onClick={() => setSendFig(false)} aria-label="첨부 빼기">✕</button>
                    </span>
                  )}
                  <button className="vb-capchip" onClick={() => enterCap(curSessRef.current)}>＋ 오려내기</button>
                  {models.length > 0 && (
                    <div style={{ position: "relative", marginLeft: "auto" }}>
                      <button className={"vb-mdlbtn" + (mdlMenuOpen ? " open" : "")}
                        onClick={() => {
                          // 열기는 곧바로 하고 측정은 뒤따라 붙는다 — await 하지 않는다.
                          // refreshHealth 를 setState 업데이터 안에 넣으면 안 된다(순수해야 한다).
                          const opening = !mdlMenuOpen;
                          setMdlMenuOpen(opening);
                          setSessMenuOpen(false);
                          if (opening) refreshHealth();
                        }}>
                        {cfg.askModel ? (models.find((m) => m.id === cfg.askModel)?.label || "모델") : `기본${defLabel ? " — " + defLabel : ""}`}
                        <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      {mdlMenuOpen && (
                        <div className="vb-dropmenu" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 270, zIndex: 5 }}>
                          <div className="vb-dropscroll">
                            <button className={"vb-mdlitem" + (!cfg.askModel ? " on" : "")} onClick={() => pickModel("")}>
                              <span className="vb-mdlrow">
                                <span className="n">기본{defLabel ? ` — ${defLabel}` : ""}</span>
                                {!cfg.askModel && <span className="c">✓</span>}
                              </span>
                            </button>
                            {["chat", "reason"].map((grp) => {
                              const list = models.filter((m) => (m.think ? "reason" : "chat") === grp);
                              if (!list.length) return null;
                              return (
                                <div key={grp}>
                                  <div className="vb-mdlgrp">{grp === "reason" ? "추론 모델 — 속생각을 먼저 흘린 뒤 답한다" : "일반 모델"}</div>
                                  {list.map((m) => {
                                    const hp = healthOf(m.id);
                                    return (
                                      <button key={m.id} className={"vb-mdlitem" + (cfg.askModel === m.id ? " on" : "")}
                                        onClick={() => pickModel(m.id)}>
                                        <span className="vb-mdlrow">
                                          <span className="n">{m.label}</span>
                                          {m.id === defModel && <span className="d">기본</span>}
                                          {hp && <span className={"vb-mdlhp " + hp.cls}><i />{hp.text}</span>}
                                          {cfg.askModel === m.id && <span className="c">✓</span>}
                                        </span>
                                        <span className="vb-mdlnote">{m.note}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          <div className="vb-dropfoot">
                            단어·문장 탭은 반응 속도 때문에 빠른 모델을 그대로 씁니다 — 이 선택은 질문 탭에만 적용됩니다.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="vb-scroll" ref={panesRef}>
                {statView && (
                  <div className={"vb-statcard" + (statView.warn ? " warn" : "")}>
                    <div className="vb-statrow1">
                      <i className="vb-statdot" />
                      <span className="vb-statlbl">{statView.text}</span>
                      <button className="vb-statstop" onClick={stopAsk}>중단</button>
                    </div>
                    {statSteps && (
                      <div className="vb-statsteps">
                        {statSteps.map((s) => (
                          <div key={s.label} className={"vb-statstep" + (s.cls ? " " + s.cls : "")}>
                            <b /><span>{s.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="vb-statmeta">
                      {aiStat?.engine && <span className="eng">{aiStat.engine}</span>}
                      {aiStat?.model && <span>{aiStat.model.split("/").pop()}</span>}
                      <span>질문 탭</span>
                      {ttlLeft && <span style={{ marginLeft: "auto" }}>대화 {ttlLeft}</span>}
                    </div>
                  </div>
                )}

                {qaPairs.length === 0 ? (
                  <div className="vb-ph">
                    <p>책 본문을 근거로 답합니다 — 짧은 책은 전체를, 긴 책은 지금 보는 {curPage}쪽 주변과 목차를 함께 보냅니다.</p>
                    <p style={{ margin: 0 }}>한 대화 안에서는 앞의 문답을 기억하므로 이어서 되물을 수 있습니다. 대화는 마지막 질문에서 2시간 뒤 사라집니다.</p>
                  </div>
                ) : (
                  <>
                    <div className="vb-recent">최신<b /></div>
                    {qaPairs.map((p, k) => {
                      const latest = k === 0;
                      const ek = (sess?.id || "") + ":" + p.i;
                      const expanded = latest || expandSet.has(ek);
                      return (
                        <div key={p.i} className={"vb-qa" + (latest ? " vb-pe" : " past" + (expanded ? " open" : ""))}>
                          {p.q.img && <img className="vb-msgimg" src={p.q.img} alt="오려낸 영역" />}
                          <div className="vb-qbubble">{p.q.text}</div>
                          {p.a && (
                            <div className={"vb-abody" + (!expanded ? " clamp" : "")}>
                              {/* 끊겼어도 받아 둔 답이 있으면 그걸 먼저 보여 주고, 사정은 아래에 적는다 */}
                              {p.a.text && <Rich text={p.a.text} live={!!p.a.live} />}
                              {p.a.err && (
                                <span className="vb-err">
                                  {p.a.text ? p.a.err : `답을 받지 못했습니다 — ${p.a.err}`}
                                </span>
                              )}
                              {p.a.stopped && <div className="vb-stopped">여기서 중단했습니다</div>}
                              {p.a.swap && (
                                <div className="vb-swap">
                                  {p.a.swap.wanted}가 붐벼서 {p.a.swap.model}가 대신 답했습니다
                                </div>
                              )}
                            </div>
                          )}
                          {!latest && p.a && !p.a.err && (
                            <button className="vb-expand"
                              onClick={() => setExpandSet((s) => {
                                const n = new Set(s);
                                n.has(ek) ? n.delete(ek) : n.add(ek);
                                return n;
                              })}>
                              {expanded ? "접기" : "펼치기"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
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

        {setOpen && (
          <div className="vb-modal" onClick={(e) => { if (e.target === e.currentTarget) setSetOpen(false); }}>
            <div className="vb-card">
              <h3>엔진 설정</h3>
              <p className="vb-sub">기본은 NVIDIA NIM입니다. 호출이 실패하면 서버가 자동으로 Gemini로 넘어가고, 이후 3분간 Gemini를 먼저 씁니다. API 키는 서버에서 관리하므로 여기에 넣지 않습니다. 설정과 배율은 이 기기에 저장됩니다.</p>
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
              {models.length > 0 && (
                <div className="vb-field">
                  <label>질문 탭 모델</label>
                  <select value={cfg.askModel || ""}
                    onChange={(e) => setCfg({ ...cfg, askModel: e.target.value })}>
                    <option value="">
                      서버 기본값{defLabel ? ` — ${defLabel}` : ""}
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="vb-hint">
                    {askNote || "단어·문장 탭은 반응 속도 때문에 빠른 모델을 그대로 씁니다. 이 설정은 질문 탭에만 적용됩니다."}
                  </p>
                </div>
              )}
              <button className="vb-done" onClick={() => { persist(); setSetOpen(false); }}>닫기</button>
            </div>
          </div>
        )}

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
                              <img src={"/api/library/thumb/" + r.id} alt="" loading="lazy" />
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
