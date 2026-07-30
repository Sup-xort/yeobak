# 여백 (Yeobaek)

영어 원서·논문을 읽는 한국 대학생을 위한 iPad용 PDF 리더.
단어를 탭하면 뜻과 문맥, 더블탭하면 문장 번역, 드래그하면 구간 번역, 질문 탭에서는 현재 페이지를 근거로 답합니다.

첫 화면은 **서재**입니다. PDF를 열면 서버에 저장되고 표지(1페이지) 카드로 진열됩니다.
폴더를 만들어 카드를 끌어다 정리하고, `⤓` 로 다시 내려받을 수 있습니다.
단어 풀이의 ★ 를 누르면 **단어장**(풀이 시트 네 번째 탭)에 모입니다.
저장된 모든 것(PDF·표지·목록·단어장)은 서버의 `data/` 한 폴더에 있으므로 그것만 백업하면 됩니다 (`DATA_DIR` 로 위치 변경 가능).

## 실행

```bash
npm install
cp .env.example .env      # 값을 채운다 (아래 참고)
npm run build
npm start                 # http://<서버IP>:8787
```

`.env` 필수 항목:

| 키 | 설명 |
|---|---|
| `APP_PASSWORD` | 접속 비밀번호. **반드시 숫자 6자리** — 6자리가 다 차면 자동 로그인되므로 다른 길이면 로그인할 수 없다. 5회 틀리면 IP당 5분 잠금. 한 번 입력하면 30일 유지 |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 로 생성 |
| `NIM_API_KEY` | https://build.nvidia.com 에서 발급 |
| `NIM_MODEL` | 단어·문장 탭 모델. 기본 `meta/llama-3.3-70b-instruct` |
| `NIM_ASK_MODEL` | 질문 탭 기본 모델. 기본 `deepseek-ai/deepseek-v4-pro` |
| `GEMINI_API_KEY` | (선택) NIM 실패 시 폴백 |

개발 중에는 터미널 두 개로:

```bash
npm run dev:server        # 8787 — API
npm run dev               # 5173 — /api 는 8787로 프록시됨
```

## 구조

```
브라우저 (React)  ──POST /api/chat──▶  server/index.js  ──▶  NVIDIA NIM
                                            │                    ↓ 실패 시
                                            └──────────────▶  Gemini
```

- **API 키는 서버에만 있습니다.** 브라우저로 절대 내려가지 않습니다.
- NVIDIA NIM은 `build.nvidia.com` 외의 오리진에 CORS를 열어주지 않으므로 **브라우저에서 직접 호출할 수 없습니다.** 이 프록시가 필수인 이유입니다.
- 프로바이더 선택·폴백·3분 서킷 브레이커는 전부 서버가 처리합니다. 클라이언트는 어느 엔진이 응답했는지를 `X-Engine` 응답 헤더로만 알면 됩니다.
- 서버는 프로바이더와 무관하게 **항상 OpenAI 형식 SSE**를 내보냅니다. Gemini 응답은 `pipeGemini()`가 변환합니다. 덕분에 클라이언트 파서는 하나뿐입니다.
- **탭마다 모델이 다릅니다.** 단어·문장 탭은 첫 토큰 속도가 중요해서 `NIM_MODEL`을 쓰고, 질문 탭만 더 좋은 모델(`NIM_ASK_MODEL`)로 부릅니다. 고를 수 있는 목록은 `server/index.js` 의 `ASK_MODELS` 에 있고, 앱 설정에서 바꿀 수 있습니다 (`GET /api/models`). 클라이언트가 보낸 모델 이름은 이 목록에 있을 때만 받아들입니다.

## 외부 접속

기본은 `0.0.0.0:8787` 이므로 방화벽/보안그룹에서 해당 포트를 열면 iPad에서 바로 붙습니다.
HTTPS가 필요하면 앞단에 nginx를 두고 리버스 프록시하세요 — 서버가 `X-Accel-Buffering: no` 를 보내므로 스트리밍이 끊기지 않습니다.
