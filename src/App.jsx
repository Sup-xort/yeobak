import { useState, useRef, useEffect, useCallback } from "react";

/* ───────────────────────── 설정 ───────────────────────── */
const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
/* API 키는 전부 서버(.env)에 있다. 브라우저는 /api/chat 만 부른다. */
const DEFAULT_CFG = {
  forceGemini: false,
  useDict: true,
  askModel: "", // 질문 탭 모델. 빈 값이면 서버 기본값
};
const WIDE = 880;
/* 터치 기기 여부 — 로그인 키패드에서 OS 키보드를 언제 띄울지 정하는 데만 쓴다 */
const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer:coarse)").matches;

const CSS = `
.vb-root{--desk:#201F1D;--desk2:#2A2926;--desk3:#38362F;--paper:#FDFDFC;
  --muted:#918C82;--mark:#FFD84D;--mark2:#6FD3C0;--line:rgba(255,255,255,.10);
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",Pretendard,"Noto Sans KR","Segoe UI",system-ui,sans-serif;
  --serif:"Iowan Old Style",Charter,"Palatino Linotype",Georgia,"Times New Roman",serif;
  position:relative;width:100%;height:100vh;height:100dvh;
  display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--sans);background:var(--desk);color:#EDEBE6;font-size:15px;
  -webkit-font-smoothing:antialiased;overscroll-behavior:none}
.vb-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
/* :where 로 특이도를 낮춘 리셋 — .vb-root button 으로 쓰면 (클래스+태그) 특이도가
   .vb-libbtn 같은 단일 클래스 규칙의 padding 을 전부 덮어써 버린다 (실제로 당했던 버그) */
.vb-root :where(button){font-family:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}

.vb-bar{flex:0 0 auto;display:flex;align-items:center;gap:2px;
  padding:calc(6px + env(safe-area-inset-top)) 8px 6px;
  background:var(--desk);border-bottom:1px solid var(--line);z-index:40}
.vb-tool{height:36px;min-width:36px;padding:0 10px;border-radius:9px;display:inline-flex;
  align-items:center;justify-content:center;font-size:13px;color:#D9D5CC;flex:0 0 auto;
  touch-action:manipulation}
.vb-tool:active{background:var(--desk3)}
.vb-tool.on{background:var(--mark);color:#241F00;font-weight:600}
.vb-tool svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round}
@media (pointer:coarse){.vb-tool{height:42px;min-width:42px}}
.vb-name{flex:1;min-width:0;padding:0 8px;font-size:13px;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb-pill{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--muted);padding:0 8px;white-space:nowrap}
.vb-eng{font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:4px 7px;
  border-radius:5px;background:var(--desk3);color:var(--muted);white-space:nowrap}
.vb-eng.c{color:var(--mark)} .vb-eng.g{color:var(--mark2)}

.vb-body{flex:1;min-height:0;display:flex;position:relative}

.vb-out{position:absolute;inset:0 auto 0 0;width:min(80%,300px);z-index:30;background:var(--desk2);
  border-right:1px solid var(--line);transform:translateX(-101%);
  transition:transform .24s cubic-bezier(.3,.8,.4,1);display:flex;flex-direction:column}
.vb-out.open{transform:none}
.vb-root.wide .vb-out{position:relative;flex:0 0 272px;width:272px;transform:none}
.vb-root.wide .vb-out.closed{display:none}
.vb-out h2{margin:0;padding:14px 16px 10px;font-size:10.5px;font-weight:600;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.vb-olist{flex:1;overflow-y:auto;padding:0 8px calc(24px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.vb-orow{display:flex;align-items:center;border-radius:7px}
.vb-orow.d1{margin-left:15px;border-left:1px solid var(--line);border-radius:0 7px 7px 0}
.vb-orow.d2{margin-left:30px;border-left:1px solid var(--line);border-radius:0 7px 7px 0}
.vb-oi{flex:1;min-width:0;text-align:left;padding:10px 10px 10px 2px;border-radius:inherit;
  font-size:13.5px;line-height:1.45;color:#CFCBC2;touch-action:manipulation;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vb-oi:active{background:var(--desk3)}
.vb-orow.d1 .vb-oi{font-size:13px;color:#B4B0A7}
.vb-orow.d2 .vb-oi{font-size:12.5px;color:#A09C93}
.vb-ochev{flex:0 0 28px;height:38px;display:flex;align-items:center;justify-content:center;
  color:var(--muted);touch-action:manipulation}
.vb-ochev svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round;transition:transform .16s}
.vb-ochev.fold svg{transform:rotate(-90deg)}
.vb-ochev.off{pointer-events:none;visibility:hidden}
.vb-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;padding:6px 4px}
.vb-pg{height:40px;border-radius:8px;border:1px solid var(--line);font-size:13px;color:#CFCBC2;
  font-variant-numeric:tabular-nums;touch-action:manipulation}
.vb-pg:active{background:var(--desk3)}
.vb-pg.on{background:var(--mark);color:#241F00;border-color:transparent;font-weight:650}
.vb-oempty{padding:10px 12px;font-size:13px;color:var(--muted);line-height:1.5}
.vb-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:25;opacity:0;
  pointer-events:none;transition:opacity .24s}
.vb-scrim.on{opacity:1;pointer-events:auto}
.vb-root.wide .vb-scrim{display:none}

.vb-view{flex:1;overflow-y:auto;overflow-x:auto;-webkit-overflow-scrolling:touch;
  padding:14px 0 45vh;touch-action:pan-x pan-y;overscroll-behavior:contain;
  transition:padding .26s cubic-bezier(.3,.85,.35,1)}
/* 넓은 화면에서 풀이 시트가 열리면 그 폭만큼 비켜서 페이지가 시트에 가려지지 않게 한다 */
.vb-root.wide .vb-view.shr{padding-right:400px}
.vb-pages{transform-origin:50% 0;will-change:transform}
.vb-page{position:relative;margin:0 auto 14px;background:var(--paper);
  box-shadow:0 1px 3px rgba(0,0,0,.5),0 10px 30px rgba(0,0,0,.28);border-radius:2px;overflow:hidden}
.vb-page canvas{position:absolute;inset:0;width:100%;height:100%}
.vb-pn{position:absolute;right:6px;bottom:5px;font-size:9.5px;color:#B9B5AC;
  font-variant-numeric:tabular-nums;pointer-events:none}
.vb-tl{position:absolute;inset:0;overflow:hidden;line-height:1;color:transparent;
  -webkit-user-select:text;user-select:text;-webkit-touch-callout:none}
.vb-tl .it{position:absolute;white-space:pre;transform-origin:0 0;cursor:text}
.vb-tl .w{border-radius:2px}
.vb-tl .w.hit{background:var(--mark);box-shadow:0 0 0 1px var(--mark)}
.vb-tl .w.sent{background:rgba(111,211,192,.55)}
.vb-root ::selection{background:rgba(255,216,77,.55)}

.vb-zoompill{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:36;
  padding:6px 14px;border-radius:20px;background:rgba(32,31,29,.9);color:#EDEBE6;
  font-size:13px;font-variant-numeric:tabular-nums;pointer-events:none}
.vb-uppill{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:34;
  min-width:250px;max-width:76%;padding:9px 16px;border-radius:12px;background:var(--desk3);
  border:1px solid var(--line);overflow:hidden;font-size:12.5px;color:#EDEBE6;text-align:center;
  white-space:nowrap;text-overflow:ellipsis;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.vb-uppill i{position:absolute;inset:0 auto 0 0;background:rgba(255,216,77,.22);transition:width .2s}
.vb-uppill span{position:relative}

/* ── 서재 (PDF 보관함) ── */
.vb-lib{position:absolute;inset:0;z-index:32;background:var(--desk);display:flex;flex-direction:column;
  animation:vb-fade .22s ease-out}
@keyframes vb-fade{from{opacity:0}to{opacity:1}}
.vb-libhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:calc(14px + env(safe-area-inset-top)) 20px 6px}
.vb-mk{font-family:var(--serif);font-size:34px;line-height:1;color:var(--paper);letter-spacing:-.02em}
.vb-mk em{font-style:italic;background:var(--mark);color:#241F00;padding:0 .12em;border-radius:3px}
.vb-crumb{display:flex;align-items:center;gap:2px;font-size:14px;color:var(--muted);min-width:0}
.vb-crumb button{padding:8px 10px;border-radius:8px;color:#D9D5CC;max-width:200px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;touch-action:manipulation}
.vb-crumb button.tgt{background:var(--desk3);box-shadow:0 0 0 2px var(--mark)}
.vb-libact{margin-left:auto;display:flex;gap:8px;align-items:center}
/* 질문탭(.vb-tab)과 같은 규격 — 서재와 뷰어의 버튼 크기를 통일한다 */
.vb-libbtn{min-height:40px;min-width:48px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:9px;background:var(--desk3);font-size:14.5px;line-height:1;
  color:#EDEBE6;touch-action:manipulation;white-space:nowrap}
.vb-libbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;
  stroke-linecap:round;stroke-linejoin:round}
.vb-seg .vb-libbtn{background:transparent}
.vb-libbtn.pri{background:var(--mark);color:#241F00;font-weight:650}
.vb-libbtn:disabled{opacity:.45}
.vb-newfol{display:flex;gap:8px;padding:10px 20px 0}
.vb-newfol input{flex:1;max-width:280px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);
  background:#232220;color:#EDEBE6;font-size:15px;outline:none;font-family:inherit}
.vb-libbody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  padding:2px 20px calc(30px + env(safe-area-inset-bottom))}
.vb-sect{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px}
.vb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:18px 14px}
.vb-fol{position:relative;border:1px solid var(--line);border-radius:12px;background:var(--desk2);
  padding:12px;text-align:left;cursor:pointer;touch-action:manipulation;
  -webkit-user-select:none;user-select:none}
.vb-fol:active{background:var(--desk3)}
.vb-fol.over{background:var(--desk3);box-shadow:0 0 0 2px var(--mark)}
.vb-fol svg{width:26px;height:26px;stroke:var(--mark);fill:none;stroke-width:1.6;
  stroke-linecap:round;stroke-linejoin:round;margin-bottom:8px}
/* 책 카드 — 표지(1페이지 썸네일)가 얼굴이다 */
.vb-doc{position:relative;text-align:left;cursor:pointer;touch-action:manipulation;
  -webkit-user-select:none;user-select:none;-webkit-user-drag:element}
.vb-doc.drag{opacity:.35}
.vb-cov{position:relative;aspect-ratio:3/4;border-radius:5px 10px 10px 5px;background:var(--desk2);
  border:1px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;
  box-shadow:0 1px 2px rgba(0,0,0,.45),0 8px 22px rgba(0,0,0,.3)}
.vb-cov::after{content:'';position:absolute;inset:0 auto 0 0;width:7px;
  background:linear-gradient(90deg,rgba(0,0,0,.3),rgba(0,0,0,0));pointer-events:none}
.vb-cov img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.vb-cov svg{width:30px;height:30px;stroke:var(--muted);fill:none;stroke-width:1.5;
  stroke-linecap:round;stroke-linejoin:round}
.vb-doc:active .vb-cov{box-shadow:0 0 0 2px var(--mark)}
.vb-fname{font-size:13.5px;line-height:1.35;color:#EDEBE6;word-break:break-word;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vb-doc .vb-fname{margin-top:8px}
.vb-fmeta{margin-top:4px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vb-dact{position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:1}
.vb-doc .vb-dact{background:rgba(32,31,29,.72);border-radius:9px;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.vb-ib{min-width:30px;height:30px;padding:0 7px;border-radius:8px;display:inline-flex;align-items:center;
  justify-content:center;font-size:15px;color:var(--muted);background:transparent;text-decoration:none;
  touch-action:manipulation}
.vb-ib:active{background:var(--desk3)}
.vb-ib.del.ask{background:#E4713F;color:#1d0f08;font-size:12px;font-weight:650}
.vb-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  text-align:center;padding:12vh 24px 6vh}
.vb-hero p{margin:0;max-width:40ch;font-size:14px;line-height:1.8;color:var(--muted)}
.vb-hint{font-size:12.5px;color:#6E6A62;line-height:1.8}
.vb-hint b{color:#9B958A;font-weight:600}
/* 데스크톱(트랙패드 포함)용 호버 */
@media (hover:hover){
  .vb-tool:hover{background:var(--desk3)}
  .vb-fol:hover{background:var(--desk3)}
  .vb-libbtn:hover{filter:brightness(1.12)}
  .vb-seg .vb-libbtn:hover{background:var(--desk3);filter:none}
  .vb-seg .vb-libbtn.pri:hover{background:var(--mark);filter:brightness(1.08)}
  .vb-doc:hover .vb-cov{transform:translateY(-3px);
    box-shadow:0 3px 4px rgba(0,0,0,.45),0 14px 30px rgba(0,0,0,.38)}
  .vb-oi:hover,.vb-pg:hover,.vb-ib:hover{background:var(--desk3)}
  .vb-tab:hover{color:#EDEBE6}
}
.vb-cov{transition:transform .16s,box-shadow .16s}
/* 좁은 화면에서는 엔진 배지를 숨겨 툴바 숨통을 틔운다 */
.vb-root:not(.wide) .vb-eng{display:none}

.vb-sheet{position:absolute;left:0;right:0;bottom:0;z-index:35;background:var(--desk2);
  border-top:1px solid var(--line);border-radius:18px 18px 0 0;display:flex;flex-direction:column;
  transform:translateY(100%);transition:transform .26s cubic-bezier(.3,.85,.35,1);
  box-shadow:0 -8px 34px rgba(0,0,0,.4)}
.vb-sheet.open{transform:none}
.vb-root.wide .vb-sheet{left:auto;right:0;top:0;bottom:0;width:400px;height:100%!important;
  border-radius:0;border-top:0;border-left:1px solid var(--line);transform:translateX(101%)}
.vb-root.wide .vb-sheet.open{transform:none}
.vb-grip{padding:10px 0 2px;display:flex;justify-content:center;touch-action:none;cursor:grab}
.vb-grip i{width:42px;height:5px;border-radius:3px;background:#57544C;display:block}
.vb-root.wide .vb-grip{display:none}
.vb-tabs{display:flex;gap:8px;padding:4px 12px 10px;align-items:center;overflow-x:auto;
  -webkit-overflow-scrolling:touch}
.vb-root.wide .vb-tabs{padding-top:16px}
/* 탭은 세그먼트 버튼 그룹 — 홈(서재)의 노란 포인트와 같은 강조색을 쓴다 */
.vb-seg{display:flex;gap:2px;padding:4px;border-radius:12px;background:#232220;
  border:1px solid var(--line);flex:0 0 auto}
.vb-tab{min-height:40px;padding:0 20px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:9px;font-size:14.5px;line-height:1;color:var(--muted);
  touch-action:manipulation;flex:0 0 auto;white-space:nowrap}
.vb-tab.on{background:var(--mark);color:#241F00;font-weight:650}
.vb-x{margin-left:auto;padding:8px 12px;color:var(--muted);font-size:18px;line-height:1}
.vb-panes{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;padding:0 20px calc(22px + env(safe-area-inset-bottom))}

.vb-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.vb-star{margin-left:auto;width:38px;height:38px;border-radius:9px;display:inline-flex;
  align-items:center;justify-content:center;align-self:center;touch-action:manipulation}
.vb-star svg{width:22px;height:22px;stroke:var(--muted);fill:none;stroke-width:1.7;stroke-linejoin:round}
.vb-star.on svg{fill:var(--mark);stroke:var(--mark)}
.vb-star:active{background:var(--desk3)}
.vb-vi{padding:12px 0;border-bottom:1px solid var(--line)}
.vb-vihead{display:flex;align-items:center;gap:8px}
.vb-viw{font-family:var(--serif);font-size:19px;color:var(--paper);word-break:break-word}
.vb-vimeta{font-size:11px;color:var(--muted);margin-left:auto;white-space:nowrap}
.vb-vim{margin:6px 0 0;font-size:14px;line-height:1.6;color:#DAD6CE}
.vb-vic{margin:4px 0 0;font-size:13px;line-height:1.6;color:var(--muted)}
.vb-hw{font-family:var(--serif);font-size:32px;line-height:1.15;color:var(--paper);
  letter-spacing:-.01em;word-break:break-word}
.vb-pos{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mark);
  border:1px solid rgba(255,216,77,.35);border-radius:4px;padding:2px 6px}
.vb-rule{height:1px;background:var(--line);margin:14px 0}
.vb-lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.vb-txt{margin:0;font-size:15.5px;line-height:1.75;color:#E7E4DD;white-space:pre-wrap;word-break:break-word}
.vb-quote{font-family:var(--serif);font-size:15px;color:#C9C5BC;border-left:2px solid var(--mark2);
  padding-left:12px;line-height:1.65;white-space:pre-wrap}
.vb-senses{margin:0;padding:0;list-style:none;counter-reset:s}
.vb-senses li{font-size:15px;line-height:1.65;color:#DAD6CE;padding:3px 0 3px 20px;position:relative}
.vb-senses li::before{content:counter(s);counter-increment:s;position:absolute;left:0;top:5px;
  font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.vb-cur::after{content:'';display:inline-block;width:7px;height:15px;margin-left:2px;
  background:var(--mark);vertical-align:-2px;animation:vbblink .9s steps(2) infinite}
@keyframes vbblink{0%,50%{opacity:1}50.01%,100%{opacity:0}}
.vb-err{color:#FF9A8A;font-size:13.5px;line-height:1.6}
.vb-ph{color:#6E6A62;font-size:14px;line-height:1.75;padding:8px 0}

.vb-msg{font-size:15px;line-height:1.75;margin-bottom:14px}
.vb-msg.me{color:var(--mark);font-weight:550}
.vb-msg.ai{color:#E7E4DD;white-space:pre-wrap}
.vb-askbar{position:sticky;bottom:0;background:var(--desk2);padding:10px 0 4px;
  display:flex;gap:8px;align-items:flex-end}
.vb-askin{flex:1;min-height:44px;max-height:120px;resize:none;padding:11px 12px;border-radius:11px;
  border:1px solid var(--line);background:#232220;color:#EDEBE6;font-size:16px;line-height:1.4;
  outline:none;font-family:inherit}
.vb-askin:focus{border-color:rgba(255,216,77,.5)}
.vb-send{height:44px;padding:0 16px;border-radius:11px;background:var(--mark);color:#241F00;
  font-weight:650;font-size:14.5px;touch-action:manipulation}
.vb-send:disabled{opacity:.4}
.vb-askctx{font-size:12px;color:var(--muted);line-height:1.55;margin-bottom:14px}

.vb-modal{position:absolute;inset:0;z-index:50;background:rgba(20,19,18,.92);display:flex;
  align-items:center;justify-content:center;padding:24px}
.vb-card{width:min(440px,100%);background:var(--desk2);border:1px solid var(--line);
  border-radius:16px;padding:22px;max-height:86%;overflow-y:auto}
.vb-card h3{margin:0 0 4px;font-size:17px;font-weight:650}
.vb-sub{margin:0 0 18px;font-size:13px;color:var(--muted);line-height:1.65}
.vb-field{margin-bottom:16px}
.vb-field label{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);margin-bottom:7px}
.vb-field input{width:100%;padding:11px;border-radius:10px;border:1px solid var(--line);
  background:#232220;color:#EDEBE6;font-size:16px;outline:none;font-family:inherit}
.vb-field input.pw6{text-align:center;letter-spacing:12px;font-size:24px;
  font-variant-numeric:tabular-nums;padding-left:calc(11px + 12px)}
.vb-field select{width:100%;padding:11px;border-radius:10px;border:1px solid var(--line);
  background:#232220;color:#EDEBE6;font-size:15px;outline:none;font-family:inherit;
  appearance:none;-webkit-appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,#918C82 50%),linear-gradient(135deg,#918C82 50%,transparent 50%);
  background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:34px}
.vb-field select option{background:#232220;color:#EDEBE6}
.vb-hint{margin:8px 2px 0;font-size:12px;color:var(--muted);line-height:1.55}

/* 로그인 숫자 키패드 — 키보드 입력과 병행해서 쓴다 */
.vb-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.vb-key{height:52px;border-radius:11px;background:#232220;border:1px solid var(--line);
  font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;color:#EDEBE6;
  display:flex;align-items:center;justify-content:center;touch-action:manipulation;
  transition:background .1s}
.vb-key:active{background:var(--desk3)}
.vb-key.sm{font-size:17px;color:var(--muted)}
.vb-key.go{background:var(--mark);color:#241F00;border-color:transparent}
.vb-key.go:disabled{opacity:.35}
@media (pointer:coarse){.vb-key{height:60px;font-size:22px}}

.vb-row{display:flex;align-items:center;gap:10px;font-size:14px;color:#D2CEC5;margin-bottom:16px}
.vb-row input{width:19px;height:19px;accent-color:var(--mark);flex:0 0 auto}
.vb-done{width:100%;padding:13px;border-radius:11px;background:var(--mark);color:#241F00;
  font-weight:650;font-size:15px;touch-action:manipulation}

.vb-bubble{position:absolute;z-index:38;padding:9px 15px;border-radius:10px;background:var(--mark);
  color:#241F00;font-size:13.5px;font-weight:650;box-shadow:0 4px 14px rgba(0,0,0,.4);white-space:nowrap}

/* ── 영역 캡처 ──
   오버레이는 .vb-view 의 실측 사각형에 position:fixed 로 맞춘다. .vb-body 안에
   절대배치하면 목차 패널까지 덮거나 패널 폭(400/272)을 또 하드코딩해야 한다. */
/* 오버레이 자체는 투명하다 — 딤은 .vb-capsel 의 box-shadow 한 곳에서만 만든다.
   둘 다 깔면 선택 안쪽까지 어두워져서 정작 오릴 글자가 잘 안 보인다. */
.vb-cap{position:fixed;z-index:42;touch-action:none;cursor:crosshair;
  background:transparent;-webkit-user-select:none;user-select:none}
.vb-cap.busy{cursor:progress}
.vb-capsel{position:absolute;border:1.5px solid var(--mark);background:rgba(255,216,77,.10);
  box-shadow:0 0 0 9999px rgba(20,19,18,.42);cursor:move}
.vb-caph{position:absolute;width:22px;height:22px;border-radius:50%;background:var(--mark);
  border:2px solid #241F00;touch-action:none}
.vb-caphint{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:43;
  padding:8px 14px;border-radius:10px;background:rgba(20,19,18,.9);border:1px solid var(--line);
  color:#D9D5CC;font-size:13px;white-space:nowrap;pointer-events:none}
.vb-capmenu{position:absolute;z-index:43;display:flex;gap:6px;padding:6px;border-radius:12px;
  background:var(--desk2);border:1px solid var(--line);box-shadow:0 6px 20px rgba(0,0,0,.5)}
.vb-capbtn{min-height:40px;padding:0 15px;border-radius:9px;background:var(--mark);color:#241F00;
  font-size:14px;font-weight:650;white-space:nowrap;touch-action:manipulation}
.vb-capbtn.ghost{background:transparent;border:1px solid var(--line);color:#CFCBC2;font-weight:500}
.vb-capbtn:disabled{opacity:.45}
/* 질문 탭에 붙는 캡처 썸네일 */
.vb-msgimg{display:block;max-width:min(100%,320px);border-radius:9px;border:1px solid var(--line);
  margin:2px 0 8px;background:#fff}

@media (prefers-reduced-motion:reduce){.vb-root *{transition:none!important;animation:none!important}}
`;

/* ───────────────── AI 호출 (Claude → Gemini) ───────────────── */
async function readSSE(res, pick, onDelta) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("event-stream")) {
    const j = await res.json();
    const t = pick.whole(j);
    if (t) onDelta(t);
    return t;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
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
      const t = pick.delta(j);
      if (t) { out += t; onDelta(t); }
    }
  }
  return out;
}

/* 서버는 프로바이더와 무관하게 항상 OpenAI 형식 SSE 로 응답한다. */
const PICK_OPENAI = {
  delta: (j) => j.choices?.[0]?.delta?.content || "",
  whole: (j) => j.choices?.[0]?.message?.content || "",
};

class AuthError extends Error {
  constructor() { super("로그인이 필요합니다."); this.name = "AuthError"; }
}

/* opts.ask = true 면 서버가 질문 탭 전용 모델(opts.model 또는 서버 기본값)로 부른다. */
async function callServer(cfg, system, user, onDelta, signal, opts = {}) {
  const res = await fetch("/api/chat", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system, user,
      // 영역 캡처 이미지(base64 JPEG). 있으면 서버가 비전 모델 체인으로 보낸다.
      image: opts.image || "",
      maxTokens: opts.ask ? 1400 : 1000,
      forceGemini: !!cfg.forceGemini,
      ask: !!opts.ask,
      model: opts.ask ? cfg.askModel || "" : "",
    }),
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    let d = "";
    try { d = (await res.json()).error || ""; } catch {}
    throw new Error("요청 실패 " + res.status + (d ? ": " + d : ""));
  }
  const engine = res.headers.get("X-Engine") || "";
  const text = await readSSE(res, PICK_OPENAI, onDelta);
  return { text, engine };
}

/* ───────────────── 텍스트 유틸 ───────────────── */
function wordAt(text, off) {
  let s = off, e = off;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return text.slice(s, e).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "");
}
function sentenceAt(text, off) {
  const stop = /[.!?。！？…\n]/;
  let s = off, e = off;
  while (s > 0 && !stop.test(text[s - 1])) s--;
  while (e < text.length && !stop.test(text[e])) e++;
  if (e < text.length) e++;
  return { text: text.slice(s, e).replace(/\s+/g, " ").trim(), start: s, end: e };
}
const fmtSize = (b) =>
  b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const fmtDate = (t) => {
  const d = new Date(t || 0);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
function parseWord(s) {
  const m = s.match(/뜻\s*:\s*([\s\S]*?)(?:\n\s*문맥\s*:|$)/);
  const c = s.match(/문맥\s*:\s*([\s\S]*)$/);
  return { mean: m ? m[1].trim() : "", ctx: c ? c[1].trim() : "" };
}

const SYS_WORD = `너는 한국 대학생이 영어 원서·논문을 읽을 때 옆에서 짚어주는 사람이다.
답은 한국어로, 군더더기 없이 짧게. 인사·서론·마무리 문장 금지. 마크다운 기호 금지.
반드시 아래 두 줄 형식만 출력한다:
뜻: <사전적 의미 1~3개를 ' / '로 구분해 한 줄>
문맥: <이 문장 안에서 어떤 의미와 역할로 쓰였는지 1~2문장>`;

const SYS_SENT = `너는 영어 원서·논문을 읽는 한국 대학생의 번역 파트너다.
입력 문장을 자연스러운 한국어로 옮긴다. 직역투를 피하고 전문 용어는 원어를 괄호로 병기한다.
번역문만 출력한다. 인사·설명·마크다운 금지.
문장 구조가 까다로울 때만 마지막 줄에 "핵심: "으로 시작하는 한 줄을 덧붙인다.`;

const SYS_ASK = `너는 한국 대학생이 읽고 있는 문서를 함께 보는 튜터다.
주어진 본문(책 전체 또는 표시된 범위)을 근거로 한국어로 답한다. 짧고 정확하게, 필요하면 원문 표현을 쪽수와 함께 인용한다.
독자가 지금 보고 있는 쪽과 방금 짚은 문장이 표시되어 있으면 그 맥락을 우선 고려한다.
본문에 없는 내용은 추측이라고 밝힌다. 인사말 없이 바로 답한다.`;

/* ── 영역 캡처 프롬프트 ──
   "해석"은 비전 모델이 한 번에 처리하고, "문제풀이"는 두 단계로 나눈다:
   비전 모델이 눈 역할로 옮겨적고(SYS_CAP_OCR), 실제 추론은 질문 탭 모델(DeepSeek 등)이 한다.
   비전 모델은 글자를 잘 읽지만 추론은 텍스트 전용 모델이 더 낫기 때문이다. */
const SYS_CAP_READ = `너는 한국 대학생이 읽는 원서·교재의 한 부분을 함께 보는 번역·해설자다.
주어진 이미지는 지금 읽고 있는 쪽에서 오려낸 영역이다. 이미지에 보이는 것만 근거로 삼는다.
먼저 보이는 본문을 자연스러운 한국어로 옮기고, 이어서 이해에 필요한 만큼만 짧게 풀어 설명한다.
수식·기호·표는 읽은 그대로 옮기고 각 기호가 무엇을 뜻하는지 밝힌다.
전문 용어는 원어를 괄호로 병기한다. 인사말·마무리 문장·마크다운 기호 금지.
이미지가 흐리거나 글자를 알아볼 수 없으면 추측하지 말고 그 사실을 먼저 밝힌다.`;

const SYS_CAP_OCR = `이미지에 보이는 내용을 있는 그대로 옮겨 적는다. 번역·해설·풀이를 하지 않는다.
수식은 한 줄로 읽을 수 있는 형태로 옮긴다(예: (A+B)' = A'B').
표는 행마다 줄을 나눠 옮기고, 그림·회로도는 [그림: 무엇이 있는지 한 줄]로 적는다.
문제 번호와 보기 기호(①, (a) 등)를 빠뜨리지 않는다. 알아볼 수 없는 글자는 [?]로 표시한다.
옮긴 내용만 출력한다.`;

const SYS_CAP_SOLVE = `너는 한국 대학생의 문제풀이 조교다. 주어진 문제를 한국어로 푼다.
답만 던지지 말고 풀이 과정을 단계로 나눠 보여주되, 군더더기 없이 짧게.
근거가 되는 정의·법칙은 이름을 밝힌다(예: 드모르간 법칙).
마지막 줄에 "답: "으로 시작하는 한 줄로 최종 답을 적는다.
문제가 불완전해서 풀 수 없으면 무엇이 빠졌는지 밝힌다. 인사말·마크다운 기호 금지.`;

/* ───────────────── 컴포넌트 ───────────────── */
export default function VerbatimReader() {
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [docName, setDocName] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const [outline, setOutline] = useState([]);
  const [outOpen, setOutOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState("word");
  const [engine, setEngine] = useState("");
  const [word, setWord] = useState(null);
  const [sent, setSent] = useState(null);
  const [askLog, setAskLog] = useState([]);
  const [askVal, setAskVal] = useState("");
  const [asking, setAsking] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [busy, setBusy] = useState(false);
  const [sheetFrac, setSheetFrac] = useState(0.46);
  const [bubble, setBubble] = useState(null);
  const [wide, setWide] = useState(true);
  const [zoomPill, setZoomPill] = useState(null);
  const [authed, setAuthed] = useState(null); // null = 확인 중
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [models, setModels] = useState([]);      // 질문 탭에서 고를 수 있는 모델
  const [defModel, setDefModel] = useState("");  // 서버 기본값
  const [libOpen, setLibOpen] = useState(true);  // 서재 화면 (문서가 없으면 항상 열림)
  const [lib, setLib] = useState({ folders: [], files: [] });
  const [libFolder, setLibFolder] = useState(""); // "" = 최상위
  const [libErr, setLibErr] = useState("");
  const [folInput, setFolInput] = useState(null); // 새 폴더 이름 입력 중이면 문자열
  const [dragId, setDragId] = useState("");       // 드래그 중인 파일 id
  const [dropTgt, setDropTgt] = useState("");     // 드래그가 올라가 있는 폴더 id ("" 아니면 강조)
  const [delAsk, setDelAsk] = useState("");       // 한 번 더 누르면 삭제할 대상 id
  const [vocab, setVocab] = useState([]);         // 단어장 (서버 data/vocab.json 과 동기화)
  const [folded, setFolded] = useState(() => new Set()); // 접힌 목차 항목 index
  const [upProg, setUpProg] = useState(null);     // 업로드 진행 {name, pct}

  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const pdfRef = useRef(null);
  const pagesRef = useRef([]);
  const dataRef = useRef([]);
  const renderedRef = useRef(new Set());
  const queueRef = useRef(new Set());
  const ioRef = useRef(null);
  const scaleRef = useRef(1);
  const zoomRef = useRef(1);
  const curRef = useRef(1);
  const cacheRef = useRef(new Map());
  const cfgRef = useRef(cfg);
  const tapRef = useRef({ t: 0, page: null });
  const wAbort = useRef(null);
  const sAbort = useRef(null);
  const lastSentRef = useRef("");
  const selRef = useRef("");
  const boxRef = useRef({ w: 1024, h: 768 });
  const layoutRef = useRef({ sheetOpen: false, outOpen: false });
  const pwRef = useRef(null);
  const curFileRef = useRef(null);            // 지금 열려 있는 서재 파일 {id, name}
  const bookTextRef = useRef([]);             // 질문 탭용 페이지별 전체 텍스트 (백그라운드 추출)
  const extractingRef = useRef(false);
  const delTimer = useRef(null);              // 두 번 눌러 삭제 타이머
  const layoutKeyRef = useRef({ cw: 0, zoom: 0 }); // 마지막 배치에 쓴 폭·배율 — 같으면 relayout 을 건너뛴다

  useEffect(() => { cfgRef.current = cfg; }, [cfg]);
  useEffect(() => { layoutRef.current = { sheetOpen, outOpen }; }, [sheetOpen, outOpen]);

  /* 설정 저장 / 복원 */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("yeobaek");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.cfg) setCfg((c) => ({ ...c, ...s.cfg }));
      if (s.zoom) zoomRef.current = s.zoom;
    } catch {}
  }, []);
  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        "yeobaek",
        JSON.stringify({ cfg: cfgRef.current, zoom: zoomRef.current })
      );
    } catch {}
  }, []);

  /* 로그인 상태 확인 */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me");
        const j = await r.json();
        setAuthed(!!j.authed);
      } catch { setAuthed(false); }
    })();
  }, []);

  /* 질문 탭 모델 목록 — 로그인 뒤 한 번만 */
  useEffect(() => {
    if (authed !== true) return;
    (async () => {
      try {
        const r = await fetch("/api/models");
        if (!r.ok) return;
        const j = await r.json();
        setModels(Array.isArray(j.models) ? j.models : []);
        setDefModel(j.default || "");
      } catch {}
    })();
  }, [authed]);

  /* ── 서재 ── */
  const libApi = useCallback(async (url, opt) => {
    const r = await fetch(url, opt);
    if (r.status === 401) { setAuthed(false); throw new AuthError(); }
    if (!r.ok) {
      let d = "";
      try { d = (await r.json()).error || ""; } catch {}
      throw new Error(d || "요청 실패 " + r.status);
    }
    return r;
  }, []);

  const refreshLib = useCallback(async () => {
    try {
      const r = await libApi("/api/library");
      setLib(await r.json());
      setLibErr("");
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("서재 목록을 불러오지 못했습니다.");
    }
  }, [libApi]);

  const refreshVocab = useCallback(async () => {
    try {
      const r = await libApi("/api/vocab");
      setVocab((await r.json()).words || []);
    } catch {}
  }, [libApi]);

  useEffect(() => {
    if (authed === true) { refreshLib(); refreshVocab(); }
  }, [authed, refreshLib, refreshVocab]);

  /* fetch 는 업로드 진행률을 못 재서 XHR 을 쓴다 */
  const uploadPDF = (buf, name, folder) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/library/upload?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`);
      xhr.setRequestHeader("Content-Type", "application/pdf");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUpProg({ name, pct: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        setUpProg(null);
        if (xhr.status === 401) { setAuthed(false); reject(new AuthError()); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          let msg = "업로드 실패 (HTTP " + xhr.status + ")";
          if (xhr.status === 413) msg = "파일이 서버 허용 크기를 넘습니다 (HTTP 413)";
          else { try { const j = JSON.parse(xhr.responseText); if (j.error) msg += " — " + j.error; } catch {} }
          reject(new Error(msg)); return;
        }
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
      };
      xhr.onerror = () => { setUpProg(null); reject(new Error("네트워크 오류")); };
      setUpProg({ name, pct: 0 });
      xhr.send(buf);
    });

  const saveToLib = async (buf, name) => {
    try {
      const j = await uploadPDF(buf, name, libFolder);
      curFileRef.current = { id: j.id, name: j.name };
      refreshLib();
      if (!j.thumb) sendThumb(j.id);
    } catch (e) {
      if (e.name !== "AuthError")
        setLibErr(`서버에 저장하지 못했습니다 (${e.message}) — 문서는 열려 있지만 서재에는 없습니다.`);
    }
  };

  /* 표지 썸네일 — 방금 연 문서의 1페이지를 작게 렌더해 서버에 올린다 */
  const sendThumb = async (id) => {
    try {
      const pdf = pdfRef.current;
      if (!pdf || curFileRef.current?.id !== id) return;
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 300 / v1.width });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
      if (!blob) return;
      await libApi("/api/library/thumb/" + id, {
        method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob,
      });
      refreshLib();
    } catch {}
  };

  const openLibFile = async (f) => {
    try {
      setLibErr("");
      const r = await libApi("/api/library/file/" + f.id);
      const buf = await r.arrayBuffer();
      curFileRef.current = { id: f.id, name: f.name };
      setLibOpen(false);
      await loadPDF(new Uint8Array(buf), f.name);
      if (!f.thumb) sendThumb(f.id); // 표지가 없던 책은 처음 열 때 만들어진다
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("파일을 여는 데 실패했습니다.");
    }
  };

  const moveFile = async (id, folder) => {
    try {
      await libApi("/api/library/file/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("옮기지 못했습니다.");
    }
  };

  const makeFolder = async (name) => {
    const n = name.trim();
    if (!n) return;
    try {
      await libApi("/api/library/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      setFolInput(null);
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 만들지 못했습니다.");
    }
  };

  const delFile = async (id) => {
    try {
      await libApi("/api/library/file/" + id, { method: "DELETE" });
      if (curFileRef.current?.id === id) curFileRef.current = null;
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("지우지 못했습니다.");
    }
  };

  const delFolder = async (id) => {
    try {
      await libApi("/api/library/folder/" + id, { method: "DELETE" });
      if (libFolder === id) setLibFolder("");
      refreshLib();
    } catch (e) {
      if (e.name !== "AuthError") setLibErr("폴더를 지우지 못했습니다.");
    }
  };

  /* 실수로 지우는 걸 막는 두 번 탭 삭제 — confirm() 은 홈 화면 웹앱에서 못 믿는다 */
  const tapDel = (key, fn) => {
    if (delAsk === key) {
      clearTimeout(delTimer.current);
      setDelAsk("");
      fn();
      return;
    }
    setDelAsk(key);
    clearTimeout(delTimer.current);
    delTimer.current = setTimeout(() => setDelAsk(""), 2600);
  };

  /* ── 단어장 ── */
  const addVocab = async () => {
    const w = word;
    if (!w?.head) return;
    try {
      const r = await libApi("/api/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: w.head,
          mean: (w.senses || []).filter((s) => s !== "찾는 중…").join(" / "),
          ctx: w.ctx || "",
          quote: w.quote || "",
          doc: docName,
        }),
      });
      const j = await r.json();
      setVocab((v) => [j, ...v.filter((x) => x.word.toLowerCase() !== j.word.toLowerCase())]);
    } catch (e) {
      if (e.name !== "AuthError") console.warn("vocab add", e);
    }
  };

  const delVocab = async (id) => {
    try {
      await libApi("/api/vocab/" + id, { method: "DELETE" });
      setVocab((v) => v.filter((x) => x.id !== id));
    } catch (e) {
      if (e.name !== "AuthError") console.warn("vocab del", e);
    }
  };

  /* 지금 열려 있는 문서를 파일로 저장 — pdf.js 가 들고 있는 원본 바이트를 그대로 내려준다 */
  const downloadCur = async () => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    try {
      const data = await pdf.getData();
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = (docName || "문서") + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      console.warn("download", e);
    }
  };

  /* pdf.js */
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = CDN + "pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + "pdf.worker.min.js";
      setReady(true);
    };
    s.onerror = () => setLoadErr("pdf.js를 불러오지 못했습니다. 네트워크를 확인하세요.");
    document.head.appendChild(s);
  }, []);

  /* 컨테이너 크기 관측 — 스플릿 뷰·슬라이드 오버 대응 */
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      boxRef.current = { w: r.width, h: r.height };
      setWide(r.width >= WIDE);
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  /* 프로바이더 선택과 폴백은 서버가 처리한다. 어느 쪽이 응답했는지는 X-Engine 헤더로 온다. */
  const ask = useCallback(async (system, user, onDelta, signal, opts) => {
    try {
      const { text, engine } = await callServer(cfgRef.current, system, user, onDelta, signal, opts);
      if (engine) setEngine(engine);
      return text;
    } catch (e) {
      if (e.name === "AuthError") setAuthed(false);
      throw e;
    }
  }, []);

  /* ── 레이아웃 계산 ── */
  const contentWidth = () => {
    const { w } = boxRef.current;
    const isWide = w >= WIDE;
    const pad = isWide ? 56 : 12;
    const sh = isWide && layoutRef.current.sheetOpen ? 400 : 0;
    const ow = isWide && layoutRef.current.outOpen ? 272 : 0;
    return Math.max(240, w - pad - sh - ow);
  };

  const buildTextLayer = async (page, vp, layer, n) => {
    const tc = await page.getTextContent();
    let text = "";
    const words = [];
    const frag = document.createDocumentFragment();
    const pend = [];
    for (const item of tc.items) {
      if (!item.str) { if (item.hasEOL) text += "\n"; continue; }
      if (text && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
      const tx = window.pdfjsLib.Util.transform(vp.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      const ang = Math.atan2(tx[1], tx[0]);
      const st = tc.styles[item.fontName] || {};
      const d = document.createElement("span");
      d.className = "it";
      d.style.left = tx[4] + "px";
      d.style.top = tx[5] - fh + "px";
      d.style.fontSize = fh + "px";
      d.style.fontFamily = st.fontFamily || "sans-serif";
      for (const part of item.str.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { d.appendChild(document.createTextNode(part)); text += part; }
        else {
          const w = document.createElement("span");
          w.className = "w";
          w.textContent = part;
          w.dataset.off = String(text.length);
          w.dataset.page = String(n);
          d.appendChild(w);
          text += part;
          words.push(w);
        }
      }
      if (item.hasEOL) text += "\n";
      frag.appendChild(d);
      pend.push([d, item.width * vp.scale, ang]);
    }
    layer.appendChild(frag);
    const widths = pend.map(([d]) => d.offsetWidth);
    pend.forEach(([d, target, ang], i) => {
      const a = widths[i];
      let t = "";
      if (ang) t += `rotate(${ang}rad) `;
      if (a > 0 && target > 0) t += `scaleX(${target / a})`;
      if (t) d.style.transform = t;
    });
    dataRef.current[n - 1] = { text, words };
  };

  const renderPage = async (n) => {
    if (renderedRef.current.has(n) || queueRef.current.has(n)) return;
    queueRef.current.add(n);
    try {
      const pdf = pdfRef.current;
      const page = await pdf.getPage(n);
      const el = pagesRef.current[n - 1];
      if (!el) return;
      const vp = page.getViewport({ scale: scaleRef.current * zoomRef.current });
      el.style.width = vp.width + "px";
      el.style.height = vp.height + "px";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width * dpr);
      cv.height = Math.floor(vp.height * dpr);
      const ctx = cv.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      // 이전 배율의 캔버스가 있으면 그 '아래'에 깔아 두고 그린다 — 완성될 때까지
      // 흐릿한 이전 그림이 보이고, 흰 화면이 번쩍이지 않는다.
      el.insertBefore(cv, el.firstChild);
      await page.render({
        canvasContext: ctx, viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      // 완성 — 이전 캔버스와 남아 있던 텍스트 레이어를 걷어낸다
      el.querySelectorAll("canvas").forEach((c) => { if (c !== cv) c.remove(); });
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
      const layer = document.createElement("div");
      layer.className = "vb-tl";
      el.appendChild(layer);
      await buildTextLayer(page, vp, layer, n);
      renderedRef.current.add(n);
    } catch (e) {
      console.error("page " + n, e);
    } finally {
      queueRef.current.delete(n);
    }
  };

  const prune = () => {
    for (const n of [...renderedRef.current]) {
      if (Math.abs(n - curRef.current) > 4) {
        const el = pagesRef.current[n - 1];
        if (el) {
          el.querySelectorAll("canvas").forEach((c) => c.remove());
          el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
        }
        renderedRef.current.delete(n);
        dataRef.current[n - 1] = null;
      }
    }
  };

  const observe = () => {
    ioRef.current?.disconnect();
    ioRef.current = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const n = +e.target.dataset.n;
        if (e.isIntersecting) {
          renderPage(n);
          if (e.intersectionRatio > 0.35) { curRef.current = n; setCurPage(n); }
        }
      }
      prune();
    }, { root: viewRef.current, rootMargin: "1000px 0px", threshold: [0, 0.35] });
    pagesRef.current.forEach((el) => el && ioRef.current.observe(el));
  };

  const buildPages = (w1, h1, total) => {
    const stage = stageRef.current;
    stage.innerHTML = "";
    pagesRef.current = [];
    const cw = contentWidth();
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
    scaleRef.current = cw / w1;
    const w = w1 * scaleRef.current * zoomRef.current;
    const h = h1 * scaleRef.current * zoomRef.current;
    for (let i = 1; i <= total; i++) {
      const d = document.createElement("div");
      d.className = "vb-page";
      d.dataset.n = String(i);
      d.style.width = w + "px";
      d.style.height = h + "px";
      const s = document.createElement("span");
      s.className = "vb-pn";
      s.textContent = String(i);
      d.appendChild(s);
      stage.appendChild(d);
      pagesRef.current[i - 1] = d;
    }
  };

  const loadPDF = async (buf, name) => {
    setBusy(true);
    setLoadErr("");
    try {
      renderedRef.current.clear();
      queueRef.current.clear();
      dataRef.current = [];
      bookTextRef.current = [];
      const pdf = await window.pdfjsLib.getDocument({
        data: buf, cMapUrl: CDN + "cmaps/", cMapPacked: true,
        standardFontDataUrl: CDN + "standard_fonts/",
      }).promise;
      pdfRef.current = pdf;
      setDocName(name);
      setNumPages(pdf.numPages);
      const p1 = await pdf.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      buildPages(v1.width, v1.height, pdf.numPages);
      observe();
      curRef.current = 1;
      setCurPage(1);
      let out = null;
      try { out = await pdf.getOutline(); } catch (e) { console.warn("목차 읽기 실패:", e); }
      if (!out?.length) console.info("이 PDF에는 목차(/Outlines)가 없습니다 — 주석 앱(굿노트 등)의 책갈피는 PDF 목차가 아닐 수 있습니다.");
      const flat = [];
      const walk = (items, depth) => {
        for (const it of items) {
          flat.push({ title: it.title, depth, dest: it.dest });
          if (it.items?.length && depth < 2) walk(it.items, depth + 1);
        }
      };
      if (out?.length) walk(out, 0);
      setOutline(flat);
      setFolded(new Set());
      setTimeout(() => extractAll(pdf), 800); // 첫 렌더와 경쟁하지 않게 잠깐 뒤에
    } catch (e) {
      setLoadErr("PDF를 열지 못했습니다: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  /* 질문 탭용 전체 텍스트 — 페이지가 프룬되어도 남도록 별도로 한 번 훑어 둔다 */
  const extractAll = async (pdf) => {
    if (extractingRef.current) return;
    extractingRef.current = true;
    try {
      const arr = bookTextRef.current;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (pdfRef.current !== pdf) return; // 다른 문서로 바뀜 — 중단
        if (arr[n - 1] != null) continue;
        try {
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          let t = "";
          for (const it of tc.items) {
            if (it.str) {
              if (t && !/\s$/.test(t) && !/^\s/.test(it.str)) t += " ";
              t += it.str;
            }
            if (it.hasEOL) t += "\n";
          }
          arr[n - 1] = t.replace(/\s+/g, " ").trim();
        } catch {
          arr[n - 1] = "";
        }
      }
    } finally {
      extractingRef.current = false;
    }
  };

  /* 질문에 딸려 보낼 본문 — 짧은 책은 통째로, 긴 책은 현재 쪽 주변으로 한도까지 */
  const ASK_CAP = 48000;
  const buildAskContext = () => {
    const pdf = pdfRef.current;
    if (!pdf) return { scope: "", text: "(본문 없음)" };
    const N = pdf.numPages;
    const pages = bookTextRef.current;
    const pageText = (n) =>
      pages[n - 1] ?? (dataRef.current[n - 1]?.text || "").replace(/\s+/g, " ").trim();
    const done = Array.from({ length: N }, (_, i) => pages[i]).every((t) => t != null);
    if (done) {
      const total = pages.reduce((s, t) => s + t.length + 8, 0);
      if (total <= ASK_CAP)
        return { scope: `책 전체 ${N}쪽`, text: pages.map((t, i) => `[${i + 1}쪽] ${t}`).join("\n") };
    }
    const cur = curRef.current;
    const picked = [];
    let used = 0;
    const tryAdd = (n) => {
      if (n < 1 || n > N) return true;
      const t = pageText(n);
      if (used + t.length > ASK_CAP) return false;
      picked.push({ n, t });
      used += t.length + 8;
      return true;
    };
    tryAdd(cur);
    for (let d = 1; d < N; d++) {
      const a = tryAdd(cur + d);
      const b = tryAdd(cur - d);
      if (!a && !b) break;
    }
    picked.sort((x, y) => x.n - y.n);
    let text = picked.map((p) => `[${p.n}쪽] ${p.t}`).join("\n");
    if (outline.length) {
      const toc = outline.slice(0, 40).map((o) => "  ".repeat(o.depth) + "- " + o.title).join("\n").slice(0, 1500);
      text = `[목차]\n${toc}\n\n${text}`;
    }
    const from = picked[0]?.n ?? cur;
    const to = picked[picked.length - 1]?.n ?? cur;
    return { scope: `${from}–${to}쪽 (전체 ${N}쪽 중)`, text };
  };

  const scrollToPage = (n, smooth = true) => {
    const el = pagesRef.current[n - 1];
    const view = viewRef.current;
    if (!el || !view) return;
    const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 10;
    view.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    curRef.current = n;
    setCurPage(n);
  };

  /* anchor 가 있으면(핀치 줌) 그 지점(페이지 내 fx/fy)이 화면의 같은 자리(sx/sy)로 돌아오게 복원한다 */
  const relayout = useCallback(async (keepPage, anchor) => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    const cw = contentWidth();
    // 폭도 배율도 그대로면 아무것도 하지 않는다 — 좁은 화면에서 풀이창을 여닫을 때마다
    // 전부 다시 그리면서 페이지가 튀던 문제의 원인이 이 불필요한 재배치였다.
    if (cw === layoutKeyRef.current.cw && zoomRef.current === layoutKeyRef.current.zoom) return;
    layoutKeyRef.current = { cw, zoom: zoomRef.current };
    const keep = keepPage || curRef.current;
    const view = viewRef.current;
    // 페이지 맨 위로 스냅하지 않도록, 보고 있던 페이지 안의 위치(비율)를 기억해 둔다
    let frac = 0;
    const prevEl = pagesRef.current[keep - 1];
    if (view && prevEl && prevEl.offsetHeight) {
      const top = prevEl.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
      frac = Math.max(0, Math.min(1, (view.scrollTop - top) / prevEl.offsetHeight));
    }
    const p1 = await pdf.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    scaleRef.current = cw / v1.width;
    const w = v1.width * scaleRef.current * zoomRef.current;
    const h = v1.height * scaleRef.current * zoomRef.current;
    ioRef.current?.disconnect();
    for (const el of pagesRef.current) {
      if (!el) continue;
      el.style.width = w + "px";
      el.style.height = h + "px";
      // 캔버스는 남긴다 — CSS 로 새 크기에 맞춰 늘어난 채(흐릿하게) 보이다가
      // renderPage 가 선명한 새 캔버스를 완성하면 그때 교체된다.
      // 텍스트 레이어는 옛 배율 좌표라 어긋나므로 걷어낸다.
      el.querySelectorAll(".vb-tl").forEach((t) => t.remove());
    }
    renderedRef.current.clear();
    queueRef.current.clear();
    dataRef.current = [];
    observe();
    requestAnimationFrame(() => {
      const el = pagesRef.current[keep - 1];
      if (!el || !view) return;
      if (anchor) {
        const r = el.getBoundingClientRect();
        view.scrollTop += r.top + anchor.fy * r.height - anchor.sy;
        view.scrollLeft += r.left + anchor.fx * r.width - anchor.sx;
      } else {
        const top = el.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
        view.scrollTo({ top: top + frac * el.offsetHeight, behavior: "auto" });
      }
      curRef.current = keep;
      setCurPage(keep);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => relayout(), 280);
    return () => clearTimeout(t);
  }, [sheetOpen, outOpen, wide, relayout]);

  useEffect(() => {
    let t;
    const on = () => { clearTimeout(t); t = setTimeout(() => relayout(), 180); };
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
      clearTimeout(t);
    };
  }, [relayout]);

  const goDest = async (dest) => {
    try {
      const pdf = pdfRef.current;
      const d = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!d) return;
      const ref = d[0];
      const idx = typeof ref === "object" && ref !== null ? await pdf.getPageIndex(ref) : Number(ref);
      scrollToPage(idx + 1);
    } catch (e) { console.warn(e); }
  };

  const clearMarks = () => {
    viewRef.current?.querySelectorAll(".w.hit,.w.sent").forEach((e) => e.classList.remove("hit", "sent"));
  };

  /* ── 단어 / 문장 ── */
  const runWord = async (w, sentence) => {
    if (!w) return;
    const key = "w|" + w + "|" + sentence.slice(0, 120);
    if (cacheRef.current.has(key)) { setWord({ ...cacheRef.current.get(key), quote: sentence }); return; }
    setWord({ head: w, pos: "", senses: ["찾는 중…"], ctx: "", quote: sentence, live: true });
    wAbort.current?.abort();
    wAbort.current = new AbortController();
    const sig = wAbort.current.signal;
    let dictDone = false;

    if (cfgRef.current.useDict && /^[A-Za-z][A-Za-z'-]*$/.test(w)) {
      fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(w.toLowerCase()), { signal: sig })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!Array.isArray(j) || sig.aborted) return;
          const ms = [];
          for (const m of j[0].meanings || []) {
            const d0 = (m.definitions || [])[0];
            if (d0) ms.push(`(${m.partOfSpeech}) ${d0.definition}`);
            if (ms.length >= 3) break;
          }
          const pos = j[0]?.meanings?.[0]?.partOfSpeech || "";
          if (ms.length) { dictDone = true; setWord((s) => (s && s.head === w ? { ...s, senses: ms, pos } : s)); }
        })
        .catch(() => {});
    }

    let buf = "";
    try {
      await ask(SYS_WORD, `단어: ${w}\n문장: ${sentence}`, (c) => {
        buf += c;
        const { mean, ctx } = parseWord(buf);
        setWord((s) => {
          if (!s || s.head !== w) return s;
          const senses = mean && !dictDone ? mean.split(/\s*\/\s*/).filter(Boolean).slice(0, 4) : s.senses;
          return { ...s, senses, ctx: ctx || s.ctx };
        });
      }, sig);
      const { mean, ctx } = parseWord(buf);
      setWord((s) => {
        if (!s || s.head !== w) return s;
        const merged = {
          ...s, live: false, ctx: ctx || buf.trim(),
          senses: mean && !dictDone ? mean.split(/\s*\/\s*/).filter(Boolean).slice(0, 4) : s.senses,
        };
        cacheRef.current.set(key, { ...merged });
        return merged;
      });
    } catch (e) {
      if (e.name !== "AbortError") setWord((s) => (s && s.head === w ? { ...s, live: false, err: e.message } : s));
    }
  };

  const runSentence = async (text) => {
    if (!text) return;
    const key = "s|" + text.slice(0, 200);
    if (cacheRef.current.has(key)) { setSent({ trans: cacheRef.current.get(key), quote: text, live: false }); return; }
    setSent({ trans: "", quote: text, live: true });
    sAbort.current?.abort();
    sAbort.current = new AbortController();
    let buf = "";
    try {
      await ask(SYS_SENT, text, (c) => {
        buf += c;
        setSent((s) => (s && s.quote === text ? { ...s, trans: buf } : s));
      }, sAbort.current.signal);
      cacheRef.current.set(key, buf.trim());
      setSent((s) => (s && s.quote === text ? { ...s, trans: buf.trim(), live: false } : s));
    } catch (e) {
      if (e.name !== "AbortError") setSent((s) => (s && s.quote === text ? { ...s, live: false, err: e.message } : s));
    }
  };

  /* ── 탭 (한 번 / 두 번) ──
     pointerdown 에서 바로 실행하면 핀치의 첫 손가락·스크롤 시작·길게 눌러 선택까지
     전부 단어 풀이로 오인한다. 후보만 잡아 두고 pointerup 에서 판정한다:
     둘째 손가락이 오거나, 8px 넘게 움직이거나, 350ms 를 넘기면 탭이 아니다. */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let pend = null; // {el, x, y, id, t}
    const cancel = () => { pend = null; };
    const onDown = (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) { pend = null; return; }
      const el = ev.target.closest?.(".w");
      if (!el) { pend = null; return; }
      pend = { el, x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: Date.now() };
    };
    const onMove = (ev) => {
      if (pend && ev.pointerId === pend.id &&
        Math.hypot(ev.clientX - pend.x, ev.clientY - pend.y) > 8) pend = null;
    };
    const onTouchStart = (e) => { if (e.touches.length >= 2) pend = null; };
    const onUp = (ev) => {
      if (!pend || ev.pointerId !== pend.id) return;
      const { el, t } = pend;
      pend = null;
      if (Date.now() - t > 350) return; // 길게 누름 — 선택 제스처에 양보
      const n = +el.dataset.page;
      const pd = dataRef.current[n - 1];
      if (!pd) return;
      const off = +el.dataset.off;
      const now = Date.now();
      const dbl = now - tapRef.current.t < 350 && tapRef.current.page === n;
      tapRef.current = { t: now, page: n };
      const s = sentenceAt(pd.text, off);
      lastSentRef.current = s.text;
      if (dbl) {
        wAbort.current?.abort();
        clearMarks();
        for (const w of pd.words) {
          const o = +w.dataset.off;
          if (o >= s.start && o < s.end) w.classList.add("sent");
        }
        setSheetOpen(true);
        setTab("sent");
        runSentence(s.text);
      } else {
        clearMarks();
        el.classList.add("hit");
        setSheetOpen(true);
        setTab("word");
        runWord(wordAt(pd.text, off), s.text);
      }
    };
    view.addEventListener("pointerdown", onDown, { passive: true });
    view.addEventListener("pointermove", onMove, { passive: true });
    view.addEventListener("pointerup", onUp, { passive: true });
    view.addEventListener("pointercancel", cancel, { passive: true });
    view.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      view.removeEventListener("pointerdown", onDown);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", cancel);
      view.removeEventListener("touchstart", onTouchStart);
    };
  }, [ask]);

  /* ── 두 손가락 핀치 줌 (아이패드) ──
     제스처 중에는 CSS scale + 두 손가락 팬(스크롤 직접 이동)만 하고,
     끝나는 순간 손가락 중점 아래의 지점을 앵커로 잡아 relayout 이
     같은 점을 같은 화면 자리로 되돌린다.
     브라우저의 네이티브 스크롤이 먼저 제스처를 가져가면(touchmove 가
     cancelable 이 아니게 되면) 즉시 핀치를 포기한다 — 안 그러면
     네이티브 스크롤과 우리 변환이 겹쳐 페이지가 몇 장씩 튄다. */
  useEffect(() => {
    const view = viewRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    let pinching = false, startD = 0, startZoom = 1, factor = 1, lastMid = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const reset = () => {
      stage.style.transform = "";
      stage.style.transformOrigin = "";
      setZoomPill(null);
    };
    // 화면 좌표 (x,y) 아래의 페이지와 페이지 내 상대좌표. transform 이 걸린
    // 상태에서도 getBoundingClientRect 는 변환 후 좌표를 주므로 그대로 쓴다.
    const findAnchor = (x, y) => {
      const cur = curRef.current;
      for (let i = Math.max(0, cur - 9); i < Math.min(pagesRef.current.length, cur + 9); i++) {
        const el = pagesRef.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom)
          return { page: i + 1, fx: clamp01((x - r.left) / r.width), fy: clamp01((y - r.top) / r.height), sx: x, sy: y };
      }
      const el = pagesRef.current[cur - 1];
      const r = el?.getBoundingClientRect();
      return r
        ? { page: cur, fx: 0.5, fy: clamp01((y - r.top) / r.height), sx: x, sy: y }
        : { page: cur, fx: 0.5, fy: 0, sx: x, sy: y };
    };

    const onStart = (e) => {
      if (e.touches.length !== 2 || !pdfRef.current) return;
      pinching = true;
      startD = dist(e.touches);
      startZoom = zoomRef.current;
      factor = 1;
      lastMid = mid(e.touches);
      // 제스처 중에는 렌더/프룬이 끼어들지 않게 관찰을 멈춘다
      ioRef.current?.disconnect();
      const sr = stage.getBoundingClientRect();
      stage.style.transformOrigin = `${lastMid.x - sr.left}px ${lastMid.y - sr.top}px`;
    };
    const onMove = (e) => {
      if (!pinching || e.touches.length !== 2) return;
      if (!e.cancelable) {
        // 네이티브 스크롤이 이미 제스처를 가져갔다 — 핀치를 포기한다
        pinching = false;
        reset();
        observe();
        return;
      }
      e.preventDefault();
      const m = mid(e.touches);
      // 두 손가락 팬: 중점 이동량만큼 우리가 직접 스크롤한다
      view.scrollTop -= m.y - lastMid.y;
      view.scrollLeft -= m.x - lastMid.x;
      lastMid = m;
      const raw = dist(e.touches) / startD;
      const next = Math.max(0.3, Math.min(3, startZoom * raw));
      factor = next / startZoom;
      stage.style.transform = `scale(${factor})`;
      setZoomPill(Math.round(next * 100) + "%");
    };
    const onEnd = (e) => {
      if (!pinching || e.touches.length >= 2) return;
      pinching = false;
      // 앵커는 끝나는 순간의 중점에서 계산한다 (변환이 걸린 채로 측정)
      const anchor = lastMid ? findAnchor(lastMid.x, lastMid.y) : null;
      reset();
      lastMid = null;
      const next = Math.max(0.3, Math.min(3, startZoom * factor));
      if (Math.abs(next - zoomRef.current) > 0.01) {
        zoomRef.current = next;
        persist();
        relayout(anchor?.page, anchor);
      } else {
        observe();
      }
    };
    view.addEventListener("touchstart", onStart, { passive: true });
    view.addEventListener("touchmove", onMove, { passive: false });
    view.addEventListener("touchend", onEnd, { passive: true });
    view.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      view.removeEventListener("touchstart", onStart);
      view.removeEventListener("touchmove", onMove);
      view.removeEventListener("touchend", onEnd);
      view.removeEventListener("touchcancel", onEnd);
    };
  }, [relayout, persist]);

  /* ── 드래그 선택 ── */
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const t = sel ? sel.toString().trim() : "";
      if (!t || t.length < 2 || !viewRef.current?.contains(sel.anchorNode)) { setBubble(null); return; }
      selRef.current = t.replace(/\s+/g, " ");
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const host = viewRef.current.parentElement.getBoundingClientRect();
      setBubble({
        left: Math.max(8, Math.min(host.width - 150, r.left - host.left + r.width / 2 - 70)),
        top: Math.max(8, r.top - host.top - 48),
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  /* ── 키보드 (매직 키보드) ── */
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "Escape") { setSheetOpen(false); setOutOpen(false); setSetOpen(false); }
      if (!pdfRef.current) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); scrollToPage(Math.min(numPages, curRef.current + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); scrollToPage(Math.max(1, curRef.current - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [numPages]);

  /* ── 질문 ── */
  const sendAsk = async () => {
    const q = askVal.trim();
    if (!q || asking) return;
    setAskVal("");
    setAsking(true);
    const idx = askLog.length + 1;
    setAskLog((l) => [...l, { role: "me", text: q }, { role: "ai", text: "", live: true }]);
    const { scope, text } = buildAskContext();
    const user =
      `[문서: ${docName || "제목 없음"} — 제공 범위: ${scope || "없음"}]\n${text}\n\n` +
      `[지금 보는 쪽] ${curRef.current}쪽\n\n[방금 짚은 문장]\n${lastSentRef.current || "(없음)"}\n\n[질문]\n${q}`;
    let buf = "";
    try {
      await ask(SYS_ASK, user, (c) => {
        buf += c;
        setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: buf } : m)));
      }, undefined, { ask: true });
      setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: buf, live: false } : m)));
    } catch (e) {
      setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: "", live: false, err: e.message } : m)));
    } finally {
      setAsking(false);
    }
  };

  /* ── 영역 캡처 ──
     모드에 들어가면 .vb-view 위에 오버레이가 덮이고 입력을 독점한다. 그래서 탭 판정·핀치·
     스크롤 핸들러와 경쟁하지 않고, 텍스트 레이어의 data-off 오프셋 기계도 건드리지 않는다
     (픽셀만 읽으므로 스캔 PDF 처럼 텍스트가 없는 문서에서도 그대로 동작한다).
     좌표는 오버레이 기준(capSel)으로 두고, 자를 때만 페이지 실측 사각형으로 환산한다. */
  const CAP_TARGET = 1400;      // 크롭 긴 변 목표 픽셀 — 작은 수식도 읽히도록
  const CAP_MAXPX = 4_000_000;  // 아이패드 사파리가 캔버스를 조용히 비우지 않도록 총 픽셀 상한
  const CAP_MIN = 16;           // 이보다 작으면 스친 것으로 보고 선택을 버린다
  const [capMode, setCapMode] = useState(false);
  const [capBox, setCapBox] = useState(null); // 오버레이 위치 = .vb-view 실측 사각형
  const [capSel, setCapSel] = useState(null); // {x,y,w,h} 오버레이 기준
  const [capBusy, setCapBusy] = useState("");
  const capDragRef = useRef(null);
  const capAbort = useRef(null);

  const measureCap = () => {
    const r = viewRef.current?.getBoundingClientRect();
    if (r) setCapBox({ left: r.left, top: r.top, width: r.width, height: r.height });
  };
  /* NIM 모델은 한동안 안 쓰면 콜드스타트가 있다 — 실측으로 식었을 때 비전 52초·질문 탭 44초,
     데워지면 각각 2.3초·1초대. 모드에 들어가면 사용자가 영역을 그리는 몇 초가 생기므로
     그 사이에 미리 깨운다. 문제풀이는 비전 → 질문 탭 모델을 연달아 쓰므로 둘 다 건드린다.
     실패해도 무시한다(어차피 본 요청이 다시 시도한다). */
  const warmRef = useRef(0);
  const warmModels = () => {
    if (Date.now() - warmRef.current < 5 * 60 * 1000) return;
    warmRef.current = Date.now();
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const c = cv.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 1, 1);
    const poke = (body) =>
      fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: "ok", user: ".", maxTokens: 1, ...body }),
      }).then((r) => r.body?.cancel()).catch(() => {});
    poke({ image: cv.toDataURL("image/jpeg").split(",")[1] }); // 비전 모델
    poke({ ask: true, model: cfgRef.current.askModel || "" }); // 풀이 담당 모델
  };
  const enterCap = () => {
    measureCap(); setCapSel(null); setCapBusy(""); setCapMode(true);
    warmModels();
  };
  const exitCap = () => {
    capAbort.current?.abort();
    setCapMode(false); setCapSel(null); setCapBusy("");
    capDragRef.current = null;
  };
  // 모드 중에 창이 바뀌면 오버레이도 따라가야 한다. Escape 로 빠져나온다.
  useEffect(() => {
    if (!capMode) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); exitCap(); } };
    window.addEventListener("resize", measureCap);
    window.addEventListener("orientationchange", measureCap);
    window.addEventListener("keydown", onKey, true); // 캡처 단계에서 먼저 먹는다
    return () => {
      window.removeEventListener("resize", measureCap);
      window.removeEventListener("orientationchange", measureCap);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [capMode]);

  const capDown = (e) => {
    if (capBusy || !capBox) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX - capBox.left, y = e.clientY - capBox.top;
    const h = e.target.dataset?.caph;
    if (h && capSel) capDragRef.current = { mode: h, x, y, orig: { ...capSel } };
    else if (e.target.classList?.contains("vb-capsel") && capSel)
      capDragRef.current = { mode: "move", x, y, orig: { ...capSel } };
    else { capDragRef.current = { mode: "new", x, y }; setCapSel({ x, y, w: 0, h: 0 }); }
  };
  const capMove = (e) => {
    const d = capDragRef.current;
    if (!d || !capBox) return;
    const x = Math.max(0, Math.min(capBox.width, e.clientX - capBox.left));
    const y = Math.max(0, Math.min(capBox.height, e.clientY - capBox.top));
    if (d.mode === "new") {
      setCapSel({ x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) });
      return;
    }
    const o = d.orig;
    if (d.mode === "move") {
      setCapSel({
        x: Math.max(0, Math.min(capBox.width - o.w, o.x + (x - d.x))),
        y: Math.max(0, Math.min(capBox.height - o.h, o.y + (y - d.y))),
        w: o.w, h: o.h,
      });
      return;
    }
    // 네 꼭지점 — 잡은 반대쪽 모서리를 고정하고 다시 그린다
    const l = d.mode.includes("w") ? x : o.x;
    const r = d.mode.includes("e") ? x : o.x + o.w;
    const t = d.mode.includes("n") ? y : o.y;
    const b = d.mode.includes("s") ? y : o.y + o.h;
    setCapSel({ x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) });
  };
  const capUp = () => {
    const d = capDragRef.current;
    capDragRef.current = null;
    if (d?.mode === "new") setCapSel((s) => (s && (s.w < CAP_MIN || s.h < CAP_MIN) ? null : s));
  };

  /* 선택과 가장 많이 겹치는 페이지를 고른다. 페이지 사이 여백에 걸쳐도 안전하다.
     v1 은 한 페이지로 자른다 — 여러 페이지 합성은 다음 단계. */
  const capPage = (sel) => {
    if (!capBox) return null;
    const L = capBox.left + sel.x, T = capBox.top + sel.y;
    const R = L + sel.w, B = T + sel.h;
    let best = null, bestA = 0;
    pagesRef.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(R, r.right) - Math.max(L, r.left);
      const h = Math.min(B, r.bottom) - Math.max(T, r.top);
      if (w > 0 && h > 0 && w * h > bestA) { bestA = w * h; best = { n: i + 1, r }; }
    });
    return best;
  };

  /* 화면 캔버스를 확대하면 흐려서 모델이 글자를 놓친다.
     그래서 그 영역만 pdf.js 로 고배율 재렌더해서 자른다. */
  const cropRegion = async (sel) => {
    const hit = capPage(sel);
    const pdf = pdfRef.current;
    if (!hit || !pdf) throw new Error("영역이 페이지 위에 없습니다.");
    const { n, r } = hit;
    const L = Math.max(capBox.left + sel.x, r.left), T = Math.max(capBox.top + sel.y, r.top);
    const R = Math.min(capBox.left + sel.x + sel.w, r.right), B = Math.min(capBox.top + sel.y + sel.h, r.bottom);
    const fx = (L - r.left) / r.width, fy = (T - r.top) / r.height;
    const fw = (R - L) / r.width, fh = (B - T) / r.height;
    if (fw <= 0 || fh <= 0) throw new Error("영역이 페이지 위에 없습니다.");

    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const cw = v1.width * fw, ch = v1.height * fh;
    let hi = Math.min(8, Math.max(1, CAP_TARGET / Math.max(cw, ch)));
    if (cw * ch * hi * hi > CAP_MAXPX) hi = Math.sqrt(CAP_MAXPX / (cw * ch));
    const vp = page.getViewport({ scale: hi });
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(vp.width * fw));
    cv.height = Math.max(1, Math.round(vp.height * fh));
    const ctx = cv.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({
      canvasContext: ctx, viewport: vp,
      transform: [1, 0, 0, 1, -vp.width * fx, -vp.height * fy],
    }).promise;
    return { page: n, url: cv.toDataURL("image/jpeg", 0.85) };
  };

  /* kind: "read" = 해석(비전 모델 한 번) / "solve" = 문제풀이(옮겨적기 → 질문 탭 모델이 풀이) */
  const runCapture = async (kind) => {
    if (!capSel || capBusy) return;
    setCapBusy(kind);
    let shot;
    try {
      shot = await cropRegion(capSel);
    } catch (e) {
      setCapBusy("");
      setAskLog((l) => [...l, { role: "ai", text: "", live: false, err: e.message }]);
      setTab("ask"); setSheetOpen(true);
      return;
    }
    const b64 = shot.url.split(",")[1];
    exitCap();
    setTab("ask");
    setSheetOpen(true);

    capAbort.current?.abort();
    const ac = new AbortController();
    capAbort.current = ac;
    const label = kind === "solve" ? "문제풀이" : "해석";
    const idx = askLog.length + 1;
    setAskLog((l) => [
      ...l,
      { role: "me", text: `${shot.page}쪽 영역 — ${label}`, img: shot.url },
      { role: "ai", text: "", live: true },
    ]);
    const put = (t, extra) =>
      setAskLog((l) => l.map((m, i) => (i === idx ? { ...m, text: t, ...extra } : m)));

    setAsking(true);
    try {
      if (kind === "read") {
        let buf = "";
        await ask(SYS_CAP_READ,
          `[문서: ${docName || "제목 없음"} — ${shot.page}쪽에서 오려낸 영역]\n이 영역을 해석해 달라.`,
          (c) => { buf += c; put(buf); }, ac.signal, { image: b64 });
        put(buf, { live: false });
      } else {
        // 1단계: 비전 모델이 눈 역할 — 옮겨적기. 읽은 내용을 그대로 보여줘서
        // 모델이 수식을 잘못 읽었을 때 사용자가 바로 알아챌 수 있게 한다.
        let ocr = "";
        await ask(SYS_CAP_OCR, `[${shot.page}쪽에서 오려낸 영역] 이 이미지를 옮겨 적어라.`,
          (c) => { ocr += c; put(`[읽은 내용]\n${ocr}`); }, ac.signal, { image: b64 });
        if (!ocr.trim()) throw new Error("이미지에서 글자를 읽지 못했습니다.");
        const head = `[읽은 내용]\n${ocr.trim()}\n\n`;
        put(head + "풀이 중…");
        // 2단계: 추론은 질문 탭 모델(기본 DeepSeek)이 한다 — 이미지 없이 텍스트로.
        let buf = "";
        await ask(SYS_CAP_SOLVE,
          `[문서: ${docName || "제목 없음"} / ${shot.page}쪽에서 오려낸 문제]\n${ocr.trim()}\n\n위 문제를 풀어라.`,
          (c) => { buf += c; put(head + buf); }, ac.signal, { ask: true });
        put(head + buf, { live: false });
      }
    } catch (e) {
      if (e.name !== "AbortError") put("", { live: false, err: e.message });
    } finally {
      setAsking(false);
    }
  };

  const readFile = (f) => {
    const r = new FileReader();
    r.onload = async () => {
      const buf = r.result;
      const name = f.name.replace(/\.pdf$/i, "");
      curFileRef.current = null;
      setLibOpen(false);
      // pdf.js 가 버퍼를 워커로 가져가 비워 버리므로, 업로드용 원본과 분리한 복사본을 넘긴다
      await loadPDF(new Uint8Array(buf).slice(), name);
      saveToLib(buf, name); // 열면서 서재에도 저장한다 (문서가 로드된 뒤라 표지도 바로 만든다)
    };
    r.readAsArrayBuffer(f);
  };

  const dragRef = useRef(null);
  const zoomBy = (f) => {
    zoomRef.current = Math.max(0.3, Math.min(3, zoomRef.current * f));
    setZoomPill(Math.round(zoomRef.current * 100) + "%");
    setTimeout(() => setZoomPill(null), 900);
    persist();
    relayout();
  };

  /* 비밀번호는 숫자 6자리 고정 — 6자리가 다 차면 엔터 없이 바로 확인한다 */
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

  /* 화면 키패드 — 입력칸의 포커스를 뺏지 않아야 키보드 입력을 이어서 할 수 있다.
     (터치에서는 click 만 오므로 mousedown 억제로 충분하다) */
  const holdFocus = (e) => e.preventDefault();
  const pwKey = (k) => {
    setPwErr("");
    const nv = k === "del" ? pw.slice(0, -1) : pw.length >= 6 || !/^\d$/.test(k) ? pw : pw + k;
    setPw(nv);
    if (nv.length === 6) submitPw(nv);
    // 터치 기기에서 포커스를 주면 OS 키보드가 올라와 키패드를 가린다.
    if (!COARSE) pwRef.current?.focus();
  };

  const defLabel = models.find((m) => m.id === defModel)?.label || "";
  const askNote = models.find((m) => m.id === (cfg.askModel || defModel))?.note || "";
  const folders = [...lib.folders].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const shownFiles = lib.files
    .filter((f) => (f.folder || "") === libFolder)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const curFolName = lib.folders.find((f) => f.id === libFolder)?.name || "";
  const savedVocab = word?.head
    ? vocab.find((v) => v.word.toLowerCase() === word.head.toLowerCase())
    : null;
  /* 접힌 항목의 하위(depth 가 더 깊은 뒤따르는 항목)는 숨긴다 */
  const visibleOutline = (() => {
    const v = [];
    let skip = -1;
    outline.forEach((it, i) => {
      if (skip >= 0 && it.depth > skip) return;
      skip = -1;
      v.push(i);
      if (folded.has(i)) skip = it.depth;
    });
    return v;
  })();

  /* 입력칸에 포커스가 없어도 키보드로 바로 칠 수 있게 한다.
     (iPad + 매직 키보드에서는 키패드를 가리지 않으려고 자동 포커스를 껐다) */
  useEffect(() => {
    if (authed !== false) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === pwRef.current) return;
      if (e.key === "Enter") { e.preventDefault(); submitPw(pw); return; }
      if (e.key === "Backspace") pwKey("del");
      else if (/^\d$/.test(e.key)) pwKey(e.key);
      else return;
      e.preventDefault();
      pwRef.current?.focus(); // 이후 타이핑은 입력칸이 받는다
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 의존성 배열 없음 — 매 렌더마다 다시 걸어 pw/submitPw 의 최신 값을 본다

  // 서재가 홈 화면인 동안(문서를 안 열었거나 서재를 띄운 동안)은 읽기 도구창을 숨긴다
  const inLib = libOpen || numPages === 0;

  return (
    <div className={"vb-root" + (wide ? " wide" : "")} ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {authed === false && (
        <div className="vb-modal" style={{ zIndex: 100 }}>
          <form className="vb-card" onSubmit={(e) => { e.preventDefault(); submitPw(pw); }}>
            <h3>여백</h3>
            <p className="vb-sub">숫자 6자리 비밀번호를 입력하세요. 6자리가 다 차면 자동으로 들어갑니다. 이 기기에서는 30일간 유지됩니다.</p>
            <div className="vb-field">
              <label>비밀번호</label>
              <input ref={pwRef} type="password" inputMode="numeric" autoFocus={!COARSE}
                className="pw6" maxLength={6}
                value={pw} spellCheck={false} autoCapitalize="off" autoCorrect="off"
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
                <button key={d} type="button" className="vb-key"
                  onMouseDown={holdFocus} onClick={() => pwKey(d)}>{d}</button>
              ))}
              <button type="button" className="vb-key sm" onMouseDown={holdFocus}
                onClick={() => pwKey("del")} aria-label="지우기">⌫</button>
              <button type="button" className="vb-key" onMouseDown={holdFocus}
                onClick={() => pwKey("0")}>0</button>
              <button type="submit" className="vb-key go" disabled={pwBusy || !pw}
                onMouseDown={holdFocus} aria-label="들어가기">↵</button>
            </div>
            {pwErr && <p className="vb-sub" style={{ color: "#E4713F", margin: "14px 0 0" }}>{pwErr}</p>}
            <button className="vb-done" type="submit" disabled={pwBusy} style={{ marginTop: 16 }}>
              {pwBusy ? "확인 중…" : "들어가기"}
            </button>
          </form>
        </div>
      )}

      {!inLib && <div className="vb-bar">
        <button className={"vb-tool" + (outOpen ? " on" : "")} onClick={() => setOutOpen((v) => !v)} aria-label="목차">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button className={"vb-tool" + (libOpen ? " on" : "")}
          onClick={() => { setLibOpen(true); refreshLib(); }} aria-label="서재">
          <svg viewBox="0 0 24 24"><path d="M4 4.5h4V20H4zM10 4.5h4V20h-4zM15.6 6l3.9-1L22 19l-3.9 1z" /></svg>
        </button>
        <button className="vb-tool" onClick={() => fileRef.current?.click()} aria-label="PDF 열기">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
        </button>
        {numPages > 0 && (
          <button className="vb-tool" onClick={downloadCur} aria-label="PDF 다운로드">
            <svg viewBox="0 0 24 24"><path d="M12 4v10m0 0l-4-4m4 4l4-4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></svg>
          </button>
        )}
        <span className="vb-name">{busy ? "여는 중…" : docName || "PDF를 열어 시작하세요"}</span>
        {numPages > 0 && <span className="vb-pill">{curPage} / {numPages}</span>}
        <span className={"vb-eng" + (engine === "NIM" ? " c" : engine === "Gemini" ? " g" : "")}>
          {engine || "대기"}
        </span>
        {numPages > 0 && (
          <button className={"vb-tool" + (capMode ? " on" : "")} onClick={() => (capMode ? exitCap() : enterCap())}
            aria-label="영역 캡처">
            <svg viewBox="0 0 24 24"><path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4" /><rect x="8" y="8" width="8" height="8" strokeDasharray="2.5 2" /></svg>
          </button>
        )}
        <button className="vb-tool" onClick={() => zoomBy(1 / 1.2)} aria-label="축소">−</button>
        <button className="vb-tool" onClick={() => zoomBy(1.2)} aria-label="확대">+</button>
        <button className="vb-tool" onClick={() => setSetOpen(true)} aria-label="설정">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.8 2.8 1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5 2 2 0 11-4 0 1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3 2 2 0 11-2.8-2.8 1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1 2 2 0 110-4 1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8 2 2 0 112.8-2.8 1.6 1.6 0 001.8.3 1.6 1.6 0 001-1.5 2 2 0 114 0 1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3 2 2 0 112.8 2.8 1.6 1.6 0 00-.3 1.8 1.6 1.6 0 001.5 1 2 2 0 110 4 1.6 1.6 0 00-1.5 1z" /></svg>
        </button>
        <button className={"vb-tool" + (sheetOpen && tab === "ask" ? " on" : "")}
          onClick={() => { setTab("ask"); setSheetOpen(true); }}>질문</button>
        <button className={"vb-tool" + (sheetOpen ? " on" : "")} onClick={() => setSheetOpen((v) => !v)}>풀이</button>
      </div>}

      <div className="vb-body">
        <aside className={"vb-out" + (wide ? (outOpen ? "" : " closed") : outOpen ? " open" : "")}>
          <h2>목차</h2>
          <div className="vb-olist">
            {outline.length === 0 && numPages === 0 && <div className="vb-oempty">PDF를 열면 목차가 나타납니다.</div>}
            {outline.length === 0 && numPages > 0 && (
              <>
                <div className="vb-oempty">이 PDF에는 목차 정보가 없습니다. 페이지로 바로 이동하세요.</div>
                <div className="vb-pgrid">
                  {Array.from({ length: numPages }, (_, i) => (
                    <button key={i} className={"vb-pg" + (curPage === i + 1 ? " on" : "")}
                      onClick={() => { scrollToPage(i + 1); if (!wide) setOutOpen(false); }}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </>
            )}
            {visibleOutline.map((i) => {
              const it = outline[i];
              const kids = outline[i + 1]?.depth > it.depth; // walk 는 하위 항목을 바로 뒤에 넣는다
              return (
                <div key={i} className={"vb-orow" + (it.depth ? " d" + it.depth : "")}>
                  <button className={"vb-ochev" + (kids ? "" : " off") + (folded.has(i) ? " fold" : "")}
                    tabIndex={kids ? 0 : -1}
                    onClick={() => setFolded((s) => {
                      const n = new Set(s);
                      n.has(i) ? n.delete(i) : n.add(i);
                      return n;
                    })}
                    aria-label="하위 목차 접기/펼치기">
                    <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button className="vb-oi" onClick={() => { goDest(it.dest); if (!wide) setOutOpen(false); }}>
                    {it.title}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <div className={"vb-scrim" + (outOpen && !wide ? " on" : "")} onClick={() => setOutOpen(false)} />

        <div className={"vb-view" + (wide && sheetOpen ? " shr" : "")} ref={viewRef}>
          <div className="vb-pages" ref={stageRef} />
        </div>

        {zoomPill && <div className="vb-zoompill">{zoomPill}</div>}

        {upProg && (
          <div className="vb-uppill" role="status">
            <i style={{ width: upProg.pct + "%" }} />
            <span>{upProg.name} — 올리는 중 {upProg.pct}%</span>
          </div>
        )}

        {bubble && (
          <button className="vb-bubble" style={{ left: bubble.left, top: bubble.top }}
            onPointerDown={(e) => {
              e.preventDefault();
              setBubble(null);
              lastSentRef.current = selRef.current;
              setSheetOpen(true); setTab("sent");
              runSentence(selRef.current);
            }}>
            선택 구간 해석
          </button>
        )}

        {inLib && (
          <div className="vb-lib"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer?.files?.[0];
              if (f) readFile(f); // 파일 앱에서 끌어다 놓으면 바로 저장하고 연다
            }}>
            <div className="vb-libhead">
              <div className="vb-mk">여<em>백</em></div>
              <div className="vb-crumb">
                <button className={dropTgt === "__root__" ? "tgt" : ""}
                  onClick={() => setLibFolder("")}
                  onDragOver={(e) => { if (dragId && libFolder) { e.preventDefault(); setDropTgt("__root__"); } }}
                  onDragLeave={() => setDropTgt((t) => (t === "__root__" ? "" : t))}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setDropTgt("");
                    if (dragId) moveFile(dragId, ""); // 최상위로 꺼내기
                  }}>
                  서재
                </button>
                {libFolder && <><span>›</span><button onClick={() => {}}>{curFolName}</button></>}
              </div>
              <div className="vb-libact">
                <div className="vb-seg">
                  <button className="vb-libbtn" onClick={() => { setTab("vocab"); setSheetOpen(true); }}
                    aria-label="단어장" title="단어장">
                    <svg viewBox="0 0 24 24"><path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>
                  </button>
                  <button className="vb-libbtn" onClick={() => setSetOpen(true)} aria-label="설정" title="설정">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.8 2.8 1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5 2 2 0 11-4 0 1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3 2 2 0 11-2.8-2.8 1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1 2 2 0 110-4 1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8 2 2 0 112.8-2.8 1.6 1.6 0 001.8.3 1.6 1.6 0 001-1.5 2 2 0 114 0 1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3 2 2 0 112.8 2.8 1.6 1.6 0 00-.3 1.8 1.6 1.6 0 001.5 1 2 2 0 110 4 1.6 1.6 0 00-1.5 1z" /></svg>
                  </button>
                  <button className="vb-libbtn" onClick={() => setFolInput(folInput === null ? "" : null)}
                    aria-label="새 폴더" title="새 폴더">
                    <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M12 10.5v5M9.5 13h5" /></svg>
                  </button>
                  {numPages > 0 && (
                    <button className="vb-libbtn" onClick={() => setLibOpen(false)} aria-label="읽던 문서로" title="읽던 문서로">
                      <svg viewBox="0 0 24 24"><path d="M2.5 5.6C5 4.3 8 4.3 12 6.1v12.3C8 16.7 5 16.7 2.5 17.9zM21.5 5.6C19 4.3 16 4.3 12 6.1v12.3c4-1.7 7-1.7 9.5-.5z" /></svg>
                    </button>
                  )}
                  <button className="vb-libbtn pri" disabled={!ready} onClick={() => fileRef.current?.click()}
                    aria-label={ready ? "PDF 추가" : "준비 중"} title="PDF 추가">
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
              </div>
            </div>
            {folInput !== null && (
              <form className="vb-newfol" onSubmit={(e) => { e.preventDefault(); makeFolder(folInput); }}>
                <input value={folInput} autoFocus placeholder="폴더 이름"
                  onChange={(e) => setFolInput(e.target.value)} />
                <button className="vb-libbtn pri" type="submit" disabled={!folInput.trim()}>만들기</button>
              </form>
            )}
            {(libErr || loadErr) && (
              <div className="vb-err" style={{ padding: "10px 20px 0" }}>{libErr || loadErr}</div>
            )}
            <div className="vb-libbody">
              {libFolder === "" && folders.length > 0 && (
                <>
                  <div className="vb-sect">폴더 {folders.length}</div>
                  <div className="vb-grid">
                    {folders.map((fo) => (
                      <div key={fo.id}
                        className={"vb-fol" + (dropTgt === fo.id ? " over" : "")}
                        onClick={() => setLibFolder(fo.id)}
                        onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTgt(fo.id); } }}
                        onDragLeave={() => setDropTgt((t) => (t === fo.id ? "" : t))}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setDropTgt("");
                          if (dragId) moveFile(dragId, fo.id);
                        }}>
                        <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                        <div className="vb-fname">{fo.name}</div>
                        <div className="vb-fmeta">{lib.files.filter((f) => f.folder === fo.id).length}개</div>
                        <div className="vb-dact">
                          <button className={"vb-ib del" + (delAsk === "fo" + fo.id ? " ask" : "")}
                            onClick={(e) => { e.stopPropagation(); tapDel("fo" + fo.id, () => delFolder(fo.id)); }}
                            aria-label="폴더 삭제">
                            {delAsk === "fo" + fo.id ? "삭제?" : "✕"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!(libFolder === "" && folders.length === 0 && shownFiles.length === 0) && (
                <div className="vb-sect">
                  {libFolder ? "이 폴더의 PDF" : "PDF"} {shownFiles.length}권
                </div>
              )}
              {shownFiles.length === 0 ? (
                libFolder === "" && folders.length === 0 ? (
                  <div className="vb-hero">
                    <div className="vb-mk" style={{ fontSize: 56 }}>여<em>백</em></div>
                    <p>PDF를 추가하면 표지와 함께 이 서재에 꽂힙니다.<br />
                      읽을 때는 단어 한 번 탭 = 뜻 · 두 번 탭 = 문장 해석 · 드래그 = 구간 해석.</p>
                    <button className="vb-libbtn pri" style={{ padding: "13px 26px", fontSize: 15 }}
                      disabled={!ready} onClick={() => fileRef.current?.click()}>
                      {ready ? "첫 PDF 추가" : "준비 중…"}
                    </button>
                  </div>
                ) : (
                  <div className="vb-oempty">
                    {libFolder
                      ? "이 폴더는 비어 있습니다. 서재에서 PDF를 끌어다 놓으세요."
                      : "아직 저장된 PDF가 없습니다. 'PDF 추가'를 누르거나 파일을 끌어다 놓으세요."}
                  </div>
                )
              ) : (
                <div className="vb-grid">
                  {shownFiles.map((f) => (
                    <div key={f.id} draggable
                      className={"vb-doc" + (dragId === f.id ? " drag" : "")}
                      onClick={() => openLibFile(f)}
                      onDragStart={(e) => {
                        setDragId(f.id);
                        e.dataTransfer.setData("text/plain", f.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDragId(""); setDropTgt(""); }}>
                      <div className="vb-cov">
                        {f.thumb ? (
                          <img src={"/api/library/thumb/" + f.id} alt="" loading="lazy" />
                        ) : (
                          <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" /></svg>
                        )}
                      </div>
                      <div className="vb-fname">{f.name}</div>
                      <div className="vb-fmeta">{fmtSize(f.size)} · {fmtDate(f.at)}</div>
                      <div className="vb-dact">
                        <a className="vb-ib" href={"/api/library/file/" + f.id + "?dl=1"} download
                          onClick={(e) => e.stopPropagation()} aria-label="다운로드">⤓</a>
                        <button className={"vb-ib del" + (delAsk === f.id ? " ask" : "")}
                          onClick={(e) => { e.stopPropagation(); tapDel(f.id, () => delFile(f.id)); }}
                          aria-label="삭제">
                          {delAsk === f.id ? "삭제?" : "✕"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="vb-hint" style={{ marginTop: 26 }}>
                <b>탭</b> 열기 · <b>끌어서 폴더에 놓기</b> 이동 · <b>⤓</b> 다운로드 · <b>✕ 두 번</b> 삭제<br />
                읽기 화면 — <b>한 번 탭</b> 단어 풀이 · <b>두 번 탭</b> 문장 해석 · <b>길게 눌러 선택</b> 구간 해석 · <b>두 손가락</b> 확대
              </div>
            </div>
          </div>
        )}

        <section className={"vb-sheet" + (sheetOpen ? " open" : "")}
          style={{ height: wide ? "100%" : sheetFrac * 100 + "%" }}>
          <div className="vb-grip"
            onPointerDown={(e) => { dragRef.current = { y: e.clientY, h: sheetFrac }; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dh = (dragRef.current.y - e.clientY) / boxRef.current.h;
              setSheetFrac(Math.max(0.2, Math.min(0.9, dragRef.current.h + dh)));
            }}
            onPointerUp={(e) => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <i />
          </div>
          <div className="vb-tabs">
            <div className="vb-seg">
              {[["word", "단어"], ["sent", "문장"], ["ask", "질문"], ["vocab", "단어장"]].map(([k, label]) => (
                <button key={k} className={"vb-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <button className="vb-x" onClick={() => setSheetOpen(false)}>✕</button>
          </div>

          <div className="vb-panes">
            {tab === "word" && (!word ? (
              <div className="vb-ph">본문에서 단어를 한 번 누르면 여기에 뜻이 나옵니다.</div>
            ) : (
              <>
                <div className="vb-head">
                  <span className="vb-hw">{word.head}</span>
                  {word.pos && <span className="vb-pos">{word.pos}</span>}
                  <button className={"vb-star" + (savedVocab ? " on" : "")}
                    onClick={() => (savedVocab ? delVocab(savedVocab.id) : addVocab())}
                    aria-label={savedVocab ? "단어장에서 빼기" : "단어장에 담기"}>
                    <svg viewBox="0 0 24 24"><path d="M12 3.6l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" /></svg>
                  </button>
                </div>
                <p className="vb-lbl" style={{ marginTop: 14 }}>뜻</p>
                <ol className="vb-senses">{(word.senses || []).map((s, i) => <li key={i}>{s}</li>)}</ol>
                <div className="vb-rule" />
                <p className="vb-lbl">이 문맥에서</p>
                <p className={"vb-txt" + (word.live ? " vb-cur" : "")}>{word.ctx}</p>
                {word.err && <p className="vb-err">답을 받지 못했습니다 — {word.err}</p>}
                <div className="vb-rule" />
                <p className="vb-lbl">원문</p>
                <p className="vb-txt vb-quote">{word.quote}</p>
              </>
            ))}

            {tab === "sent" && (!sent ? (
              <div className="vb-ph">단어를 두 번 연속으로 누르면 그 문장 전체를 해석합니다.</div>
            ) : (
              <>
                <p className="vb-lbl" style={{ marginTop: 6 }}>해석</p>
                <p className={"vb-txt" + (sent.live ? " vb-cur" : "")}>{sent.trans}</p>
                {sent.err && <p className="vb-err">답을 받지 못했습니다 — {sent.err}</p>}
                <div className="vb-rule" />
                <p className="vb-lbl">원문</p>
                <p className="vb-txt vb-quote">{sent.quote}</p>
              </>
            ))}

            {tab === "ask" && (
              <>
                <div className="vb-askctx" style={{ marginTop: 6 }}>
                  책 본문을 근거로 답합니다 — 짧은 책은 전체를, 긴 책은 지금 보는 {curPage}쪽 주변과 목차를 함께 보냅니다.
                </div>
                {askLog.map((m, i) => (
                  <div key={i} className={"vb-msg " + m.role + (m.live ? " vb-cur" : "")}>
                    {m.img && <img className="vb-msgimg" src={m.img} alt="오려낸 영역" />}
                    {m.err ? <span className="vb-err">답을 받지 못했습니다 — {m.err}</span> : m.text}
                  </div>
                ))}
                <div className="vb-askbar">
                  <textarea className="vb-askin" rows={1} value={askVal} placeholder="이 부분에 대해 물어보세요"
                    onChange={(e) => setAskVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && wide) { e.preventDefault(); sendAsk(); } }} />
                  <button className="vb-send" disabled={asking || !askVal.trim()} onClick={sendAsk}>보내기</button>
                </div>
              </>
            )}

            {tab === "vocab" && (vocab.length === 0 ? (
              <div className="vb-ph">단어 풀이에서 ★ 를 누르면 여기에 모입니다.</div>
            ) : (
              <div style={{ marginTop: 6 }}>
                {vocab.map((v) => (
                  <div key={v.id} className="vb-vi">
                    <div className="vb-vihead">
                      <span className="vb-viw">{v.word}</span>
                      <span className="vb-vimeta">{v.doc ? v.doc + " · " : ""}{fmtDate(v.at)}</span>
                      <button className={"vb-ib del" + (delAsk === "v" + v.id ? " ask" : "")}
                        onClick={() => tapDel("v" + v.id, () => delVocab(v.id))} aria-label="단어장에서 삭제">
                        {delAsk === "v" + v.id ? "삭제?" : "✕"}
                      </button>
                    </div>
                    {v.mean && <p className="vb-vim">{v.mean}</p>}
                    {v.ctx && <p className="vb-vic">{v.ctx}</p>}
                    {v.quote && <p className="vb-txt vb-quote" style={{ fontSize: 13, marginTop: 6 }}>{v.quote}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {setOpen && (
          <div className="vb-modal" onClick={(e) => { if (e.target === e.currentTarget) setSetOpen(false); }}>
            <div className="vb-card">
              <h3>엔진 설정</h3>
              <p className="vb-sub">기본은 NVIDIA NIM입니다. 호출이 실패하면 서버가 자동으로 Gemini로 넘어가고, 이후 3분간 Gemini를 먼저 씁니다. API 키는 서버에서 관리하므로 여기에 넣지 않습니다. 설정과 배율은 이 기기에 저장됩니다.</p>
              <label className="vb-row">
                <input type="checkbox" checked={cfg.forceGemini}
                  onChange={(e) => setCfg({ ...cfg, forceGemini: e.target.checked })} />
                처음부터 Gemini만 사용
              </label>
              <label className="vb-row">
                <input type="checkbox" checked={cfg.useDict}
                  onChange={(e) => setCfg({ ...cfg, useDict: e.target.checked })} />
                영어 단어는 사전 API를 먼저 조회 (더 빠름)
              </label>
              {models.length > 0 && (
                <div className="vb-field">
                  <label>질문 탭 모델</label>
                  <select value={cfg.askModel || ""}
                    onChange={(e) => setCfg({ ...cfg, askModel: e.target.value })}>
                    <option value="">
                      서버 기본값{defLabel ? ` — ${defLabel}` : ""}
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="vb-hint">
                    {askNote || "단어·문장 탭은 반응 속도 때문에 빠른 모델을 그대로 씁니다. 이 설정은 질문 탭에만 적용됩니다."}
                  </p>
                </div>
              )}
              <button className="vb-done" onClick={() => { persist(); setSetOpen(false); }}>닫기</button>
            </div>
          </div>
        )}
      </div>

      {/* 영역 캡처 오버레이 — .vb-root 직속이라 position:fixed 가 뷰포트 기준으로 잡힌다 */}
      {capMode && capBox && (
        <div className={"vb-cap" + (capBusy ? " busy" : "")}
          style={{ left: capBox.left, top: capBox.top, width: capBox.width, height: capBox.height }}
          onPointerDown={capDown} onPointerMove={capMove}
          onPointerUp={capUp} onPointerCancel={capUp}>
          {!capSel && <div className="vb-caphint">읽고 싶은 부분을 드래그해서 감싸세요 · Escape 로 나가기</div>}
          {capSel && (
            <>
              <div className="vb-capsel"
                style={{ left: capSel.x, top: capSel.y, width: capSel.w, height: capSel.h }} />
              {[["nw", 0, 0], ["ne", 1, 0], ["sw", 0, 1], ["se", 1, 1]].map(([k, cx, cy]) => (
                <div key={k} className="vb-caph" data-caph={k}
                  style={{ left: capSel.x + capSel.w * cx - 11, top: capSel.y + capSel.h * cy - 11 }} />
              ))}
              <div className="vb-capmenu"
                style={{
                  left: Math.max(4, Math.min((capBox.width || 0) - 250, capSel.x + capSel.w / 2 - 125)),
                  top: capSel.y > 62 ? capSel.y - 58 : capSel.y + capSel.h + 10,
                }}
                onPointerDown={(e) => e.stopPropagation()}>
                <button className="vb-capbtn" disabled={!!capBusy} onClick={() => runCapture("read")}>
                  {capBusy === "read" ? "읽는 중…" : "해석"}
                </button>
                <button className="vb-capbtn" disabled={!!capBusy} onClick={() => runCapture("solve")}>
                  {capBusy === "solve" ? "읽는 중…" : "문제풀이"}
                </button>
                <button className="vb-capbtn ghost" disabled={!!capBusy} onClick={() => setCapSel(null)}>다시</button>
                <button className="vb-capbtn ghost" disabled={!!capBusy} onClick={exitCap}>닫기</button>
              </div>
            </>
          )}
        </div>
      )}

      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
    </div>
  );
}
