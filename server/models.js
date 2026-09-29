/* ───────────────── 모델 목록 · 상태 · 자동 선택 ─────────────────
   왜 이 파일이 있나: Gemini·NIM 의 모델 목록은 몇 주 단위로 바뀐다(2026-09-18 NIM 대량 410,
   2026-09-28 deepseek-v4-flash-0731 410·gemini-2.5 "새 사용자 제공 안 함"). 예전엔 목록을 코드에
   박아 두고 죽을 때마다 손으로 찾아 고쳤다. 이제 서버가 스스로 한다:

   1. 찾기(discover) — 켜질 때와 하루 한 번, 두 API 의 모델 목록을 받는다.
      목록에 있다고 쓸 수 있는 건 아니다(수명 끝난 모델도, 이 계정에서 404 인 모델도 목록에 있다).
      그래서 이름으로 1차로 거르고(임베딩·음성·안전성 검사·코드 전용·소형), 새 모델이나 오래
      안 재 본 모델만 **실제로 짧게 불러 본다**: 답이 오나 / 첫 글자까지 몇 초 / 속생각을 하나 /
      (비전 후보면) 그림을 받나. 410·404·400 이면 목록에서 뺀다. 결과는 data/models.json.
   2. 분류 — 단어·문장 탭(속생각 없이 첫 글자가 빠른 것), 질문 탭(살아 있는 대화 모델 전부),
      영역 캡처(그림을 받는 것).
   3. 점수 — 실사용(/api/chat 의 성공·실패·첫 글자 시간)과 가끔의 1토큰 확인으로 모델마다
      성공률·첫 글자 시간을 지수이동평균으로 쌓는다. **상태를 요청 없이 알 방법은 없다**
      (두 곳 다 모델별 붐빔을 알려 주는 API 가 없다) — 그래서 실사용 기록이 주 재료다.
   4. 자동 선택 — 사용자가 "자동"이면 점수로 순서를 정하고, 고른 모델이 있으면 그걸 맨 앞에 둔다.
      탭은 빠른 순, 질문 탭은 품질 순(Gemini Flash 새 버전 → NIM 큰 모델 → Lite) + 방금 실패한 건 뒤로.

   모델 성격 설명(note)은 자동으로 못 만든다 — 직접 써 본 모델만 NOTES 에 남기고, 나머지는
   잰 값("추론 모델 · 첫 글자 약 2초")만 보여 준다. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DAY = 24 * 60 * 60 * 1000;
const RETEST_OK = DAY;          // 살아 있는 모델은 하루에 한 번 다시 잰다
const RETEST_DEAD = 7 * DAY;    // 410·404 로 뺀 모델은 일주일에 한 번만 다시 본다(부활하는 일이 있다)
const TEST_MS = 30_000;         // 찾기 테스트 한 번의 상한
const TAP_MAX_MS = 6_000;       // 이보다 첫 글자가 늦으면 탭용으로 안 쓴다
const RECENT_BAD = 5 * 60 * 1000; // 이 안에 실패하고 그 뒤로 성공이 없는 모델은 줄 뒤로
const PROVIDER_WIN = 5 * 60 * 1000; // 프로바이더(Google/NVIDIA) 전체 상태를 보는 창
const FRESH_MS = 5 * 60 * 1000; // 쓰는 동안 이보다 오래된 기록은 1토큰으로 다시 잰다

/* 직접 써 보고 적은 성격. 상태("몇 초", "무응답")는 적지 마라 — 금세 거짓말이 된다. */
const NOTES = {
  "gemini/gemini-3.8-flash": "조용히 생각한 뒤 한 번에 쓴다. 굵은 글씨와 소제목으로 구조를 잘 잡는다.",
  "gemini/gemini-3.6-flash": "3.8 과 비슷한 문체로 조금 짧게 쓴다. 탭에선 생각을 끄고 바로 쓴다.",
  "gemini/gemini-3.5-flash": "굵은 글씨와 소제목으로 구조를 잘 잡는다.",
  "gemini/gemini-3.5-flash-lite": "가장 가벼운 축. 짧고 담백하게 쓴다.",
  "gemini/gemini-flash-latest": "Google 이 가리키는 최신 Flash — 예고 없이 다른 모델로 바뀔 수 있다.",
  "deepseek-ai/deepseek-v4.1-flash": "표와 수식을 갖춰 쓰는 촘촘한 편. 속생각이 길게 흐르고 나서 답이 나온다.",
  "nvidia/nemotron-3-ultra-550b-a55b": "뜻풀이에 한 줄 풀이를 덧붙이는 등 친절하게 쓴다. 표를 즐겨 쓴다.",
  "nvidia/nemotron-3-super-120b-a12b": "표를 가장 많이 쓴다. 답 전에 속생각이 한참 흐른다.",
  "z-ai/glm-5.3-flash": "형식 지시를 잘 지키고 짧게 끝낸다.",
  "google/gemma-4-31b-it": "그림 속 글자를 정확히 읽고 한국어가 자연스럽다.",
};

/* 첫 실행(아직 models.json 이 없을 때) 찾기가 끝나기 전에 쓸 목록 — 2026-09-28 실측으로 살아 있던 것 */
const SEED = [
  { id: "gemini/gemini-3.6-flash", think: false, gen: { thinkingConfig: { thinkingBudget: 0 } } },
  { id: "gemini/gemini-3.8-flash", think: false, gen: { thinkingConfig: { thinkingBudget: 0 } } },
  { id: "gemini/gemini-flash-latest", think: false, gen: { thinkingConfig: { thinkingBudget: 0 } } },
  { id: "gemini/gemini-3.5-flash", think: false },
  { id: "gemini/gemini-3.5-flash-lite", think: false },
  { id: "gemini/gemini-3.1-flash-lite", think: false, gen: { thinkingConfig: { thinkingLevel: "minimal" } } },
  { id: "deepseek-ai/deepseek-v4.1-flash", think: true },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", think: true },
  { id: "nvidia/nemotron-3-super-120b-a12b", think: true },
  { id: "z-ai/glm-5.3-flash", think: true },
  { id: "google/gemma-4-31b-it", think: false, vision: true },
];

/* 이름으로 1차로 거르기. 여기 걸리면 불러 보지도 않는다. */
const GEMINI_SKIP = /(tts|image|embedding|computer-use|robotics|transcribe|customtools|audio|live|aqa|omni|learnlm|gemma)/i;
const NIM_SKIP = new RegExp([
  "embed", "rerank", "retriev", "safety", "guard", "reward", "nemoguard", "parse", "ocr", "detect",
  "clip", "whisper", "tts", "asr", "riva", "canary", "parakeet", "coder", "code", "starcoder", "deplot",
  "kosmos", "paligemma", "neva", "fuyu", "vila", "cosmos", "flux", "sdxl", "stable", "diffusion", "bio",
  "genmol", "esm", "molmim", "diffdock", "chem", "audio", "translat", "bge", "colbert", "gliner",
  "topic-control", "jailbreak", "pii", "segment", "depth", "grounding", "-base", "math", "reason-?embed",
  "calibration",
  "llama-3\\.2-11b-vision", // 2026-07-30 실측: 같은 구절 무한 반복(자동 시험으론 안 잡힌다)
].join("|"), "i");
const sizeB = (id) => { const m = /(\d+(?:\.\d+)?)b(?![a-z])/i.exec(id.split("/").pop()); return m ? Number(m[1]) : 0; };

/* 사람이 읽을 이름 — "deepseek-ai/deepseek-v4.1-flash" → "DeepSeek V4.1 Flash" */
const WORDS = { glm: "GLM", gpt: "GPT", oss: "OSS", deepseek: "DeepSeek", nemotron: "Nemotron", llama: "Llama",
  qwen: "Qwen", qwq: "QwQ", kimi: "Kimi", gemma: "Gemma", mistral: "Mistral", phi: "Phi", gemini: "Gemini",
  latest: "(최신)", preview: "(미리보기)", lite: "Lite", vl: "VL", minimax: "MiniMax", nim: "NIM" };
function labelOf(id) {
  const gem = id.startsWith("gemini/");
  const toks = id.split("/").pop().split("-").filter((t) => t && !/^(it|instruct|chat|a\d+b|\d{4})$/i.test(t));
  const out = toks.map((t) => WORDS[t.toLowerCase()] ||
    (/^\d+(\.\d+)?b$/i.test(t) ? t.toUpperCase() : /^v\d/i.test(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)));
  return out.join(" ") + (gem ? "" : " · NIM");
}

/* 비전 테스트용 32×32 빨간 PNG — 이미지 도구가 없는 서버라 zlib 로 직접 만든다 */
function redPng() {
  const W = 32, row = Buffer.alloc(1 + W * 3);
  for (let x = 0; x < W; x++) row.set([220, 30, 30], 1 + x * 3);
  const raw = Buffer.concat(Array(W).fill(row));
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const PROBE_PNG = redPng();

export function createModels({ DATA_DIR, GEMINI_KEY, NIM_KEY, NIM_BASE }) {
  const FILE = path.join(DATA_DIR, "models.json");
  /* reg: id → { id, label, think, vision, gen, firstMs, status, checkedAt, dead } — 찾기 결과(저장됨)
     st:  id → { okEw, msEw, lastOk, lastFail, status, at }                       — 실사용 점수(메모리) */
  let reg = new Map();
  let updatedAt = 0;
  let discovering = false;
  const st = new Map();
  const events = []; // { gem, ok, at } — 프로바이더 단위 판정용 최근 기록
  const STATS = path.join(DATA_DIR, "model-stats.json");
  // 점수는 재기동해도 잊지 않는다 — 예전엔 재기동하면 방금 한도가 끝난 모델을 처음부터 다시 두드렸다
  try { for (const [id, v] of Object.entries(JSON.parse(fs.readFileSync(STATS, "utf8")))) st.set(id, v); } catch {}
  let statsDirty = false;
  setInterval(() => {
    if (!statsDirty) return;
    statsDirty = false;
    try { fs.writeFileSync(STATS + ".tmp", JSON.stringify(Object.fromEntries(st))); fs.renameSync(STATS + ".tmp", STATS); } catch {}
  }, 30_000).unref();

  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const m of j.models || []) {
      // 탭 자격이 tapMs 로 바뀌기 전(2026-09-28 저녁)에 저장된 항목 — Gemini 는 그때 이미 생각을 끈 설정으로 쟀다
      if (m.tapMs === undefined && m.id.startsWith("gemini/") && m.gen && m.quality && !m.think) m.tapMs = m.firstMs;
      reg.set(m.id, m);
    }
    updatedAt = j.updatedAt || 0;
  } catch {
    for (const m of SEED) reg.set(m.id, { ...m, label: labelOf(m.id), checkedAt: 0 });
  }
  const save = () => {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt, models: [...reg.values()] }, null, 2));
    fs.renameSync(tmp, FILE);
  };
  const isGem = (id) => id.startsWith("gemini/");
  const hasKey = (id) => (isGem(id) ? !!GEMINI_KEY : !!NIM_KEY);

  /* ── 점수 ──
     실패할 때마다 점수를 **깎는다**: 성공률(okEw)은 실패 한 번에 절반이 되고 성공으로 조금씩 회복한다.
     여기에 프로바이더 단위 판정을 더한다 — Google 쪽이 최근 5분 동안 실패가 성공보다 많으면
     Gemini 모델 전체를 NVIDIA 뒤로 보낸다. 2026-09-28 에 Gemini 가 503·429 로 통째로 막혔는데
     서버가 Gemini 모델을 하나씩 차례로 다 두드린 뒤에야 NIM 에 닿거나, 그 전에 시도 상한에 걸렸다. */
  /* lane: "tap"(속생각 끈 탭) / "main"(질문·캡처). 같은 모델도 둘의 첫 글자 시간이 수십 배 다르다
     (nemotron-3.5-lightning: 끄면 0.6초, 켜면 17초) — 섞어 재면 둘 다 틀린다. 성공률은 공유한다. */
  function record(id, ok, status = 0, ms = 0, lane = "main") {
    const s = st.get(id) || { okEw: 1 };
    s.okEw = ok ? 0.7 * s.okEw + 0.3 : s.okEw * 0.5;
    s.lanes = s.lanes || (s.msEw ? { main: s.msEw } : {});
    if (ok && ms) s.lanes[lane] = s.lanes[lane] ? 0.7 * s.lanes[lane] + 0.3 * ms : ms;
    s.msEw = s.lanes.main || s.msEw;
    s[ok ? "lastOk" : "lastFail"] = Date.now();
    s.status = status; s.at = Date.now(); s.ms = ms;
    // 429 는 대개 무료 등급의 **하루·분당 한도 초과**다 — 몇 초 뒤 풀리는 503 과 달리 오래 간다.
    // 30분 동안 아예 안 부른다(chain 참고).
    if (!ok && status === 429) s.quotaUntil = Date.now() + 30 * 60 * 1000;
    if (ok) s.quotaUntil = 0;
    st.set(id, s);
    statsDirty = true;
    events.push({ gem: isGem(id), ok, at: Date.now() });
    while (events.length && Date.now() - events[0].at > PROVIDER_WIN) events.shift();
    // 실사용에서 410·404 가 나면 곧바로 목록에서 뺀다 — 다음 찾기까지 기다리지 않는다
    if (!ok && (status === 410 || status === 404) && reg.has(id)) {
      Object.assign(reg.get(id), { dead: true, status, checkedAt: Date.now() });
      save();
    }
  }
  const recentBad = (id) => {
    const s = st.get(id);
    if (s?.quotaUntil > Date.now()) return true;
    return !!s?.lastFail && (!s.lastOk || s.lastFail > s.lastOk) && Date.now() - s.lastFail < RECENT_BAD;
  };
  /* 프로바이더가 지금 막혀 있나 — 최근 5분 실패 3번 이상 + 실패가 성공보다 많음 */
  function providerDown(gem) {
    let f = 0, o = 0;
    for (const e of events) if (e.gem === gem && Date.now() - e.at < PROVIDER_WIN) e.ok ? o++ : f++;
    return f >= 3 && f > o;
  }
  const speed = (id, lane = "main") => {
    const s = st.get(id);
    if (lane === "tap") return s?.lanes?.tap ?? reg.get(id)?.tapMs ?? 60_000;
    return s?.lanes?.main ?? s?.msEw ?? reg.get(id)?.firstMs ?? 5000;
  };
  const reliab = (id) => st.get(id)?.okEw ?? 1;
  /* 벌점: 0 이면 멀쩡. 정렬의 첫 기준이다. 모델 자신이 방금 실패(2), 성공률이 반 밑(1), 그 프로바이더가 막힘(1). */
  const penalty = (id) => (recentBad(id) ? 2 : 0) + (reliab(id) < 0.5 ? 1 : 0) + (providerDown(isGem(id)) ? 1 : 0);
  const version = (id) => Number(/(\d+(?:\.\d+)?)-/.exec(id.split("/").pop().replace(/^gemini-/, ""))?.[1] || 0);
  /* 질문 탭 품질 순위 — 잴 수 없는 것이라 규칙으로 둔다 */
  function quality(id) {
    const n = id.toLowerCase();
    if (isGem(id)) {
      const v = n.includes("latest") ? 3.7 : version(id);
      if (n.includes("lite")) return 40 + v;
      if (n.includes("pro")) return 90 + v; // 무료 등급에선 429 가 잦아 Flash 뒤에 둔다
      return 100 + v - (n.includes("preview") ? 0.5 : 0);
    }
    const b = sizeB(id);
    return (b >= 100 ? 60 : 20) + Math.log10(b || 1);
  }

  const alive = (m) => !m.dead && hasKey(m.id);
  // 탭 자격 = 찾기 때 "속생각 끈 설정으로 단어 풀이 시험"을 통과하고(tapMs 가 있음) 충분히 빠른 것
  const isTap = (m) => alive(m) && m.chat !== false && m.tapMs !== undefined && m.tapMs <= TAP_MAX_MS;
  const isAsk = (m) => alive(m) && m.chat !== false;
  const isVision = (m) => alive(m) && (isGem(m.id) || m.vision);

  function order(kind) {
    const list = [...reg.values()].filter(kind === "tap" ? isTap : kind === "image" ? isVision : isAsk).map((m) => m.id);
    const bad = penalty;
    if (kind === "ask")
      return list.sort((a, b) => bad(a) - bad(b) || (speed(a) > 30000) - (speed(b) > 30000) || quality(b) - quality(a));
    /* 캡처: Gemini 먼저(그림을 가장 잘 읽는다), 그 안에서 빠른 순.
       탭: **NIM 먼저** — Gemini 무료 한도는 모델마다 하루 몇십~몇백 번이라, 가장 자주 부르는 단어 탭이
       그걸 다 먹으면 정작 그림째 풀기·질문에 쓸 몫이 없다(2026-09-28 저녁에 실제로 그렇게 됐다).
       NIM 은 속생각을 끄면 단어 탭에 0.5~3초라 충분히 빠르다. Gemini 는 NIM 이 막혔을 때의 뒷줄. */
    if (kind === "tap") return list.sort((a, b) => bad(a) - bad(b) || isGem(a) - isGem(b) || speed(a, "tap") - speed(b, "tap"));
    return list.sort((a, b) => bad(a) - bad(b) || isGem(b) - isGem(a) || speed(a) - speed(b));
  }

  /* 한 요청의 시도 순서. picked 가 있으면 맨 앞(질문 탭은 방금 실패했어도 — 고른 의미가 없어지므로,
     탭은 속도가 먼저라 방금 실패했으면 뒤로). 이미지는 그림을 받는 모델만. */
  /* gemOnly: 그림째 한 번에 푸는 경로(visionDirect). 따로 규칙을 두지 않고 **캡처 순위를 그대로 쓴다** —
     순위표 맨 앞에서부터 Gemini 가 이어지는 동안만 시도하고, 순위상 NIM 모델이 앞에 서는 순간 멈춘다.
     그러면 클라이언트가 두 단계(NIM 이 옮겨 적기 → 질문 탭 모델이 풀기)로 넘어간다. Gemini 가 실패할 때마다
     점수가 깎이고(벌점, "Google 전체가 막힘") 다음 모델을 다시 고르므로, 막혀 있으면 한두 번 만에 NIM 이
     앞에 서서 저절로 멈춘다. 방금 막힌 게 기록돼 있으면 처음부터 빈 줄 → 곧바로 두 단계. */
  function chain({ kind, picked, gemOnly, ask }) {
    const base = order(kind);
    if (gemOnly) {
      const lead = [];
      for (const id of base) { if (!isGem(id)) break; lead.push(id); }
      return lead.filter((id) => !(st.get(id)?.quotaUntil > Date.now()));
    }
    const m = picked && reg.get(picked);
    const ok = m && (kind === "tap" ? alive(m) : kind === "image" ? isVision(m) : isAsk(m));
    let out = base.filter((id) => id !== picked);
    /* 탭: 탭용 모델이 전부 막히면(Google 이 통째로 막힌 날) 느리더라도 질문 탭 모델로 받는다 — 답이 늦는 게
       답이 없는 것보단 낫다. 둘을 한 줄로 합쳐 **벌점 먼저** 정렬하므로, 막힌 Gemini 탭 모델보다
       멀쩡한 NIM 이 앞에 선다. 벌점이 같으면 탭용 → 빠른 순. */
    if (kind === "tap") {
      const tapSet = new Set(out);
      out = [...out, ...order("ask").filter((id) => !tapSet.has(id) && id !== picked)]
        .sort((a, b) => penalty(a) - penalty(b) || tapSet.has(b) - tapSet.has(a) || isGem(a) - isGem(b) || speed(a, "tap") - speed(b, "tap"));
    }
    if (ok) out = kind === "tap" && penalty(picked) ? [...out, picked] : [picked, ...out];
    /* 한도가 끝난(429) 모델은 아예 안 부른다 — 불러 봐야 곧바로 429 이고, 그 자리를 차지해서
       뒤에 있던 멀쩡한 모델(NIM 비전 등)이 상한 5개에 잘려 한 번도 안 불렸다(2026-09-28 캡처 "전부 실패").
       전부 한도라면 어쩔 수 없이 그대로 시도한다. */
    const open = out.filter((id) => !(st.get(id)?.quotaUntil > Date.now()));
    return (open.length ? open : out).slice(0, 8);
  }

  const get = (id) => reg.get(id);
  const pickable = (id) => !!reg.get(id) && alive(reg.get(id));

  /* ── 1토큰 확인 (쓰는 동안만) ── */
  const probing = new Set();
  async function ping(id) {
    if (probing.has(id) || !hasKey(id)) return;
    probing.add(id);
    const t0 = Date.now();
    try {
      const r = isGem(id)
        ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id.slice(7))}:generateContent`, {
            method: "POST", signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 1, ...(reg.get(id)?.gen || {}) } }),
          })
        : await fetch(`${NIM_BASE}/chat/completions`, {
            method: "POST", signal: AbortSignal.timeout(10_000),
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIM_KEY}` },
            body: JSON.stringify({ model: id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
          });
      // 1토큰 응답 시간은 첫 글자 시간과 비슷하지만 같지 않다 — 성공 여부만 믿고 시간은 약하게 반영
      record(id, r.ok, r.status, r.ok ? Date.now() - t0 : 0);
    } catch (e) {
      // 10초 무응답은 "느림"(-1) — 죽었다고 단정하지 않는다(콜드스타트는 50초도 걸린다)
      const s = st.get(id) || { okEw: 1, msEw: 5000 };
      s.status = e.name === "TimeoutError" ? -1 : 0; s.at = Date.now();
      st.set(id, s);
    } finally {
      probing.delete(id);
    }
  }
  let lastTouch = 0;
  /* /api/chat·/api/models 가 부를 때마다: 5분 넘게 기록이 없는 상위 후보 몇 개만 다시 잰다.
     아무도 안 쓰면 아무것도 안 잰다 — 구글 무료 한도를 놀면서 갉아먹지 않게. */
  function touch(max = 3) {
    if (Date.now() - lastTouch < 60_000) return;
    lastTouch = Date.now();
    const seen = new Set();
    const cands = [...order("tap").slice(0, 3), ...order("ask").slice(0, 4)].filter((id) => !seen.has(id) && seen.add(id));
    let n = 0;
    for (const id of cands) {
      if (n >= max) break;
      if (Date.now() - (st.get(id)?.at || 0) > FRESH_MS) { ping(id); n++; }
    }
  }

  /* ── 찾기 ── */
  async function listGemini() {
    if (!GEMINI_KEY) return [];
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error("Gemini 목록 " + r.status);
    return ((await r.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => n.startsWith("gemini-") && !GEMINI_SKIP.test(n))
      .map((n) => "gemini/" + n);
  }
  async function listNIM() {
    if (!NIM_KEY) return [];
    const r = await fetch(`${NIM_BASE}/models`, { headers: { Authorization: `Bearer ${NIM_KEY}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error("NIM 목록 " + r.status);
    return ((await r.json()).data || []).map((m) => m.id)
      .filter((id) => !NIM_SKIP.test(id) && !(sizeB(id) && sizeB(id) < 7));
  }

  /* 스트림을 끝까지(또는 TEST_MS 까지) 읽는다 → { ok, status, firstMs, think, text }.
     firstMs 는 첫 델타(답이든 속생각이든)까지, text 는 답(content)만. */
  async function streamTest(url, init, gemini) {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TEST_MS);
    let firstMs = 0, contentMs = 0, think = false, text = "";
    try {
      const r = await fetch(url, { ...init, signal: ac.signal });
      if (!r.ok) { await r.text().catch(() => ""); return { ok: false, status: r.status }; }
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
          let c = "", k = "";
          if (gemini) c = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
          else { const d = j.choices?.[0]?.delta || {}; c = d.content || ""; k = d.reasoning_content || d.reasoning || ""; }
          if ((c || k) && !firstMs) firstMs = Date.now() - t0;
          if (k) think = true;
          if (c && !contentMs) contentMs = Date.now() - t0;
          text += c;
        }
        if (text.length > 2000) break;
      }
    } catch {
      if (!firstMs) return { ok: false, status: -1 }; // 30초 안에 한 글자도 없음 — 느림(죽었다고 단정하지 않는다)
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
    if (/<think>/.test(text)) { think = true; text = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, ""); }
    // 속생각만 흐르다 예산·시간 안에 끝났어도 살아 있는 추론 모델이다(답 품질은 판정 못 함)
    if (!text.trim()) return think ? { ok: true, status: 200, firstMs: Math.max(firstMs, TEST_MS), think, text: "" } : { ok: false, status: 204 };
    // 속도는 답의 첫 글자로 잰다(추론 모델의 속생각 첫 조각은 빨라도 답은 한참 뒤다)
    return { ok: true, status: 200, firstMs: contentMs || firstMs, think, text };
  }
  /* 자격 시험 — "이 일을 할 줄 아는가"만 본다. **답이 맞는지는 코드로 판정하지 않는다.**
     단어 뜻은 맞는 답의 모양이 너무 다양해서(이루다/실현하다/달성하다/꿈을 현실로 만들다 …) 정규식으로
     정답을 잡으면 멀쩡한 모델을 떨어뜨린다. 2026-09-29 에 "realize = 실현·이루" 정답 검사를 잠깐 넣었다가
     사용자와 이야기하고 되돌렸다 — 문맥상 덜 맞는 뜻("깨닫다")도 탭에선 큰 문제가 아니고, 품질의 차이는
     사람이 드롭다운으로 고르는 영역이다. 여기서 거르는 건 한국어로 "뜻:" 줄을 못 쓰는 모델뿐이다
     (보정·분류 전용 모델, 영어만 하는 소형 모델, 형식을 무시하는 모델 — nvidia/ising-calibration 이 그랬다). */
  const Q = "영어 단어의 뜻을 문장 속 의미로 한국어로 풀어라. 정확히 두 줄로만: 첫 줄 '뜻: …', 둘째 줄 '문맥: …'.\n" +
    "단어: realize\n문장: She finally realized her dream of becoming a doctor.";
  const passes = (raw) => {
    const t = raw.replace(/\*/g, ""); // "**뜻**:" 처럼 굵게 쓴 것도 받는다
    const mean = (/뜻\s*[:：]([^\n]*)/.exec(t) || [])[1] || "";
    return /[가-힣]{2,}/.test(mean); // "뜻:" 줄이 있고 그 줄이 한국어면 통과
  };
  async function testGemini(id) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id.slice(7))}:streamGenerateContent?alt=sse`;
    const call = (gen, image) => streamTest(url, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: image ? "이 그림의 색을 한 단어로." : Q },
        ...(image ? [{ inlineData: { mimeType: "image/png", data: PROBE_PNG } }] : [])] }],
        generationConfig: { maxOutputTokens: 400, ...(gen || {}) } }),
    }, true);
    /* 탭용으로 쓰려면 속생각을 꺼야 한다(속생각 토큰이 답 예산을 먹고 첫 글자를 늦춘다).
       모델마다 받는 설정이 달라서(3.8 은 "minimal" 을 400 으로 거절) 차례로 넣어 본다. */
    for (const gen of [{ thinkingConfig: { thinkingBudget: 0 } }, { thinkingConfig: { thinkingLevel: "minimal" } }, null]) {
      const r = await call(gen);
      if (r.status === 400) continue; // 이 설정을 안 받는다 — 다음 설정으로
      // 생각을 못 끈 모델(gen 없음)은 첫 글자가 늦으므로 탭에선 추론 모델처럼 다룬다
      const quality = r.ok ? passes(r.text) : undefined;
      // 생각을 끌 수 있고 뜻풀이 시험을 통과했으면 탭에 쓸 수 있다(tapMs)
      return { ...r, gen: gen || undefined, think: !gen, vision: true, quality, tapMs: gen && quality ? r.firstMs : undefined };
    }
    return { ok: false, status: 400 };
  }
  const NIM_NO_THINK = [{ chat_template_kwargs: { enable_thinking: false } }, { reasoning_effort: "low" }];
  async function testNIM(id) {
    const url = `${NIM_BASE}/chat/completions`;
    const call = (content, max = 1500, extra) => streamTest(url, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIM_KEY}` },
      body: JSON.stringify({ model: id, messages: [{ role: "user", content }], max_tokens: max, stream: true, ...(extra || {}) }),
    }, false);
    const r = await call(Q);
    // 추론 모델이 시간 안에 답까지 못 갔으면 품질은 모른다(undefined) — 빼지는 않는다
    if (r.ok) r.quality = r.text ? passes(r.text) : undefined;
    /* 탭용: 속생각을 끈 설정을 찾는다. NIM 은 모델마다 받는 방법이 다르다(2026-09-28 실측, 단어 탭 첫 글자):
         chat_template_kwargs.enable_thinking=false — nemotron-3.5-lightning 0.6초, nano-omni 0.5초, ultra 3.3초
         reasoning_effort="low"                      — gpt-oss-20b 0.8초, muse-glimmer 3.8초
       GLM·DeepSeek 은 둘 다 20초 넘게 걸려 탭엔 못 쓴다. 답이 시험을 통과하고 가장 빠른 설정을 고른다. */
    if (r.ok) {
      if (!r.think && r.quality && r.firstMs <= TAP_MAX_MS) r.tapMs = r.firstMs;
      else {
        for (const g of NIM_NO_THINK) {
          const t = await call(Q, 600, g);
          if (t.ok && t.text && passes(t.text) && t.firstMs <= TAP_MAX_MS && !(r.tapMs <= t.firstMs)) { r.tapMs = t.firstMs; r.gen = g; }
        }
      }
    }
    /* 그림 시험은 **모든** NIM 대화 모델에 한다 — 이름으로 짐작하면 놓친다(2026-09-28: 이름에 vision 이
       없는 muse-glimmer-30b·nemotron-3-nano-omni 가 실제로 그림을 읽었다). 못 받는 모델은 400 으로 곧장 거절한다. */
    if (r.ok) {
      const v = await call([{ type: "text", text: "이 그림은 무슨 색인가? 한국어 한 단어로." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PROBE_PNG}` } }], 300);
      // 붐빔·무응답이면 "그림 못 받음"으로 단정하지 않는다(undefined → 한 시간 뒤 다시). 거절(400·422)만 false.
      // 색을 맞혀야 "그림을 본다"로 친다. 속생각만 하다 끝나 답이 없으면 모른다(undefined) — 그림을 조용히
      // 버리고 텍스트만 받는 모델도 200 은 준다(2026-09-28: deepseek·gpt-oss 가 이걸로 비전 모델로 잘못 올라갔다).
      r.vision = v.ok ? (v.text ? /빨|붉|적색|red/i.test(v.text) : undefined)
        : [400, 404, 415, 422].includes(v.status) ? false : undefined;
    }
    return r;
  }

  async function discover({ force = false } = {}) {
    if (discovering) return;
    discovering = true;
    const t0 = Date.now();
    try {
      const found = [];
      for (const [name, fn] of [["Gemini", listGemini], ["NIM", listNIM]]) {
        try { found.push(...(await fn())); } catch (e) { console.warn(`[모델] ${name} 목록 실패: ${e.message}`); }
      }
      if (!found.length) return; // 두 목록 다 못 받았으면 있던 걸 그대로 둔다
      const listed = new Set(found);
      // 목록에서 사라진 모델은 뺀다
      for (const m of reg.values()) if (!listed.has(m.id) && hasKey(m.id)) Object.assign(m, { dead: true, status: "unlisted" });
      const due = found.filter((id) => {
        const m = reg.get(id);
        if (!m || force) return true;
        return Date.now() - (m.checkedAt || 0) > (m.pending ? 60 * 60 * 1000 : m.dead ? RETEST_DEAD : RETEST_OK);
      });
      let i = 0, added = 0, removed = 0;
      const worker = async () => {
        while (i < due.length) {
          const id = due[i++];
          const r = isGem(id) ? await testGemini(id) : await testNIM(id);
          const prev = reg.get(id);
          const m = { ...(prev || {}), id, label: labelOf(id), checkedAt: Date.now(), status: r.status };
          if (r.ok && r.quality === false) {
            // 답은 하는데 한국어 뜻풀이를 못 한다 — 여백엔 못 쓴다. 대화 모델 아님으로 표시
            Object.assign(m, { dead: false, chat: false, firstMs: r.firstMs, pending: false });
            if (prev && prev.chat !== false && !prev.dead) removed++;
          } else if (r.ok) {
            Object.assign(m, { dead: false, chat: true, think: !!r.think, firstMs: r.firstMs, quality: r.quality,
              vision: r.vision ?? prev?.vision ?? false, gen: r.gen, tapMs: r.tapMs,
              pending: !isGem(id) && r.vision === undefined });
            if (!prev || prev.dead) added++;
            record(id, true, 200, r.firstMs);
          } else if ([400, 404, 410, 422].includes(r.status)) {
            // 없는 모델·수명 끝·이 계정에서 못 씀·대화 모델이 아님 → 뺀다
            if (prev && !prev.dead) removed++;
            m.dead = true;
            m.pending = false;
          } else {
            // 붐빔(429/5xx)·느림(-1) — 살아 있을 수 있으니 이전 판정을 유지하고 다음에 다시 본다
            m.pending = true; // 한 시간 뒤 다시 본다(아래 due)
            if (!prev) m.dead = true; // 한 번도 답한 적 없는 새 모델은 확인될 때까지 안 쓴다
          }
          reg.set(id, m);
        }
      };
      await Promise.all([worker(), worker(), worker()]); // 동시에 셋 — 서버 메모리가 작다
      updatedAt = Date.now();
      save();
      const live = [...reg.values()].filter(alive);
      console.log(`[모델] 찾기 끝 ${((Date.now() - t0) / 1000).toFixed(0)}초 — 목록 ${found.length} · 테스트 ${due.length} · ` +
        `새로 ${added} · 뺌 ${removed} · 쓸 수 있음 ${live.length} (탭 ${live.filter(isTap).length}, 캡처 ${live.filter(isVision).length})`);
    } finally {
      discovering = false;
    }
  }

  /* 클라이언트에 줄 목록 — note 는 직접 써 본 것만, 나머지는 잰 값 */
  function describe(m, lane = "main") {
    // 속도는 답의 첫 글자 기준(속생각 제외). 탭 목록은 속생각을 끈 탭 설정으로 잰 값.
    const ms = lane === "tap" ? speed(m.id, "tap") : speed(m.id);
    const kindTxt = lane === "tap" ? "속생각 끔" : m.think ? "추론 모델" : "일반 모델";
    const measured = `${kindTxt}${ms && ms < 60_000 ? ` · 첫 글자 약 ${(ms / 1000).toFixed(1)}초` : ""}`;
    return { id: m.id, label: m.label || labelOf(m.id), think: lane === "tap" ? false : !!m.think, vision: !!(isGem(m.id) || m.vision),
      note: NOTES[m.id] ? `${NOTES[m.id]} (${measured})` : measured };
  }
  function publicList() {
    const byQ = (a, b) => quality(b.id) - quality(a.id);
    const all = [...reg.values()];
    return {
      models: all.filter(isAsk).sort(byQ).map(describe),
      tapModels: all.filter(isTap).sort((a, b) => isGem(a.id) - isGem(b.id) || speed(a.id, "tap") - speed(b.id, "tap")).map((m) => describe(m, "tap")),
      auto: { ask: order("ask")[0] || "", tap: order("tap")[0] || "", image: order("image")[0] || "" },
      health: Object.fromEntries([...st].map(([id, s]) => [id, { ok: s.status !== -1 && (!s.lastFail || (s.lastOk || 0) > s.lastFail), status: s.status, at: s.at, ms: Math.round(s.msEw) }])),
      updatedAt, discovering,
    };
  }

  return { record, chain, get, pickable, touch, discover, publicList, isGem, isDiscovering: () => discovering };
}
