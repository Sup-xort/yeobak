import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 vite(5173)가 /api 요청을 프록시 서버(8787)로 넘긴다.
// 운영에서는 server/index.js 하나가 dist/와 /api를 함께 서빙하므로 프록시가 필요 없다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
