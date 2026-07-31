# Handoff: 여백(Yeobaek) — AI 답변 패널 리디자인 (4a)

## Overview
아이패드·윈도우 노트북에서 PDF를 읽다 생기는 세 가지 요구 — **낱말 뜻**, **문장/구간 해석**, **오려낸 영역에 대한 질문(수학 문제풀이 포함)** — 을 한 표면에서 처리하는 리더 UI입니다.
기존 구현(`Sup-xort/yeobak`, `src/App.jsx`)의 하단/우측 "풀이 시트"를 대체합니다.

채택안은 **4a**입니다. 1a·1b·1c·2a·3a는 같은 파일에 남아 있는 탐색 기록이며 구현 대상이 아닙니다.

### 4a가 기존 구현에서 바꾸는 것
1. 유리(glass) 질감을 **모든 탭에 동일 적용** — 기존 질문 탭의 불투명 sticky 헤더(`.vb-asktop`)·푸터(`.vb-askfoot`, `background:var(--desk2)`)가 시트의 반투명을 깨뜨리던 문제 해결.
2. `🖼 그림` 토글(`.vb-figtog`) 제거 → 첨부는 **썸네일 칩('영역 1' + ✕)** 으로 컴포저 안에 표시.
3. 세그먼트 알약 탭(`.vb-seg`/`.vb-tab`) → **밑줄 인디케이터 탭**. 노란색(`#FFD84D`)은 화면당 primary 한 곳에만.
4. 탭 구성 변경: `단어 · 문장 · 질문 · 단어장` → **`단어 · 질문 · 기록`** (문장 해석은 본문 행간 리본으로, 단어장은 기록 탭에 흡수).
5. 질문 컴포저가 **패널 맨 위**로 이동하고 대화 큐가 **최신 순으로 반전** — iPad 키보드가 올라와도 입력 위치가 고정.
6. **패널 / 카드** 두 가지 배치(노션 peek 방식)와 **라이트 / 다크** 테마.
7. 세션 칩 줄 → **대화 이름 드롭다운**(＋ 새 대화, TTL 표시).
8. 모델 상태줄을 `statView`의 네 단계 + STALL 경고까지 시각화.

## About the Design Files
번들에 든 `.dc.html` 파일은 **디자인 레퍼런스(HTML 프로토타입)** 입니다. 그대로 제품에 넣을 코드가 아닙니다.
목표는 이 화면들을 **대상 코드베이스(여기서는 기존 React + Vite 앱 `src/App.jsx`)의 패턴으로 재구현**하는 것입니다.
- `support.js`는 프로토타입 런타임일 뿐 제품과 무관합니다. 복사하지 마세요.
- 프로토타입은 스타일을 전부 inline으로 씁니다. 실제 구현은 기존 `CSS` 문자열(`src/App.jsx` 상단, `.vb-*` 클래스 체계)을 확장하는 편이 자연스럽습니다.
- 텍스트/데이터는 전부 더미입니다. 실제 값은 기존 상태(`word`, `sent`, `askLog`, `vocab`, `sessions`, `aiStat`)에서 옵니다.

## Fidelity
**High-fidelity.** 색·타이포·간격·라운드·모션 값이 확정값입니다. 이 문서의 수치를 그대로 쓰세요.
단, PDF 렌더링(pdf.js 캔버스 + 텍스트 레이어)·서버 통신·SSE 파싱은 기존 구현을 그대로 재사용합니다. 바뀌는 것은 **답변 표면의 UI뿐**입니다.

---

## Screens / Views

프레임 기준 크기: **1160 × 760** (아이패드 가로 / 노트북 창을 상정). 좁은 화면 규칙은 "Responsive"에 별도 기술.

### 1) 리더 셸 (Reader shell)
**Purpose** — PDF를 읽는 기본 화면. 상단 툴바 + 본문 + (패널 또는 카드).

**Layout**
- 루트: `display:flex; flex-direction:column; height:100%`, 배경 `theme.bg`.
- 툴바: `flex:0 0 auto`, `padding:10px 14px`, `gap:4px`, `background:theme.bar`, `backdrop-filter:blur(14px)`, `border-bottom:1px solid theme.line`, `z-index:6`.
- 본문 영역: `flex:1; display:flex; position:relative; overflow:hidden`.
- 종이(page): 폭 `660px` 고정, `background:#FFFEFB`(테마 무관), `border-radius:4px`, `box-shadow:0 1px 2px rgba(21,19,15,.1), 0 16px 40px rgba(0,0,0,.22)`, `padding:54px 62px 40px`. 컨테이너는 `justify-content:center; padding:30px 0 0`.
- 패널 모드일 때 컨테이너에 `padding-right: <패널 폭>`, `transition:padding .3s cubic-bezier(.2,.9,.25,1)`.

**툴바 구성 (좌→우)**
| 요소 | 사양 |
|---|---|
| 목차 버튼 | 36×36, `border-radius:12px`, 아이콘 17px, stroke 1.7, `M4 6h16M4 12h16M4 18h10` |
| 서재 버튼 | 동일 규격, 책 3권 아이콘 `M4 4.5h4V20H4zM10 4.5h4V20h-4zM15.6 6l3.9-1L22 19l-3.9 1z` |
| 문서명 | `flex:1`, 13px, `theme.muted`, ellipsis |
| 페이지 | 12.5px, `tabular-nums`, `padding:0 10px` |
| 오려내기 | 높이 36, `padding:0 13px`, 아이콘 16px + 라벨 13px, `gap:7px` |
| ☾/☀ | 36×36, 배경 `theme.fill` (테마 토글) |
| 구분선 | 1×20, `theme.line`, `margin:0 6px` |
| 패널/카드 세그먼트 | 컨테이너 `padding:3px; border-radius:13px; background:theme.fill`; 버튼 높이 30, `padding:0 12px`, `border-radius:10px`, 12.5px; 선택 시 배경 `#FFFEFB`(라이트) / `rgba(255,255,255,.1)`(다크), `font-weight:600`, 라이트에서만 `box-shadow:0 1px 3px rgba(21,19,15,.12)` |
| 단어/질문/기록 세그먼트 | 위와 동일 규격, `margin-left:6px` |

**본문 인터랙션**
- 낱말 1탭 → 단어 탭 갱신. 선택 낱말 하이라이트는 **밑줄 형광펜**: `background:linear-gradient(to top,#FFD84D 0 3px,transparent 3px)` — 글자를 덮지 않는 기존 방식(`.vb-hl`)을 그대로 유지.
- 문장 2탭 → 원문 **바로 아래에 행간 리본** 삽입: `padding-left:14px; border-left:2px solid #1F9E8B`, sans 14px/1.7, `color:#4A463F`, 하단에 11px `#A39D91` 캡션("두 번 탭한 문장 · 해석").
- 본문 타이포: serif `'Iowan Old Style',Charter,Georgia,serif`, 16.5px/1.9, `color:#15130F`, `text-wrap:pretty`. 소제목: sans 10.5px, `letter-spacing:.18em`, uppercase, `#A39D91`.

### 2) 답변 표면 — 패널 모드
- `position:absolute; top:0; right:0; bottom:0; height:auto`, `border-radius:0`, `border-left:1px solid theme.line`, 그림자 없음.
- 폭은 탭에 따라: **단어 372px · 질문 400px · 기록 268px**. `transition:width .3s cubic-bezier(.2,.9,.25,1)`.
- 닫힘: `transform:translateX(101%)`.

### 3) 답변 표면 — 카드 모드
- `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%)`, **width 720px, height 78%**, `border-radius:22px`, `border:1px solid theme.line2`, `box-shadow:theme.shadow`.
- 뒤에 스크림: `inset:0; background:rgba(10,9,8,.34); z-index:7; pointer-events:none; transition:opacity .3s` (카드일 때만 opacity 1). **본문 클릭을 막지 않습니다** — 카드가 떠 있어도 낱말 탭이 동작해야 합니다.
- 닫힘: `translate(-50%,-50%) scale(.96)` + opacity.
- 본문은 밀리지 않음(`padding-right:0`).

**공통(두 모드)**
- 유리: `background:theme.glass`, `backdrop-filter:blur(26px) saturate(1.35)`.
- `transition: transform .32s cubic-bezier(.2,.9,.25,1), width .3s, height .3s, border-radius .3s, background .3s`.
- 헤더: `padding:16px 20px 0`, `gap:16px`, `border-bottom:1px solid theme.line`.
  - 탭 버튼: 14px, `padding-bottom:12px`, 선택 시 `color:theme.ink; font-weight:600` + 하단 2px 인디케이터(`theme.star`), 비선택 `theme.muted`.
  - 우측: 모드 전환 ⤢(30×30, 아이콘 15px, `M4 9V5a1 1 0 011-1h4M20 15v4a1 1 0 01-1 1h-4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4`), 닫기 ✕(30×30, 15px).

### 4) 단어 탭
`padding:22px 20px 28px`, 진입 시 `animation:rise .22s ease-out`.
1. 헤드: 표제어 serif **33px**/1.1, `letter-spacing:-.01em`, `color:theme.ink`. 아래 품사·발음 11px, `letter-spacing:.1em`, uppercase, `theme.faint`.
2. ★ 버튼: 36×36, `border-radius:12px`, 아이콘 19px stroke 1.6. 담김 상태 = `stroke/fill: theme.star`, 배경 `theme.accBg`, 테두리 `theme.accBd`. 미담김 = `stroke:theme.faint`, `fill:none`, 배경 없음, 테두리 `theme.line2`.
3. **문맥 뜻 카드가 사전보다 위** — `margin-top:20px; padding:16px; border-radius:16px; background:theme.accBg; border:1px solid theme.accBd`. 라벨 10.5px/`.14em`/uppercase/`theme.accInk`, 본문 15.5px/1.7/`theme.accTx`.
4. 사전: 라벨(10.5px, `.14em`, uppercase, `theme.faint`) + 항목 `display:flex; gap:10px`, 번호 11px `tabular-nums` `theme.faint`, 뜻 15px/1.6 `theme.sub`. 항목 간 `gap:9px`.
5. 원문: serif 14.5px/1.7 `theme.muted`, `border-left:2px solid theme.line2; padding-left:14px`.
6. 액션 2개: 높이 38, `padding:0 14px`, `border-radius:12px`, `border:1px solid theme.line2`, 13.5px — "문장 해석", "이 낱말로 질문".

### 5) 질문 탭
**상단 고정 블록** (`padding:14px 18px 12px; border-bottom:1px solid theme.line`) — 스크롤되지 않습니다.
1. **대화 줄**: 대화 이름 드롭다운 버튼(높이 28, `border-radius:9px`, `border:1px solid theme.line2`, 배경 `theme.fill`, 12.5px, 좌측 5px 점 `theme.star`, 우측 chevron 11px — 열리면 `rotate(180deg)`), 그 옆 TTL 텍스트(11.5px `theme.faint`, "1시간 52분 남음"), 우측 끝 `＋ 새 대화`(높이 28, `border:1px dashed theme.line2`).
   - 드롭다운 패널: `border-radius:14px`, `background:theme.menu`, `border:1px solid theme.line2`, `box-shadow:0 8px 24px rgba(0,0,0,.2)`, 항목 `padding:10px 12px` (점 + 제목 13px + 우측 메타 11px), 선택 항목 배경 `theme.accBg`·`font-weight:600`. 하단 설명 11px/1.6 `theme.faint`: "한 대화 안에서만 앞의 문답을 기억합니다 · 마지막 질문에서 2시간 뒤 사라짐 · 영역을 오려내면 새 대화가 열립니다".
2. **컴포저**: `display:flex; align-items:flex-end; gap:8px; padding:8px 8px 8px 14px; border-radius:18px; background:theme.input; border:1px solid theme.line2`.
   - textarea: `min-height:30px; max-height:96px; resize:none; border:0; background:none; font-size:15px; line-height:1.5` (iOS 확대 방지를 위해 실제 구현에서는 16px 권장 — 기존 `.vb-askin`도 16px).
   - 보내기: 36×36, `border-radius:14px`, `background:#FFD84D`, 아이콘은 **위 화살표** `M12 19V5M5 12l7-7 7 7` (17px, stroke 2).
3. **첨부/모델 줄** (`margin-top:9px`): 썸네일 칩(높이 auto, `padding:5px 8px 5px 6px`, `border-radius:10px`, 배경 `theme.fill`, 24×17 썸네일 + "영역 1" + ✕) · `＋ 오려내기`(dashed) · 우측 **모델 토글**(높이 28, `border-radius:10px`, 12.5px, chevron).
   - 모델 드롭다운: `ASK_MODELS` 5종을 label + note로 나열, 기본 모델에 "기본" 배지, 선택 항목에 ✓(`theme.star`)와 배경 `theme.accBg`. 하단 주석: "단어·문장 탭은 반응 속도 때문에 빠른 모델(gpt-oss-120b)을 그대로 씁니다 — 이 선택은 질문 탭에만 적용됩니다."

**스크롤 영역** (`padding:0 20px 24px`)
1. **모델 상태 카드** — 아래 "모델 상태" 절 참조.
2. 구분선 행: "최신"(11px, `.12em`, uppercase, `theme.faint`) + `flex:1` 1px 라인.
3. **최신 문답** — 질문 말풍선: `padding:10px 14px; border-radius:14px; background:theme.qBg; color:theme.qInk; font-weight:600; font-size:14.5px`. 답변: 15px/1.85 `theme.ink`, 문단 `margin-bottom:10px`, 강조 `font-weight:650`.
   - 수식/목록 블록: `padding:14px 16px; border-radius:14px; background:theme.fill; font-size:14.5px; color:theme.sub; overflow-x:auto; overscroll-behavior-x:contain` — **긴 LaTeX는 이 블록만 가로 스크롤**(페이지 전체가 밀리지 않도록). 기존 `.vb-mathblk`와 같은 목적.
   - 스트리밍 커서: `display:inline-block; width:7px; height:15px; background:theme.star; vertical-align:-2px`, 0.9s steps(2) 깜빡임.
4. **지난 문답** — `opacity:.66`, 질문은 `theme.fill` 배경의 작은 말풍선, 답은 2줄 요약 + "펼치기" 버튼(높이 30, `border:1px solid theme.line2`).
5. 후속 질문 추천 버튼은 **넣지 않습니다** (팀 결정).

### 6) 기록 탭 (폭 268px)
- `padding:16px 14px 24px`. 헤더: "7쪽"(11px, `.12em`, uppercase) + 라인 + "전체" 버튼(높이 26, `border-radius:9px`, 배경 `theme.fill`).
- 항목: `padding:10px 8px; border-radius:12px`, 1행 = 5px 점 + 제목(13.5px, 낱말은 serif) + 우측 시각(10.5px `tabular-nums`), 2행 = 12px/1.5 `theme.muted`, 2줄 클램프, `padding-left:12px`.
- 점 색으로 종류 구분: 낱말 `theme.star` · 질문 `#FFD84D` · 해석 `#1F9E8B`.
- 항목 탭 → 해당 탭으로 전환(낱말이면 단어 탭 + 그 낱말 로드).

## 모델 상태 (기존 `statView` 그대로)
카드: `padding:12px 14px; border-radius:14px; background:theme.statBg; border:1px solid theme.statBd`.
- 1행: 7px 점(1.1s pulse) + 상태 문구(13px, 600) + 우측 카운트(12px `tabular-nums`) + `중단` 버튼(높이 28, `padding:0 10px`, `border-radius:9px`, 11.5px, **`white-space:nowrap; flex:0 0 auto`** — 한글 2자가 줄바꿈되지 않도록).
- 2행: 4단계 진행 바 — `보냄 · 배정 · 생각 · 답변`. 각 칸 `flex:1`, 3px 바 + 10px 라벨. 지난 단계 `theme.accBd`, 현재 `theme.star`(경고 시 `warnDot`), 이후 `theme.line2`. 현재 라벨만 600.
- 3행: 엔진 배지(`padding:2px 6px; border-radius:5px; background:theme.engBg; color:theme.engFg`) + 모델 id 꼬리 + 경과 + "질문 탭" + 우측 대화 TTL. 전부 11px `tabular-nums`.
- 4행(선택): 힌트 11.5px/1.6.

문구는 `src/App.jsx` `statView`를 그대로 사용:
| phase | 문구 | 비고 |
|---|---|---|
| `send` | `차례를 기다리는 중 · N초` | 45초(STALL_WAIT) 이상이면 warn |
| `wait` | `모델이 계산 중 · N초 · <엔진 모델>` | 45초 이상 → `N초째 첫 글자가 오지 않습니다 … 모델이 식었으면 1분까지 걸립니다`, warn |
| `think` | `생각하는 중 · N자 · N초 · <엔진 모델>` | **절대 warn 아님** (속생각이 흐르는 동안은 살아 있음이 확실) |
| `stream` | `답변 받는 중 · N자 · N초 · <엔진 모델>` | 마지막 토큰 이후 STALL_GAP 초과 시 `N초째 멈춰 있습니다 …`, warn |
| 캡처 단계 | `해석하는 중` / `옮겨적는 중` / `그림을 보고 푸는 중` / `푸는 중` 접두 | `stepped()` |

warn 스타일: 배경 `theme.warnBg`, 테두리 `theme.warnBd`, 라벨 `theme.warnFg`, 보조 `theme.warnSub`, 점 `theme.warnDot`, 중단 버튼 `background:theme.stopBg; color:theme.stopFg; font-weight:600`.

## Interactions & Behavior
- **탭 전환**: 툴바 세그먼트 또는 패널 헤더 탭. 패널이 닫혀 있으면 열면서 전환.
- **모드 전환**(패널↔카드): 툴바 세그먼트 또는 패널 헤더 ⤢. **탭·스크롤 위치·대화 상태는 유지**되어야 합니다(컨테이너만 바뀜 — 내용 컴포넌트를 언마운트하지 마세요).
- **테마 전환**: 툴바 ☾/☀. 종이(PDF)는 항상 흰색. 데스크는 다크에서 `#161513`.
- **낱말 탭** → 단어 탭 + 패널 열기, 본문 하이라이트 이동.
- **질문 전송** → 컴포저는 제자리, 새 문답이 "최신" 아래 **맨 위로** 삽입(큐 반전). 스크롤을 강제로 내리지 않습니다.
- **캡처(오려내기)** → 새 대화 생성 + 썸네일 칩 첨부(기존 규칙 유지).
- 애니메이션: 진입 `rise` = `opacity 0→1, translateY(6px)→0`, `.18~.22s ease-out`. 컨테이너 이동 `.3~.32s cubic-bezier(.2,.9,.25,1)`.
- `prefers-reduced-motion: reduce` 시 전부 해제(기존 CSS에 이미 존재).

### 스크롤바 (통일 규칙 — 신규)
디자인 톤을 깨는 기본 스크롤바를 전역에서 교체합니다. 라이트·다크 공용 중성 회색:
```css
*{scrollbar-width:thin;scrollbar-color:rgba(140,135,124,.42) transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(140,135,124,.34);border-radius:99px;
  border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-thumb:hover{background:rgba(140,135,124,.58);
  border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-corner{background:transparent}
```
가로로 넘치는 요소(수식 블록, 표, 코드)는 요소 자체에 `overflow-x:auto; overscroll-behavior-x:contain`을 주어 **그 블록만** 스크롤되게 합니다.

### Responsive
- **≥ 880px (기존 `WIDE`)**: 위 사양 그대로. 패널 모드 기본.
- **< 880px (아이패드 세로 등)**: 패널 → **화면 폭 전체 바텀 시트**(기존 `.vb-sheet` 위치), 카드 모드 → 좌우 16px 인셋. 툴바의 모드 세그먼트는 숨기고 탭 세그먼트만 노출.
- 터치 기기: 모든 히트 타깃 최소 44px (기존 `@media (pointer:coarse)` 규칙 유지).

## State Management
기존 상태를 최대한 재사용합니다.
| 상태 | 설명 | 기존 대응 |
|---|---|---|
| `panelMode` | `"panel" \| "card"` | 신규 (localStorage 저장 권장) |
| `dark` | 테마 | 신규 (localStorage) |
| `panelOpen` | 표면 열림 | `sheetOpen` |
| `tab` | `"word" \| "ask" \| "log"` | `tab` (값 변경) |
| `word` / `sent` | 낱말·문장 결과 | 동일 |
| `sessions` / `curSess` | 대화 목록·현재 대화 | 동일 (칩 → 드롭다운) |
| `askLog` | 문답 (렌더 시 역순) | 동일 |
| `aiStat` / `statView` | 모델 상태 | 동일 |
| `cfg.askModel` / `models` | 모델 선택 | 동일 (`GET /api/models`) |
| `vocab` | ★ 낱말 | 기록 탭 소스 |
| `logItems` | 낱말·해석·질문 통합 타임라인 | **신규** — vocab + 해석 기록 + 세션 문답을 시각순 병합 |

## Design Tokens

### Light
| 토큰 | 값 |
|---|---|
| bg / desk | `#F4F1EB` |
| bar | `rgba(244,241,235,.92)` |
| paper | `#FFFEFB` (테마 무관) |
| ink | `#15130F` |
| sub | `#3A362F` |
| muted | `#8C877C` |
| faint | `#A39D91` |
| line / line2 / lineSoft | `rgba(21,19,15,.09)` / `.13` / `.06` |
| glass | `rgba(255,254,251,.84)` |
| fill | `rgba(21,19,15,.05)` |
| input / menu | `#FFFEFB` |
| accBg / accBd / accInk / accTx | `rgba(255,216,77,.16)` / `rgba(201,162,39,.28)` / `#8A6F14` / `#241F00` |
| star | `#C9A227` |
| qBg / qInk | `rgba(255,216,77,.28)` / `#241F00` |
| statBg / statBd | `rgba(21,19,15,.035)` / `rgba(21,19,15,.09)` |
| warnBg / warnBd / warnFg / warnSub / warnDot | `rgba(228,113,63,.10)` / `rgba(196,84,38,.32)` / `#8A3A15` / `#A0512C` / `#C45426` |
| stopBg / stopFg | `#C45426` / `#FFF6F1` |
| engBg / engFg | `rgba(255,216,77,.3)` / `#5C4A08` |
| shadow | `0 26px 70px rgba(21,19,15,.28)` |

### Dark
| 토큰 | 값 |
|---|---|
| bg | `#1A1917` · desk `#161513` |
| bar | `rgba(26,25,23,.92)` |
| ink / sub / muted / faint | `#F1EFE9` / `#D6D2CA` / `#8E8A81` / `#5F5B54` |
| line / line2 / lineSoft | `rgba(255,255,255,.09)` / `.14` / `.06` |
| glass | `rgba(26,25,23,.66)` |
| fill | `rgba(255,255,255,.06)` |
| input / menu | `rgba(0,0,0,.22)` / `#232220` |
| accBg / accBd / accInk / accTx | `rgba(255,216,77,.10)` / `rgba(255,216,77,.24)` / `#D9BC55` / `#F1EFE9` |
| star | `#FFD84D` |
| qBg / qInk | `#FFD84D` / `#241F00` |
| statBg / statBd | `rgba(255,255,255,.05)` / `rgba(255,255,255,.09)` |
| warnBg / warnBd / warnFg / warnSub / warnDot | `rgba(228,113,63,.14)` / `rgba(228,113,63,.4)` / `#FFB9A3` / `#E4B8AE` / `#FF9A8A` |
| stopBg / stopFg | `#FF9A8A` / `#2A1512` |
| engBg / engFg | `rgba(255,216,77,.16)` / `#E0C568` |
| shadow | `0 26px 70px rgba(0,0,0,.6)` |

### 고정값(테마 무관)
- 노란 강조 `#FFD84D`, 그 위 글자 `#241F00`
- 청록(문장/해석) `#1F9E8B`(라이트) · `#6FD3C0`(다크)
- 형광펜 하이라이트 `linear-gradient(to top,#FFD84D 0 3px,transparent 3px)`

### Type scale
| 용도 | 값 |
|---|---|
| 본문(PDF) | serif 16.5px / 1.9 |
| 표제어 | serif 33px / 1.1, `-.01em` |
| 기록·단어장 표제어 | serif 19px |
| 답변 본문 | sans 15px / 1.85 |
| 문맥 뜻 | 15px / 1.7 |
| 사전 뜻 | 15px / 1.6 |
| 입력 | 15~16px / 1.5 |
| 탭 | 14px |
| 버튼·칩 | 12~13.5px |
| 라벨(uppercase) | 10.5px, `letter-spacing:.14em` |
| 메타·상태 | 11~12px, `tabular-nums` |

Fonts — sans: `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", "Segoe UI", system-ui, sans-serif` / serif: `"Iowan Old Style", Charter, "Palatino Linotype", Georgia, "Times New Roman", serif`. (기존 `--sans`/`--serif` 그대로)

### Radius / Spacing
- Radius: 아이콘 버튼 9~12 · 칩 9~10 · 카드/블록 14~16 · 컴포저 18 · 카드 모드 22 · 원형 99
- 패널 내부 좌우 패딩 20 (기록 탭만 14)
- 요소 간 gap 6~10, 섹션 간 마진 20~22

## Assets
새 이미지 에셋 없음. 모든 아이콘은 24×24 viewBox의 인라인 stroke SVG(`fill:none; stroke-width:1.7~1.8; stroke-linecap:round; stroke-linejoin:round`)이며 기존 `src/App.jsx`에 이미 있는 path를 재사용합니다. 새로 추가된 두 개만:
- 보내기(위 화살표): `M12 19V5M5 12l7-7 7 7`
- 모드 전환(⤢): `M4 9V5a1 1 0 011-1h4M20 15v4a1 1 0 01-1 1h-4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4`
프로토타입의 회색 사선 패턴(`repeating-linear-gradient(135deg, …)`)은 **캡처 썸네일 자리표시자**입니다. 실제로는 캡처된 JPEG base64를 넣습니다.

## Files
| 파일 | 내용 |
|---|---|
| `여백 리디자인.dc.html` | 탐색 5안. **구현 대상은 `#4a` 섹션** (맨 위). 1a/1b/1c/2a/3a는 참고용 |
| `여백 현재 UI.dc.html` | 기존 UI 재현본 — 무엇이 바뀌는지 비교용 |
| `support.js` | 프로토타입 런타임. 구현과 무관, 복사하지 말 것 |

원본 코드베이스: `Sup-xort/yeobak` (branch `main`)
- UI 전부: `src/App.jsx` (CSS 26–535행, 렌더 2440–2983행)
- 상태줄 로직: `src/App.jsx` `statView` 942–978행, `phaseHook` 915–926행
- 모델 목록: `server/index.js` `ASK_MODELS` 24–31행
- 마크다운/KaTeX 렌더: `src/rich.jsx` (그대로 재사용)
