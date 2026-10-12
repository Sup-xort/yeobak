/* 빌드 뒤 dist/assets 의 js·css·svg 옆에 .gz 를 미리 만들어 둔다 — server/index.js 가 받는 쪽이
   gzip 을 받으면 이걸 그대로 보낸다. nginx 에서 gzip 을 켜지 않은 이유: 이 서버는 HTTP/1.1 에
   chunked_transfer_encoding off 라, nginx 가 압축하면 길이를 모르는 응답이 되어 매번 연결을 끊는다.
   미리 압축한 파일은 길이가 있다. (719KB → 230KB, 2026-10-09) */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");
let n = 0, before = 0, after = 0;
for (const f of fs.readdirSync(dir)) {
  if (!/\.(js|css|svg)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(dir, f));
  const gz = zlib.gzipSync(src, { level: 9 });
  if (gz.length >= src.length * 0.9) continue; // 거의 안 줄면 안 만든다
  fs.writeFileSync(path.join(dir, f + ".gz"), gz);
  n++; before += src.length; after += gz.length;
}
console.log(`gzip: ${n}개 ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB`);
