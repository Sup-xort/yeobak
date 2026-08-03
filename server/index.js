import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFHexString, PDFNumber } from "pdf-lib";
import { mountRemote } from "./remote.js";

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
   note 에는 **모델의 성질만** 적는다: 답이 촘촘한지 간결한지, 표를 쓰는지 줄글인지,
   속생각을 흘리는지, 수식 표기에 버릇이 있는지. 이런 건 잘 안 변한다.
   반대로 "첫 글자 0.6초", "90초 동안 무응답" 같은 그날의 상태는 여기 적지 않는다 —
   NIM 은 529 Overloaded 를 수시로 내고 몇 분 뒤 저절로 풀려서, 한 번 재고 박아 두면
   멀쩡한 모델을 "쓰지 마라"고 못 박게 된다(Llama 3.3 이 실제로 그렇게 적혀 있었다).
   속도·가용성은 markHealth/probe 가 실시간으로 재서 드롭다운에 점으로 띄운다.
   빠르기는 순위(빠름/보통/느림)로만 남긴다 — 순위는 절대 초보다 훨씬 오래 간다.
   think: true 는 reasoning_content(속생각)를 실제로 흘리는 걸 스트리밍으로 확인한 모델이다 —
   클라이언트 드롭다운이 이 값으로 "추론 모델"/"일반 모델"을 가른다. */
const ASK_MODELS = [
  { id: "deepseek-ai/deepseek-v4-pro",           label: "DeepSeek V4 Pro",        think: false, note: "이 목록에서 가장 촘촘하다. 표와 수식으로 단계를 하나도 안 건너뛰고 펼친다. 그만큼 끝까지 오래 걸리고 답 길이 편차도 커서, 길게 읽을 각오가 섰을 때 고른다." },
  { id: "deepseek-ai/deepseek-v4-flash",         label: "DeepSeek V4 Flash",      think: true,  note: "균형이 가장 좋다. Pro보다 얕지만 표와 수식은 그대로 갖춰 쓰면서 훨씬 빨리 끝난다. 짧게 여러 번 되물으며 공부할 때 제일 낫다." },
  { id: "nvidia/nemotron-3-super-120b-a12b",     label: "Nemotron 3 Super 120B",  think: true,  note: "표를 가장 많이 쓴다 — 정리된 표로 받고 싶을 때. 설명량은 Pro급인데 더 빨리 끝난다. 대신 답이 시작되기 전 속생각이 한참 흐르니, 화면이 비어 있어도 멈춘 게 아니다." },
  { id: "minimaxai/minimax-m3",                  label: "MiniMax M3",             think: false, note: "이 목록에서 가장 느리다. 답이 시작되기까지 오래 걸려 서버의 90초 상한에 걸리는 일이 잦다 — 짧은 질문에만." },
  { id: "openai/gpt-oss-120b",                   label: "GPT-OSS 120B",           think: true,  note: "단어·문장 탭과 같은 모델이라 늘 데워져 있어 대체로 제일 빠르다. 다만 수식을 가끔 \\[ \\] 로 써서 화면에 날것으로 보일 수 있다 — 이 앱은 $…$ 를 그린다." },
  { id: "mistralai/mistral-medium-3.5-128b",     label: "Mistral Medium 3.5",     think: false, note: "표 없이 줄글로 차분하게 쓴다. 문장이 깔끔하고 다국어에 강해 번역 섞인 질문에 어울린다. 대신 정보량은 이 목록에서 적은 편." },
  { id: "meta/llama-3.3-70b-instruct",           label: "Llama 3.3 70B",          think: false, note: "단어·문장 탭이 쓰는 바로 그 모델. 짧고 담백하게 답하고 표는 거의 안 쓴다. 긴 설명이 필요한 질문에는 다른 모델이 낫다." },
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
app.use(express.json({ limit: "12mb" })); // 서재 검색용 본문 캐시(책 전체 텍스트)가 4mb 를 넘는 경우가 있어 올렸다

/* ───────────────── 세션 (단일 비밀번호) ───────────────── */
const COOKIE = "yb_sess";
/* 세션 수명 — "놀고 있던 시간" 기준이다. 30일짜리 쿠키를 기기에 남겨두지 않으려고 짧게 잡되,
   요청이 있을 때마다 갱신(sliding)하므로 계속 쓰는 동안에는 끊기지 않는다. 기기를 덮어두고
   이 시간이 지나야 로그아웃된다. SESSION_HOURS 로 조절할 수 있다. */
const SESSION_HOURS = Math.min(Math.max(Number(process.env.SESSION_HOURS) || 4, 0.5), 720);
const MAX_AGE = SESSION_HOURS * 60 * 60 * 1000;

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
  /* 지금 정책보다 더 긴 수명을 주장하는 토큰은 안 받는다. 이게 없으면 수명을 줄여도 이미
     기기에 나가 있는 옛 쿠키(30일짜리)가 만료일까지 그대로 살아 있어서, 정작 줄이려던
     쿠키만 안 줄어든다. 여유 1분은 발급 직후의 시계 오차용. */
  if (Number(exp) - Date.now() > MAX_AGE + 60 * 1000) return false;
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
  setSession(req, res);
  res.json({ ok: true });
});

function setSession(req, res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE / 1000}` +
      (req.secure ? "; Secure" : "")
  );
}

/* 남은 수명이 절반 밑으로 떨어졌을 때만 쿠키를 다시 내려준다 — 매 요청마다 Set-Cookie 를
   붙이면 헤더만 늘고 얻는 게 없다. 이 갱신이 "쓰는 동안에는 안 끊긴다"를 만든다. */
function slide(req, res, tok) {
  const exp = Number(String(tok).split(".")[0]);
  if (exp - Date.now() < MAX_AGE / 2) setSession(req, res);
}

app.get("/api/me", (req, res) => {
  if (tokenOK(req)) return res.json({ authed: true, via: "token", sessionHours: SESSION_HOURS });
  const tok = readCookie(req, COOKIE);
  const ok = validToken(tok);
  if (ok) slide(req, res, tok);
  res.json({ authed: ok, sessionHours: SESSION_HOURS });
});

/* ── 점검용 토큰 통로 ──────────────────────────────────────────────────────
   세션 쿠키 대신 `Authorization: Bearer <DEV_TOKEN>` 으로도 통과시킨다. 비밀번호를 쓰지
   않고 API 를 직접 두드려 볼 수 있고, 쿠키를 안 남기므로 기기에 흔적도 안 남는다.
   .env 에 DEV_TOKEN 이 없으면 이 통로는 아예 없다(기본 비활성).

   지금은 "이 서버 안에서 보낸 요청"만 받는다. 근거 두 가지:
   - nginx 는 프록시할 때 X-Forwarded-For 를 반드시 붙인다 → 밖에서 nginx 를 거쳐 온 요청은
     그 헤더 때문에 걸린다. 공격자가 nginx 더러 헤더를 빼게 만들 수는 없다.
   - 8787 이 0.0.0.0 에 열려 있어 nginx 를 건너뛴 직접 접속도 가능한데, 그건 TCP 상대 주소가
     루프백이 아니라서 걸린다(이 주소는 헤더와 달리 위조가 안 된다).

   나중에 공개 API 로 열 때는 fromThisMachine 조건만 풀고, 그 자리에 토큰별 권한과 쿼터를
   붙이면 된다 — 인증 지점은 여기 하나로 이미 모여 있다. */
const DEV_TOKEN = process.env.DEV_TOKEN || "";
if (DEV_TOKEN && DEV_TOKEN.length < 24)
  console.warn("[여백] DEV_TOKEN 이 너무 짧습니다 — 24자 이상 무작위 문자열을 쓰세요.");

function fromThisMachine(req) {
  if (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false;
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function tokenOK(req) {
  if (!DEV_TOKEN || !fromThisMachine(req)) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(DEV_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (tokenOK(req)) return next(); // 쿠키를 새로 내려주지 않는다 — 흔적을 안 남기는 게 목적이다
  const tok = readCookie(req, COOKIE);
  if (validToken(tok)) { slide(req, res, tok); return next(); }
  res.status(401).json({ error: "로그인이 필요합니다." });
}

/* ── 모델 상태 ──
   note 에 "첫 글자 0.6초" 같은 그날의 수치를 박아 두면 금세 거짓말이 된다. NIM 은 529
   Overloaded 를 수시로 내고 몇 분 뒤 저절로 풀리기 때문이다(실제로 한 번 재 보고 "무응답"
   이라고 적어 둔 모델이 멀쩡했다). 그래서 성질은 note 에 글로 두고, 상태는 여기서 잰다.

   두 갈래로 채운다:
   - 실사용: /api/chat 이 성공하거나 실패할 때마다 markHealth() 가 공짜로 적는다.
   - 프로브: 안 쓰는 모델은 실사용 기록이 안 쌓이므로, 드롭다운을 열 때 max_tokens 1 짜리
     최소 요청을 병렬로 던진다. 스트리밍 핫패스와 무관한 별도 호출이라 안전하다. */
const health = new Map(); // id → { ok, status, at, ms }
const HEALTH_TTL = 60 * 1000; // 이보다 최근 기록이 있으면 다시 찌르지 않는다
const probing = new Set();    // 지금 찌르고 있는 모델 — 겹쳐 부르지 않는다
const markHealth = (id, ok, status = 0, ms = 0) =>
  health.set(id, { ok, status, at: Date.now(), ms });

async function probe(id) {
  if (probing.has(id)) return;
  probing.add(id);
  const t0 = Date.now();
  try {
    const r = await fetch(`${NIM_BASE}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${NIM_KEY}` },
      body: JSON.stringify({ model: id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    });
    markHealth(id, r.ok, r.status, Date.now() - t0);
  } catch (e) {
    /* 8초 안에 대답이 없는 것과 아예 못 붙는 것은 다르다. 콜드스타트는 50초도 걸리는데,
       그걸 "응답 없음"이라고 적으면 실제로는 answer 가 오는 모델을 죽었다고 못 박게 된다
       (note 에서 걷어낸 그 잘못을 배지에서 되풀이하는 셈). -1 은 "느리다"까지만 말한다.
       덤으로 이 프로브가 콜드스타트를 깨워 두기도 한다. */
    markHealth(id, false, e.name === "TimeoutError" ? -1 : 0, Date.now() - t0);
  } finally {
    probing.delete(id);
  }
}

/* 오래된 기록만 뒤에서 다시 잰다. **await 하지 않는 게 요점이다** — 값을 읽는 쪽은
   측정이 끝나기를 기다리지 않고 늘 저장값을 즉시 받는다. 새로 잰 값은 그다음 읽을 때
   보인다. 아무도 앱을 안 쓰면 재지도 않으므로 놀고 있는 서버가 API 를 계속 두드리지도
   않는다(고정 주기로 도는 타이머를 안 두는 이유). */
function refreshStale() {
  if (!NIM_KEY) return;
  for (const m of ASK_MODELS)
    if (Date.now() - (health.get(m.id)?.at || 0) > HEALTH_TTL) probe(m.id);
}

/* 질문 탭에서 고를 수 있는 모델 목록 + 저장된 상태값.
   이 라우트는 **읽기 전용이다.** 측정을 기다리는 일이 절대 없다. */
app.get("/api/models", requireAuth, (_req, res) => {
  res.json({
    models: ASK_MODELS,
    default: NIM_ASK_MODEL,
    fast: NIM_MODEL,
    health: Object.fromEntries(health),
  });
  refreshStale(); // 응답을 보낸 뒤에 시작한다 — 이 줄이 응답을 늦출 여지조차 없게
});

/* ───────────────── 서재 (PDF 보관함) ─────────────────
   PDF 바이트는 data/pdfs/<id>.pdf 로, 표지 썸네일은 data/thumbs/<id>.jpg 로,
   폴더·파일 목록은 data/library.json 하나로 관리한다. */
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const TEXT_DIR = path.join(DATA_DIR, "text"); // 서재 검색용 페이지별 본문 캐시, data/text/<id>.json
const LIB_FILE = path.join(DATA_DIR, "library.json");
fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(TEXT_DIR, { recursive: true });

mountRemote(app, { requireAuth, DATA_DIR });

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

/* 서재 검색 — 제목 부분일치 + (열어서 인덱싱된 문서에 한해) 본문 부분일치.
   진짜 검색엔진이 아니라 단순 substring 매칭이다: 개인 서재 규모(수십~수백 권)에서는
   충분하고, 형태소 분석 없이도 한글 부분일치는 잘 맞는다.
   본문 매칭은 페이지당 첫 등장 위치 하나만, 문서당 최대 3쪽까지만 잡는다 — 검색 결과에
   "어디 있는지" 감만 주면 되지 전체 occurrence 를 셀 필요는 없다. */
function snippetAt(text, idx, qLen) {
  const CTX = 40;
  const start = Math.max(0, idx - CTX);
  const end = Math.min(text.length, idx + qLen + CTX);
  let s = text.slice(start, end);
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}
function searchDocText(id, qLower, maxMatches = 3) {
  let pages;
  try {
    pages = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, id + ".json"), "utf8"));
  } catch {
    return []; // 아직 한 번도 안 열어서 인덱스가 없다 — 제목 매칭만으로 걸릴 수 있다
  }
  if (!Array.isArray(pages)) return [];
  const out = [];
  for (let i = 0; i < pages.length && out.length < maxMatches; i++) {
    const t = pages[i] || "";
    const idx = t.toLowerCase().indexOf(qLower);
    if (idx >= 0) out.push({ page: i + 1, snippet: snippetAt(t, idx, qLower.length) });
  }
  return out;
}
app.get("/api/library/search", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  if (!q) return res.json({ query: "", results: [] });
  const qLower = q.toLowerCase();
  const results = [];
  for (const f of lib.files) {
    const titleMatch = f.name.toLowerCase().includes(qLower);
    const matches = searchDocText(f.id, qLower);
    if (!titleMatch && !matches.length) continue;
    results.push({ ...f, titleMatch, matches });
  }
  results.sort((a, b) => {
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return (b.at || 0) - (a.at || 0);
  });
  res.json({ query: q, results: results.slice(0, 40) });
});

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
    // lastOpenedAt 을 업로드 시각으로 미리 채워 둔다 — 방금 추가한 책이 서재 인사말에서
    // "오랜만이네요"로 뜨는 걸 막는다(추가 = 사실상 방금 연 것과 같다).
    const entry = { id, name, folder, size: buf.length, at: Date.now(), lastOpenedAt: Date.now() };
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

/* 폴더 이동·이름 변경·마지막으로 읽은 쪽 저장.
   lastPage 는 읽는 동안 쪽이 바뀔 때마다(디바운스해서) 클라이언트가 조용히 보낸다 —
   다음에 이 파일을 열면 그 쪽부터 시작한다. */
app.patch("/api/library/file/:id", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const { folder, name, lastPage, opened } = req.body || {};
  if (folder !== undefined)
    f.folder = folder && lib.folders.some((x) => x.id === folder) ? folder : "";
  if (typeof name === "string" && name.trim()) f.name = name.trim().slice(0, 200);
  if (Number.isFinite(lastPage) && lastPage > 0) f.lastPage = Math.floor(lastPage);
  // opened:true — 서재에서 이 문서를 열 때마다 찍는다. lastPage 저장은 스크롤 디바운스라
  // 첫 몇 초 안에 문서를 닫으면 안 찍힐 수 있어서, "정말 열었다"는 별도 신호를 둔다.
  // 서재 인사말이 "이어읽기"/"오랜만" 을 가르는 기준이 이 값이다.
  if (opened === true) f.lastOpenedAt = Date.now();
  saveLib();
  res.json(f);
});

/* 이름 정리(서재 헤더의 이름표 버튼)가 쓰는 앞쪽 본문 — 검색 인덱스에 이미 있으면 그걸 준다.
   한 번도 안 연 문서는 인덱스가 없어 404 가 나가고, 클라이언트가 그때만 PDF 를 받아
   pdf.js 로 직접 뽑는다(서버엔 pdfjs-dist 가 없다 — 아래 주석 참고). */
app.get("/api/library/file/:id/text", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  let pages;
  try {
    pages = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, f.id + ".json"), "utf8"));
  } catch {
    return res.status(404).json({ error: "본문 인덱스가 없습니다." });
  }
  const n = Math.max(1, Math.min(5, Number(req.query.pages) || 1));
  res.json({ pages: (Array.isArray(pages) ? pages : []).slice(0, n) });
});

/* 서재 검색 인덱스 갱신 — 클라이언트가 문서를 열어 pdf.js 로 본문을 다 뽑으면
   (App.jsx extractAll) 페이지별 텍스트 배열을 여기로 올린다. 서버는 pdf-lib 만 있고
   pdfjs-dist 는 없어서 서버 자체 추출은 하지 않는다 — 열어본 문서만 검색되는 대신
   훨씬 가볍다. totalPages 도 같이 실어 보내 "마지막 O쪽 · 총 N쪽" 표기에 쓴다. */
app.post("/api/library/file/:id/text", requireAuth, (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const pages = Array.isArray(req.body?.pages) ? req.body.pages : null;
  if (!pages || !pages.length) return res.status(400).json({ error: "pages 가 비었습니다." });
  const clean = pages.map((t) => (typeof t === "string" ? t.slice(0, 20000) : ""));
  const tmp = path.join(TEXT_DIR, f.id + ".json.tmp");
  const dst = path.join(TEXT_DIR, f.id + ".json");
  fs.writeFileSync(tmp, JSON.stringify(clean));
  fs.renameSync(tmp, dst);
  const total = Number(req.body?.totalPages);
  if (Number.isFinite(total) && total > 0 && f.totalPages !== Math.floor(total)) {
    f.totalPages = Math.floor(total);
    saveLib();
  }
  res.json({ ok: true, pages: clean.length });
});

/* ── 목차 자동 생성 결과를 PDF 파일 자체에 북마크(/Outlines)로 박아 넣는다 ──
   pdf-lib 는 북마크를 만드는 고수준 API가 없어서 PDFContext 로 직접 트리를 만든다.
   Title 은 반드시 PDFHexString.fromText() 로 써야 한다 — 기본 PDFString 은
   PDFDocEncoding(라틴 계열)이라 한글이 깨진다(실제로 재현·확인했다). depth 로 부모를 찾는
   스택 방식 트리 구성 → 모든 노드에 ref 를 먼저 할당 → Prev/Next/Parent/First/Last/Count 를
   채우는 순서. pdfjs-dist 3.11.174(이 앱이 쓰는 버전)의 getOutline() 으로 왕복 검증했다. */
function buildOutlinePdf(pdfBytes, items) {
  return (async () => {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const ctx = pdfDoc.context;

    const roots = [];
    const parentStack = [{ children: roots, depth: -1 }];
    for (const it of items) {
      const depth = Math.max(0, Math.min(5, Math.floor(it.depth) || 0));
      while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= depth) parentStack.pop();
      const node = { title: it.title, page: it.page, children: [] };
      parentStack[parentStack.length - 1].children.push(node);
      parentStack.push({ children: node.children, depth });
    }

    const allocRefs = (nodes) => { for (const n of nodes) { n.ref = ctx.nextRef(); allocRefs(n.children); } };
    const outlinesRef = ctx.nextRef();
    allocRefs(roots);

    const countAll = (nodes) => nodes.reduce((s, n) => s + 1 + countAll(n.children), 0);
    const buildLevel = (nodes, parentRef) => {
      nodes.forEach((n, i) => {
        const pageIndex = Math.min(pages.length - 1, Math.max(0, n.page - 1));
        const dest = ctx.obj([pages[pageIndex].ref, PDFName.of("Fit")]);
        const dict = { Title: PDFHexString.fromText(n.title), Parent: parentRef, Dest: dest };
        if (i > 0) dict.Prev = nodes[i - 1].ref;
        if (i < nodes.length - 1) dict.Next = nodes[i + 1].ref;
        if (n.children.length) {
          dict.First = n.children[0].ref;
          dict.Last = n.children[n.children.length - 1].ref;
          dict.Count = PDFNumber.of(countAll(n.children));
          buildLevel(n.children, n.ref);
        }
        ctx.assign(n.ref, ctx.obj(dict));
      });
    };
    buildLevel(roots, outlinesRef);

    const outlinesDict = { Type: PDFName.of("Outlines"), Count: PDFNumber.of(countAll(roots)) };
    if (roots.length) { outlinesDict.First = roots[0].ref; outlinesDict.Last = roots[roots.length - 1].ref; }
    ctx.assign(outlinesRef, ctx.obj(outlinesDict));
    pdfDoc.catalog.set(PDFName.of("Outlines"), outlinesRef);

    return pdfDoc.save();
  })();
}

app.post("/api/library/file/:id/outline", requireAuth, async (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || !items.length) return res.status(400).json({ error: "items 가 비었습니다." });
  const clean = items
    .filter((it) => it && typeof it.title === "string" && it.title.trim() && Number.isFinite(it.page))
    .slice(0, 300)
    .map((it) => ({ title: it.title.trim().slice(0, 200), page: Math.max(1, Math.floor(it.page)), depth: it.depth }));
  if (!clean.length) return res.status(400).json({ error: "유효한 항목이 없습니다." });

  const filePath = path.join(PDF_DIR, f.id + ".pdf");
  try {
    const bytes = await fs.promises.readFile(filePath);
    const out = await buildOutlinePdf(bytes, clean);
    const tmp = filePath + ".tmp";
    await fs.promises.writeFile(tmp, out);
    await fs.promises.rename(tmp, filePath);
    res.json({ ok: true, count: clean.length });
  } catch (e) {
    console.error("[여백] 목차 생성 실패", e);
    res.status(500).json({ error: "목차를 PDF에 반영하지 못했습니다: " + e.message });
  }
});

app.delete("/api/library/file/:id", requireAuth, (req, res) => {
  const i = lib.files.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 파일입니다." });
  const [f] = lib.files.splice(i, 1);
  fs.rm(path.join(PDF_DIR, f.id + ".pdf"), { force: true }, () => {});
  fs.rm(path.join(THUMB_DIR, f.id + ".jpg"), { force: true }, () => {});
  fs.rm(path.join(TEXT_DIR, f.id + ".json"), { force: true }, () => {});
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
    // 표지를 만드는 김에 1쪽 원본 비율도 같이 받는다 — 서재 그리드의 "매트" 처리(칸은
    // 고정, 안의 종이는 원본 비율대로)에 쓴다. 클라이언트가 이미 재고 있는 값이라 별도
    // 왕복 없이 쿼리로 얹는다.
    const w = Number(req.query.w), h = Number(req.query.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) f.ratio = w / h;
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

/* 사이드바 폴더 순서 — 드래그로 바꾼 순서를 그대로 배열 순서로 저장한다.
   목록에 없는 id(동시에 다른 곳에서 삭제/추가된 폴더)는 무시하고, ids 에 안 실린
   기존 폴더는 뒤에 원래 순서 그대로 붙인다 — 클라이언트가 살짝 stale 해도 폴더가 사라지지 않는다. */
app.patch("/api/library/folders/reorder", requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: "ids 가 비었습니다." });
  const byId = new Map(lib.folders.map((f) => [f.id, f]));
  const ordered = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const seen = new Set(ordered.map((f) => f.id));
  for (const f of lib.folders) if (!seen.has(f.id)) ordered.push(f);
  lib.folders = ordered;
  saveLib();
  res.json({ folders: lib.folders });
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

/* ───────────────── 해석 이력 (기록 탭) ─────────────────
   드래그 선택으로 해석한 문장/구간. data/interps.json 에 최신순으로 쌓인다.
   단어장(vocab)과 똑같은 구조 — 예전엔 클라이언트 useRef 에만 있어서 새로고침하면 날아갔다. */
const INTERP_FILE = path.join(DATA_DIR, "interps.json");
const INTERP_MAX = 300; // 무한정 쌓이지 않게 오래된 것부터 버린다
let interps = [];
try {
  interps = JSON.parse(fs.readFileSync(INTERP_FILE, "utf8")).items || [];
} catch {}
function saveInterps() {
  const tmp = INTERP_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ items: interps }, null, 2));
  fs.renameSync(tmp, INTERP_FILE);
}

app.get("/api/interps", requireAuth, (_req, res) => res.json({ items: interps }));

app.post("/api/interps", requireAuth, (req, res) => {
  const { quote = "", trans = "", doc = "", page = 0 } = req.body || {};
  const q = String(quote).trim().slice(0, 800);
  if (!q) return res.status(400).json({ error: "quote 가 비었습니다." });
  const entry = {
    id: crypto.randomUUID(),
    quote: q,
    trans: String(trans).slice(0, 4000),
    doc: String(doc).slice(0, 200),
    page: Number(page) || 0,
    at: Date.now(),
  };
  interps.unshift(entry);
  if (interps.length > INTERP_MAX) interps.length = INTERP_MAX;
  saveInterps();
  res.json(entry);
});

app.delete("/api/interps/:id", requireAuth, (req, res) => {
  const i = interps.findIndex((v) => v.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 항목입니다." });
  interps.splice(i, 1);
  saveInterps();
  res.json({ ok: true });
});

/* ───────────────── 단어 찾아본 기록 (기록 탭) ─────────────────
   ★ 로 담은 것(vocab)과 별개다 — 이건 그냥 그 문서에서 탭해 본 모든 단어.
   같은 문서에서 같은 단어를 다시 찾으면(대소문자 무시) 새로 안 쌓고 맨 앞으로만 옮긴다 —
   문서가 다르면 같은 단어라도 별개 항목이다("이 파일에서" 찾아본 것이 기준이라). */
const LOOKUP_FILE = path.join(DATA_DIR, "lookups.json");
const LOOKUP_MAX = 1000;
let lookups = [];
try {
  lookups = JSON.parse(fs.readFileSync(LOOKUP_FILE, "utf8")).items || [];
} catch {}
function saveLookups() {
  const tmp = LOOKUP_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ items: lookups }, null, 2));
  fs.renameSync(tmp, LOOKUP_FILE);
}

app.get("/api/lookups", requireAuth, (_req, res) => res.json({ items: lookups }));

app.post("/api/lookups", requireAuth, (req, res) => {
  const { word = "", mean = "", ctx = "", quote = "", doc = "" } = req.body || {};
  const w = String(word).trim().slice(0, 80);
  if (!w) return res.status(400).json({ error: "word 가 비었습니다." });
  const d = String(doc).slice(0, 200);
  const i = lookups.findIndex((v) => v.word.toLowerCase() === w.toLowerCase() && v.doc === d);
  if (i >= 0) lookups.splice(i, 1);
  const entry = {
    id: crypto.randomUUID(),
    word: w,
    mean: String(mean).slice(0, 500),
    ctx: String(ctx).slice(0, 800),
    quote: String(quote).slice(0, 500),
    doc: d,
    at: Date.now(),
  };
  lookups.unshift(entry);
  if (lookups.length > LOOKUP_MAX) lookups.length = LOOKUP_MAX;
  saveLookups();
  res.json(entry);
});

app.delete("/api/lookups/:id", requireAuth, (req, res) => {
  const i = lookups.findIndex((v) => v.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 항목입니다." });
  lookups.splice(i, 1);
  saveLookups();
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
    const e = new Error(`NIM(${model || NIM_MODEL}) ${res.status}${d ? ": " + d.slice(0, 200) : ""}`);
    e.status = res.status; // 붐빔(429/5xx)인지 판별해 재시도할 수 있게 남긴다
    throw e;
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
/* 턴 하나의 상한 — 답변 예산이 8000 토큰으로 올라가면서 6000자로는 지난 답이 문장 중간에서
   잘려 히스토리에 들어갔다. 잘린 답은 없느니만 못해서(모델이 그 뒤를 지어낸다) 넉넉히 잡는다. */
const HIST_TURN_CHARS = 16000;
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
  // 단어·문장 탭은 탭-즉시반응이 생명이라 90초로 빡빡하게 잡지만, 질문 탭은 이미
  // 스트리밍으로 "살아 있다"는 걸 보여주고 있어 더 기다릴 여유가 있다 — Nemotron 3 Super
  // 120B·MiniMax M3 처럼 첫 글자 전 속생각이 긴 모델이 이 90초 상한에 자주 걸려
  // "응답 없음"으로 잘못 죽어 보이던 것을 고친다.
  const timeoutMs = ask ? 180_000 : 90_000;
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]);
  // 상한 8000 — 추론 모델은 max_tokens 안에서 속생각(reasoning)까지 함께 쓰기 때문에,
  // 이름 정리처럼 긴 구조화 출력이 필요한 호출은 4000 으로는 답이 통째로 잘린다.
  const args = { system, user, image, history, maxTokens: Math.min(Number(maxTokens) || 1000, 8000), signal };

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
    outer:
    for (const m of chain) {
      /* 고른 모델은 붐벼서(429/5xx, 특히 529 Overloaded) 실패하면 잠깐 쉬었다 다시 부른다.
         한 번 만에 폴백으로 넘어가던 탓에, 붐비는 시간대에는 드롭다운에서 무엇을 고르든
         답은 늘 NIM_MODEL(gpt-oss-120b)이 하고 있었다. 붐빔은 대개 몇 백 ms 뒤에 풀린다. */
      const tries = m === picked ? 3 : 1;
      for (let i = 0; i < tries; i++) {
        const t0 = Date.now();
        try {
          upstream = await callNIM({ ...args, model: m });
          engine = "NIM";
          usedModel = m;
          markHealth(m, true, 200, Date.now() - t0);
          break outer;
        } catch (e) {
          // 클라이언트가 떠났을 때만 조용히 끝낸다 — 응답을 기다리는 상대가 없다.
          // 90초 상한(signal)은 여기 넣으면 안 된다. 그건 클라이언트가 아직 기다리는 중이라
          // 아무것도 안 보내고 return 하면 탭이 영영 멈춘다.
          if (ac.signal.aborted) return;
          // 실사용에서 공짜로 얻는 상태 신호 — 드롭다운의 "지금 붐빔"이 이걸로 산다.
          markHealth(m, false, e.status || 0, Date.now() - t0);
          // 상한이 이미 터졌으면 더 시도해도 즉시 실패한다 — 아래 오류 응답으로 내려간다.
          if (signal.aborted) break outer;
          // 상태 코드가 붙은 실패만 재시도한다 — 타임아웃·네트워크 끊김은 다시 걸어도 같다.
          if (i + 1 < tries && e.status >= 429) {
            console.warn(`[여백] NIM(${m}) ${e.status} — ${i + 1}번째, 잠시 뒤 재시도`);
            await new Promise((r) => setTimeout(r, 500 * (i + 1)));
            continue;
          }
          // 기본 모델까지 실패했을 때만 NIM 전체가 죽었다고 본다.
          if (m === NIM_MODEL) nimDownUntil = Date.now() + 3 * 60 * 1000;
          console.warn(`[여백] NIM(${m}) 실패:`, e.message);
        }
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
  // 고른 모델이 답하지 못해 다른 모델이 대신 답할 때, 원래 고른 쪽을 알려 준다.
  // 이걸 안 알려 주면 "드롭다운을 바꿔도 늘 같은 모델이 답한다"로만 보인다.
  if (ask && usedModel && usedModel !== picked) res.setHeader("X-Wanted", picked);
  res.setHeader("Access-Control-Expose-Headers", "X-Engine, X-Model, X-Wanted");
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
  // 켜자마자 한 번 재 둔다 — 첫 사용자가 빈 값을 안 보게. 여기서도 await 하지 않는다.
  refreshStale();
});
