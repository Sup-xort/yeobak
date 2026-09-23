import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 vite(5173)가 API 요청을 프록시 서버(8787)로 넘긴다.
// 운영에서는 server/index.js 하나가 dist/와 /api를 함께 서빙하므로 프록시가 필요 없다.
// 2026-08-21: 여백을 sqhsxp.duckdns.org/yeobaek/ 서브패스로 이전 — asset base 고정.
//
// base 를 바꾸면 같이 바꿔야 하는 곳: public/site.webmanifest (Vite 가 복사만 한다),
// 그리고 아래 프록시 키. 그 외 런타임 경로는 src/paths.js 의 u() 가 알아서 따라온다.
export default defineConfig({
  base: "/yeobaek/",
  plugins: [react()],
  server: {
    proxy: {
      // 앱이 이제 /yeobaek/api/… 로 부른다(u() 가 base 를 붙인다). 운영의 nginx
      // prefix-strip 을 dev 에서 흉내내야 Express 가 아는 /api/… 로 도착한다.
      "/yeobaek/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yeobaek/, ""),
      },
    },
  },
});
