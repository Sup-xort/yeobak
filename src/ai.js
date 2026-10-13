import { u } from "./paths.js";

/* onEvent: 서버의 이름 있는 이벤트(try·fail·nap·pick·error — server/index.js 의 sseNote). */
async function readSSE(res, pick, onDelta, onThink, onStop, onEvent) {
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
  let buf = "", out = "", ev = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("event:")) { ev = line.slice(6).trim(); continue; }
      if (!line.trim()) { ev = ""; continue; }
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let j;
      try { j = JSON.parse(raw); } catch { continue; }
      if (ev) { onEvent?.(ev, j); continue; }
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

export class AuthError extends Error {
  constructor() { super("로그인이 필요합니다."); this.name = "AuthError"; }
}

/* opts.ask = true 면 서버가 질문 탭 전용 모델(opts.model 또는 서버 기본값)로 부른다. */
export async function callServer(cfg, system, user, onDelta, signal, opts = {}) {
  const res = await fetch(u("/api/chat"), {
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
      ask: !!opts.ask,
      model: opts.ask ? cfg.askModel || "" : "",
      // 고른 모델이 실패하면 서버가 알아서 다른 모델로 넘어간다 — 누가 답했는지는 X-Model 로 온다
      tapModel: cfg.tapModel || "",
      // 그림째 Gemini 에게만 — 막혀 있으면 서버가 502 를 주고, 호출한 쪽이 두 단계로 넘어간다
      visionDirect: !!opts.visionDirect,
      // 상태를 보는 쪽(onPhase)이 있으면 모델 고르는 과정까지 받는다 — 이때 모델 정보는 헤더가 아니라 pick 이벤트
      progress: !!opts.onPhase,
    }),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    let d = "";
    try { d = (await res.json()).error || ""; } catch {}
    throw new Error("요청 실패 " + res.status + (d ? ": " + d : ""));
  }
  let engine = res.headers.get("X-Engine") || "";
  let model = res.headers.get("X-Model") || "";
  // 고른 모델이 붐벼서 다른 모델이 대신 답했으면 서버가 원래 고른 쪽을 여기 담아 준다.
  const wanted = res.headers.get("X-Wanted") || "";
  if (wanted) opts.onPhase?.("swap", { wanted, model });
  /* 헤더에 모델이 있으면 서버가 이미 모델에 붙었다는 뜻이다(progress 가 아닐 때).
     이 시점부터 첫 글자까지의 침묵은 "모델이 생각 중"과 "죽었다"를 구분할 수 없다 —
     그래서 상태만 알리고 끊는 판단은 사람에게 맡긴다. progress 면 pick 이벤트가 같은 일을 한다. */
  if (model) opts.onPhase?.("wait", { engine, model });
  let first = true;
  let think = 0;
  let stop = "";
  let failed = "";
  const text = await readSSE(res, PICK_OPENAI, (c) => {
    if (first) { first = false; opts.onPhase?.("stream", { engine, model }); }
    opts.onPhase?.("tick");
    // 스트림을 화면에 안 뿌리는 호출자(이름 정리처럼 결과 전체만 쓰는 쪽)는 onDelta 를 안 넘긴다
    onDelta?.(c);
  }, (k) => {
    // 속생각이 흐르는 동안은 답이 한 글자도 안 나온다. 그래도 모델은 일하고 있다.
    think += k.length;
    opts.onPhase?.("think", { engine, model, think });
  }, (fr) => { stop = fr; }, (name, d) => {
    if (name === "error") { failed = d.error || "지금은 답할 수 있는 모델이 없어요."; return; }
    if (name === "pick") {
      engine = d.engine || ""; model = d.model || "";
      if (d.wanted) opts.onPhase?.("swap", { wanted: d.wanted, model });
      opts.onPhase?.("pick", d);
      // 이어 쓰기(cont)는 답이 이미 흐르던 중이다 — 단계를 "계산 중"으로 되돌리지 않는다
      if (d.why !== "cont") opts.onPhase?.("wait", { engine, model });
      return;
    }
    opts.onPhase?.(name, d); // try · fail · nap
  });
  if (failed && !text) throw new Error(failed);
  // 상한에 걸려 끊긴 걸 조용히 넘기면 화면에는 "다 답했다"로 보인다 — 호출자에게 알린다
  if (stop === "length") opts.onPhase?.("cut", { engine, model });
  return { text, engine, model, truncated: stop === "length" };
}
