import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";

/* ───────────────── 리모트 모드 (아이패드 → 안드로이드 패널 미러링) ─────────────────

   역할 분담은 끝까지 이렇다:
     - 아이패드는 유일하게 모델을 부르는 쪽이다. 문서·오프셋·본문 맥락을 쥔 것도
       아이패드뿐이라 어떤 조회든 결국 아이패드가 실행한다.
     - 폰은 명령만 던진다(질문 입력, 오려내기 요청, 대화 전환). 직접 /api/chat 을 타지 않는다.
     - 서버는 상태의 주인이지 실행자가 아니다. 여기 있는 라우트들은 "지금 이렇다"를
       받아서 저장하고, 붙어 있는 다른 기기에 SSE 로 흘려보내는 일만 한다.

   두 종류의 상태를 분명히 가른다:
     - 중계(relay) = 흐르는 중인 화면. 단어/문장/오려내기 조회가 토큰 단위로 갱신되는
       동안의 표시다. 저장하지 않는다 — 다시 붙었을 때 지나간 토큰을 재생할 필요가 없다.
       slot 별 seq 로 "이미 버려진 이전 조회"만 걸러낸다.
     - 세션(session) = 질문 탭 대화. 여기는 저장한다 — 아이패드가 잠들어도 폰이
       지난 대화를 계속 봐야 하기 때문이다. 단, 토큰마다 쓰지 않는다: 스트리밍 중인
       모습은 relay 로만 보여주고, 세션에는 문답이 "정착"됐을 때(새 메시지 추가,
       완료/중단/에러 확정)만 반영한다. 그래야 초당 여러 번 파일을 다시 쓰는 일이 없다.

   오려낸 그림은 세션에 속한다 — 세션이 지워지면(수동 삭제든 TTL 만료든) 그림도
   함께 지운다. 그래서 서재 썸네일처럼 영구 보관하지 않고 세션 id 로 묶인 디렉터리에
   둔다: data/sessimg/<세션id>/<그림id>.jpg */

// src/App.jsx 의 SESS_TTL·SESS_MAX 와 반드시 같은 값으로 맞춘다 — 어긋나면
// "폰에는 남아 있는데 아이패드에는 이미 지워졌다" 같은 어긋남이 생긴다.
const SESS_TTL = 2 * 60 * 60 * 1000;
const SESS_MAX = 20;
const FIELD_CAP = 60_000; // 메시지 한 필드 상한 — 정상 답은 훨씬 짧다, 폭주 방지용 안전판

export function mountRemote(app, { requireAuth, DATA_DIR }) {
  const SESS_FILE = path.join(DATA_DIR, "sessions.json");
  const SESSIMG_DIR = path.join(DATA_DIR, "sessimg");
  fs.mkdirSync(SESSIMG_DIR, { recursive: true });

  let store = { sessions: [], cur: "" };
  try {
    const j = JSON.parse(fs.readFileSync(SESS_FILE, "utf8"));
    store = { sessions: Array.isArray(j.sessions) ? j.sessions : [], cur: j.cur || "" };
  } catch {}

  let saveTimer = null;
  function saveSessions() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const tmp = SESS_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, SESS_FILE);
    }, 500);
  }

  function removeSessionFiles(id) {
    fs.rm(path.join(SESSIMG_DIR, id), { recursive: true, force: true }, () => {});
  }

  function findSess(id) {
    return store.sessions.find((s) => s.id === id) || null;
  }

  // 문자열 필드만 길이를 자른다 — 필드 모양은 클라이언트가 정하므로 서버는 강요하지 않는다
  function sanitize(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      out[k] = typeof v === "string" ? v.slice(0, FIELD_CAP) : v;
    }
    return out;
  }

  // ── SSE 허브 ──
  const listeners = new Set();
  function broadcast(event, data) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) res.write(chunk);
  }
  const heartbeat = setInterval(() => {
    for (const res of listeners) res.write(":ping\n\n"); // nginx 120s 타임아웃보다 훨씬 짧게 유지
  }, 20_000);
  heartbeat.unref?.();

  // ── 모드 · 현재 문서 ──
  let mode = { on: false, doc: null }; // doc: { id, name, page }
  const relaySeq = Object.create(null); // slot -> 마지막으로 받아들인 seq (새 tap 이 이전 걸 버리는 기준)

  const snapshot = () => ({ mode, sessions: store.sessions, cur: store.cur });

  app.get("/api/remote/stream", requireAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    listeners.add(res);
    res.write(`event: hello\ndata: ${JSON.stringify(snapshot())}\n\n`);
    // req 의 'close' 가 아니라 res 의 'close' — 이유는 /api/chat 의 같은 주석 참고.
    res.on("close", () => listeners.delete(res));
  });

  app.get("/api/remote/state", requireAuth, (_req, res) => res.json(snapshot()));

  app.post("/api/remote/mode", requireAuth, (req, res) => {
    mode = { on: !!req.body?.on, doc: req.body?.on ? mode.doc : null };
    broadcast("mode", mode);
    res.json({ ok: true, mode });
  });

  // 아이패드가 페이지를 넘길 때마다 부른다 — 리모트가 꺼져 있으면 조용히 무시한다
  app.post("/api/remote/page", requireAuth, (req, res) => {
    if (!mode.on) return res.json({ ok: true, skipped: true });
    const { docId = "", docName = "", page = 0 } = req.body || {};
    mode.doc = {
      id: String(docId).slice(0, 100),
      name: String(docName).slice(0, 200),
      page: Math.max(0, Math.floor(Number(page)) || 0),
    };
    broadcast("page", mode.doc);
    res.json({ ok: true });
  });

  /* 단어/문장/오려내기의 "지금 그려지는 중" 화면을 그대로 흘려보낸다. 서버는 payload
     의 모양을 모른다 — 그릴 규칙은 클라이언트가 갖고 있다. 서버가 책임지는 건 하나,
     "이미 버려진 이전 조회가 뒤늦게 와도 덮어쓰지 못하게" 막는 것뿐이다. 단어를 연달아
     탭하면 이전 탭의 늦게 도착한 토큰이 새 탭의 화면을 덮어쓸 수 있는데, seq 가 낮으면
     버려서 막는다. */
  app.post("/api/remote/relay", requireAuth, (req, res) => {
    const { slot = "", seq = 0, payload = null } = req.body || {};
    if (!slot || !mode.on) return res.json({ ok: true, skipped: true });
    const n = Number(seq) || 0;
    if (n < (relaySeq[slot] || 0)) return res.json({ ok: true, stale: true });
    relaySeq[slot] = n;
    broadcast("relay:" + slot, { seq: n, payload });
    res.json({ ok: true });
  });

  // ── 질문 탭 세션 (저장) ──

  app.get("/api/remote/sessions", requireAuth, (_req, res) => res.json({ sessions: store.sessions, cur: store.cur }));

  app.post("/api/remote/sessions", requireAuth, (req, res) => {
    const { title = "", extra = {} } = req.body || {};
    const s = {
      id: crypto.randomUUID(),
      title: String(title || "새 대화").slice(0, 200),
      at: Date.now(),
      msgs: [],
      img: "",
      ...sanitize(extra),
    };
    const next = [s, ...store.sessions];
    store.sessions = next.slice(0, SESS_MAX);
    for (const dropped of next.slice(SESS_MAX)) {
      removeSessionFiles(dropped.id);
      broadcast("sess-del", { id: dropped.id });
    }
    store.cur = s.id;
    saveSessions();
    broadcast("sess-new", s);
    res.json(s);
  });

  app.post("/api/remote/cur", requireAuth, (req, res) => {
    const id = String(req.body?.id || "");
    if (id && !findSess(id)) return res.status(404).json({ error: "없는 대화입니다." });
    store.cur = id;
    saveSessions();
    broadcast("sess-cur", { id });
    res.json({ ok: true });
  });

  app.patch("/api/remote/sessions/:id", requireAuth, (req, res) => {
    const s = findSess(req.params.id);
    if (!s) return res.status(404).json({ error: "없는 대화입니다." });
    const patch = sanitize(req.body?.patch || req.body || {});
    Object.assign(s, patch);
    s.at = Date.now();
    saveSessions();
    broadcast("sess-patch", { id: s.id, patch });
    res.json(s);
  });

  // 새 문답을 정착시킨다(질문 + 빈 답 자리, 혹은 질문+완성된 답을 한 번에). 스트리밍
  // 도중의 토큰 하나하나는 여기로 오면 안 된다 — 그건 /api/remote/relay 의 몫이다.
  app.post("/api/remote/sessions/:id/msgs", requireAuth, (req, res) => {
    const s = findSess(req.params.id);
    if (!s) return res.status(404).json({ error: "없는 대화입니다." });
    const arr = Array.isArray(req.body?.msgs) ? req.body.msgs : [];
    if (!arr.length) return res.status(400).json({ error: "msgs 가 비었습니다." });
    const clean = arr.slice(0, 4).map(sanitize);
    const from = s.msgs.length;
    s.msgs.push(...clean);
    s.at = Date.now();
    saveSessions();
    broadcast("sess-msgs", { id: s.id, from, msgs: clean });
    res.json({ ok: true, from });
  });

  // 답이 끝났거나(완성/중단/에러) 별표를 눌렀거나 — 정착된 상태만 여기로 온다
  app.patch("/api/remote/sessions/:id/msgs/:i", requireAuth, (req, res) => {
    const s = findSess(req.params.id);
    if (!s) return res.status(404).json({ error: "없는 대화입니다." });
    const i = Number(req.params.i);
    if (!Number.isInteger(i) || !s.msgs[i]) return res.status(404).json({ error: "없는 메시지입니다." });
    const patch = sanitize(req.body?.patch || req.body || {});
    Object.assign(s.msgs[i], patch);
    s.at = Date.now();
    saveSessions();
    broadcast("sess-msg-patch", { id: s.id, i, patch });
    res.json({ ok: true });
  });

  app.delete("/api/remote/sessions/:id", requireAuth, (req, res) => {
    const i = store.sessions.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "없는 대화입니다." });
    const [removed] = store.sessions.splice(i, 1);
    if (store.cur === removed.id) store.cur = store.sessions[0]?.id || "";
    removeSessionFiles(removed.id);
    saveSessions();
    broadcast("sess-del", { id: removed.id });
    res.json({ ok: true });
  });

  // 오려낸 그림 — 세션에 속한다. data URL 로 세션 JSON 에 박지 않고 경로로 주고받는다.
  // :id 를 그대로 fs 경로에 쓰면 안 되므로, 실제로 존재하는 세션일 때만(findSess 통과) 연다 —
  // 그 자체가 경로 조작 방어다: 저장된 id 는 항상 crypto.randomUUID() 라 "/", ".." 가 없다.
  app.post(
    "/api/remote/sessions/:id/image",
    requireAuth,
    express.raw({ type: () => true, limit: "3mb" }),
    (req, res) => {
      const s = findSess(req.params.id);
      if (!s) return res.status(404).json({ error: "없는 대화입니다." });
      if (!Buffer.isBuffer(req.body) || req.body.length < 100)
        return res.status(400).json({ error: "이미지가 비었습니다." });
      const dir = path.join(SESSIMG_DIR, s.id);
      fs.mkdirSync(dir, { recursive: true });
      const imgId = crypto.randomUUID();
      fs.writeFileSync(path.join(dir, imgId + ".jpg"), req.body);
      res.json({ id: imgId });
    }
  );

  app.get("/api/remote/sessions/:id/image/:imgId", requireAuth, (req, res) => {
    if (!findSess(req.params.id)) return res.status(404).end();
    const file = path.join(SESSIMG_DIR, req.params.id, req.params.imgId + ".jpg");
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(file);
  });

  // 2시간 지난 대화를 정리한다 — 그림도 같이 지운다(세션이 그림의 유일한 주인이다).
  function sweep() {
    const now = Date.now();
    const keep = [];
    const dropped = [];
    for (const s of store.sessions) (now - (s.at || 0) < SESS_TTL ? keep : dropped).push(s);
    if (!dropped.length) return;
    store.sessions = keep;
    if (!keep.some((s) => s.id === store.cur)) store.cur = keep[0]?.id || "";
    for (const s of dropped) {
      removeSessionFiles(s.id);
      broadcast("sess-del", { id: s.id });
    }
    saveSessions();
  }
  sweep(); // 서버가 막 켜졌을 때 이미 지나 있던 세션도 바로 정리한다
  const sweepTimer = setInterval(sweep, 60_000);
  sweepTimer.unref?.();
}
