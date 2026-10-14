/* ── 서재 인사말 ──
   시간대(새벽·아침·낮·저녁·밤) × 맥락(처음·이어읽기·오랜만) 두 축에서 문장을 고른다.
   문구 구조는 design_handoff_yeobaek_library_and_brand/여백 서재.dc.html 의 SLOTS 를
   그대로 옮겼다 — 다만 그 시안은 전부 더미 문구("7쪽" 같은 고정 숫자)라, 여기서는 실제
   서재 데이터(최근 연 문서 제목·쪽수)로 채운다. "이어읽기" 인지 "오랜만" 인지는 그 문서의
   lastOpenedAt 이 갈라서 정한다(48시간 기준).
   같은 문장이 연달아 뜨지 않도록 직전에 보여준 조합의 키를 localStorage 에 남겨 두고
   다음 선택에서 제외한다 — 서재 화면은 매번 새로 마운트되지 않으니(SPA), 서재를 다시
   열 때마다가 아니라 앱을 새로 불러올 때 한 번만 고른다(walk-in 인사말이지 실시간 위젯이 아니다). */
const GREET_STAMP = ["새벽", "아침", "낮", "저녁", "밤"];
const greetTimeIdx = (h) => (h < 5 ? 0 : h < 11 ? 1 : h < 17 ? 2 : h < 21 ? 3 : 4);
const GREET_DORMANT_HOURS = 96; // 이보다 오래 안 열었으면 "오랜만"

const GREET_NEW = [
  ["처음 오셨네요.", "PDF를 끌어다 놓거나 위의 'PDF 추가'로 서재를 채워보세요."],
  ["여백에 오신 걸 환영합니다.", "단어는 탭 한 번, 문장은 두 번, 구간은 드래그로 풀이합니다."],
  ["빈 서재입니다.", "자료를 넣으면 표지와 함께 여기 꽂힙니다."],
];
const greetDormant = (at) => [
  ["오랜만이네요.", at ? `${at}가 그대로 남아 있습니다.` : "서재를 둘러볼까요?"],
  ["다시 만나 반갑습니다.", "새로 시작해도, 이어서 봐도 좋습니다."],
  ["한동안 안 오셨네요.", at ? `${at}에서 이어가 볼까요?` : "새 자료를 열어볼까요?"],
];
const greetResume = (at) => [
  [ // 새벽
    ["아직 아무도 깨지 않았네요.", "조용한 시간엔 어려운 장이 더 잘 읽히더군요."],
    ["밤을 넘기셨군요.", "15분만 더 읽고 덮는 것도 좋은 선택입니다."],
    ["불 켜진 방이 여기 하나.", at ? `${at}에서 이어가시겠어요?` : "이어서 읽어볼까요?"],
  ],
  [ // 아침
    ["좋은 아침입니다.", at ? `${at}에서 멈추셨어요.` : "오늘도 좋은 하루 보내세요."],
    ["오늘 첫 페이지를 열어볼까요.", "아침엔 새 챕터를 시작하기 좋습니다."],
    ["일찍 오셨네요.", at ? `${at}, 짧게 이어가 볼까요?` : "짧게 한 챕터 어떠세요."],
  ],
  [ // 낮
    ["이어서 읽을 준비가 되셨나요.", at ? `${at}에서 기다리고 있습니다.` : "새 자료를 열어볼까요?"],
    ["한낮의 30분.", at ? `${at}로 돌아가 볼까요?` : "잠깐 짬을 내 읽어볼까요?"],
    ["다시 오셨군요.", "읽던 자리로 바로 갈까요, 아니면 새 자료를 열까요?"],
  ],
  [ // 저녁
    ["하루를 덮기 전에, 한 챕터.", at ? `${at}가 기다리고 있습니다.` : "가볍게 한 챕터 어떠세요."],
    ["저녁입니다.", "가벼운 걸 읽어도 좋고, 읽던 곳으로 돌아가도 좋습니다."],
    ["수고하셨어요.", at ? `${at}가 그대로 있습니다.` : "오늘 하루도 고생 많으셨어요."],
  ],
  [ // 밤
    ["늦은 시간이네요.", "짧게 읽고 덮으시겠어요? 자리는 기억해두겠습니다."],
    ["오늘의 마지막 페이지.", "어려운 장은 내일 아침으로 미뤄도 괜찮습니다."],
    ["조용한 밤입니다.", at ? `${at}에서 이어가 볼까요?` : "화면을 어둡게 해두었어요."],
  ],
];

export function pickGreeting(libData, storageKey = "yeobaek.greet") {
  const now = new Date();
  const timeIdx = greetTimeIdx(now.getHours());
  const stamp = `${GREET_STAMP[timeIdx]} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const files = libData?.files || [];
  const recent = files.length
    ? [...files].sort((a, b) => (b.lastOpenedAt || b.at || 0) - (a.lastOpenedAt || a.at || 0))[0]
    : null;
  const hoursSince = recent ? (Date.now() - (recent.lastOpenedAt || recent.at || 0)) / 3_600_000 : Infinity;
  const at = recent
    ? `《${recent.name}》 ${recent.lastPage || 1}쪽${recent.totalPages ? ` · 전체 ${recent.totalPages}쪽` : ""}`
    : "";

  let mode, pool;
  if (!files.length) { mode = "new"; pool = GREET_NEW; }
  else if (hoursSince > GREET_DORMANT_HOURS) { mode = "dormant"; pool = greetDormant(at); }
  else { mode = "resume"; pool = greetResume(at)[timeIdx]; }

  let last = "";
  try { last = localStorage.getItem(storageKey) || ""; } catch {}
  const keyOf = (i) => `${mode}:${timeIdx}:${i}`;
  const idxPool = pool.map((_, i) => i);
  const candidates = idxPool.filter((i) => keyOf(i) !== last);
  const pick = candidates.length ? candidates : idxPool;
  const idx = pick[Math.floor(Math.random() * pick.length)];
  try { localStorage.setItem(storageKey, keyOf(idx)); } catch {}

  const [line, sub] = pool[idx];
  return { stamp, line, sub };
}
