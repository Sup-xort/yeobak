# 여백 (Yeobaek)

아이패드용 한국어 PDF 리더. 단어 탭 → 사전 + 문맥 풀이, 드래그 → 구간 해석, 질문 탭 → 책 본문을 근거로 답,
영역 캡처 → 그림·수식 읽기. 서재·단어장·필기·작은 노트.

Vite + React SPA 와 Express 서버 하나. 저장되는 건 전부 `data/` 한 폴더라 그것만 백업하면 된다.

## 실행

```bash
npm install
cp .env.example .env      # 값을 채운다
npm run build
npm start                 # http://<서버IP>:8787
```

개발 중에는 터미널 두 개로:

```bash
npm run dev:server        # 8787 — API
npm run dev               # 5173 — /api 는 8787로 프록시됨
```

## 폴더

```
src/       프론트엔드 (App.jsx 가 본체)
server/    Express — index.js(라우트), models.js(모델 찾기·선택), remote.js(질문 대화 저장·중계), annots.js(PDF 필기)
scripts/   빌드 보조 (gzip-dist, make-icons)
public/    아이콘·PWA 매니페스트
data/      운영 데이터 (gitignored)
```

API 키는 서버에만 있다 — NVIDIA NIM 은 브라우저 CORS 를 막아서 서버 프록시가 필수다.
구조·운영 세부는 `CLAUDE.md`.
