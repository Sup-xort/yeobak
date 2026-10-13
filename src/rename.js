import { CDN } from "./consts.js";

export const REN_MAX = 40; // 한 번에 다루는 문서 수 상한 — 넘으면 응답이 길어져 JSON 이 잘린다

/* 모델 답에서 이름 목록을 건져낸다. 프롬프트로 "JSON 만" 이라고 못박아도 코드펜스로 감싸거나
   {"names":…} 를 빼고 배열만 주는 경우가 있어서, 되는 해석을 차례로 시도한다. */
export const parseNameJSON = (out) => {
  let s = String(out || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const cand = [];
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) cand.push(s.slice(a, b + 1));   // {"names":[…]}
  const c = s.indexOf("["), d = s.lastIndexOf("]");
  if (c >= 0 && d > c) cand.push(s.slice(c, d + 1));   // […] 만 준 경우
  for (const t of cand) {
    try {
      const j = JSON.parse(t);
      const list = Array.isArray(j) ? j : j?.names;
      if (Array.isArray(list)) return list;
    } catch {}
  }
  return null;
};

/* 모델이 준 이름을 그대로 믿지 않는다. 제어문자·경로문자 제거, 길이 제한,
   확장자는 모델 출력이 아니라 원래 이름을 따라간다(서재에 .pdf 붙은 이름과 안 붙은 이름이 섞여 있다). */
export const cleanRenamed = (raw, orig) => {
  const ext = /\.pdf$/i.test(orig) ? orig.slice(orig.lastIndexOf(".")) : "";
  let n = String(raw || "")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 80)
    .trim();
  return n ? n + ext : orig;
};

/* 이름 지을 근거로 쓸 앞쪽 본문 — 검색 인덱스에 있으면 그걸 쓰고(대부분), 한 번도 안 연
   문서일 때만 PDF 를 받아 pdf.js 로 직접 뽑는다. 뷰어의 pdfRef 는 건드리지 않는 별도 문서다.
   1쪽만 보지 않는 이유는 표지가 이미지 한 장이라 글자가 하나도 없는 문서가 흔해서다
   (실제로 서재 문서 하나가 그랬다) — 앞 3쪽 중 처음으로 글자가 있는 쪽을 쓴다. */
export const firstPageText = async (f, libApi) => {
  const pick = (pages) => (pages || []).find((t) => t && t.trim()) || "";
  try {
    const r = await libApi(`/api/library/file/${f.id}/text?pages=3`);
    const t = pick((await r.json()).pages);
    if (t) return t;
  } catch {}
  try {
    const r = await libApi("/api/library/file/" + f.id);
    const buf = await r.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({
      data: new Uint8Array(buf), cMapUrl: CDN + "cmaps/", cMapPacked: true,
    }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(3, pdf.numPages); n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      pages.push(tc.items.map((i) => i.str).join(" "));
    }
    pdf.destroy?.();
    return pick(pages);
  } catch { return ""; }
};
