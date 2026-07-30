import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PORT = Number(process.env.PORT || 8787);
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const NIM_KEY = process.env.NIM_API_KEY || "";
const NIM_MODEL = process.env.NIM_MODEL || "meta/llama-3.3-70b-instruct";
const NIM_BASE = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/* 질문 탭 전용 모델 목록.
   단어·문장 탭은 첫 토큰 속도가 생명이라 NIM_MODEL 을 그대로 쓰고,
   질문 탭만 아래에서 고른 모델로 부른다. 클라이언트가 이 목록을 받아 설정에 띄운다.
   note 는 2026-07-29 에 같은 질문으로 직접 재본 값이다(TTFT = 첫 글자까지). */
const ASK_MODELS = [
  { id: "deepseek-ai/deepseek-v4-pro",           label: "DeepSeek V4 Pro",        note: "설명이 가장 정확하고 말투가 자연스럽다. 첫 응답 ~1초." },
  { id: "nvidia/nemotron-3-super-120b-a12b",     label: "Nemotron 3 Super 120B",  note: "가장 빨리 끝난다(전체 ~2초). 답이 짧은 편." },
  { id: "minimaxai/minimax-m3",                  label: "MiniMax M3",             note: "가장 길고 꼼꼼하다. 첫 응답 ~8초." },
  { id: "openai/gpt-oss-120b",                   label: "GPT-OSS 120B",           note: "단어·문장 탭과 같은 계열. 빠르지만 마크다운을 섞는다." },
  { id: "mistralai/mistral-medium-3.5-128b",     label: "Mistral Medium 3.5",     note: "다국어에 강하지만 첫 응답이 20초 넘을 때가 있다." },
];
const ASK_MODEL_IDS = new Set(ASK_MODELS.map((m) => m.id));
const NIM_ASK_MODEL = process.env.NIM_ASK_MODEL || "deepseek-ai/deepseek-v4-pro";

/* 영역 캡처(이미지)를 읽는 비전 모델. ASK_MODELS 는 전부 텍스트 전용이라 이미지를 못 받는다.
   2026-07-30 에 실제 이미지를 던져 실측한 결과(표지 썸네일, 한국어 프롬프트):
     google/gemma-4-31b-it                    3.6초, 모든 글자 정확 + 한국어 자연스러움  ← 채택
     meta/llama-3.2-90b-vision-instruct      13.7초, 정확하지만 느리고 장황            ← 폴백
     nvidia/nemotron-nano-12b-v2-vl           2.1초, 제목만 읽고 나머지 놓침
     meta/llama-3.2-11b-vision-instruct       8.3초, 같은 구절 무한 반복 (실격)
   DeepSeek 은 NIM 에 비전 버전이 없다(v4-pro·v4-flash·coder 전부 텍스트 전용).
   카탈로그에 있어도 계정에서 404 나는 것들: gemma-3-12b-it, phi-3-vision, cosmos-reason2-8b. */
const NIM_VISION_MODEL = process.env.NIM_VISION_MODEL || "google/gemma-4-31b-it";
const VISION_CHAIN = [NIM_VISION_MODEL, "meta/llama-3.2-90b-vision-instruct"]
  .filter((m, i, a) => a.indexOf(m) === i);

if (!APP_PASSWORD || !SESSION_SECRET) {
  console.error("[여백] APP_PASSWORD 와 SESSION_SECRET 을 .env 에 설정하세요.");
  process.exit(1);
}
if (!NIM_KEY && !GEMINI_KEY) {
  console.error("[여백] NIM_API_KEY 또는 GEMINI_API_KEY 중 최소 하나는 필요합니다.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
// 영역 캡처는 base64 JPEG 를 본문에 담아 보낸다 (1400px 크롭이면 대략 200~600KB).
// 1mb 로는 큰 크롭에서 413 이 나므로 여유를 둔다.
app.use(express.json({ limit: "4mb" }));

/* ───────────────── 세션 (단일 비밀번호) ───────────────── */
const COOKIE = "yb_sess";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30일

function sign(exp) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(exp)).digest("base64url");
}
function makeToken() {
  const exp = Date.now() + MAX_AGE;
  return `${exp}.${sign(exp)}`;
}
function validToken(tok) {
  if (!tok) return false;
  const [exp, mac] = String(tok).split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  // 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다
  if (mac.length !== good.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good));
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

/* 비밀번호가 6자리 숫자라 시도 제한이 없으면 브루트포스에 뚫린다 — IP당 5회 실패 시 5분 잠금 */
const pwFails = new Map(); // ip → { n, until }
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  let f = pwFails.get(ip);
  if (f && f.until > Date.now())
    return res.status(429).json({ error: "실패가 너무 많습니다. 5분 뒤에 다시 해보세요." });
  if (f && f.until) { pwFails.delete(ip); f = undefined; } // 잠금이 풀리면 처음부터 다시 센다
  const given = String(req.body?.password || "");
  const a = Buffer.from(given);
  const b = Buffer.from(APP_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    if (pwFails.size > 5000) pwFails.clear();
    const n = (f?.n || 0) + 1;
    pwFails.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
    return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
  }
  pwFails.delete(ip);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE / 1000}` +
      (req.secure ? "; Secure" : "")
  );
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authed: validToken(readCookie(req, COOKIE)) });
});

function requireAuth(req, res, next) {
  if (validToken(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: "로그인이 필요합니다." });
}

/* 질문 탭에서 고를 수 있는 모델 목록 */
app.get("/api/models", requireAuth, (_req, res) => {
  res.json({ models: ASK_MODELS, default: NIM_ASK_MODEL, fast: NIM_MODEL });
});

/* ───────────────── 서재 (PDF 보관함) ─────────────────
   PDF 바이트는 data/pdfs/<id>.pdf 로, 표지 썸네일은 data/thumbs/<id>.jpg 로,
   폴더·파일 목록은 data/library.json 하나로 관리한다. */
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const LIB_FILE = path.join(DATA_DIR, "library.json");
fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

let lib = { folders: [], files: [] };
try {
  const j = JSON.parse(fs.readFileSync(LIB_FILE, "utf8"));
  lib = { folders: j.folders || [], files: j.files || [] };
} catch {}

function saveLib() {
  // 쓰다가 죽어도 목록 파일이 깨지지 않게 임시 파일에 쓰고 원자적으로 바꾼다
  const tmp = LIB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
  fs.renameSync(tmp, LIB_FILE);
}

app.get("/api/library", requireAuth, (_req, res) => res.json(lib));

/* 업로드 — 본문이 PDF 바이트 그대로 오고, 이름·폴더는 쿼리로 받는다 */
app.post(
  "/api/library/upload",
  requireAuth,
  express.raw({ type: () => true, limit: "300mb" }),
  (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 1024).includes("%PDF"))
      return res.status(400).json({ error: "PDF 파일이 아닙니다." });
    const name = String(req.query.name || "문서").slice(0, 200);
    const folder = lib.folders.some((f) => f.id === req.query.folder) ? String(req.query.folder) : "";
    // 같은 이름·같은 크기면 이미 있는 것으로 본다 — 같은 PDF 를 다시 열 때마다 늘어나지 않게
    const dup = lib.files.find((f) => f.name === name && f.size === buf.length);
    if (dup) return res.json({ ...dup, existing: true });
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(PDF_DIR, id + ".pdf"), buf);
    const entry = { id, name, folder, size: buf.length, at: Date.now() };
    lib.files.push(entry);
    saveLib();
    res.json(entry);
  }
);

/* 읽기(기본)와 다운로드(?dl) — 경로는 목록에 있는 id 로만 만들어져 밖으로 나갈 수 없다 */
app.get("/api/library/file/:id", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const fn = encodeURIComponent(f.name + ".pdf");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${"dl" in req.query ? "attachment" : "inline"}; filename*=UTF-8''${fn}`
  );
  res.sendFile(path.join(PDF_DIR, f.id + ".pdf"));
});

/* 폴더 이동·이름 변경 */
app.patch("/api/library/file/:id", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const { folder, name } = req.body || {};
  if (folder !== undefined)
    f.folder = folder && lib.folders.some((x) => x.id === folder) ? folder : "";
  if (typeof name === "string" && name.trim()) f.name = name.trim().slice(0, 200);
  saveLib();
  res.json(f);
});

app.delete("/api/library/file/:id", requireAuth, (req, res) => {
  const i = lib.files.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 파일입니다." });
  const [f] = lib.files.splice(i, 1);
  fs.rm(path.join(PDF_DIR, f.id + ".pdf"), { force: true }, () => {});
  fs.rm(path.join(THUMB_DIR, f.id + ".jpg"), { force: true }, () => {});
  saveLib();
  res.json({ ok: true });
});

/* 표지 썸네일 — 클라이언트가 1페이지를 작게 렌더해 올린다 */
app.post(
  "/api/library/thumb/:id",
  requireAuth,
  express.raw({ type: () => true, limit: "2mb" }),
  (req, res) => {
    const f = lib.files.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "없는 파일입니다." });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100)
      return res.status(400).json({ error: "이미지가 비었습니다." });
    fs.writeFileSync(path.join(THUMB_DIR, f.id + ".jpg"), req.body);
    f.thumb = true;
    saveLib();
    res.json({ ok: true });
  }
);

app.get("/api/library/thumb/:id", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f || !f.thumb) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(path.join(THUMB_DIR, f.id + ".jpg"));
});

app.post("/api/library/folder", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "폴더 이름이 비었습니다." });
  const folder = { id: crypto.randomUUID(), name };
  lib.folders.push(folder);
  saveLib();
  res.json(folder);
});

app.patch("/api/library/folder/:id", requireAuth, (req, res) => {
  const fo = lib.folders.find((x) => x.id === req.params.id);
  if (!fo) return res.status(404).json({ error: "없는 폴더입니다." });
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (name) fo.name = name;
  saveLib();
  res.json(fo);
});

app.delete("/api/library/folder/:id", requireAuth, (req, res) => {
  const i = lib.folders.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 폴더입니다." });
  lib.folders.splice(i, 1);
  for (const f of lib.files) if (f.folder === req.params.id) f.folder = ""; // 안의 파일은 최상위로
  saveLib();
  res.json({ ok: true });
});

/* ───────────────── 단어장 ─────────────────
   단어 풀이에서 ★ 로 모은 단어들. data/vocab.json 하나에 최신순으로 쌓인다. */
const VOCAB_FILE = path.join(DATA_DIR, "vocab.json");
let vocab = [];
try {
  vocab = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf8")).words || [];
} catch {}
function saveVocab() {
  const tmp = VOCAB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ words: vocab }, null, 2));
  fs.renameSync(tmp, VOCAB_FILE);
}

app.get("/api/vocab", requireAuth, (_req, res) => res.json({ words: vocab }));

app.post("/api/vocab", requireAuth, (req, res) => {
  const { word = "", mean = "", ctx = "", quote = "", doc = "" } = req.body || {};
  const w = String(word).trim().slice(0, 80);
  if (!w) return res.status(400).json({ error: "word 가 비었습니다." });
  // 같은 단어는 최신 내용으로 맨 앞에 다시 넣는다
  const i = vocab.findIndex((v) => v.word.toLowerCase() === w.toLowerCase());
  if (i >= 0) vocab.splice(i, 1);
  const entry = {
    id: crypto.randomUUID(),
    word: w,
    mean: String(mean).slice(0, 500),
    ctx: String(ctx).slice(0, 800),
    quote: String(quote).slice(0, 500),
    doc: String(doc).slice(0, 200),
    at: Date.now(),
  };
  vocab.unshift(entry);
  saveVocab();
  res.json(entry);
});

app.delete("/api/vocab/:id", requireAuth, (req, res) => {
  const i = vocab.findIndex((v) => v.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 항목입니다." });
  vocab.splice(i, 1);
  saveVocab();
  res.json({ ok: true });
});

/* ───────────────── 프로바이더 ───────────────── */
// 브라우저에는 항상 OpenAI 형식 SSE 만 내보낸다. Gemini 는 여기서 변환한다.
function sseChunk(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

async function callNIM({ system, user, image, history = [], maxTokens, signal, model }) {
  if (!NIM_KEY) throw new Error("NIM 키 없음");
  // 이미지가 있으면 content 를 배열로 보낸다 (OpenAI 표준 멀티모달 형식).
  const content = image
    ? [{ type: "text", text: user },
       { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }]
    : user;
  const res = await fetch(`${NIM_BASE}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIM_KEY}` },
    body: JSON.stringify({
      model: model || NIM_MODEL,
      messages: [
        { role: "system", content: system },
        ...history.map((t) => ({ role: t.role, content: t.text })),
        { role: "user", content },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: true,
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    throw new Error(`NIM(${model || NIM_MODEL}) ${res.status}${d ? ": " + d.slice(0, 200) : ""}`);
  }
  return res; // 이미 OpenAI 형식 SSE — 그대로 통과시킨다
}

async function callGemini({ system, user, image, history = [], maxTokens, signal }) {
  if (!GEMINI_KEY) throw new Error("Gemini 키 없음");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}` +
    `:streamGenerateContent?alt=sse`;
  const parts = [{ text: user }];
  if (image) parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      // Gemini 의 어시스턴트 역할 이름은 "model" 이다.
      contents: [
        ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
        { role: "user", parts },
      ],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}${d ? ": " + d.slice(0, 200) : ""}`);
  }
  return res;
}

// Gemini SSE → OpenAI SSE 로 바꿔서 클라이언트로 흘려보낸다
async function pipeGemini(upstream, res) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
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
      const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (t) res.write(sseChunk(t));
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

/* NIM 이 죽으면 3분간 Gemini 를 먼저 쓴다 (서킷 브레이커) */
let nimDownUntil = 0;

/* 질문 탭 세션의 이전 대화. 클라이언트가 이미 잘라서 보내지만,
   프롬프트가 폭주해 요금·지연이 튀지 않도록 서버에서 한 번 더 자른다.
   이미지는 전부 버린다 — 비전 체인을 타는 이미지는 현재 턴의 image 하나뿐이다.
   (이전 턴 이미지까지 실으면 텍스트 전용 모델이 받아 삼키지 못하고 400 을 낸다.) */
const HIST_TURNS = 16;      // 최근 몇 턴까지
const HIST_TURN_CHARS = 6000;   // 턴 하나의 상한
const HIST_TOTAL_CHARS = 48000; // 전체 상한
function trimHistory(h) {
  if (!Array.isArray(h)) return [];
  const out = [];
  for (const t of h.slice(-HIST_TURNS)) {
    const text = String(t?.text || "").slice(0, HIST_TURN_CHARS).trim();
    if (!text) continue;
    out.push({ role: t?.role === "assistant" ? "assistant" : "user", text });
  }
  let total = out.reduce((n, t) => n + t.text.length, 0);
  while (total > HIST_TOTAL_CHARS && out.length > 1) total -= out.shift().text.length;
  // 첫 턴은 반드시 user 여야 한다 (Gemini 는 model 로 시작하는 대화를 거부한다).
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const { system = "", user = "", image = "", maxTokens = 1000, forceGemini = false, ask = false, model = "" } = req.body || {};
  if (!user) return res.status(400).json({ error: "user 가 비었습니다." });
  const history = trimHistory(req.body?.history);

  const ac = new AbortController();
  // req 의 'close' 는 본문을 다 읽은 직후에도 발생하므로 쓰면 안 된다.
  // 실제 클라이언트 이탈은 응답이 끝나기 전에 res 가 닫히는 경우다.
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

  // 프로바이더가 응답하지 않을 때 탭이 영원히 멈추지 않도록 상한을 둔다.
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(90_000)]);
  const args = { system, user, image, history, maxTokens: Math.min(Number(maxTokens) || 1000, 4000), signal };

  // 질문 탭은 더 좋은 모델을 쓴다. 클라이언트가 보낸 모델은 허용 목록에 있을 때만 받는다.
  // 그 모델이 죽어 있어도 단어·문장 탭까지 Gemini 로 끌려가지 않도록,
  // 먼저 기본 NIM_MODEL 로 한 번 더 시도한 뒤에 폴백한다.
  // 영역 캡처(image)는 비전 모델 체인을 따로 탄다 — 텍스트 모델은 이미지를 못 받는다.
  // 이 체인에는 NIM_MODEL 이 없으므로, 비전 모델이 죽어도 서킷 브레이커가 돌지 않는다
  // (= 단어·문장 탭이 3분간 Gemini 로 끌려가는 일이 없다).
  const picked = ask ? (ASK_MODEL_IDS.has(model) ? model : NIM_ASK_MODEL) : NIM_MODEL;
  const chain = image
    ? VISION_CHAIN
    : picked === NIM_MODEL ? [NIM_MODEL] : [picked, NIM_MODEL];

  let upstream = null;
  let engine = "";
  let usedModel = "";
  const tryNIM = !forceGemini && NIM_KEY && Date.now() > nimDownUntil;

  if (tryNIM) {
    for (const m of chain) {
      try {
        upstream = await callNIM({ ...args, model: m });
        engine = "NIM";
        usedModel = m;
        break;
      } catch (e) {
        if (ac.signal.aborted) return;
        // 기본 모델까지 실패했을 때만 NIM 전체가 죽었다고 본다.
        if (m === NIM_MODEL) nimDownUntil = Date.now() + 3 * 60 * 1000;
        console.warn(`[여백] NIM(${m}) 실패:`, e.message);
      }
    }
  }
  if (!upstream) {
    try {
      upstream = await callGemini(args);
      engine = "Gemini";
      usedModel = GEMINI_MODEL;
    } catch (e) {
      if (ac.signal.aborted) return;
      console.error("[여백] 전부 실패:", e.message);
      return res.status(502).json({ error: e.message });
    }
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Engine", engine);
  res.setHeader("X-Model", usedModel);
  res.setHeader("Access-Control-Expose-Headers", "X-Engine, X-Model");
  res.setHeader("X-Accel-Buffering", "no"); // nginx 앞단 버퍼링 방지
  res.flushHeaders();

  try {
    if (engine === "Gemini") await pipeGemini(upstream, res);
    else {
      // 클라이언트가 스트리밍 도중 끊으면(단어를 연속으로 탭해 이전 요청을 abort 할 때 늘 일어난다)
      // 이 Readable 이 'error' 를 뿜는다. 핸들러가 없으면 프로세스 전체가 죽는다.
      // 비동기 스트림 에러라 위의 try/catch 로는 잡히지 않는다.
      const rs = Readable.fromWeb(upstream.body);
      rs.on("error", (e) => {
        if (!ac.signal.aborted) console.error("[여백] 업스트림 스트림 오류:", e.message);
        res.end();
      });
      res.on("error", () => rs.destroy());
      rs.pipe(res);
    }
  } catch (e) {
    if (!ac.signal.aborted) console.error("[여백] 스트림 중단:", e.message);
    res.end();
  }
});

/* ───────────────── 정적 파일 ───────────────── */
app.use(express.static(path.join(ROOT, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "dist", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[여백] http://0.0.0.0:${PORT}  엔진: ${NIM_KEY ? NIM_MODEL : "(NIM 없음)"} → ${GEMINI_KEY ? GEMINI_MODEL : "(Gemini 없음)"}`);
  console.log(`[여백] 질문 탭 기본 모델: ${NIM_ASK_MODEL}${ASK_MODEL_IDS.has(NIM_ASK_MODEL) ? "" : "  ← 허용 목록에 없음(ASK_MODELS 확인)"}`);
  console.log(`[여백] 영역 캡처 비전 모델: ${VISION_CHAIN.join(" → ")}`);
});
