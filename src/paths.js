// 여백은 sqhsxp.duckdns.org/yeobaek/ 서브패스에 산다 (2026-08-21 이전, 2026-08-22 마무리).
//
// Vite 의 base 는 index.html 의 <link>/<script> 태그만 다시 쓴다. JS 안의 문자열
// 리터럴("/api/…", "/brand/…")도, public/ 에서 그대로 복사되는 파일(site.webmanifest)도
// 건드리지 않는다. 그래서 base 만 넣고 끝내면 asset 은 멀쩡한데 런타임 경로가 전부
// 루트를 가리킨 채 남아 조용히 404 가 된다 — 실제로 그렇게 리모트 모드·PWA·브랜드
// 아이콘이 한 번 죽었다.
//
// 그래서 런타임 경로는 전부 여기를 거친다. 새 fetch / img src / a href 를 쓸 때
// 루트 절대경로를 박지 말고 u() 로 감싼다.
//
// BASE_URL 은 끝에 슬래시가 붙어 있고("/yeobaek/"), base 가 "/" 로 돌아가도
// 그대로 동작한다.
export const u = (p) => import.meta.env.BASE_URL + String(p).replace(/^\//, "");
