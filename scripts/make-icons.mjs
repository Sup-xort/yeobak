/* 브랜드 아이콘 PNG 굽기 — public/brand/yeobaek-icon.svg 의 작도(128 그리드)를 그대로 옮겼다.
   핸드오프로 받은 png/ 중 icon-180.png 이 deflate 스트림째 깨져 있었는데(첫 블록부터 해제 불가),
   그 파일을 요청하는 건 사파리의 apple-touch-icon 뿐이라 사파리에서만 아이콘이 깨져 보였다.
   이미지 라이브러리를 안 쓰고 zlib 만으로 굽는 이유는 서버에 sharp/ImageMagick 이 없어서다.

   내보내는 것 두 가지:
   - icon-180.png        모서리 둥근 투명 배경 (브랜드 에셋 세트의 규격 그대로)
   - icon-180-square.png 모서리 없는 불투명 정사각 — apple-touch-icon 전용.
     iOS 는 apple-touch-icon 의 투명 픽셀을 검정으로 합성한 뒤 자기 마스크를 다시 씌워서,
     이미 둥근 아이콘을 주면 모서리에 검은 자국이 남는다. 애플 지침대로 꽉 찬 정사각을 준다.

   실행: node scripts/make-icons.mjs */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const G = 128;   // 작도 그리드
const SS = 4;    // 픽셀당 4×4 슈퍼샘플 (안티에일리어싱)

const PAPER = [0xff, 0xfe, 0xfb];
const INK   = [0x15, 0x13, 0x0f];
const TEAL  = [0x1f, 0x9e, 0x8b];
const MARK  = [0xff, 0xd8, 0x4d];

/* 둥근 사각형 부호거리함수 — 0 이하면 안쪽 */
const rrDist = (px, py, x, y, w, h, r) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/* 한 점의 색 — 뒤에서 앞으로 겹쳐 칠한다. square 면 종이가 꽉 차고, 아니면 둥근 모서리 + 투명 */
function sample(x, y, square) {
  let rgb = PAPER, a = 1;
  if (!square && rrDist(x, y, 0, 0, G, G, 28) > 0) { a = 0; }
  if (a) {
    if (x >= 84 && x <= 85.6 && y >= 26 && y <= 102) rgb = mix(rgb, TEAL, 0.55); // 여백선
    for (const [rx, ry, rw, rh] of [[26, 38, 46, 5], [26, 55, 46, 5], [26, 72, 30, 5]]) {
      if (rrDist(x, y, rx, ry, rw, rh, 2.5) <= 0) rgb = INK;                     // 본문 3줄
    }
    if (Math.hypot(x - 102, y - 57.5) <= 8) rgb = MARK;                          // 주석 점
  }
  return [rgb[0], rgb[1], rgb[2], a * 255];
}

function raster(size, square) {
  const ch = square ? 3 : 4;
  const rows = Buffer.alloc((size * ch + 1) * size);
  const k = G / size;
  for (let py = 0; py < size; py++) {
    let o = py * (size * ch + 1) + 1; // 각 줄 첫 바이트는 필터 종류(0)
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const s = sample((px + (sx + 0.5) / SS) * k, (py + (sy + 0.5) / SS) * k, square);
        // 알파를 곱해 더한 뒤 나중에 되나눈다 — 경계에서 색이 흐려지지 않게
        acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
      }
      const a = acc[3] / (SS * SS);
      const d = acc[3] || 1;
      rows[o++] = Math.round(acc[0] / d);
      rows[o++] = Math.round(acc[1] / d);
      rows[o++] = Math.round(acc[2] / d);
      if (!square) rows[o++] = Math.round(a);
    }
  }
  return rows;
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, square) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = square ? 2 : 6; // 8bit, 2=RGB / 6=RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raster(size, square), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [file, size, square] of [
  ["public/brand/png/icon-180.png", 180, false],
  ["public/brand/png/icon-180-square.png", 180, true],
]) {
  const buf = png(size, square);
  writeFileSync(file, buf);
  console.log(`${file}  ${size}×${size}  ${square ? "RGB 불투명 정사각" : "RGBA 둥근 모서리"}  ${buf.length}B`);
}
