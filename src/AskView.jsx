import { useState, useRef, useEffect } from "react";
import { ThinkingOrb } from "thinking-orbs";
import Rich from "./rich.jsx";
import Bi from "./icons.jsx";
import { useLiveText } from "./liveText.js";

/* ───────────────────────── 질문 탭 화면 (아이패드·폰 공용) ─────────────────────────
   대화는 서버 한 곳(server/remote.js 의 세션 저장소)에 있고, 이 컴포넌트는 그리기만 한다.
   무엇을 보내고 누가 답하는지는 부르는 쪽(App.jsx = 모델을 부르는 실행자, Remote.jsx = 폰)이 정한다.

   run: 지금(또는 방금) 도는 답의 상태 — App.jsx 의 aiStat 모양 그대로
     { running, phase, t0, at, marks, tryLabel, pickLabel, pickWhy, model, trail, chars, think, step,
       outcome, err, end, napSec }
   폰은 아이패드가 relay("ask")로 흘려 주는 같은 모양을 받는다. */

export const SESS_TTL = 2 * 60 * 60 * 1000; // server/remote.js 와 같은 값

/* 붙여넣거나 끌어다 놓은 그림을 JPEG 로 — 스크린숏은 PNG 라 크고, 서버·모델 쪽은 JPEG 를 전제로 한다.
   긴 변 max 픽셀로 줄인다(아이패드 스크린숏 2732px 그대로면 수 MB). 투명 배경은 흰색으로 깐다. */
export async function imageToJpeg(file, max = 2048) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("그림을 읽지 못했어요."));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.9);
    const blob = await (await fetch(dataUrl)).blob();
    return { b64: dataUrl.split(",")[1], blob, url: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 붙여넣기·끌어다 놓기에서 그림 파일 하나를 꺼낸다(없으면 null)
const imageFileOf = (dt) => {
  if (!dt) return null;
  for (const f of dt.files || []) if (f.type.startsWith("image/")) return f;
  for (const it of dt.items || []) {
    if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) return f; }
  }
  return null;
};

const STALL_WAIT = 45_000; // 첫 글자를 이만큼 못 받으면 경고색(MiniMax M3 실측 40.9초보다 넉넉히)
const STALL_GAP = 12_000;  // 흐르던 답이 이만큼 멈추면 경고색
const PICK_WHY = { auto: "자동 선택 1순위", picked: "직접 고른 모델", fallback: "앞 모델이 응답하지 않아 전환", cont: "끊긴 답을 이어서 작성" };

const ago = (t) => {
  const min = Math.floor((Date.now() - (t || 0)) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
};
const ttlText = (s) => {
  const ms = SESS_TTL - (Date.now() - (s?.at || 0));
  if (!s || ms <= 0) return "";
  const min = Math.ceil(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분 남음` : `${min}분 남음`;
};

/* 상태 한 벌 — 답 머리 한 줄(text·orb), 고리(prog·short), 상태 카드(title·sub·steps). 순수 함수. */
export function runView(r) {
  if (!r) return null;
  const live = !!r.running;
  const now = r.end || Date.now();
  const m = r.marks || {};
  const who = r.pickLabel || (r.model ? String(r.model).split("/").pop() : "");
  const gap = now - (r.at || r.t0);
  const phaseIdx = { send: 0, try: 1, nap: 1, wait: 2, think: 2, stream: 3 }[r.phase] ?? 0;

  let orb = "breathing", text = "", warn = false;
  if (live) {
    switch (r.phase) {
      case "send": orb = "connecting"; text = "요청 보내는 중"; warn = now - r.t0 >= STALL_WAIT; break;
      case "try": orb = "connecting"; text = `${r.tryLabel} 연결 중`; break;
      case "nap": orb = "searching"; text = "모든 모델이 바빠요 · 잠시 후 다시 시도할게요"; warn = true; break;
      case "think": orb = "solving"; text = `${who} 생각하는 중`; break;
      case "wait": orb = "breathing"; warn = gap >= STALL_WAIT; text = warn ? `${who} 응답이 늦어지고 있어요` : `${who} 준비 중`; break;
      default: orb = "composing"; warn = gap >= STALL_GAP; text = warn ? "답변이 잠시 멈췄어요" : `${who} 답변 중`;
    }
  }

  const first = (...ks) => ks.map((k) => m[k]).filter(Boolean).sort((a, b) => a - b)[0];
  const starts = [r.t0, first("try", "pick", "wait", "think", "stream"), first("wait", "think", "stream"), m.stream];
  const cur = !live && r.outcome === "done" ? 4 : phaseIdx;
  const steps = ["보냄", "연결", "생각", "답변"].map((label, i) => {
    const a = starts[i];
    const b = starts.slice(i + 1).find(Boolean) ?? (i <= cur ? now : undefined);
    return { label, cls: i < cur ? "done" : i === cur ? (live ? "now" : r.outcome === "done" ? "done" : "fail") : "",
      dur: a && b ? ((b - a) / 1000).toFixed(1) + "초" : "" };
  });
  const sec = ((now - r.t0) / 1000).toFixed(live ? 0 : 1);
  /* 고리 진행률 — 4단계가 한 칸씩 25%. 단계 안에서는 끝을 모르므로 지수로 차오르다 90%에서 멈춘다
     (답변 단계는 받은 글자 수로). 끝나면 100%. */
  const inStep = phaseIdx === 3
    ? 1 - Math.exp(-(r.chars || 0) / 1500)
    : 1 - Math.exp(-(now - (starts[phaseIdx] || r.t0)) / [1500, 4000, 12000][phaseIdx]);
  const prog = !live && r.outcome === "done" ? 1 : Math.min(1, (phaseIdx + 0.9 * inStep) / 4);

  let short, title, sub;
  if (live) {
    short = { send: "보내는 중", try: "연결 중", nap: "다시 시도 중", wait: "준비 중", think: "생각 중", stream: "답변 중" }[r.phase] || "처리 중";
    title = text;
    sub = {
      send: "요청을 보내고 있어요.",
      try: "답할 모델에 연결하고 있어요.",
      nap: "모든 모델이 바빠서 잠깐 기다렸다가 다시 시도해요.",
      wait: warn ? "평소보다 오래 걸리고 있어요. 멈추고 다시 시도해도 괜찮아요." : "요청을 처리하고 있어요. 잠시만 기다려 주세요.",
      think: `답하기 전에 생각을 정리하고 있어요 · 생각 ${r.think || 0}자`,
      stream: warn ? "답변이 잠시 멈췄어요. 곧 이어지거나 다른 모델이 이어서 써요." : `답변을 쓰고 있어요 · ${r.chars || 0}자`,
    }[r.phase] || "";
  } else if (r.outcome === "done") {
    short = "완료"; title = "답변 완료";
    sub = `${who ? who + " · " : ""}${m.stream ? `첫 글자 ${((m.stream - r.t0) / 1000).toFixed(1)}초 · ` : ""}전체 ${sec}초`;
  } else if (r.outcome === "stopped") {
    short = "멈춤"; title = "답변을 멈췄어요"; sub = `${sec}초 만에 멈췄어요.`;
  } else {
    short = "실패"; title = "답변을 받지 못했어요"; sub = r.err || "잠시 후 다시 시도해 주세요.";
  }
  return {
    live, orb, text, who, warn: live ? warn : r.outcome === "error",
    short, title, sub, sec, steps, prog, outcome: r.outcome,
    why: PICK_WHY[r.pickWhy] || "", trail: r.trail || [], step: r.step || "", device: r.device || "",
  };
}

export default function AskView({
  theme = "dark", active = true,
  sessions = [], curId = "", onPickSess, onNewSess, onDelSess,
  msgs = [], imgUrl = (x) => x,
  value, onChange, onSend, onStop, busy = false,
  placeholder = "물어보세요", empty = {}, notice = null,
  attach = null, capture = null,
  models = [], askRank = [], selModel = "", onPickModel, onModelsOpen, healthOf = () => null, defLabel = "",
  run: runProp = null, lastRun = null,
  runRef = null, // 실행자(App)가 넘기는 지금 상태 ref — 있으면 초마다 직접 읽는다(부모를 다시 그리지 않게)
  onRedo, canRedo = () => false, wideEnter = false,
  onImage = null, // 붙여넣기·끌어다 놓기로 들어온 그림 파일(File) — 없으면 받지 않는다
}) {
  const sess = sessions.find((s) => s.id === curId) || null;
  const run = runRef?.current?.running ? runRef.current : runProp;

  /* ── 초 단위 갱신 — 도는 동안만 ── */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!run?.running) return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [run?.running]);

  /* ── 팝오버(대화 목록 · 모델 · 상태 카드) — 하나만 열린다, 바깥을 누르면 닫힌다 ── */
  const [pop, setPop] = useState(""); // "" | "sess" | "model" | "stat"
  const toggle = (k) => setPop((p) => (p === k ? "" : k));
  useEffect(() => {
    if (!pop) return;
    const onDown = (e) => { if (!e.target.closest(".vb-ak-pop") && !e.target.closest("[data-pop]")) setPop(""); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pop]);

  const [delId, setDelId] = useState("");
  const delTimer = useRef(null);
  const tapDel = (id) => {
    if (delId === id) { setDelId(""); clearTimeout(delTimer.current); onDelSess?.(id); return; }
    setDelId(id);
    clearTimeout(delTimer.current);
    delTimer.current = setTimeout(() => setDelId(""), 2600);
  };

  const [copied, setCopied] = useState("");
  const copy = async (key, text) => {
    try { await navigator.clipboard.writeText(text); } catch {
      // 홈 화면 웹앱에서 clipboard API 가 막힐 때 — 숨긴 textarea 로
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? "" : k)), 1500);
  };

  /* ── 상태: 도는 동안 + 끝나고 4초(또는 카드를 열어 둔 동안) ── */
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!lastRun) return;
    setPeek(true);
    const t = setTimeout(() => setPeek(false), 4000);
    return () => clearTimeout(t);
  }, [lastRun]);
  const liveView = runView(run?.running ? run : null);
  const shown = run?.running ? liveView : (pop === "stat" || peek) ? runView(lastRun) : null;
  const lastShown = useRef(null);
  if (shown) lastShown.current = shown;
  const ring = shown || lastShown.current; // 사라지는 애니메이션 동안은 마지막 모습 그대로
  const liveModel = liveView ? (run.pickLabel || run.tryLabel || "") : "";
  const mdlTitle = liveModel || (selModel
    ? (models.find((m) => m.id === selModel)?.label || "모델")
    : `자동 · ${askRank[0]?.label || defLabel || "준비 중"}`);

  /* ── 문답 쌍(최신이 위) ── */
  const pairs = [];
  for (let i = 0; i < msgs.length; i += 2) if (msgs[i]) pairs.push({ q: msgs[i], a: msgs[i + 1] || null, i });
  pairs.reverse();

  /* ── 스크롤 ──
     새 문답은 맨 위에 꽂힌다. 맨 위로 올리는 건 문답이 늘었을 때만, 그 밖엔 대화마다 읽던 자리를 기억하고,
     위에서 답이 자라면 화면 맨 위에 걸친 문답을 기준점 삼아 읽던 자리를 붙잡는다
     (아이패드 사파리엔 브라우저 스크롤 고정 overflow-anchor 가 없다). */
  const scRef = useRef(null);
  const inRef = useRef(null);
  const pos = useRef({});
  const lens = useRef({});
  const anchor = useRef(null);
  const [far, setFar] = useState(false);
  const pin = () => {
    const el = scRef.current, box = inRef.current;
    if (!el || !box) return;
    const top = el.scrollTop;
    const hit = [...box.children].find((c) => c.offsetTop + c.offsetHeight > top);
    anchor.current = top > 4 && hit ? { el: hit, off: hit.offsetTop - top } : null;
  };
  const onScroll = () => {
    const el = scRef.current;
    if (!el) return;
    pos.current[curId] = el.scrollTop;
    pin();
    const f = el.scrollTop > 240;
    setFar((v) => (v === f ? v : f));
  };
  useEffect(() => {
    if (!active) return;
    const el = scRef.current;
    if (!el) return;
    const prev = lens.current[curId];
    lens.current[curId] = msgs.length;
    const grew = prev !== undefined && msgs.length > prev;
    requestAnimationFrame(() => { el.scrollTop = grew ? 0 : pos.current[curId] || 0; onScroll(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.length, curId, active]);
  useEffect(() => {
    if (!active) return;
    const box = inRef.current, el = scRef.current;
    if (!box || !el) return;
    const ro = new ResizeObserver(() => {
      const a = anchor.current;
      if (!a || !a.el.isConnected) return;
      const want = a.el.offsetTop - a.off;
      if (Math.abs(want - el.scrollTop) > 1) el.scrollTop = want;
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [active]);

  /* ── 그림 붙여넣기·끌어다 놓기 ── 화면 어디에 놓아도 받는다(입력창만 노리기엔 작다) */
  const [dropOn, setDropOn] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const dropProps = onImage ? {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDropOn(true); },
    onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: () => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDropOn(false); } },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      dragDepth.current = 0; setDropOn(false);
      const f = imageFileOf(e.dataTransfer);
      if (f) onImage(f);
    },
  } : {};
  const onPaste = (e) => {
    if (!onImage) return;
    const f = imageFileOf(e.clipboardData);
    if (!f) return; // 글이면 평소대로 붙는다
    e.preventDefault();
    onImage(f);
  };

  return (
    <div className={"vb-askwrap vb-ak" + (dropOn ? " drop" : "")} {...dropProps}>
      {dropOn && <div className="vb-ak-drop"><Bi name="image" /><span>여기에 놓으면 그림을 붙여요</span></div>}
      {/* ── 머리: 대화 고르기 · 새 대화 ── */}
      <div className="vb-ak-head">
        <div className="vb-ak-anchor">
          <button data-pop className={"vb-ak-thread" + (pop === "sess" ? " open" : "")} onClick={() => toggle("sess")}>
            <span className="t">{sess ? sess.title : "새 대화"}</span>
            <Bi name="chevron-down" />
          </button>
          {pop === "sess" && (
            <div className="vb-ak-pop" style={{ left: 0, width: 300 }}>
              <div className="vb-ak-poph">최근 대화</div>
              <div className="vb-ak-popscroll">
                {sessions.length === 0 && <div className="vb-ak-popempty">아직 대화가 없어요.</div>}
                {sessions.map((s) => (
                  <div key={s.id} className={"vb-ak-sess" + (s.id === curId ? " on" : "")}
                    onClick={() => { onPickSess?.(s.id); setPop(""); }}>
                    <Bi name={s.origin === "phone" ? "phone" : s.img ? "image" : "chat"} className="ic" />
                    <span className="t">{s.title}</span>
                    <span className="m">{ago(s.at)}</span>
                    <button className={"x" + (delId === s.id ? " ask" : "")}
                      onClick={(e) => { e.stopPropagation(); tapDel(s.id); }} aria-label="대화 삭제">
                      {delId === s.id ? "삭제" : <Bi name="x-lg" />}
                    </button>
                  </div>
                ))}
              </div>
              <div className="vb-ak-popfoot">
                아이패드와 폰이 같은 대화를 함께 봐요. 마지막 질문 후 2시간 동안 보관돼요{sess && ttlText(sess) ? ` · 이 대화는 ${ttlText(sess)}` : ""}
              </div>
            </div>
          )}
        </div>
        <button className="vb-ak-iconbtn" aria-label="새 대화" title="새 대화" onClick={() => { onNewSess?.(); setPop(""); }}>
          <Bi name="pencil-square" />
        </button>
      </div>

      {/* ── 입력창: 첨부 · 글 · 도구(오려내기 · 상태 고리 · 모델 · 보내기/멈추기) ── */}
      <div className="vb-ak-composer">
        {attach && (
          <div className="vb-ak-attach">
            <img src={attach.src} alt="" />
            <span>{attach.label}</span>
            {attach.onRemove && (
              <button onClick={attach.onRemove} aria-label="첨부 빼기"><Bi name="x-lg" /></button>
            )}
          </div>
        )}
        <textarea className="vb-ak-input" rows={2} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} onPaste={onPaste}
          onKeyDown={(e) => { if (wideEnter && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend(); } }} />
        <div className="vb-ak-tools">
          {capture && (
            <button className="vb-ak-tool" onClick={capture.onClick} title={capture.label} aria-label={capture.label}>
              <Bi name={capture.icon} />
            </button>
          )}
          {/* 상태 고리 — 4단계 진행을 시계 방향으로 채운다. 누르면 상태 카드가 튀어나온다 */}
          {ring && (
            <button data-pop className={"vb-ak-ring" + (shown ? " show" : "") + (pop === "stat" ? " open" : "") +
              (ring.warn ? " warn" : ring.live ? " live" : " " + (ring.outcome || ""))}
              onClick={() => toggle("stat")} aria-expanded={pop === "stat"} aria-label={ring.title}>
              <span className="rg">
                <svg viewBox="0 0 24 24">
                  <circle className="trk" cx="12" cy="12" r="9" />
                  <circle className="bar" cx="12" cy="12" r="9" pathLength="100"
                    style={{ strokeDashoffset: 100 - Math.round(ring.prog * 100) }} />
                </svg>
                {!ring.live && (
                  <Bi name={ring.outcome === "done" ? "check2" : ring.outcome === "stopped" ? "stop-fill" : "exclamation-circle"} className="core" />
                )}
              </span>
              <span className="lbl">{ring.short}<em>{ring.sec}초</em></span>
            </button>
          )}
          <span className="vb-ak-grow" />
          {models.length > 0 && (
            <button data-pop className={"vb-ak-tool vb-ak-model" + (pop === "model" ? " open" : "")}
              title={mdlTitle} aria-label={"답변 모델: " + mdlTitle}
              onClick={() => { const o = pop !== "model"; toggle("model"); if (o) onModelsOpen?.(); }}>
              <Bi name="stars" />
              <i className={"dot " + (liveModel ? "run" : (selModel ? "ok" : askRank[0]?.cls || ""))} />
            </button>
          )}
          {busy && onStop ? (
            <button className="vb-ak-send stop" onClick={onStop} aria-label="멈추기" title="멈추기"><Bi name="stop-fill" /></button>
          ) : (
            <button className="vb-ak-send" disabled={!value.trim() || busy} onClick={() => onSend()} aria-label="보내기"><Bi name="arrow-up" /></button>
          )}
        </div>

        {pop === "model" && (
          <div className="vb-ak-pop" style={{ right: 0, top: "calc(100% + 6px)", width: 330 }}>
            <div className="vb-ak-popscroll">
              <button className={"vb-ak-opt" + (!selModel ? " on" : "")} onClick={() => { onPickModel?.(""); setPop(""); }}>
                <span className="row">
                  <span className="n">자동 선택</span>
                  {!selModel && <Bi name="check2" className="ck" />}
                </span>
                <span className="d">지금 잘 답하는 모델부터 차례로 물어요. 막히면 바로 다음 모델로 넘어가요.</span>
              </button>
              {askRank.length > 0 && (
                <ol className="vb-ak-rank">
                  {askRank.map((r) => {
                    const on = liveView && run.model === r.id;
                    return (
                      <li key={r.id} className={on ? "run" : ""}>
                        <span className="n">{r.label}</span>
                        <span className={"st " + (on ? "run" : r.cls)}><i />{on ? "답변 중" : r.text}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="vb-ak-poph">직접 선택</div>
              {models.map((m) => {
                const hp = healthOf(m.id);
                return (
                  <button key={m.id} className={"vb-ak-opt" + (selModel === m.id ? " on" : "")}
                    onClick={() => { onPickModel?.(m.id); setPop(""); }}>
                    <span className="row">
                      <span className="n">{m.label}</span>
                      {hp && <span className={"st " + hp.cls}><i />{hp.text}</span>}
                      {selModel === m.id && <Bi name="check2" className="ck" />}
                    </span>
                    <span className="d">{m.note}</span>
                  </button>
                );
              })}
            </div>
            <div className="vb-ak-popfoot">고른 모델이 응답하지 않으면 다른 모델이 대신 답해요.</div>
          </div>
        )}

        {pop === "stat" && ring && (
          <div className={"vb-ak-pop vb-isl-card" + (ring.warn ? " warn" : "")} style={{ left: 0, width: 340 }}>
            <div className="vb-isl-in">
              <div className="vb-isl-title">{ring.title}</div>
              <div className="vb-isl-sub">{ring.sub}</div>
              <div className="vb-isl-steps">
                {ring.steps.map((st) => (
                  <div key={st.label} className={"st " + st.cls}><b /><span>{st.label}</span><em>{st.dur}</em></div>
                ))}
              </div>
              {(ring.who || ring.why || ring.step || ring.device) && (
                <dl className="vb-isl-rows">
                  {ring.who && <><dt>모델</dt><dd>{ring.who}</dd></>}
                  {ring.why && <><dt>선택 이유</dt><dd>{ring.why}</dd></>}
                  {ring.step && <><dt>작업</dt><dd>{ring.step}</dd></>}
                  {ring.device && <><dt>답하는 기기</dt><dd>{ring.device}</dd></>}
                </dl>
              )}
              {ring.trail.length > 0 && (
                <div className="vb-isl-trail">
                  <div className="h">응답하지 않은 모델</div>
                  {ring.trail.map((t, i) => <div key={i} className="r"><span>{t.label}</span><em>{t.why}</em></div>)}
                </div>
              )}
              {ring.live && onStop && (
                <button className="vb-isl-stop" onClick={onStop}><Bi name="stop-fill" />멈추기</button>
              )}
            </div>
          </div>
        )}
      </div>

      {notice}

      {/* ── 대화 ── */}
      <div className="vb-scrollwrap">
        <div className="vb-scroll vb-ak-scroll" ref={scRef} onScroll={onScroll}>
          <div className="vb-scrollin" ref={inRef}>
            {pairs.length === 0 ? (
              <div className="vb-ak-empty">
                <ThinkingOrb state="breathing" size={64} theme={theme} aria-label="" />
                <h3>{empty.title || "무엇이든 물어보세요"}</h3>
                {empty.text && <p>{empty.text}</p>}
                {empty.suggestions?.length > 0 && (
                  <div className="vb-ak-suggest">
                    {empty.suggestions.map((t) => <button key={t} onClick={() => onSend(t)}>{t}</button>)}
                  </div>
                )}
              </div>
            ) : pairs.map((p, k) => {
              const latest = k === 0;
              const key = curId + ":" + p.i;
              const a = p.a;
              const live = !!(a?.live || (a?.pending && !a?.err));
              const lv = live && latest ? liveView : null;
              const by = a?.by;
              const failed = a && !live && a.err && !a.text;
              return (
                <div key={p.i} className={"vb-ak-turn" + (latest ? " latest vb-pe" : "")}>
                  {k === 1 && <div className="vb-ak-sep">이전 문답</div>}
                  <div className="vb-ak-q">
                    {p.q.img && <img src={imgUrl(p.q.img)} alt="오려낸 영역" />}
                    <p>{p.q.text}</p>
                  </div>
                  {a && (
                    <div className="vb-ak-a">
                      <div className={"vb-ak-ahead" + (lv?.warn ? " warn" : "")}>
                        {live
                          ? <ThinkingOrb state={lv?.orb || "breathing"} size={20} theme={theme} aria-label={lv?.text || "답변 대기 중"} />
                          : <i className={"mark" + (failed ? " err" : "")} />}
                        <span className="who">
                          {live ? (lv?.who || a.waitText || "답변 준비 중") : (by?.label || a.swap?.model || "답변")}
                        </span>
                        <span className="meta">{live ? (lv ? `${lv.sec}초` : "") : (by?.first ? `${by.first}초` : "")}</span>
                      </div>
                      {!live && by?.trail?.length > 0 && (
                        <div className="vb-ak-trail">
                          {by.trail.map((t, i) => <span key={i}><b>{t.label}</b><em>{t.why}</em></span>)}
                          <span className="to">→ 대신 답했어요</span>
                        </div>
                      )}
                      {!live && !by && a.swap && (
                        <div className="vb-ak-trail"><span><b>{a.swap.wanted}</b><em>붐빔</em></span><span className="to">→ 대신 답했어요</span></div>
                      )}

                      <LiveBody sid={curId} i={p.i + 1} text={a.text} live={live} />

                      {failed ? (
                        <div className="vb-ak-error">
                          <b>답변을 받지 못했어요</b>
                          <span>{a.err}</span>
                          {latest && canRedo(p) && <button disabled={busy} onClick={onRedo}>다시 시도</button>}
                        </div>
                      ) : a.err && !live ? (
                        <div className="vb-ak-note">연결이 끊겨 여기서 멈췄어요 · {String(a.err).replace(/^연결이 끊겨 여기서 멈췄(습니다|어요) — /, "")}</div>
                      ) : null}
                      {a.stopped && <div className="vb-ak-note">답변을 멈췄어요</div>}

                      {!live && !failed && (
                        <div className="vb-ak-acts">
                          {a.text && (
                            <button onClick={() => copy(key, a.text)} title="복사">
                              <Bi name={copied === key ? "check2" : "copy"} />
                              <span>{copied === key ? "복사됨" : "복사"}</span>
                            </button>
                          )}
                          {latest && canRedo(p) && (
                            <button disabled={busy} onClick={onRedo} title="다시 답변 받기">
                              <Bi name="arrow-clockwise" /><span>다시 답변</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {far && busy && (
          <button className="vb-jump" onClick={() => scRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>↑ 새 답변 보기</button>
        )}
      </div>
    </div>
  );
}

/* 답 본문 — 흐르는 중이면 liveText 저장소를 직접 구독해 이 칸만 다시 그린다(src/liveText.js) */
function LiveBody({ sid, i, text, live }) {
  const t = useLiveText(live ? sid : "", i, text);
  return t ? <div className="vb-ak-body"><Rich text={t} live={live} /></div> : null;
}
