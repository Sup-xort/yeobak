/* ───────────────────────── 설정 ───────────────────────── */
export const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
/* API 키는 전부 서버(.env)에 있다. 브라우저는 /api/chat 만 부른다. */
export const DEFAULT_CFG = {
  useDict: true,
  tapModel: "", // 단어·문장 탭·영역 캡처 모델. 빈 값이면 서버 기본값
  askModel: "", // 질문 탭 모델. 빈 값이면 서버 기본값
};

/* ── 질문 탭 세션 ──
   대화는 세션 단위로 묶인다. 세션 안에서만 모델이 앞의 문답을 기억한다.
   영역을 캡처하면 늘 새 세션이 열린다 — 캡처는 대개 앞의 대화와 무관한
   새 문제이고, 섞이면 모델이 엉뚱한 문제의 조건을 끌고 온다.
   2시간이 지난 세션은 버린다. 마지막 활동 기준이라 대화가 이어지는 동안은 살아 있다. */
export const SESS_TTL = 2 * 60 * 60 * 1000;
export const SESS_MAX = 20;      // 이보다 많아지면 오래된 것부터 버린다
export const WIDE = 880;
/* 서재 카드의 "매트" 규격 — 슬롯 높이(px)와 좁은 화면 축소율, 비율을 모를 때 쓰는 A4 세로.
   SLOT_H 는 App.css 의 .vb-slot / .vb-slot.sm 높이와 같이 움직여야 한다. */
export const SLOT_H = 132;
export const NARROW_S = 114 / SLOT_H; // .vb-slot.sm 이 114px
export const A4_RATIO = 210 / 297;
/* 터치 기기 여부 — 로그인 키패드에서 OS 키보드를 언제 띄울지 정하는 데만 쓴다 */
export const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer:coarse)").matches;
/* 애플펜슬 드래그 캡처 토글을 사파리에서만 보여준다 — 이 제스처는 사파리/웹킷의
   PointerEvent pointerType:"pen" 구분에 기대는데, 크롬 계열은 아이패드에서도 펜을
   touch 로 뭉뚱그려 보고할 때가 있어 다른 브라우저에서는 조용히 안 켜지는 게 낫다. */
export const IS_SAFARI =
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

/* 필기 도구 프리셋 — 굵기는 pt(배율 1 단위 = 종이 위 1/72인치 ≈ 0.353mm). 펜 1.4pt ≈ 0.5mm 볼펜.
   화면 px 가 아니라 종이 단위라 확대하면 같이 굵어진다(굿노트도 mm). 내보낸 PDF 의 /Ink 굵기도 이 값.
   세 칸은 기본값일 뿐 — 고른 칸을 한 번 더 누르면 슬라이더로 그 칸의 굵기를 바꾼다(ws 에 저장). */
export const INK_PEN_COLORS = ["#1e1b1b", "#1d4ed8", "#dc2626", "#15803d", "#7c3aed"];
export const INK_HL_COLORS = ["#fde047", "#86efac", "#f9a8d4", "#93c5fd", "#fdba74"];
export const INK_PEN_W = [0.8, 1.4, 2.4];
export const INK_HL_W = [6, 10, 16];
/* 확대 범위 — 600% 는 사용자 요청(2026-10-08, 필기·작은 첨자 보기). 쪽 캔버스는 MAX_PX 에서 해상도가
   더 안 오르지만 화면에 보이는 부분은 선명화 조각(renderDetails)이 기기 해상도로 다시 그린다 */
export const ZOOM_MIN = 0.3, ZOOM_MAX = 6;
export const INK_W_RANGE = { pen: [0.3, 6], hl: [2, 30] };
export const PT_MM = 25.4 / 72;
/* 저장된 도구 설정을 지금 모양({c, w, ws:[3], wi})으로 — 슬라이더 전(ws 없음) 설정도 받는다 */
export const inkToolCfg = (t, def, colors) => {
  const ws = Array.isArray(t?.ws) && t.ws.length === 3 && t.ws.every((v) => v > 0) ? [...t.ws] : [...def];
  let wi = Number.isInteger(t?.wi) && t.wi >= 0 && t.wi < 3 ? t.wi : -1;
  if (wi < 0) { wi = ws.indexOf(t?.w); if (wi < 0) { wi = 1; if (t?.w > 0) ws[1] = t.w; } }
  return { c: t?.c || colors[0], ws, wi, w: ws[wi] };
};
