import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";

/* ───────────────── 질문 탭 대화 저장소 + 기기 간 중계 ─────────────────

   서버는 상태의 주인이지 실행자가 아니다 — 모델은 아이패드·PC 창이 부르고, 여기는
   "지금 이렇다"를 받아 저장하고 붙어 있는 다른 창에 SSE 로 흘린다.
     - 중계(relay "ask") = 흐르는 중인 답. 저장하지 않고 seq 로 낡은 것만 거른다.
     - 세션 = 질문 탭 대화. 정착했을 때(메시지 추가, 완료/중단/에러)만 쓴다 — 토큰마다 쓰지 않는다.
   오려낸 그림은 세션에 속한다: data/sessimg/<세션id>/<그림id>.jpg, 세션과 함께 지운다. */

// src/App.jsx 의 SESS_TTL·SESS_MAX 와 반드시 같은 값으로 맞춘다 — 어긋나면
// "한 창에는 남아 있는데 다른 창에는 이미 지워졌다" 같은 어긋남이 생긴다.
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
  /* 2026-09-29 부터 아이패드 질문 탭도 이 저장소를 쓴다(예전엔 아이패드는 localStorage, 폰만 여기).
     메시지 역할은 아이패드 쪽 이름(me/ai)으로 통일한다 — 예전 폰 형식(user/assistant)은 읽을 때 바꾼다. */
  for (const s of store.sessions)
    for (const m of s.msgs || []) m.role = m.role === "user" ? "me" : m.role === "assistant" ? "ai" : m.role;

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

  const relaySeq = Object.create(null); // slot -> 마지막으로 받아들인 seq (새 tap 이 이전 걸 버리는 기준)

  const snapshot = () => ({ sessions: store.sessions, cur: store.cur });

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

  // 흐르는 답을 다른 창에 — 늦게 온 이전 seq 가 새 걸 덮지 못하게만 막는다
  app.post("/api/remote/relay", requireAuth, (req, res) => {
    const { slot = "", seq = 0, payload = null } = req.body || {};
    if (slot !== "ask") return res.json({ ok: true, skipped: true });
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

  /* 답 자리 맡기 — 답하다 끊긴 질문(pending)을 아이패드·PC 가 여럿 열려 있어도 한 곳만 답하게 한다.
     맡은 기기가 3분 넘게 아무 말이 없으면(창을 닫았거나 잠듦) 다른 기기가 가져갈 수 있다. */
  app.post("/api/remote/sessions/:id/msgs/:i/claim", requireAuth, (req, res) => {
    const s = findSess(req.params.id);
    const m = s?.msgs[Number(req.params.i)];
    if (!m) return res.status(404).json({ error: "없는 메시지입니다." });
    const by = String(req.body?.by || "").slice(0, 60);
    if (!m.pending) return res.status(409).json({ error: "이미 답한 질문입니다." });
    if (m.claim && m.claim !== by && Date.now() - (m.claimAt || 0) < 180_000)
      return res.status(409).json({ error: "다른 기기가 답하는 중입니다." });
    Object.assign(m, { claim: by, claimAt: Date.now() });
    saveSessions();
    broadcast("sess-msg-patch", { id: s.id, i: Number(req.params.i), patch: { claim: by, claimAt: m.claimAt } });
    res.json({ ok: true });
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
