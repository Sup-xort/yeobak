import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { PDFDocument, PDFName, PDFHexString, PDFNumber } from "pdf-lib";
import { mountRemote } from "./remote.js";
import { importAnnots, exportWithAnnots } from "./annots.js";
import { createModels } from "./models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PORT = Number(process.env.PORT || 8787);
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const NIM_KEY = process.env.NIM_API_KEY || "";
const NIM_BASE = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
// 대화 모델 순위에 같이 끼는 OpenAI 호환 프로바이더(2026-10-09~) — 없어도 된다
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";

/* 모델 목록·상태·자동 선택은 server/models.js — 목록은 서버가 스스로 찾는다(그 파일 머리말).
   TAP_MODEL / ASK_MODEL 로 기본값을 고정할 수 있다(비우면 "자동" — 점수로 고른다). */

/* 첫 글자(또는 속생각)까지 기다리는 상한. 넘기면 그 모델을 버리고 다음으로 넘어간다 —
   아직 화면에 한 글자도 안 나갔으니 사용자는 바뀐 걸 모른다. 헤더는 왔는데 글자가 안 오는
   모델(2026-09 NIM 에서 흔했다)이 전체 상한을 혼자 다 쓰던 걸 막는다. */
const FIRST_MS = { tap: 15_000, ask: 45_000 };
/* 이미 쓰기 시작한 뒤 이만큼 아무것도 안 오면 멈춘 것으로 보고 끝낸다(끊겼다는 안내를 붙여서). */
const STALL_MS = 45_000;

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

/* 모델 목록 + 점수 + 지금 자동이 고르는 모델. 읽기 전용이라 즉시 돌아온다 —
   오래된 점수는 응답을 보낸 뒤에 뒤에서 다시 잰다(models.touch). */
app.get("/api/models", requireAuth, (_req, res) => {
  const p = models.publicList();
  res.json({
    ...p,
    // 클라이언트의 "자동 — 지금 ○○" 표시용. 고정값(.env)이 있으면 그것.
    default: PIN_ASK && models.pickable(PIN_ASK) ? PIN_ASK : p.auto.ask,
    tapDefault: PIN_TAP && models.pickable(PIN_TAP) ? PIN_TAP : p.auto.tap,
  });
  models.touch(6);
});

/* 목록 다시 찾기 — 몇 분 걸리므로 기다리지 않고 바로 돌려준다 */
app.post("/api/models/refresh", requireAuth, (_req, res) => {
  if (!models.isDiscovering()) models.discover({ force: true }).catch((e) => console.warn("[모델] 찾기 실패:", e.message));
  res.status(202).json({ ok: true, discovering: true });
});

/* ───────────────── 서재 (PDF 보관함) ─────────────────
   PDF 바이트는 data/pdfs/<id>.pdf 로, 표지 썸네일은 data/thumbs/<id>.jpg 로,
   폴더·파일 목록은 data/library.json 하나로 관리한다. */
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const TEXT_DIR = path.join(DATA_DIR, "text"); // 서재 검색용 페이지별 본문 캐시, data/text/<id>.json
const ANNOT_DIR = path.join(DATA_DIR, "annots"); // 필기, data/annots/<id>.json — 형식은 src/ink.js 머리말
const LIB_FILE = path.join(DATA_DIR, "library.json");
fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(ANNOT_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(TEXT_DIR, { recursive: true });

const models = createModels({ DATA_DIR, GEMINI_KEY, NIM_KEY, NIM_BASE, GROQ_KEY, OPENROUTER_KEY });
const PIN_TAP = process.env.TAP_MODEL || "";
const PIN_ASK = process.env.ASK_MODEL || "";

mountRemote(app, { requireAuth, DATA_DIR });

let lib = { folders: [], files: [] };
try {
  const j = JSON.parse(fs.readFileSync(LIB_FILE, "utf8"));
  lib = { folders: j.folders || [], files: j.files || [] };
} catch {}

// indexed 가 생기기 전(2026-10-09)에 본문을 올린 책 — 이미 있는 인덱스 파일로 채운다
{
  let n = 0;
  for (const f of lib.files) {
    if (f.indexed !== undefined) continue;
    try {
      const pages = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, f.id + ".json"), "utf8"));
      if (Array.isArray(pages)) { f.indexed = pages.length; n++; }
    } catch {}
  }
  if (n) process.nextTick(() => saveLib());
}

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
/* 검색마다 text/*.json 을 전부 동기로 읽고 파싱했더니, 서버가 swap 에서 막 깨어난 때는 한 번에 1초 넘게
   이벤트 루프를 막았다(2026-10-09 실측). 쪽 본문과 소문자판을 메모리에 둔다 — 서재 전체가 몇 MB 다.
   올리기·지우기 때 그 문서만 버린다. */
const textCache = new Map(); // id → { pages, lower } | null(인덱스 없음)
function docText(id) {
  if (textCache.has(id)) return textCache.get(id);
  let v = null;
  try {
    const pages = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, id + ".json"), "utf8"));
    if (Array.isArray(pages)) v = { pages, lower: pages.map((t) => String(t || "").toLowerCase()) };
  } catch {} // 아직 한 번도 안 열어서 인덱스가 없다 — 제목 매칭만으로 걸릴 수 있다
  textCache.set(id, v);
  return v;
}
function searchDocText(id, qLower, maxMatches = 3) {
  const d = docText(id);
  if (!d) return [];
  const { pages, lower } = d;
  const out = [];
  for (let i = 0; i < pages.length && out.length < maxMatches; i++) {
    const t = pages[i] || "";
    const idx = lower[i].indexOf(qLower);
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

/* 서재에 PDF 하나를 넣는다 — 앱 업로드와 단축어 받은편지함이 같이 쓴다.
   PDF 가 아니면 null. 같은 이름·같은 크기면 이미 있는 것으로 보고 그 항목을 돌려준다
   (같은 PDF 를 다시 열 때마다, 단축어를 두 번 눌러도 늘어나지 않게). */
const isPdf = (buf) => Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 1024).includes("%PDF");
/* src: 바이트(Buffer) 또는 이미 디스크에 받아 둔 임시 파일 { tmp, size }. 임시 파일은 여기서 옮기거나 지운다. */
function addPdf(src, name, folder) {
  const size = Buffer.isBuffer(src) ? src.length : src.size;
  const dup = lib.files.find((f) => f.name === name && f.size === size);
  if (dup) {
    if (!Buffer.isBuffer(src)) fs.rm(src.tmp, { force: true }, () => {});
    return { ...dup, existing: true };
  }
  const id = crypto.randomUUID();
  const dst = path.join(PDF_DIR, id + ".pdf");
  if (Buffer.isBuffer(src)) fs.writeFileSync(dst, src);
  else fs.renameSync(src.tmp, dst);
  // lastOpenedAt 을 업로드 시각으로 미리 채워 둔다 — 방금 추가한 책이 서재 인사말에서
  // "오랜만이네요"로 뜨는 걸 막는다(추가 = 사실상 방금 연 것과 같다).
  const entry = { id, name, folder, size, at: Date.now(), lastOpenedAt: Date.now() };
  lib.files.push(entry);
  saveLib();
  return entry;
}

/* 본문을 메모리에 모으지 않고 곧장 임시 파일로 흘린다. 예전엔 express.raw 로 통째로 받았는데,
   300MB 상한이면 버퍼 + 이어 붙인 사본으로 RAM 954MB 서버가 swap 으로 밀리거나 OOM 이 난다
   (서재에 이미 136MB 짜리 책이 있다). 상한(nginx client_max_body_size 300m 와 같은 값)을 넘으면 413. */
const UPLOAD_MAX = 300 * 1024 * 1024;
async function receiveToTmp(req) {
  const tmp = path.join(PDF_DIR, `.up-${crypto.randomUUID()}.tmp`);
  let size = 0;
  try {
    await pipeline(req, async function* (src) {
      for await (const c of src) {
        size += c.length;
        if (size > UPLOAD_MAX) throw Object.assign(new Error("너무 큰 파일입니다."), { status: 413 });
        yield c;
      }
    }, fs.createWriteStream(tmp));
    const fd = await fs.promises.open(tmp, "r");
    const head = Buffer.alloc(1024);
    const { bytesRead } = await fd.read(head, 0, 1024, 0).finally(() => fd.close());
    return { tmp, size, head: head.subarray(0, bytesRead) };
  } catch (e) {
    fs.rm(tmp, { force: true }, () => {});
    throw e;
  }
}
// 받다가 죽은 임시 파일 정리
for (const n of fs.readdirSync(PDF_DIR)) if (n.startsWith(".up-")) fs.rmSync(path.join(PDF_DIR, n), { force: true });

/* 업로드 — 본문이 PDF 바이트 그대로 오고, 이름·폴더는 쿼리로 받는다 */
app.post("/api/library/upload", requireAuth, async (req, res) => {
  let got;
  try {
    got = await receiveToTmp(req);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.status === 413 ? "파일이 너무 큽니다." : "받는 중에 끊겼습니다." });
  }
  if (!isPdf(got.head)) {
    fs.rm(got.tmp, { force: true }, () => {});
    return res.status(400).json({ error: "PDF 파일이 아닙니다." });
  }
  const name = String(req.query.name || "문서").slice(0, 200);
  const folder = lib.folders.some((f) => f.id === req.query.folder) ? String(req.query.folder) : "";
  res.json(addPdf(got, name, folder));
});

/* ── 받은편지함: 단축어·공유 시트로 PDF 넣기 ────────────────────────────────
   아이패드 단축어의 "URL 내용 가져오기", 갤럭시의 HTTP Shortcuts 앱처럼 **쿠키가 없는**
   호출자를 위한 통로. 세션 대신 INBOX_TOKEN 을 받고, 이 토큰으로 할 수 있는 건 "서재에
   PDF 넣기" 하나뿐이다 — 읽기·지우기는 못 한다. 그래서 기기의 단축어에 박아 둬도 새어
   나갔을 때 피해가 스팸 PDF 정도에 그친다. INBOX_TOKEN 이 없으면 통로 자체가 없다.

   본문은 두 모양 다 받는다(단축어 쪽 설정을 어떻게 하든 되게):
   - 날 바이트 — 단축어 "요청 본문: 파일", HTTP Shortcuts "File"
   - multipart/form-data — 단축어 "요청 본문: 양식", HTTP Shortcuts "Form data"
   이름은 ?name= > X-Filename 헤더 > multipart/Content-Disposition 의 filename 순.
   **아이패드 단축어는 "양식"으로 보내게 안내한다** — 헤더에 한글 이름을 넣으면 iOS 가 값을
   빈 문자열로 보낸다(2026-09-28 실기기: x-filename 이 "" 로 옴). 양식은 파일 이름이 multipart 에 실려 온다. */
const INBOX_TOKEN = process.env.INBOX_TOKEN || "";
if (INBOX_TOKEN && INBOX_TOKEN.length < 24)
  console.warn("[여백] INBOX_TOKEN 이 너무 짧습니다 — 24자 이상 무작위 문자열을 쓰세요.");

function inboxOK(req) {
  if (!INBOX_TOKEN) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  const given = m ? m[1].trim() : String(req.query.key || "");
  const a = Buffer.from(given), b = Buffer.from(INBOX_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* 헤더 값의 파일 이름 — RFC 5987 filename*=UTF-8''… 를 먼저, 아니면 filename="…".
   단축어는 한글을 퍼센트 인코딩 없이 UTF-8 그대로 보내기도 하는데 Node 는 헤더를 latin1 로
   읽으므로, 그 경우 바이트를 되살려 UTF-8 로 다시 읽는다. */
function headerName(v) {
  if (!v) return "";
  v = String(v);
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(v);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch {} }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(v);
  return plain ? fixLatin1(plain[1] ?? plain[2].trim()) : "";
}
function fixLatin1(s) {
  if (!/[\x80-\xff]/.test(s) || /[^\x00-\xff]/.test(s)) return s;
  const t = Buffer.from(s, "latin1").toString("utf8");
  return t.includes("\ufffd") ? s : t;
}

/* multipart 에서 첫 번째 파일 칸만 꺼낸다 — 이 용도엔 파일 하나면 충분해서 라이브러리 없이 */
function firstPart(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || "");
  if (!m) return null;
  const sep = Buffer.from("--" + (m[1] || m[2]).trim());
  let at = buf.indexOf(sep);
  while (at >= 0) {
    const hEnd = buf.indexOf("\r\n\r\n", at);
    if (hEnd < 0) return null;
    const head = buf.subarray(at + sep.length, hEnd).toString("latin1");
    const next = buf.indexOf(sep, hEnd + 4);
    if (next < 0) return null;
    const body = buf.subarray(hEnd + 4, next - 2); // 칸 끝의 \r\n 은 구분자 몫
    if (/filename/i.test(head) || isPdf(body)) return { body, name: headerName(head) };
    at = next;
  }
  return null;
}

app.post("/api/inbox", express.raw({ type: () => true, limit: "300mb" }), (req, res) => {
  // 단축어가 결과를 그대로 알림에 띄우므로 사람이 읽을 한 줄 텍스트로 답한다
  const say = (code, msg) => res.status(code).type("text/plain; charset=utf-8").send(msg);
  if (!inboxOK(req)) return say(INBOX_TOKEN ? 401 : 404, "여백: 토큰이 맞지 않습니다.");
  let buf = req.body, name = "";
  if (/multipart\/form-data/i.test(req.headers["content-type"] || "") && Buffer.isBuffer(buf)) {
    const part = firstPart(buf, req.headers["content-type"]);
    buf = part?.body;
    name = part?.name || "";
  }
  if (!isPdf(buf)) return say(400, "여백: PDF 파일이 아닙니다.");
  let q = String(req.query.name || "");
  name = q || fixLatin1(String(req.headers["x-filename"] || "")) ||
    name || headerName(req.headers["content-disposition"]);
  try { name = decodeURIComponent(name); } catch {}
  name = name.replace(/[\\/]+/g, " ").replace(/\.pdf$/i, "").trim().slice(0, 200) ||
    "받은 문서 " + new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  // 폴더는 id 가 아니라 이름으로 — 단축어에 id 를 적어 넣게 할 수는 없다
  const fq = String(req.query.folder || "").trim();
  const folder = (fq && lib.folders.find((f) => f.id === fq || f.name === fq)?.id) || "";
  const e = addPdf(buf, name, folder);
  say(200, e.existing ? `여백: 이미 서재에 있습니다 — ${e.name}` : `여백: 서재에 넣었습니다 — ${e.name}`);
});

/* 설정 화면에서 단축어에 넣을 토큰을 보여 주기 위한 것 (로그인한 기기만).
   주소는 안 준다 — 서버는 자기가 /yeobaek/ 밑에 사는 걸 모른다. 클라이언트가 u() 로 만든다. */
app.get("/api/inbox/info", requireAuth, (_req, res) =>
  res.json(INBOX_TOKEN ? { enabled: true, token: INBOX_TOKEN } : { enabled: false }));

/* 읽기(기본)와 다운로드(?dl) — 경로는 목록에 있는 id 로만 만들어져 밖으로 나갈 수 없다 */
app.get("/api/library/file/:id", requireAuth, async (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  // ?dl&annots — "필기 포함" 내려받기. 필기가 없으면 원본 그대로 나간다.
  if ("dl" in req.query && "annots" in req.query) {
    try {
      const data = await readAnnots(f.id);
      if (Object.keys(data.pages || {}).length) {
        const out = await exportWithAnnots(await fs.promises.readFile(path.join(PDF_DIR, f.id + ".pdf")), data);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(f.name + " (필기).pdf")}`);
        return res.end(Buffer.from(out));
      }
    } catch (e) {
      console.error("[여백] 필기 내보내기 실패", e);
      return res.status(500).json({ error: "필기를 PDF에 넣지 못했습니다: " + e.message });
    }
  }
  /* 기기 저장소(src/pdfCache.js)는 If-None-Match 를 직접 달아 "바뀌었나"만 묻는다. 그런데 브라우저는 스크립트가
     조건 헤더를 달면 Fetch 규약대로 Cache-Control: no-cache 도 같이 붙이고, send 는 그걸 보면 ETag 가 같아도
     무조건 200 으로 전체를 보낸다 — 64MB 책을 열 때마다 다시 받던 원인(2026-10-09). 여기서는 무시하게 한다. */
  if (req.headers["if-none-match"]) { delete req.headers["cache-control"]; delete req.headers.pragma; }
  const fn = encodeURIComponent(f.name + ".pdf");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${"dl" in req.query ? "attachment" : "inline"}; filename*=UTF-8''${fn}`
  );
  // 로그인한 기기만 볼 책이다 — 중간 캐시에 남지 않게 private. ETag 로 다시 확인하므로 안 바뀌었으면 304
  res.sendFile(path.join(PDF_DIR, f.id + ".pdf"), { cacheControl: false, headers: { "Cache-Control": "private, no-cache" } });
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
  if (Number.isFinite(lastPage) && lastPage > 0) {
    const n = Math.floor(lastPage);
    // 저널에 남긴다 — "나갔다 오면 앞쪽으로 돌아가 있다" 같은 신고를 로그로 되짚기 위해(2026-09-28)
    if (n !== f.lastPage) console.log(`[쪽] ${f.name.slice(0, 40)} ${f.lastPage || "-"}→${n}`);
    f.lastPage = n;
  }
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
  // ?all — 책 전체(질문 탭 맥락용 — 클라이언트가 pdf.js 로 모든 쪽을 다시 뽑지 않게). ETag 로 다시 확인
  if ("all" in req.query) {
    res.setHeader("Cache-Control", "private, no-cache");
    return res.json({ pages: Array.isArray(pages) ? pages : [] });
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
  textCache.delete(f.id);
  // indexed = 올라온 쪽 수. 클라이언트는 이 값이 지금 쪽 수와 같으면 다시 안 올린다
  let changed = f.indexed !== clean.length;
  f.indexed = clean.length;
  const total = Number(req.body?.totalPages);
  if (Number.isFinite(total) && total > 0 && f.totalPages !== Math.floor(total)) {
    f.totalPages = Math.floor(total);
    changed = true;
  }
  if (changed) saveLib();
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

/* ── 필기 ──
   처음 GET 할 때 PDF 에 들어 있던 /Ink·/Highlight 를 한 번 가져와(annots.js) 파일로 굳힌다 —
   그 뒤로는 파일만 읽는다. 쓰기는 쪽 단위(PUT …/annots/:page): 굿노트 파일 한 쪽이 1300획·1MB 가까이
   되는데 획 하나 그을 때마다 책 전체를 올릴 수는 없다. 같은 문서에 대한 쓰기는 한 줄로 세운다. */
const annotPath = (id) => path.join(ANNOT_DIR, id + ".json");
const annotLoading = new Map(); // id → 가져오기 중인 Promise (동시에 두 번 파싱하지 않게)
async function readAnnots(id) {
  try {
    return JSON.parse(await fs.promises.readFile(annotPath(id), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!annotLoading.has(id)) {
    annotLoading.set(id, (async () => {
      let data;
      try {
        data = await importAnnots(await fs.promises.readFile(path.join(PDF_DIR, id + ".pdf")));
        if (data.imported) console.log(`[여백] PDF 주석 ${data.count}개를 필기로 가져옴 (${id})`);
      } catch (e) {
        // 암호·손상 등으로 못 읽어도 필기는 새로 시작할 수 있게 빈 채로 둔다
        console.warn("[여백] PDF 주석 읽기 실패", id, e.message);
        data = { v: 1, imported: false, count: 0, pages: {} };
      }
      await writeJsonAtomic(annotPath(id), data);
      return data;
    })().finally(() => annotLoading.delete(id)));
  }
  return annotLoading.get(id);
}
async function writeJsonAtomic(file, data) {
  const tmp = file + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(data));
  await fs.promises.rename(tmp, file);
}
const annotQueue = new Map(); // id → 마지막 쓰기 Promise
const HEX = /^#[0-9a-f]{6}$/i;
function cleanStroke(s) {
  if (!s || typeof s !== "object" || !Array.isArray(s.pts) || !s.pts.length || s.pts.length > 20000) return null;
  const w = Number(s.w);
  if (!(w > 0 && w <= 80) || !HEX.test(s.c || "")) return null;
  const pts = [];
  for (const p of s.pts) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    pts.push(Number.isFinite(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]]);
  }
  const out = { id: String(s.id || crypto.randomUUID()).slice(0, 40), t: s.t === "hl" ? "hl" : "pen", c: s.c, w, pts };
  if (Number.isFinite(s.a)) out.a = Math.max(0.05, Math.min(1, s.a));
  if (s.pr) out.pr = 1;
  return out;
}

/* 기기 진단 한 줄 — 아이패드 콘솔을 볼 수 없어서 클라이언트가 여기로 보낸다(journalctl 에 [기기]) */
app.post("/api/diag", requireAuth, (req, res) => {
  console.log("[기기]", String(req.body?.msg || "").slice(0, 2000));
  res.json({ ok: true });
});

app.get("/api/library/file/:id/annots", requireAuth, async (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  try {
    // 브라우저가 들고 있다가 ETag 로 묻게 — 안 바뀌었으면 304 라 다시 안 받는다
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(await readAnnots(f.id));
  } catch (e) {
    res.status(500).json({ error: "필기를 읽지 못했습니다: " + e.message });
  }
});

app.put("/api/library/file/:id/annots/:page", requireAuth, async (req, res) => {
  const f = lib.files.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "없는 파일입니다." });
  const page = Math.floor(Number(req.params.page));
  const raw = req.body?.strokes;
  if (!(page >= 1) || !Array.isArray(raw) || raw.length > 20000)
    return res.status(400).json({ error: "잘못된 필기 데이터입니다." });
  const strokes = raw.map(cleanStroke).filter(Boolean);
  const run = (annotQueue.get(f.id) || Promise.resolve()).then(async () => {
    const data = await readAnnots(f.id);
    data.pages ||= {};
    if (strokes.length) data.pages[page] = strokes;
    else delete data.pages[page];
    await writeJsonAtomic(annotPath(f.id), data);
  });
  annotQueue.set(f.id, run.catch(() => {}));
  try {
    await run;
    res.json({ ok: true, count: strokes.length });
  } catch (e) {
    console.error("[여백] 필기 저장 실패", e);
    res.status(500).json({ error: "필기를 저장하지 못했습니다: " + e.message });
  }
});

app.delete("/api/library/file/:id", requireAuth, (req, res) => {
  const i = lib.files.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "없는 파일입니다." });
  const [f] = lib.files.splice(i, 1);
  fs.rm(path.join(PDF_DIR, f.id + ".pdf"), { force: true }, () => {});
  fs.rm(path.join(THUMB_DIR, f.id + ".jpg"), { force: true }, () => {});
  fs.rm(path.join(TEXT_DIR, f.id + ".json"), { force: true }, () => {});
  textCache.delete(f.id);
  fs.rm(annotPath(f.id), { force: true }, () => {});
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
// 브라우저에는 항상 OpenAI 형식 SSE 만 내보낸다. 두 프로바이더 모두 여기서 다시 싼다.
/* 진행 알림(progress) — 답이 아니라 "지금 누구에게 묻고 있고 누가 왜 떨어졌나". 이름 있는 SSE 이벤트라
   OpenAI 형식만 읽는 쪽은 그냥 지나친다. */
function sseNote(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseEvent(delta, finish) {
  return `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
}

/* NIM·Groq·OpenRouter 공용(셋 다 OpenAI 형식). id 는 여백 안의 모델 id(접두어 포함) */
async function callOAI({ system, user, image, history = [], maxTokens, signal, model, gen }) {
  const up = models.upstream(model);
  if (!up.key) throw new Error(`${up.name} 키 없음`);
  // 이미지가 있으면 content 를 배열로 보낸다 (OpenAI 표준 멀티모달 형식).
  const content = image
    ? [{ type: "text", text: user },
       { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }]
    : user;
  const res = await fetch(`${up.base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${up.key}` },
    body: JSON.stringify({
      model: up.model,
      messages: [
        { role: "system", content: system },
        ...history.map((t) => ({ role: t.role, content: t.text })),
        { role: "user", content },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: true,
      // 탭용 "속생각 끄기" 설정(찾기 때 모델마다 알아낸 것 — chat_template_kwargs 또는 reasoning_effort)
      ...(gen || {}),
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    const e = new Error(`${res.status}${d ? ": " + d.slice(0, 160) : ""}`);
    e.status = res.status;
    throw e;
  }
  return res;
}

async function callGemini({ system, user, image, history = [], maxTokens, signal, model, gen }) {
  if (!GEMINI_KEY) throw new Error("Gemini 키 없음");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
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
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3, ...(gen || {}) },
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    // Gemini 오류 본문은 여러 줄 JSON 이다 — message 한 줄만 남긴다
    let msg = d;
    try { msg = JSON.parse(d).error?.message || d; } catch {}
    const e = new Error(`${res.status}${msg ? ": " + String(msg).slice(0, 160) : ""}`);
    e.status = res.status;
    throw e;
  }
  return res;
}

/* SSE 줄을 읽어 JSON 을 하나씩 내놓는다(두 프로바이더 공용) */
async function* sseJSON(body) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try { yield JSON.parse(raw); } catch {}
    }
  }
}

/* 프로바이더 스트림 → { c: 답 글자, k: 속생각, fin: 끝난 이유 } 로 맞춘다.
   fin 은 OpenAI 식으로: "stop" 정상, "length" 상한에 걸림, 그 밖은 막힘(SAFETY 등). */
const GEMINI_FIN = { STOP: "stop", MAX_TOKENS: "length" };
async function* events(upstream, gemini) {
  for await (const j of sseJSON(upstream.body)) {
    if (j.error) throw new Error(String(j.error.message || JSON.stringify(j.error)).slice(0, 160));
    if (gemini) {
      const cand = j.candidates?.[0];
      const c = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      const fr = cand?.finishReason;
      const fin = fr ? GEMINI_FIN[fr] || fr : "";
      if (!cand && j.promptFeedback?.blockReason) yield { fin: j.promptFeedback.blockReason };
      else if (c || fin) yield { c, fin };
    } else {
      const ch = j.choices?.[0];
      const d = ch?.delta || {};
      const c = d.content || "";
      const k = d.reasoning_content || d.reasoning || "";
      const fin = ch?.finish_reason || "";
      if (c || k || fin) yield { c, k, fin };
    }
  }
}

/* 질문 탭 세션의 이전 대화. 클라이언트가 이미 잘라서 보내지만,
   프롬프트가 폭주해 요금·지연이 튀지 않도록 서버에서 한 번 더 자른다.
   이미지는 전부 버린다 — 이미지는 현재 턴의 image 하나뿐이다.
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

/* ── /api/chat ──
   요청 하나 = "고른 모델 → 대신 답할 모델들" 차례로 시도. 핵심 규칙은 하나다:
   **첫 글자(또는 속생각)가 실제로 오기 전까지는 아무것도 클라이언트에 보내지 않는다.**
   그래서 붐빔(503/529), 헤더만 오고 멈춤, 빈 답(생각만 하다 끝남·SAFETY), 스트림 초반 오류가
   전부 "다음 모델로" 로 조용히 흡수된다. 예전엔 헤더가 오는 순간 그 모델에 묶여서, 그 뒤에
   빈 답이 오면 화면엔 아무것도 없이 끝났고("답도 안 내고 끝난다"), 503 셋이면 곧장 502 였다.
   쓰기 시작한 뒤에 끊기면 되돌릴 수 없으므로, 끊겼다는 한 줄을 답 끝에 붙여 알린다.
   누가 답했는지는 X-Engine/X-Model 헤더, 고른 모델과 다르면 X-Wanted 에 원래 고른 것. */
app.post("/api/chat", requireAuth, async (req, res) => {
  const { system = "", user = "", image = "", maxTokens = 1000, ask = false, model = "", tapModel = "", visionDirect = false, progress = false } = req.body || {};
  if (!user) return res.status(400).json({ error: "user 가 비었습니다." });
  const history = trimHistory(req.body?.history);

  const ac = new AbortController();
  // req 의 'close' 는 본문을 다 읽은 직후에도 발생하므로 쓰면 안 된다.
  // 실제 클라이언트 이탈은 응답이 끝나기 전에 res 가 닫히는 경우다.
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

  // 전체 상한: 단어·문장 탭은 빨리 실패해야 하므로 90초, 질문 탭은 속생각이 긴 모델을 위해 180초.
  const timeoutMs = ask ? 180_000 : 90_000;
  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]);
  // 상한 8000 — 추론 모델은 max_tokens 안에서 속생각까지 함께 쓰기 때문에,
  // 이름 정리처럼 긴 구조화 출력이 필요한 호출은 4000 으로는 답이 통째로 잘린다.
  const args = { system, user, image, history, maxTokens: Math.min(Number(maxTokens) || 1000, 8000) };

  // 클라이언트가 보낸 모델은 허용 목록에 있을 때만 받는다.
  // 사용자가 고른 모델(없으면 .env 고정값, 그것도 없으면 자동). 목록에 없는 모델은 무시한다.
  const want = (ask ? model : tapModel) || (ask ? PIN_ASK : PIN_TAP);
  const picked = models.pickable(want) ? want : "";
  // 이미지는 그림을 받는 모델만(models.js 가 거른다). 캡처는 탭 모델 선택을 따른다.
  /* maxTokens 1 은 클라이언트의 예열 요청(warmModels)이다. 예전 NIM 은 콜드스타트가 길어 미리 깨워
     두는 게 의미가 있었지만, 이걸 대신 답할 모델까지 줄줄이 부르면 무료 한도만 태운다 — 게다가
     속생각을 하는 Gemini 는 1토큰 예산으로는 "빈 응답"이라 다섯 모델을 다 돌고 실패로 기록됐다
     (2026-09-28). 그래서 예열은 첫 모델 한 번만, 결과는 점수에 안 넣는다. */
  const warm = args.maxTokens <= 1;
  const kind = image ? "image" : ask ? "ask" : "tap";
  /* 다음 모델은 **실패할 때마다 다시 고른다.** 처음에 줄을 한 번 세워 두고 따라가면, Gemini 가
     줄줄이 막혀도 그 줄 그대로 Gemini 만 두드리다 끝났다. 매번 다시 고르면 방금 깎인 점수(그 모델의
     벌점, "Google 전체가 막힘" 벌점)가 곧바로 반영돼 두세 번 실패하면 NIM 으로 넘어간다. */
  const tried = new Set();
  // visionDirect: 그림째 Gemini·kimi-k3 에게만(models.chain 의 gemOnly 참고). 질문이면 질문 탭 순위·고른 모델(Gemini 일 때)을 따른다.
  const gemOnly = !!(image && visionDirect);
  const nextModel = () => models.chain({ kind, picked, gemOnly, ask }).find((id) => !tried.has(id));
  if (!warm) models.touch();
  const firstMs = ask ? FIRST_MS.ask : FIRST_MS.tap;
  const lane = kind === "tap" ? "tap" : "main"; // 같은 모델도 탭(속생각 끔)과 질문(켬)은 속도가 전혀 다르다
  const deadline = Date.now() + timeoutMs;
  const fails = [];
  /* progress: 헤더를 곧바로 보내고, 모델을 고르는 과정(try/fail/nap)부터 흘린다. 질문 탭 상태 카드가
     "첫 글자 전엔 아무것도 모르는" 상태였다 — 서버가 몰래 모델을 갈아타는 동안 화면은 "기다리는 중"뿐이었다.
     헤더를 먼저 보내면 뒤에서 502 를 못 주므로, 전부 실패는 error 이벤트로 알린다. 모델 정보도 헤더 대신 pick 이벤트. */
  const openStream = () => {
    if (res.headersSent) return;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx 앞단 버퍼링 방지
    res.flushHeaders();
  };
  const note = (name, data) => { if (progress && !ac.signal.aborted) res.write(sseNote(name, data)); };
  if (progress) openStream();
  const label = (id) => models.get(id)?.label || id;
  const nap = (ms) => new Promise((r) => { const t = setTimeout(r, ms); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

  /* 모델 하나에 붙어 첫 글자(또는 속생각)까지 받는다 → { id, it, first, cc, t0 }. 실패하면 기록하고 null. */
  async function attempt(id, a) {
    const gem = models.isGem(id);
    const t0 = Date.now();
    // 이 시도만의 첫 글자 상한 — 넘기면 이 모델만 끊고 다음으로
    const cc = new AbortController();
    const timer = setTimeout(() => cc.abort(new Error(`${firstMs / 1000}초 동안 첫 글자 없음`)), firstMs);
    const sig = AbortSignal.any([signal, cc.signal]);
    note("try", { model: id, label: label(id) });
    // 탭·캡처는 찾기 때 알아낸 "속생각 끄기" 설정으로(Gemini 는 generationConfig, NIM 은 요청 본문에 덧붙임)
    const gen = ask ? undefined : models.get(id)?.gen;
    let it;
    try {
      const up = gem
        ? await callGemini({ ...a, model: id.slice(7), gen, signal: sig })
        : await callOAI({ ...a, model: id, gen, signal: sig });
      it = events(up, gem)[Symbol.asyncIterator]();
      for (;;) {
        const r = await it.next();
        if (r.done) throw new Error("빈 응답");
        if (r.value.c || r.value.k) { clearTimeout(timer); return { id, it, first: r.value, cc, t0 }; }
        if (r.value.fin) throw new Error(`빈 응답(${r.value.fin})`); // 한 글자도 없이 끝남
      }
    } catch (e) {
      clearTimeout(timer);
      it?.return?.().catch(() => {});
      if (ac.signal.aborted) return null; // 클라이언트가 떠났다 — 기다리는 상대가 없다
      const why = cc.signal.aborted ? cc.signal.reason?.message : signal.aborted ? "전체 상한 초과" : e.message;
      if (!warm) models.record(id, false, e.status || (cc.signal.aborted ? 408 : 0), 0, lane);
      console.warn(`[여백] ${id} 실패: ${String(why).slice(0, 160)}`);
      // 사용자에게 보일 짧은 이유 — 원문(영어 오류 본문)은 로그에만
      const st = e.status;
      const short = st === 429 ? "한도 초과" : st >= 500 ? "붐빔" : cc.signal.aborted ? "응답 없음" : st === 410 || st === 404 ? "종료됨" : "실패";
      fails.push(`${label(id)} ${short}`);
      note("fail", { model: id, label: label(id), why: short });
      return null;
    }
  }

  /* ── 붙을 모델 찾기 ──
     한 바퀴(쓸 수 있는 모델 전부)가 다 실패해도 곧장 "실패"라고 하지 않는다. 503 은 대개 몇 초면
     풀리므로, 전체 상한이 남아 있는 동안 잠깐 쉬었다가 처음부터 다시 돈다(최대 세 바퀴). */
  let got = null;
  for (let round = 0; !got && !signal.aborted; ) {
    const id = nextModel();
    if (!id) {
      if (warm || gemOnly || round >= 2 || deadline - Date.now() < 20_000) break;
      round++;
      tried.clear();
      console.warn(`[여백] 한 바퀴 전부 실패 — ${3 * round}초 쉬고 다시 (${round}/2)`);
      note("nap", { sec: 3 * round, round });
      await nap(3000 * round);
      continue;
    }
    tried.add(id);
    got = await attempt(id, args);
    if (warm) break;
  }
  if (ac.signal.aborted) return;
  if (!got) {
    console.error(`[여백] 전부 실패 — ${fails.join(" / ")}`);
    const error = fails.length
      ? `지금은 답할 수 있는 모델이 없어요 (${[...new Set(fails)].join(", ")}). 잠시 후 다시 시도해 주세요.`
      : "사용할 수 있는 모델이 없어요. API 키를 확인해 주세요.";
    if (progress) { note("error", { error }); return res.end(); }
    return res.status(502).json({ error });
  }

  // ── 여기서부터 이 모델로 확정. 헤더를 보내고 흘린다. ──
  const eng0 = models.upstream(got.id).name; // Gemini / NIM / Groq / OpenRouter
  const wanted = !gemOnly && picked && got.id !== picked ? picked : ""; // 자동일 땐 "대신 답했다"가 아니다
  if (progress) {
    // why: 이 모델이 왜 답하나 — 직접 고름 / 자동 1순위 / 앞 모델이 실패해 넘어옴
    note("pick", { model: got.id, label: label(got.id), engine: eng0, wanted,
      why: fails.length ? "fallback" : got.id === picked ? "picked" : "auto" });
  } else {
    res.setHeader("X-Engine", eng0);
    res.setHeader("X-Model", got.id);
    if (wanted) res.setHeader("X-Wanted", wanted);
    res.setHeader("Access-Control-Expose-Headers", "X-Engine, X-Model, X-Wanted");
    openStream();
  }

  let text = ""; // 지금까지 보낸 답(content) — 끊겼을 때 이어 쓰기의 재료
  const t00 = deadline - timeoutMs; // 요청이 들어온 때 — 폴백으로 흘려보낸 시간까지 체감 그대로
  let firstAt = 0;
  // 질문·그림의 체감 속도를 남긴다 — 실패만 찍혀서 "느리다"를 로그로 확인할 길이 없었다(2026-09-29)
  const inChars = system.length + user.length + history.reduce((n, t) => n + t.text.length, 0);
  const send = (ev) => {
    if (ev.k) res.write(sseEvent({ reasoning_content: ev.k }));
    if (ev.c) { res.write(sseEvent({ content: ev.c })); text += ev.c; }
    if (ev.fin) res.write(sseEvent({}, ev.fin));
  };
  /* 한 모델의 스트림을 끝까지 흘린다 → 끝난 이유(fin). 끊기면 throw.
     점수의 "속도"는 **답의 첫 글자**까지로 잰다. 속생각의 첫 조각은 0.4초에 와도 답은 90초 뒤일 수 있어서
     (2026-09-28 nemotron-omni 캡처), 그걸로 재면 느린 추론 모델이 "가장 빠른 모델"로 뽑힌다. */
  async function pump(g) {
    let timed = false;
    const timeIt = (ev) => {
      if (!timed && ev.c && !warm) { timed = true; firstAt = Date.now(); models.record(g.id, true, 200, Date.now() - g.t0, lane); }
    };
    // 쓰는 도중 STALL_MS 동안 아무것도 안 오면 멈춘 것으로 본다
    let stall;
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => g.cc.abort(new Error("멈춤")), STALL_MS); };
    let fin = g.first.fin || "";
    try {
      timeIt(g.first);
      send(g.first);
      arm();
      for (;;) {
        const r = await g.it.next();
        if (r.done) break;
        arm();
        timeIt(r.value);
        send(r.value);
        if (r.value.fin) fin = r.value.fin;
      }
    } finally {
      clearTimeout(stall);
    }
    if (!timed && !warm) models.record(g.id, true, 200, Date.now() - g.t0, lane); // 답 없이 속생각만으로 끝난 경우
    return fin;
  }

  /* 쓰는 도중에 끊기면(망·업스트림 오류·45초 멈춤) "끊겼습니다"로 끝내지 않고 **이어 쓰게 한다** —
     지금까지 쓴 답을 어시스턴트 턴으로 넣고 "끊긴 곳 바로 다음부터 이어 써라"로 다른 모델(없으면 같은
     모델)을 부른다. 화면에서는 답이 잠깐 멈췄다가 이어지는 것으로 보인다. 두 번까지. */
  const CONT = "(바로 앞의 네 답이 연결 문제로 도중에 끊겼다. 끊긴 지점 바로 다음 글자부터 이어서 써라. " +
    "이미 쓴 부분을 되풀이하거나 처음부터 다시 쓰지 말고, 인사나 설명 없이 곧바로 이어지는 내용만 써라.)";
  let cur = got;
  for (let conts = 0; ; ) {
    try {
      const fin = await pump(cur);
      if (fin && fin !== "stop" && fin !== "length")
        res.write(sseEvent({ content: `\n\n_(답변이 중간에 멈췄어요 (${fin}). 다시 시도하거나 다른 모델을 골라 주세요.)_` }));
      break;
    } catch (e) {
      if (ac.signal.aborted) return;
      console.warn(`[여백] ${cur.id} 쓰는 도중 끊김: ${String(cur.cc.signal.reason?.message || e.message).slice(0, 120)}`);
      if (!warm) models.record(cur.id, false, 0, 0, lane);
      let next = null;
      if (conts < 2 && !signal.aborted) {
        conts++;
        // 답이 한 글자도 없었으면(속생각만 하다 끊김) 처음부터 다시, 있으면 이어 쓰기
        const a = text.trim()
          ? { ...args, history: [...args.history, { role: "user", text: args.user }, { role: "assistant", text }], user: CONT }
          : args;
        tried.add(cur.id);
        for (let k = 0; k < 3 && !next && !signal.aborted; k++) {
          const nid = nextModel() || cur.id;
          tried.add(nid);
          next = await attempt(nid, a);
        }
      }
      if (!next) {
        if (ac.signal.aborted) return;
        res.write(sseEvent({ content: "\n\n_(연결이 끊겨 여기서 멈췄어요. 다시 시도해 주세요.)_" }));
        break;
      }
      console.warn(`[여백] ${next.id} 가 이어서 씀`);
      note("pick", { model: next.id, label: label(next.id), engine: models.upstream(next.id).name, wanted: "", why: "cont" });
      cur = next;
    }
  }
  if (!warm && kind !== "tap")
    console.log(`[여백] ${kind === "ask" ? "질문" : "그림"} ${cur.id} 첫 글자 ${firstAt ? ((firstAt - t00) / 1000).toFixed(1) + "초" : "-"}` +
      ` · 끝 ${((Date.now() - t00) / 1000).toFixed(1)}초 · 입력 ${inChars}자(대화 ${history.length}턴) · 답 ${text.length}자`);
  res.write("data: [DONE]\n\n");
  res.end();
});

/* ───────────────── 정적 파일 ───────────────── */
/* /assets/* 는 파일 이름에 내용 해시가 붙어 있어 바뀌면 이름이 바뀐다 — 1년 캐시. 예전엔 max-age=0 이라
   앱을 열 때마다 719KB 번들을 서버에 다시 물어봤다. index.html 은 늘 새로 확인해야 새 빌드가 보인다. */
const ASSETS = path.join(ROOT, "dist", "assets");
// 미리 압축해 둔 .gz(scripts/gzip-dist.mjs)가 있으면 그걸 보낸다 — 압축은 빌드 때 한 번만
app.use("/assets", (req, res, next) => {
  if (!/\.(js|css|svg)$/.test(req.path) || !/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return next();
  if (!fs.existsSync(path.join(ASSETS, path.normalize(req.path) + ".gz"))) return next();
  res.type(path.extname(req.path));
  res.setHeader("Content-Encoding", "gzip");
  res.setHeader("Vary", "Accept-Encoding");
  res.sendFile(req.path.slice(1) + ".gz", { root: ASSETS, immutable: true, maxAge: "365d" }, (e) => e && next(e));
});
app.use("/assets", express.static(path.join(ROOT, "dist", "assets"), { immutable: true, maxAge: "365d", fallthrough: false }));
app.use(express.static(path.join(ROOT, "dist"), { setHeaders: (res, p) => { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "dist", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  const p = models.publicList();
  console.log(`[여백] http://0.0.0.0:${PORT}  모델 ${p.models.length}개(탭 ${p.tapModels.length}) · 지금 자동: 탭 ${p.auto.tap} · 질문 ${p.auto.ask}` +
    `${GEMINI_KEY ? "" : "  (Gemini 키 없음)"}${NIM_KEY ? "" : "  (NIM 키 없음)"}`);
  // 켜질 때 한 번, 그 뒤 한 시간마다 목록을 본다 — 실제로 불러 보는 건 새 모델·하루 지난 모델·
  // 붐벼서 미뤄 둔 모델뿐이라 대부분의 시간엔 목록 요청 두 번으로 끝난다.
  const run = () => models.discover().catch((e) => console.warn("[모델] 찾기 실패:", e.message));
  setTimeout(run, 5_000);
  setInterval(run, 60 * 60 * 1000);
});
