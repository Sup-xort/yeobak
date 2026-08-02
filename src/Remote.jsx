import { useState, useRef, useEffect, useMemo } from "react";
import "./App.css";
import Rich from "./rich.jsx";
import { fmtDate, fmtRel } from "./App.jsx";

/* ───────────────────────── 여백 리모트 (폰) ─────────────────────────
   설계 원칙(server/remote.js 의 주석과 같다): 아이패드가 유일하게 모델을 부르고
   문서를 쥔 실행자다. 폰은 명령만 던진다 — 이 화면은 /api/chat 을 직접 부르지
   않는다. 질문은 서버에 저장된 세션(/api/remote/sessions)에 문답 자리만 만들고,
   실제 답은 아이패드가 훗날 채워 넣는 걸 SSE 로 받아서 보여준다.

   단어/문장 탭에 뜨는 내용도 마찬가지로 아이패드가 /api/remote/relay 로 흘려주는
   화면을 그대로 받아 그린다(slot: word/sent/cutout). 아이패드 쪽 배선은 아직
   연결되지 않았으므로, 지금은 "아이패드가 리모트를 켜기 전" 빈 상태가 정상이다. */

const COARSE = typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches;

const STAR_PATH = "M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z";
const CHEV_DOWN = "M6 9l6 6 6-6";
const CHEV_LEFT = "M15 5L8 12l7 7";
const SEND_PATH = "M12 19V5M5 12l7-7 7 7";

const CONN = {
  idle: { label: "대기 중", dot: "#8E8A81" },
  connected: { label: "연결됨", dot: "var(--t-mark2)" },
  reconnecting: { label: "재연결 중", dot: "var(--t-star)" },
  disconnected: { label: "연결 끊김", dot: "var(--t-warnDot)" },
};

function jfetch(url, opts) {
  return fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || String(r.status));
    return r.json();
  });
}

export default function Remote() {
  /* ── 로그인 ── */
  const [authed, setAuthed] = useState(null);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const pwRef = useRef(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((j) => setAuthed(!!j.authed)).catch(() => setAuthed(false));
  }, []);

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
  const pwKey = (k) => {
    setPwErr("");
    const nv = k === "del" ? pw.slice(0, -1) : pw.length >= 6 || !/^\d$/.test(k) ? pw : pw + k;
    setPw(nv);
    if (nv.length === 6) submitPw(nv);
    if (!COARSE) pwRef.current?.focus();
  };

  /* ── 서버 상태(SSE) ── */
  const [esState, setEsState] = useState("idle"); // idle(연결 전) | connected | reconnecting
  const [mode, setMode] = useState({ on: false, doc: null });
  const [sessions, setSessions] = useState([]);
  const [cur, setCur] = useState("");
  const [relay, setRelay] = useState({}); // slot -> {seq, payload}

  useEffect(() => {
    if (authed !== true) return;
    let everOpen = false;
    const es = new EventSource("/api/remote/stream");
    es.onopen = () => { everOpen = true; setEsState("connected"); };
    es.onerror = () => setEsState(everOpen ? "reconnecting" : "idle");
    es.addEventListener("hello", (e) => {
      const d = JSON.parse(e.data);
      setMode(d.mode || { on: false, doc: null });
      setSessions(d.sessions || []);
      setCur(d.cur || "");
    });
    es.addEventListener("mode", (e) => setMode(JSON.parse(e.data)));
    es.addEventListener("page", (e) => setMode((m) => ({ ...m, doc: JSON.parse(e.data) })));
    es.addEventListener("sess-new", (e) => {
      const s = JSON.parse(e.data);
      setSessions((arr) => [s, ...arr.filter((x) => x.id !== s.id)]);
      setCur(s.id); // 서버가 새 세션을 만들면서 cur 로 삼는다(remote.js) — 별도 이벤트 없이 따라간다
    });
    es.addEventListener("sess-cur", (e) => setCur(JSON.parse(e.data).id));
    es.addEventListener("sess-del", (e) => {
      const { id } = JSON.parse(e.data);
      setSessions((arr) => arr.filter((x) => x.id !== id));
    });
    es.addEventListener("sess-patch", (e) => {
      const { id, patch } = JSON.parse(e.data);
      setSessions((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    });
    es.addEventListener("sess-msgs", (e) => {
      const { id, msgs } = JSON.parse(e.data);
      setSessions((arr) => arr.map((s) => (s.id === id ? { ...s, msgs: [...s.msgs, ...msgs] } : s)));
    });
    es.addEventListener("sess-msg-patch", (e) => {
      const { id, i, patch } = JSON.parse(e.data);
      setSessions((arr) => arr.map((s) => {
        if (s.id !== id) return s;
        const msgs = s.msgs.slice();
        if (msgs[i]) msgs[i] = { ...msgs[i], ...patch };
        return { ...s, msgs };
      }));
    });
    for (const slot of ["word", "sent", "cutout"]) {
      es.addEventListener("relay:" + slot, (e) => {
        const d = JSON.parse(e.data);
        setRelay((r) => (r[slot] && d.seq < r[slot].seq ? r : { ...r, [slot]: d }));
      });
    }
    return () => es.close();
  }, [authed]);

  const connState = esState !== "connected" ? esState : mode.on ? "connected" : "idle";
  const connMeta = CONN[connState] || CONN.idle;

  /* ── 서재 ── */
  const [lib, setLib] = useState({ folders: [], files: [] });
  const [openFolders, setOpenFolders] = useState({});
  useEffect(() => {
    if (authed !== true) return;
    fetch("/api/library").then((r) => r.json()).then((j) => {
      setLib(j);
      setOpenFolders(Object.fromEntries((j.folders || []).map((f) => [f.id, true])));
    }).catch(() => {});
  }, [authed]);

  const recentFiles = useMemo(
    () => [...lib.files].sort((a, b) => (b.lastOpenedAt || b.at || 0) - (a.lastOpenedAt || a.at || 0)).slice(0, 5),
    [lib.files]
  );

  /* ── 단어장 · 조회 기록(기록 탭) ── */
  const [vocab, setVocab] = useState([]);
  const [lookups, setLookups] = useState([]);
  const refreshHistory = () => {
    fetch("/api/vocab").then((r) => r.json()).then((j) => setVocab(j.words || [])).catch(() => {});
    fetch("/api/lookups").then((r) => r.json()).then((j) => setLookups((j.items || []).slice(0, 40))).catch(() => {});
  };
  useEffect(() => { if (authed === true) refreshHistory(); }, [authed]);

  /* ── 화면 · 탭 ── */
  const [screen, setScreen] = useState("library"); // library | panel
  const [tab, setTab] = useState("word"); // word | ask | log
  const goPanel = () => setScreen("panel");

  /* ── 모델 목록 · 상태 ── */
  const [models, setModels] = useState([]);
  const [defModel, setDefModel] = useState("");
  const [health, setHealth] = useState({});
  const [healthBusy, setHealthBusy] = useState(false);
  const [selModel, setSelModel] = useState("");
  const [mdlMenuOpen, setMdlMenuOpen] = useState(false);
  useEffect(() => {
    if (authed !== true) return;
    fetch("/api/models").then((r) => r.json()).then((j) => {
      setModels(Array.isArray(j.models) ? j.models : []);
      setDefModel(j.default || "");
      if (j.health) setHealth(j.health);
    }).catch(() => {});
  }, [authed]);
  const healthReq = useRef(false);
  const refreshHealthNow = () => {
    if (healthReq.current) return;
    healthReq.current = true;
    setHealthBusy(true);
    fetch("/api/models").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.health) setHealth(j.health); })
      .catch(() => {}).finally(() => { healthReq.current = false; setHealthBusy(false); });
  };
  useEffect(() => {
    if (!mdlMenuOpen) return;
    const t = setInterval(refreshHealthNow, 2000);
    return () => clearInterval(t);
  }, [mdlMenuOpen]);
  const healthOf = (id) => {
    const h = health[id];
    if (!h) return healthBusy ? { cls: "wait", text: "측정 중" } : null;
    if (h.ok) return h.ms > 4000 ? { cls: "busy", text: "혼잡" } : { cls: "ok", text: "정상" };
    if (h.status >= 429) return { cls: "jam", text: "붐빔" };
    if (h.status === -1) return { cls: "busy", text: "느림" };
    return { cls: "jam", text: "응답 없음" };
  };
  const defLabel = models.find((m) => m.id === defModel)?.label || "";

  /* ── 세션(질문 탭) ── */
  const sess = sessions.find((s) => s.id === cur) || null;
  const [sessMenuOpen, setSessMenuOpen] = useState(false);
  const [delId, setDelId] = useState(""); // 두 번 눌러야 지워지는 확인창(두 상태 다 로컬)
  const delRef = useRef(null);
  const tapDel = (id, fn) => {
    if (delId === id) { setDelId(""); clearTimeout(delRef.current); fn(); return; }
    setDelId(id);
    clearTimeout(delRef.current);
    delRef.current = setTimeout(() => setDelId(""), 2600);
  };
  const newSess = () => jfetch("/api/remote/sessions", { method: "POST", body: JSON.stringify({ title: "새 대화" }) }).catch(() => {});
  const delSess = (id) => jfetch(`/api/remote/sessions/${id}`, { method: "DELETE" }).catch(() => {});
  const pickSess = (id) => jfetch("/api/remote/cur", { method: "POST", body: JSON.stringify({ id }) }).catch(() => {});

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

  /* ── 질문 입력 ── */
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const [image, setImage] = useState(null); // { blob, url }
  const fileRef = useRef(null);
  const [expandSet, setExpandSet] = useState(new Set());

  const onPickImage = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImage({ blob: f, url: URL.createObjectURL(f) });
  };
  const clearImage = () => { if (image) URL.revokeObjectURL(image.url); setImage(null); };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatErr("");
    try {
      let sid = cur;
      if (!sid) {
        const s = await jfetch("/api/remote/sessions", { method: "POST", body: JSON.stringify({ title: text.slice(0, 40) }) });
        sid = s.id;
      }
      let imgId = "";
      if (image) {
        const up = await fetch(`/api/remote/sessions/${sid}/image`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: image.blob,
        }).then((r) => { if (!r.ok) throw new Error("업로드 실패"); return r.json(); });
        imgId = up.id;
      }
      await jfetch(`/api/remote/sessions/${sid}/msgs`, {
        method: "POST",
        body: JSON.stringify({
          msgs: [
            { role: "user", text, at: Date.now(), model: selModel, img: imgId || undefined },
            { role: "assistant", text: "", at: Date.now(), pending: true },
          ],
        }),
      });
      setChatInput("");
      clearImage();
    } catch (e) {
      setChatErr(e.message || "전송하지 못했습니다.");
    } finally {
      setChatBusy(false);
    }
  };

  const pairs = useMemo(() => {
    const msgs = sess?.msgs || [];
    const out = [];
    for (let i = 0; i < msgs.length; i += 2) out.push({ i, q: msgs[i], a: msgs[i + 1] });
    return out.reverse();
  }, [sess]);

  /* ── 단어 탭 ── */
  const word = relay.word?.payload || null;
  const savedWord = word && vocab.find((v) => v.word.toLowerCase() === (word.head || "").toLowerCase());
  const toggleSaveWord = () => {
    if (!word) return;
    if (savedWord) {
      jfetch(`/api/vocab/${savedWord.id}`, { method: "DELETE" }).then(refreshHistory).catch(() => {});
    } else {
      jfetch("/api/vocab", {
        method: "POST",
        body: JSON.stringify({
          word: word.head, mean: (word.senses || []).join(" / "), ctx: word.ctx,
          quote: word.quote, doc: word.doc || mode.doc?.name || "",
        }),
      }).then(refreshHistory).catch(() => {});
    }
  };
  const [sentOpen, setSentOpen] = useState(false);
  const askAboutWord = () => {
    if (!word) return;
    setChatInput(`"${word.head}" — `);
    setTab("ask");
  };

  if (authed === null) return <div className="vb-root vb-rm" />;

  if (authed === false) {
    return (
      <div className="vb-root vb-rm">
        <div className="vb-modal" style={{ zIndex: 100 }}>
          <form className="vb-card" onSubmit={(e) => { e.preventDefault(); submitPw(pw); }}>
            <h3>여백 리모트</h3>
            <p className="vb-sub">숫자 6자리 비밀번호를 입력하세요. 6자리가 다 차면 자동으로 들어갑니다.</p>
            <div className="vb-field">
              <label>비밀번호</label>
              <input ref={pwRef} type="password" inputMode="numeric" autoFocus={!COARSE}
                className="pw6" maxLength={6} value={pw} spellCheck={false} autoCapitalize="off" autoCorrect="off"
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
                <button key={d} type="button" className="vb-key" onClick={() => pwKey(d)}>{d}</button>
              ))}
              <button type="button" className="vb-key sm" onClick={() => pwKey("del")} aria-label="지우기">⌫</button>
              <button type="button" className="vb-key" onClick={() => pwKey("0")}>0</button>
              <button type="submit" className="vb-key go" disabled={pwBusy || !pw} aria-label="들어가기">↵</button>
            </div>
            {pwErr && <p className="vb-sub" style={{ color: "#E4713F", margin: "14px 0 0" }}>{pwErr}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="vb-root vb-rm">
      {screen === "library" && (
        <div className="vb-rm-lib">
          <div className="vb-rm-brand">
            <svg width="26" height="26" viewBox="0 0 128 128">
              <rect width="128" height="128" rx="28" fill="var(--paper)" />
              <rect x="84" y="26" width="1.6" height="76" fill="var(--t-mark2)" opacity="0.7" />
              <rect x="26" y="38" width="46" height="5" rx="2.5" fill="#15130F" />
              <rect x="26" y="55" width="46" height="5" rx="2.5" fill="#15130F" />
              <rect x="26" y="72" width="30" height="5" rx="2.5" fill="#15130F" />
              <circle cx="102" cy="57.5" r="8" fill="var(--mark)" />
            </svg>
            <div style={{ fontFamily: "var(--serif)", fontSize: 19, letterSpacing: ".05em", color: "var(--t-ink)" }}>여백</div>
          </div>

          <div className="vb-rm-hero">
            <div className="vb-greet" style={{ padding: "26px 0 0" }}>
              <div className="vb-greetstamp">리모트</div>
              <div className="vb-greetline" style={{ fontSize: 26 }}>
                {mode.on && mode.doc ? "아이패드가 지금 읽고 있어요." : "아이패드에서 리모트를 켜지 않았어요."}
              </div>
              <div className="vb-greetsub">
                {mode.on && mode.doc
                  ? `《${mode.doc.name}》 ${mode.doc.page}쪽을 보고 있습니다.`
                  : "아이패드의 여백 앱에서 리모트 모드를 켜면 여기서 단어·질문·기록을 이어볼 수 있어요."}
              </div>
              <button className="vb-rm-cta" onClick={goPanel}>리모트 시작 →</button>
            </div>
          </div>

          <div className="vb-rm-scroll">
            {recentFiles.length > 0 && (
              <>
                <div className="vb-rm-sec"><span>최근 본 자료</span><b /></div>
                {recentFiles.map((f) => (
                  <button key={f.id} className="vb-rm-mat" onClick={goPanel}>
                    <div className="vb-rm-thumb">
                      {f.thumb ? <img src={`/api/library/thumb/${f.id}`} alt="" /> : null}
                      <i style={{ background: f.id === mode.doc?.id ? "var(--mark)" : "var(--t-line2)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vb-rm-mtitle">{f.name}</div>
                      <div className="vb-rm-msub">{f.lastPage || 1}쪽 · {fmtRel(f.lastOpenedAt || f.at)}</div>
                    </div>
                  </button>
                ))}
              </>
            )}

            <div className="vb-rm-sec"><span>전체 파일</span><b /></div>
            {lib.folders.map((fo) => (
              <div key={fo.id}>
                <button className="vb-rm-tree" onClick={() => setOpenFolders((s) => ({ ...s, [fo.id]: !s[fo.id] }))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    style={{ transform: `rotate(${openFolders[fo.id] ? 90 : 0}deg)`, transition: "transform .15s" }}>
                    <path d={CHEV_DOWN} stroke="var(--t-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-90 12 12)" />
                  </svg>
                  <span className="vb-rm-tname" style={{ color: "var(--t-sub)" }}>{fo.name}</span>
                </button>
                {openFolders[fo.id] && lib.files.filter((f) => f.folder === fo.id).map((f) => (
                  <button key={f.id} className="vb-rm-tree" style={{ paddingLeft: 26 }} onClick={goPanel}>
                    <span className="vb-rm-tname">{f.name}</span>
                  </button>
                ))}
              </div>
            ))}
            {lib.files.filter((f) => !f.folder).map((f) => (
              <button key={f.id} className="vb-rm-tree" onClick={goPanel}>
                <span className="vb-rm-tname">{f.name}</span>
              </button>
            ))}
            {!lib.folders.length && !lib.files.length && (
              <div className="vb-ph">서재가 비어 있습니다. 아이패드에서 PDF를 추가해 보세요.</div>
            )}
          </div>
        </div>
      )}

      {screen === "panel" && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="vb-rm-top">
            <button className="vb-rm-back" onClick={() => setScreen("library")} aria-label="서재로">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d={CHEV_LEFT} stroke="var(--t-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div className="vb-rm-doc">
              <div className="vb-rm-dtitle">{mode.doc?.name || "문서 없음"}</div>
              <div className="vb-rm-dpage">{mode.doc ? `${mode.doc.page}쪽 읽는 중` : "대기 중"}</div>
            </div>
            <div className="vb-rm-status">
              <div className="vb-rm-dot" style={{ background: connMeta.dot }} />
              <span>{connMeta.label}</span>
            </div>
          </div>

          {!mode.on && (
            <div className="vb-rm-banner warn">
              <div className="vb-rm-dot" style={{ background: CONN.disconnected.dot }} />
              <div>
                <div className="vb-rm-btitle">아이패드가 리모트를 켜지 않았어요</div>
                <div className="vb-rm-bsub">아이패드의 여백 앱에서 리모트 모드를 켜면 자동으로 이어집니다.</div>
              </div>
            </div>
          )}

          <div className="vb-rm-tabs">
            <div className="vb-seg2">
              {[["word", "단어"], ["ask", "질문"], ["log", "기록"]].map(([k, label]) => (
                <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
          </div>

          {tab === "word" && (
            <div className="vb-panes">
              <div className="vb-pe" style={{ padding: "0 20px" }}>
                {!word ? (
                  <div className="vb-ph">아이패드에서 리모트를 켜고 단어를 탭하면 여기에 뜻이 나타납니다.</div>
                ) : (
                  <div className="vb-wpane">
                    <div className="vb-head">
                      <div>
                        <div className="vb-hw">{word.head}</div>
                        {word.pos && <span className="vb-pos">{word.pos}</span>}
                      </div>
                      <button className={"vb-star" + (savedWord ? " on" : "")} onClick={toggleSaveWord}
                        aria-label={savedWord ? "단어장에서 빼기" : "단어장에 담기"}>
                        <svg viewBox="0 0 24 24"><path d={STAR_PATH} /></svg>
                      </button>
                    </div>
                    <div className="vb-accbox">
                      <p className="vb-lbl">이 문맥에서</p>
                      <p className={"vb-acctxt" + (word.live ? " vb-cur" : "")}>{word.ctx}</p>
                      {word.err && <p className="vb-err">답을 받지 못했습니다 — {word.err}</p>}
                    </div>
                    {!!(word.senses || []).length && (
                      <>
                        <p className="vb-lbl" style={{ marginTop: 22 }}>사전</p>
                        <ol className="vb-senses">
                          {word.senses.map((s, i) => <li key={i}><i>{i + 1}</i><span>{s}</span></li>)}
                        </ol>
                      </>
                    )}
                    {word.quote && (
                      <>
                        <p className="vb-lbl" style={{ marginTop: 22 }}>원문{word.page ? ` · ${word.page}쪽` : ""}</p>
                        <p className="vb-quote">{word.quote}</p>
                      </>
                    )}
                    <div className="vb-wacts">
                      <button className="vb-wactbtn" onClick={() => setSentOpen((v) => !v)}>문장 해석</button>
                      <button className="vb-wactbtn" onClick={askAboutWord}>이 낱말로 질문</button>
                    </div>
                    {sentOpen && (
                      <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: "var(--t-glass)", border: "1px solid var(--t-line2)" }}>
                        <p className="vb-lbl">해석</p>
                        <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.7, color: "var(--t-ink)" }}>
                          {relay.sent?.payload?.text || "아이패드 응답을 기다리는 중…"}
                        </p>
                      </div>
                    )}
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
                    <button className={"vb-sessbtn" + (sessMenuOpen ? " open" : "")} onClick={() => setSessMenuOpen((v) => !v)}>
                      <i />
                      <span>{sess ? sess.title : "대화 없음"}</span>
                      <svg viewBox="0 0 24 24"><path d={CHEV_DOWN} /></svg>
                    </button>
                    {sessMenuOpen && (
                      <div className="vb-dropmenu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 220, zIndex: 5 }}>
                        <div className="vb-dropscroll">
                          {sessions.length === 0 && <div className="vb-dropfoot">대화가 없습니다.</div>}
                          {sessions.map((s) => (
                            <div key={s.id} className={"vb-sessitem" + (s.id === cur ? " on" : "")}
                              style={{ cursor: "pointer" }}
                              onClick={() => { pickSess(s.id); setSessMenuOpen(false); }}>
                              <i />
                              <span className="t">{s.title}</span>
                              <span className="m">{fmtDate(s.at)}</span>
                              <button className={"x" + (delId === "rs" + s.id ? " ask" : "")}
                                onClick={(e) => { e.stopPropagation(); tapDel("rs" + s.id, () => delSess(s.id)); }}
                                aria-label="대화 삭제">
                                {delId === "rs" + s.id ? "삭제?" : "✕"}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="vb-dropfoot">대화는 마지막 질문에서 2시간 뒤 사라집니다.</div>
                      </div>
                    )}
                  </div>
                  <button className="vb-newsess" onClick={() => { newSess(); setSessMenuOpen(false); }}>＋ 새 대화</button>
                </div>

                <div className="vb-composer">
                  <textarea className="vb-askin" rows={1} value={chatInput}
                    placeholder="이 자료에 대해 물어보세요"
                    onChange={(e) => setChatInput(e.target.value)} />
                  <button className="vb-send" disabled={chatBusy || !chatInput.trim()} onClick={sendChat} aria-label="보내기">
                    <svg viewBox="0 0 24 24"><path d={SEND_PATH} /></svg>
                  </button>
                </div>

                <div className="vb-attrow">
                  {image && (
                    <span className="vb-rm-attach">
                      <img src={image.url} alt="" />
                      이미지 1개
                      <button onClick={clearImage} aria-label="첨부 빼기">✕</button>
                    </span>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
                  <button className="vb-capchip" onClick={() => fileRef.current?.click()}>＋ 이미지 첨부</button>
                  {models.length > 0 && (
                    <div style={{ position: "relative", marginLeft: "auto" }}>
                      <button className={"vb-mdlbtn" + (mdlMenuOpen ? " open" : "")}
                        onClick={() => { const o = !mdlMenuOpen; setMdlMenuOpen(o); if (o) refreshHealthNow(); }}>
                        {selModel ? (models.find((m) => m.id === selModel)?.label || "모델") : `기본${defLabel ? " — " + defLabel : ""}`}
                        <svg viewBox="0 0 24 24"><path d={CHEV_DOWN} /></svg>
                      </button>
                      {mdlMenuOpen && (
                        <div className="vb-dropmenu" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 250, zIndex: 5 }}>
                          <div className="vb-dropscroll">
                            <button className={"vb-mdlitem" + (!selModel ? " on" : "")} onClick={() => { setSelModel(""); setMdlMenuOpen(false); }}>
                              <span className="vb-mdlrow">
                                <span className="n">기본{defLabel ? ` — ${defLabel}` : ""}</span>
                                {!selModel && <span className="c">✓</span>}
                              </span>
                            </button>
                            {models.map((m) => {
                              const hp = healthOf(m.id);
                              return (
                                <button key={m.id} className={"vb-mdlitem" + (selModel === m.id ? " on" : "")}
                                  onClick={() => { setSelModel(m.id); setMdlMenuOpen(false); }}>
                                  <span className="vb-mdlrow">
                                    <span className="n">{m.label}</span>
                                    {m.id === defModel && <span className="d">기본</span>}
                                    {hp && <span className={"vb-mdlhp " + hp.cls}><i />{hp.text}</span>}
                                    {selModel === m.id && <span className="c">✓</span>}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="vb-dropfoot">아이패드가 이 선택으로 질문 탭 모델을 부릅니다.</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {chatErr && <p className="vb-err" style={{ marginTop: 8 }}>{chatErr}</p>}
              </div>

              <div className="vb-scroll">
                {pairs.length === 0 ? (
                  <div className="vb-ph">
                    <p>여기서 물어보면 아이패드가 지금 보고 있는 페이지를 근거로 답합니다.</p>
                    <p style={{ margin: 0 }}>아이패드가 리모트를 켜고 있어야 답이 옵니다 — 꺼져 있어도 질문은 쌓아 둘 수 있어요.</p>
                  </div>
                ) : (
                  <>
                    <div className="vb-recent">최신<b /></div>
                    {pairs.map((p, k) => {
                      const latest = k === 0;
                      const ek = (sess?.id || "") + ":" + p.i;
                      const expanded = latest || expandSet.has(ek);
                      const pending = p.a?.pending && !p.a?.text;
                      return (
                        <div key={p.i} className={"vb-qa" + (latest ? " vb-pe" : " past" + (expanded ? " open" : ""))}>
                          {p.q?.img && <img className="vb-msgimg" src={`/api/remote/sessions/${sess.id}/image/${p.q.img}`} alt="첨부 이미지" />}
                          <div className="vb-qbubble">{p.q?.text}</div>
                          {pending ? (
                            <div className="vb-abody">
                              <span className="vb-err" style={{ color: "var(--t-muted)" }}>
                                {mode.on ? "아이패드가 답하는 중…" : "아이패드가 리모트를 켜면 답합니다…"}
                              </span>
                            </div>
                          ) : p.a?.text || p.a?.err ? (
                            <div className={"vb-abody" + (!expanded ? " clamp" : "")}>
                              {p.a.text && <Rich text={p.a.text} live={false} />}
                              {p.a.err && <span className="vb-err">{p.a.text ? p.a.err : `답을 받지 못했습니다 — ${p.a.err}`}</span>}
                            </div>
                          ) : null}
                          {!latest && p.a?.text && (
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
            <div className="vb-rm-hist">
              <div className="vb-lhead"><span>단어장</span><b /></div>
              {vocab.length === 0 ? (
                <div className="vb-ph">★ 로 담은 단어가 여기 모입니다.</div>
              ) : vocab.slice(0, 30).map((v) => (
                <div key={v.id} className="vb-litem" style={{ cursor: "default" }}>
                  <span className="vb-lrow">
                    <i className="vb-ldot" style={{ background: "var(--t-star)" }} />
                    <span className="vb-ltitle" style={{ fontFamily: "var(--serif)" }}>{v.word}</span>
                    <span className="vb-lat">{fmtDate(v.at)}</span>
                  </span>
                  {v.mean && <span className="vb-lsub">{v.mean}</span>}
                </div>
              ))}

              <div className="vb-lhead" style={{ marginTop: 20 }}><span>조회 기록</span><b /></div>
              {lookups.length === 0 ? (
                <div className="vb-ph">단어를 탭해 찾아본 기록이 여기 모입니다.</div>
              ) : lookups.map((it) => (
                <div key={it.id} className="vb-litem" style={{ cursor: "default" }}>
                  <span className="vb-lrow">
                    <i className="vb-ldot" style={{ background: "var(--t-mark2)" }} />
                    <span className="vb-ltitle">{it.word}</span>
                    <span className="vb-lat">{fmtRel(it.at)}</span>
                  </span>
                  <span className="vb-lsub">{it.doc}{it.mean ? ` · ${it.mean}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
