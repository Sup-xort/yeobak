import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";

/* 질문 탭 답변을 마크다운 + LaTeX 로 그린다.

   순서가 중요하다. 마크다운을 먼저 돌리면 \frac 의 백슬래시가 이스케이프로 먹히고
   x_i 의 밑줄이 기울임으로 잡아먹혀 수식이 조용히 깨진다. 그래서
   코드 → 수식 → 마크다운 → 수식 되돌리기 → 살균 순으로 간다.

   스트리밍 중에도 같은 경로를 탄다. 아직 닫히지 않은 $$ 는 정규식이 잡지 않으므로
   미완성 수식이 빨간 에러로 번쩍이지 않고 그냥 글자로 남아 있다가 닫히는 순간 그려진다. */

marked.setOptions({ gfm: true, breaks: true });

/* 자리표시자는 마크다운이 건드릴 수 없는 글자만 쓴다(영숫자). */
const CODE_TOK = (i) => `qqCODE${i}CODEqq`;
const MATH_TOK = (i) => `qqMATH${i}MATHqq`;

const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;
/* $$…$$ 와 \[…\] 는 별행, \(…\) 와 $…$ 는 인라인.
   $…$ 는 앞뒤가 공백이 아닐 때만 잡는다 — "$5 와 $9" 같은 금액이 수식으로 둔갑하지 않도록.
   Safari 15 를 배려해 lookbehind 는 쓰지 않는다. */
const MATH_RE =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$][^$\n]*[^\s$]|[^\s$])\$/g;

function renderMath(body, display) {
  try {
    return katex.renderToString(body, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: "html",
      trust: false,
    });
  } catch {
    return null; // KaTeX 가 통째로 실패하면 원문을 그대로 둔다
  }
}

export function renderRich(src) {
  if (!src) return "";

  // 1) 코드부터 빼둔다 — 코드 안의 $ 는 수식이 아니다.
  const code = [];
  let s = String(src).replace(CODE_RE, (m) => (code.push(m), CODE_TOK(code.length - 1)));

  // 2) 수식을 빼서 자리표시자로 바꾼다.
  const math = [];
  s = s.replace(MATH_RE, (m, dd, br, pr, one) => {
    const display = dd !== undefined || br !== undefined;
    const body = dd ?? br ?? pr ?? one;
    if (body == null || !body.trim()) return m;
    math.push({ body, display, raw: m });
    return MATH_TOK(math.length - 1);
  });

  // 3) 코드는 되돌려서 마크다운이 정상적으로 렌더하게 한다.
  s = s.replace(/qqCODE(\d+)CODEqq/g, (m, i) => code[Number(i)] ?? m);

  // 4) 마크다운 → HTML
  let html;
  try {
    html = marked.parse(s);
  } catch {
    html = escapeHTML(s).replace(/\n/g, "<br>");
  }

  /* 5) 별행 수식이 홀로 든 <p> 는 껍데기를 벗긴다. 그대로 두면 <p><div>…</div></p> 가 되고,
        브라우저가 이를 쪼개면서 빈 <p> 가 남아 수식 위에 헛줄이 생긴다. */
  html = html.replace(/<p>\s*qqMATH(\d+)MATHqq\s*<\/p>/g,
    (m, i) => (math[Number(i)]?.display ? `qqMATH${i}MATHqq` : m));

  // 6) 수식을 KaTeX 결과로 되돌린다.
  html = html.replace(/qqMATH(\d+)MATHqq/g, (m, i) => {
    const it = math[Number(i)];
    if (!it) return m;
    const out = renderMath(it.body, it.display);
    if (out == null) return escapeHTML(it.raw);
    return it.display ? `<div class="vb-mathblk">${out}</div>` : out;
  });

  // 7) 살균. 모델 출력은 PDF 본문을 그대로 물고 나올 수 있으니 반드시 거른다.
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

function escapeHTML(t) {
  return String(t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 바깥 링크는 새 탭으로 — 홈 화면 웹앱에서 링크를 밟으면 리더가 통째로 날아간다. */
if (typeof window !== "undefined" && !window.__vbHook) {
  window.__vbHook = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

const THROTTLE = 90; // ms — 토큰마다 다시 파싱하면 아이패드에서 눈에 띄게 버벅인다

export default function Rich({ text, live }) {
  const [shown, setShown] = useState(text || "");
  const last = useRef(0);

  useEffect(() => {
    if (!live) { setShown(text || ""); return; }
    const dt = Date.now() - last.current;
    if (dt >= THROTTLE) {
      last.current = Date.now();
      setShown(text || "");
      return;
    }
    const t = setTimeout(() => { last.current = Date.now(); setShown(text || ""); }, THROTTLE - dt);
    return () => clearTimeout(t);
  }, [text, live]);

  const html = useMemo(() => renderRich(shown), [shown]);
  return <div className={"vb-md" + (live ? " vb-cur" : "")} dangerouslySetInnerHTML={{ __html: html }} />;
}
