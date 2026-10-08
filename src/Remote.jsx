import { useState, useRef, useEffect, useMemo } from "react";
import "./App.css";
import { ThinkingOrb } from "thinking-orbs";
import AskView, { imageToJpeg } from "./AskView.jsx";
import Bi from "./icons.jsx";
import { fmtRel } from "./App.jsx";
import { u } from "./paths.js";

/* ───────────────────────── 여백 리모트 (폰) ─────────────────────────
   아이패드(또는 PC)가 모델을 부르는 실행자고 폰은 곁 화면이다 — 이 화면은 /api/chat 을 부르지 않는다.
   - 질문: 대화는 서버 한 곳(server/remote.js)에 있어 아이패드와 같은 대화를 본다. 폰이 질문을 남기면
     (답 자리 pending) 문서를 연 기기가 맡아 답하고, 흐르는 답은 relay("ask")로 그대로 보인다.
   - 단어·문장: 아이패드가 리모트 모드를 켜면 탭한 단어의 뜻이 relay("word"/"sent")로 흘러온다.
   - 서재: 폰 혼자서도 되는 것(파일 보기·내려받기).
   화면은 아래 탭 막대 네 칸(서재·단어·질문·기록) + 위의 기기 상태 한 줄. */

const COARSE = typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches;

function jfetch(url, opts) {
  return fetch(u(url), {   // 서브패스 보정은 여기 한 곳에서 — paths.js 참고
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || String(r.status));
    return r.json();
  });
}

function FileRow({ f, sub, onMenu, menuOpen, live }) {
  return (
    <div className="vb-rp-file">
      <a className="vb-rp-filetap" href={u(`/api/library/file/${f.id}`)} target="_blank" rel="noopener noreferrer">
        <span className="vb-rp-thumb">
          {f.thumb ? <img src={u(`/api/library/thumb/${f.id}`)} alt="" /> : <Bi name="journal-text" />}
          {live && <i />}
        </span>
        <span className="vb-rp-fmeta">
          <span className="t">{f.name}</span>
          {sub && <span className="s">{sub}</span>}
        </span>
      </a>
      <div className="vb-rp-fmenuwrap">
        <button className="vb-rp-fmenu" onClick={(e) => { e.stopPropagation(); onMenu(); }} aria-label="파일 메뉴">⋯</button>
        {menuOpen && (
          <div className="vb-ak-pop vb-rp-filepop" style={{ right: 0, width: 170 }}>
            <a href={u(`/api/library/file/${f.id}`)} target="_blank" rel="noopener noreferrer">새 탭에서 보기</a>
            <a href={u(`/api/library/file/${f.id}?dl=1`)}>내려받기</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Remote() {
  const theme = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

  /* ── 로그인 ── */
  const [authed, setAuthed] = useState(null);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const pwRef = useRef(null);
  useEffect(() => {
    fetch(u("/api/me")).then((r) => r.json()).then((j) => setAuthed(!!j.authed)).catch(() => setAuthed(false));
  }, []);
  const submitPw = async (v) => {
    if (pwBusy || !v) return;
    setPwBusy(true);
    setPwErr("");
    try {
      const r = await fetch(u("/api/login"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: v }),
      });
      if (!r.ok) {
        let d = "";
        try { d = (await r.json()).error || ""; } catch {}
        setPwErr(d || "비밀번호가 맞지 않아요.");
        setPw("");
        return;
      }
      setPw("");
      setAuthed(true);
    } catch {
      setPwErr("서버에 연결하지 못했어요.");
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
  const [online, setOnline] = useState(false);
  const [mode, setMode] = useState({ on: false, doc: null });
  const [presence, setPresence] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [cur, setCur] = useState("");
  const [relay, setRelay] = useState({}); // slot -> {seq, payload}
  const [peerLive, setPeerLive] = useState(null); // 아이패드가 흘리는 답 { sid, i, text, run, device }
  const [lastRun, setLastRun] = useState(null);
  const curRef = useRef("");
  useEffect(() => { curRef.current = cur; }, [cur]);

  useEffect(() => {
    if (authed !== true) return;
    const es = new EventSource(u("/api/remote/stream"));
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    const patchS = (id, fn) => setSessions((arr) => arr.map((s) => (s.id === id ? fn(s) : s)));
    es.addEventListener("hello", (e) => {
      const d = JSON.parse(e.data);
      setMode(d.mode || { on: false, doc: null });
      setPresence(d.presence || []);
      const ls = d.sessions || [];
      setSessions(ls);
      setCur((c) => (ls.some((s) => s.id === c) ? c : ls[0]?.id || ""));
    });
    es.addEventListener("mode", (e) => setMode(JSON.parse(e.data)));
    es.addEventListener("page", (e) => setMode((m) => ({ ...m, doc: JSON.parse(e.data) })));
    es.addEventListener("presence", (e) => setPresence(JSON.parse(e.data)));
    es.addEventListener("sess-new", (e) => {
      const s = JSON.parse(e.data);
      setSessions((arr) => [s, ...arr.filter((x) => x.id !== s.id)]);
      setCur(s.id); // 폰은 곁 화면이라 어디서 열린 새 대화든 따라간다(아이패드에서 오려낸 문제가 곧바로 뜬다)
    });
    es.addEventListener("sess-del", (e) => {
      const { id } = JSON.parse(e.data);
      setSessions((arr) => {
        const left = arr.filter((x) => x.id !== id);
        if (curRef.current === id) setCur(left[0]?.id || "");
        return left;
      });
    });
    es.addEventListener("sess-patch", (e) => {
      const { id, patch } = JSON.parse(e.data);
      patchS(id, (s) => ({ ...s, ...patch, at: Date.now() }));
    });
    es.addEventListener("sess-msgs", (e) => {
      const { id, from, msgs } = JSON.parse(e.data);
      patchS(id, (s) => (s.msgs.length >= from + msgs.length ? s : { ...s, at: Date.now(), msgs: [...s.msgs.slice(0, from), ...msgs] }));
    });
    es.addEventListener("sess-msg-patch", (e) => {
      const { id, i, patch } = JSON.parse(e.data);
      patchS(id, (s) => ({ ...s, msgs: s.msgs.map((m, k) => (k === i ? { ...m, ...patch } : m)) }));
    });
    es.addEventListener("relay:ask", (e) => {
      const { payload } = JSON.parse(e.data);
      if (!payload) return;
      if (payload.done) {
        setPeerLive((p) => {
          if (p?.run) setLastRun({ ...p.run, running: false, end: Date.now(), device: p.device,
            outcome: p.run.outcome || (p.run.phase === "stream" ? "done" : "error") });
          return null;
        });
      } else setPeerLive(payload);
    });
    for (const slot of ["word", "sent"]) {
      es.addEventListener("relay:" + slot, (e) => {
        const d = JSON.parse(e.data);
        setRelay((r) => (r[slot] && d.seq < r[slot].seq ? r : { ...r, [slot]: d }));
      });
    }
    return () => es.close();
  }, [authed]);

  // 답할 수 있는 기기 = 문서를 연 채로 출석한 기기(가장 최근 것)
  const reader = useMemo(() => [...presence].filter((p) => p.doc).sort((a, b) => b.at - a.at)[0] || null, [presence]);

  /* ── 서재 ── */
  const [lib, setLib] = useState({ folders: [], files: [] });
  const [openFolders, setOpenFolders] = useState({});
  const [fileMenu, setFileMenu] = useState("");
  useEffect(() => {
    if (authed !== true) return;
    fetch(u("/api/library")).then((r) => r.json()).then((j) => {
      setLib(j);
      setOpenFolders(Object.fromEntries((j.folders || []).map((f) => [f.id, false])));
    }).catch(() => {});
  }, [authed]);
  useEffect(() => {
    if (!fileMenu) return;
    const onDown = (e) => { if (!e.target.closest(".vb-rp-fmenuwrap")) setFileMenu(""); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [fileMenu]);
  const recentFiles = useMemo(
    () => [...lib.files].sort((a, b) => (b.lastOpenedAt || b.at || 0) - (a.lastOpenedAt || a.at || 0)).slice(0, 4),
    [lib.files]
  );
  const readingFile = reader?.doc?.id ? lib.files.find((f) => f.id === reader.doc.id) : null;

  /* ── 단어장 · 조회 기록 ── */
  const [vocab, setVocab] = useState([]);
  const [lookups, setLookups] = useState([]);
  const refreshHistory = () => {
    fetch(u("/api/vocab")).then((r) => r.json()).then((j) => setVocab(j.words || [])).catch(() => {});
    fetch(u("/api/lookups")).then((r) => r.json()).then((j) => setLookups((j.items || []).slice(0, 40))).catch(() => {});
  };
  useEffect(() => { if (authed === true) refreshHistory(); }, [authed]);

  /* ── 탭 ── */
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("yeobaek.rtab") || "ask"; } catch { return "ask"; }
  });
  const go = (t) => { setTab(t); try { localStorage.setItem("yeobaek.rtab", t); } catch {} if (t === "log") refreshHistory(); };

  /* ── 모델 ── */
  const [models, setModels] = useState([]);
  const [askRank, setAskRank] = useState([]);
  const [defModel, setDefModel] = useState("");
  const [health, setHealth] = useState({});
  const [selModel, setSelModel] = useState(() => {
    try { return localStorage.getItem("yeobaek.rmodel") || ""; } catch { return ""; }
  });
  const loadModels = () => fetch(u("/api/models")).then((r) => r.json()).then((j) => {
    setModels(Array.isArray(j.models) ? j.models : []);
    setAskRank(Array.isArray(j.askRank) ? j.askRank : []);
    setDefModel(j.default || "");
    if (j.health) setHealth(j.health);
  }).catch(() => {});
  useEffect(() => { if (authed === true) loadModels(); }, [authed]);
  useEffect(() => { if (lastRun) loadModels(); }, [lastRun]); // 답이 끝나면 자동 순서가 바뀌었을 수 있다
  const healthOf = (id) => {
    const h = health[id];
    if (!h) return null;
    if (h.ok) return h.ms > 4000 ? { cls: "busy", text: "혼잡" } : { cls: "ok", text: "정상" };
    if (h.status >= 429) return { cls: "jam", text: "붐빔" };
    if (h.status === -1 || h.status === 408) return { cls: "busy", text: "느림" };
    return { cls: "jam", text: "응답 없음" };
  };
  const pickModel = (id) => { setSelModel(id); try { localStorage.setItem("yeobaek.rmodel", id); } catch {} };

  /* ── 질문 ── */
  const sess = sessions.find((s) => s.id === cur) || null;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [image, setImage] = useState(null); // { blob, url } — 폰에서 고른 그림
  const [useSessImg, setUseSessImg] = useState(true); // 아이패드가 오려 둔 그림을 함께 보낼지
  useEffect(() => { setUseSessImg(true); }, [cur, sess?.img]);
  const fileRef = useRef(null);

  const newSess = (title = "새 대화") =>
    jfetch("/api/remote/sessions", { method: "POST", body: JSON.stringify({ title, extra: { origin: "phone" } }) })
      .then((s) => { setSessions((arr) => [s, ...arr.filter((x) => x.id !== s.id)]); setCur(s.id); return s; });

  const send = async (text) => {
    const q = (typeof text === "string" ? text : input).trim();
    if (!q || busy) return;
    setBusy(true);
    setSendErr("");
    try {
      let sid = sess?.id;
      if (!sid) sid = (await newSess(q.length > 16 ? q.slice(0, 16) + "…" : q)).id;
      let img = "";
      if (image) {
        const r = await fetch(u(`/api/remote/sessions/${sid}/image`), {
          method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: image.blob,
        });
        if (!r.ok) throw new Error("그림을 올리지 못했어요.");
        img = (await r.json()).id;
      } else if (sess?.img && useSessImg) img = sess.img;
      await jfetch(`/api/remote/sessions/${sid}/msgs`, {
        method: "POST",
        body: JSON.stringify({ msgs: [
          { role: "me", text: q, at: Date.now(), model: selModel || undefined, img: img || undefined, from: "phone" },
          { role: "ai", text: "", at: Date.now(), pending: true },
        ] }),
      });
      if (typeof text !== "string") setInput("");
      if (image) { URL.revokeObjectURL(image.url); setImage(null); }
    } catch (e) {
      setSendErr(e.message || "보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const msgs = useMemo(() => {
    const m = sess?.msgs || [];
    if (!peerLive || peerLive.sid !== cur || !m[peerLive.i]) return m;
    return m.map((x, k) => (k === peerLive.i ? { ...x, text: peerLive.text || x.text, pending: true } : x));
  }, [sess, peerLive, cur]);
  const lastAi = msgs.length && msgs[msgs.length - 1]?.role === "ai" ? msgs[msgs.length - 1] : null;
  const answering = !!(lastAi?.pending && !lastAi?.err);
  const run = peerLive?.run?.running ? { ...peerLive.run, device: peerLive.device } : null;

  const stop = () => {
    if (!sess || !lastAi) return;
    jfetch(`/api/remote/sessions/${sess.id}/msgs/${msgs.length - 1}/cancel`, { method: "POST" }).catch(() => {});
  };
  const redo = () => {
    if (!sess || !lastAi) return;
    jfetch(`/api/remote/sessions/${sess.id}/msgs/${msgs.length - 1}`, {
      method: "PATCH",
      body: JSON.stringify({ patch: { text: "", err: "", stopped: false, by: null, swap: null, pending: true, claim: "", claimAt: 0 } }),
    }).catch(() => {});
  };

  const waiting = answering && !peerLive && !lastAi?.claim;
  const notice = sendErr ? (
    <div className="vb-rp-note warn"><Bi name="exclamation-circle" /><span>{sendErr}</span></div>
  ) : !reader ? (
    <div className="vb-rp-note">
      <Bi name="tablet" />
      <span><b>답할 기기가 없어요.</b> 아이패드나 컴퓨터에서 여백으로 문서를 열어 두면 질문에 답해요. 질문은 먼저 남겨 둘 수 있어요.</span>
    </div>
  ) : waiting ? (
    <div className="vb-rp-note"><Bi name="tablet" /><span>{reader.label}에 질문을 넘기는 중이에요…</span></div>
  ) : null;

  /* ── 단어 ── */
  const word = relay.word?.payload || null;
  const sent = relay.sent?.payload || null;
  const savedWord = word && vocab.find((v) => v.word.toLowerCase() === (word.head || "").toLowerCase());
  const toggleSaveWord = () => {
    if (!word) return;
    const p = savedWord
      ? jfetch(`/api/vocab/${savedWord.id}`, { method: "DELETE" })
      : jfetch("/api/vocab", {
        method: "POST",
        body: JSON.stringify({ word: word.head, mean: (word.senses || []).join(" / "), ctx: word.ctx, quote: word.quote, doc: word.doc || reader?.doc?.name || "" }),
      });
    p.then(refreshHistory).catch(() => {});
  };

  /* ───────── 그리기 ───────── */
  if (authed === null) return <div className="vb-root vb-rp" />;

  if (authed === false) {
    return (
      <div className="vb-root vb-rp">
        <div className="vb-modal" style={{ zIndex: 100 }}>
          <form className="vb-card" onSubmit={(e) => { e.preventDefault(); submitPw(pw); }}>
            <h3>여백 리모트</h3>
            <p className="vb-sub">숫자 6자리 비밀번호를 입력하세요. 6자리를 다 누르면 바로 들어가요.</p>
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

  const TABS = [["lib", "서재", "collection"], ["word", "단어", "book"], ["ask", "질문", "chat"], ["log", "기록", "clock-history"]];

  return (
    <div className={"vb-root vb-rp" + (theme === "light" ? " light" : "")}>
      {/* ── 위: 기기 상태 한 줄 ── */}
      <header className="vb-rp-top">
        <span className="vb-rp-brand">여백</span>
        <span className={"vb-rp-dev" + (reader ? " on" : "") + (!online ? " off" : "")}>
          <i />
          {!online ? "서버 연결 끊김"
            : reader ? <><b>{reader.label}</b><span>{reader.doc.name}{reader.doc.page ? ` · ${reader.doc.page}쪽` : ""}</span></>
              : "열린 문서 없음"}
        </span>
      </header>

      <main className="vb-rp-main">
        {tab === "lib" && (
          <div className="vb-rp-scroll">
            {reader && (
              <a className="vb-rp-now" href={readingFile ? u(`/api/library/file/${readingFile.id}`) : undefined}
                target="_blank" rel="noopener noreferrer">
                <span className="vb-rp-nowthumb">
                  {readingFile?.thumb ? <img src={u(`/api/library/thumb/${readingFile.id}`)} alt="" /> : <Bi name="journal-text" />}
                </span>
                <span className="vb-rp-nowmeta">
                  <span className="k">{reader.label}에서 읽는 중</span>
                  <span className="t">{reader.doc.name}</span>
                  <span className="s">{reader.doc.page}쪽{readingFile?.totalPages ? ` / ${readingFile.totalPages}쪽` : ""}</span>
                </span>
              </a>
            )}
            {recentFiles.length > 0 && (
              <>
                <div className="vb-rp-sec">최근 본 자료</div>
                {recentFiles.map((f) => (
                  <FileRow key={f.id} f={f} live={f.id === reader?.doc?.id}
                    sub={`${f.lastPage || 1}쪽 · ${fmtRel(f.lastOpenedAt || f.at)}`}
                    menuOpen={fileMenu === f.id} onMenu={() => setFileMenu((v) => (v === f.id ? "" : f.id))} />
                ))}
              </>
            )}
            <div className="vb-rp-sec">전체 자료</div>
            {lib.folders.map((fo) => {
              const files = lib.files.filter((f) => f.folder === fo.id);
              return (
                <div key={fo.id} className="vb-rp-folder">
                  <button className={"vb-rp-foldtap" + (openFolders[fo.id] ? " open" : "")}
                    onClick={() => setOpenFolders((s) => ({ ...s, [fo.id]: !s[fo.id] }))}>
                    <Bi name="chevron-down" className="chev" />
                    <span className="t">{fo.name}</span>
                    <span className="n">{files.length}</span>
                  </button>
                  {openFolders[fo.id] && files.map((f) => (
                    <FileRow key={f.id} f={f} live={f.id === reader?.doc?.id}
                      sub={`${f.lastPage || 1}쪽 · ${fmtRel(f.lastOpenedAt || f.at)}`}
                      menuOpen={fileMenu === f.id} onMenu={() => setFileMenu((v) => (v === f.id ? "" : f.id))} />
                  ))}
                </div>
              );
            })}
            {lib.files.filter((f) => !f.folder).map((f) => (
              <FileRow key={f.id} f={f} live={f.id === reader?.doc?.id}
                sub={`${f.lastPage || 1}쪽 · ${fmtRel(f.lastOpenedAt || f.at)}`}
                menuOpen={fileMenu === f.id} onMenu={() => setFileMenu((v) => (v === f.id ? "" : f.id))} />
            ))}
            {!lib.folders.length && !lib.files.length && (
              <div className="vb-rp-empty"><Bi name="collection" /><p>서재가 비어 있어요. 아이패드에서 PDF를 추가해 보세요.</p></div>
            )}
          </div>
        )}

        {tab === "word" && (
          <div className="vb-rp-scroll">
            {!word ? (
              <div className="vb-rp-empty">
                <ThinkingOrb state="listening" size={64} theme={theme} aria-label="" />
                <h3>단어를 기다리는 중이에요</h3>
                <p>{mode.on
                  ? "아이패드에서 단어를 탭하면 여기에 뜻이 떠요."
                  : "아이패드 여백의 설정에서 리모트를 켜면, 탭한 단어의 뜻이 여기에 떠요."}</p>
              </div>
            ) : (
              <div className="vb-rp-word vb-pe">
                <div className="vb-rp-whead">
                  <div>
                    <div className="vb-hw">{word.head}</div>
                    {word.pos && <span className="vb-pos">{word.pos}</span>}
                  </div>
                  <button className={"vb-rp-star" + (savedWord ? " on" : "")} onClick={toggleSaveWord}
                    aria-label={savedWord ? "단어장에서 빼기" : "단어장에 담기"}>
                    <Bi name={savedWord ? "star-fill" : "star"} />
                  </button>
                </div>
                <div className="vb-rp-card">
                  <div className="k">이 문맥에서</div>
                  <p className={word.live ? "vb-cur" : ""}>{word.ctx || (word.live ? "" : "—")}</p>
                  {word.err && <p className="err">뜻을 받지 못했어요 · {word.err}</p>}
                </div>
                {!!(word.senses || []).length && (
                  <div className="vb-rp-block">
                    <div className="k">사전</div>
                    <ol className="vb-senses">
                      {word.senses.map((x, i) => <li key={i}><i>{i + 1}</i><span>{x}</span></li>)}
                    </ol>
                  </div>
                )}
                {word.quote && (
                  <div className="vb-rp-block">
                    <div className="k">원문{word.page ? ` · ${word.page}쪽` : ""}</div>
                    <p className="vb-quote">{word.quote}</p>
                  </div>
                )}
                {sent?.text && (
                  <div className="vb-rp-block">
                    <div className="k">문장 해석</div>
                    <p className="vb-rp-sent">{sent.text}</p>
                  </div>
                )}
                <div className="vb-rp-acts">
                  <button onClick={() => { setInput(`"${word.head}" — `); go("ask"); }}>
                    <Bi name="chat" /><span>이 낱말로 질문</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "ask" && (
          <AskView
            theme={theme} active
            sessions={sessions} curId={cur}
            onPickSess={setCur}
            onNewSess={() => { newSess().catch(() => {}); }}
            onDelSess={(id) => jfetch(`/api/remote/sessions/${id}`, { method: "DELETE" }).catch(() => {})}
            msgs={msgs} imgUrl={(id) => u(`/api/remote/sessions/${cur}/image/${id}`)}
            value={input} onChange={setInput} onSend={send}
            onStop={answering ? stop : null} busy={busy || answering}
            placeholder={reader ? `${reader.doc.name} ${reader.doc.page}쪽에 대해 물어보세요` : "물어보세요"}
            empty={{
              title: "폰에서 물어보세요",
              text: reader
                ? `${reader.label}가 지금 보는 ${reader.doc.page}쪽을 근거로 답해요. 아이패드와 같은 대화를 함께 봐요.`
                : "아이패드나 컴퓨터에서 문서를 열어 두면, 그 문서를 근거로 답해요.",
              suggestions: reader ? ["지금 쪽 핵심만 정리해 줘", "이 문서는 어떤 내용이야?"] : [],
            }}
            notice={notice}
            attach={image
              ? { src: image.url, label: "고른 그림", onRemove: () => { URL.revokeObjectURL(image.url); setImage(null); } }
              : sess?.img && useSessImg
                ? { src: u(`/api/remote/sessions/${sess.id}/image/${sess.img}`), label: "오려낸 영역", onRemove: () => setUseSessImg(false) }
                : null}
            capture={{ icon: "image", label: "그림 첨부", onClick: () => fileRef.current?.click() }}
            models={models} askRank={askRank} selModel={selModel} onPickModel={pickModel}
            onModelsOpen={loadModels} healthOf={healthOf} defLabel={models.find((m) => m.id === defModel)?.label || ""}
            run={run} lastRun={lastRun}
            onRedo={redo} canRedo={(p) => !p.q.hist}
            onImage={(f) => imageToJpeg(f).then(({ blob, url }) => {
              setImage((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url }; });
            }).catch((e) => setSendErr(e.message))}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setImage({ blob: f, url: URL.createObjectURL(f) });
          }} />

        {tab === "log" && (
          <div className="vb-rp-scroll">
            <div className="vb-rp-sec">단어장 <em>{vocab.length}</em></div>
            {vocab.length === 0 ? (
              <div className="vb-rp-hint">단어 탭에서 ☆ 을 누르면 여기에 모여요.</div>
            ) : vocab.slice(0, 40).map((v) => (
              <div key={v.id} className="vb-rp-item">
                <span className="t serif">{v.word}</span>
                {v.mean && <span className="s">{v.mean}</span>}
                <span className="m">{fmtRel(v.at)}</span>
              </div>
            ))}
            <div className="vb-rp-sec">찾아본 단어</div>
            {lookups.length === 0 ? (
              <div className="vb-rp-hint">아이패드에서 단어를 탭한 기록이 여기에 모여요.</div>
            ) : lookups.map((it) => (
              <div key={it.id} className="vb-rp-item">
                <span className="t">{it.word}</span>
                <span className="s">{it.doc}{it.mean ? ` · ${it.mean}` : ""}</span>
                <span className="m">{fmtRel(it.at)}</span>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── 아래: 탭 막대 ── */}
      <nav className="vb-rp-tabs">
        {TABS.map(([k, label, icon]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}>
            <span className="ic">
              <Bi name={icon} />
              {k === "word" && word?.live && <i className="dot" />}
              {k === "ask" && answering && tab !== "ask" && <i className="dot" />}
            </span>
            <span className="l">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
