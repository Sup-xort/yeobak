import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Remote from "./Remote.jsx";
import { u } from "./paths.js";

// /remote 는 폰용 리모트 화면이다 — 아이패드 본체(App)와 완전히 다른 UI라 별도 컴포넌트로
// 나누고, 빌드는 하나로 유지한 채(server/index.js 가 어떤 경로든 dist/index.html 을
// 돌려주는 SPA 라) 여기서 경로만 보고 갈라 태운다.
//
// 폰이 메인 주소(/)로 들어오면 자동으로 /remote 로 보낸다 — 화면 폭만 본다. User-Agent 는
// iPadOS 13+ Safari 가 기본적으로 데스크톱 UA(Mac 인 척)를 보내서 못 믿는다(iPad 인지 구분이
// 안 됨). 폭 기준도 완벽친 않다 — 아이패드를 Slide Over 로 아주 좁게 띄우면 그 순간만은
// 리모트 화면으로 잘못 튈 수 있다. 이 경로는 처음 열 때 한 번만 판단한다(리사이즈에 안 따라감).
//
// 경로 판정은 base 를 벗겨낸 뒤에 한다. 여백은 /yeobaek/ 서브패스에 살아서 폰이 들어오는
// 주소가 "/" 가 아니라 "/yeobaek/" 이고, 리모트 주소도 "/yeobaek/remote" 다. 이걸 안 벗기면
// 두 조건이 다 거짓이 되어 폰에 아이패드 UI 가 뜬다 — 2026-08-21 서브패스 이전 때 실제로
// 그렇게 리모트 모드가 통째로 죽었다. 아래는 base 가 "/" 로 돌아가도 그대로 동작한다.
const B = import.meta.env.BASE_URL;                    // "/yeobaek/"
const rel = location.pathname.startsWith(B)
  ? location.pathname.slice(B.length - 1)              // "/yeobaek/remote" → "/remote"
  : location.pathname;
const isRemote =
  rel.startsWith("/remote") ||
  (rel === "/" && matchMedia("(max-width: 600px)").matches);
if (isRemote && rel !== "/remote") history.replaceState(null, "", u("/remote"));

/* iOS 26 홈 화면 앱 버그(WebKit 301108): 상태 표시줄을 투명(black-translucent)·viewport-fit=cover 로 쓰면
   웹뷰는 화면 끝까지 그리는데 레이아웃 뷰포트(innerHeight)는 위 안전 영역만큼 짧게 잡힌다. 그 아래가 html
   배경색 띠로 남았다(2026-10-09 실측: 화면 970, innerHeight 938, 위 안전 영역 32 — 띠 색이 html 배경과 같음).
   딱 그 모양(innerHeight + 위 안전 영역 = 화면 높이)일 때만 모자란 만큼을 --vb-gap 으로 늘린다 —
   애플이 고치면 조건이 안 맞아 저절로 0 이 된다. 홈 화면 아이콘을 다시 추가해도 안 고쳐졌다. */
{
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;top:0;height:env(safe-area-inset-top)";
  const fit = () => {
    document.body.appendChild(probe);
    const top = probe.offsetHeight;
    probe.remove();
    const full = document.documentElement.clientWidth > document.documentElement.clientHeight
      ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    // innerHeight 는 938 ↔ 970 을 제멋대로 오간다(같은 화면에서 실측) — 레이아웃 높이는 늘 938 인 clientHeight 로 잰다
    const h = document.documentElement.clientHeight;
    const gap = navigator.standalone && top > 0 && Math.abs(h + top - full) <= 2 ? full - h : 0;
    document.documentElement.style.setProperty("--vb-gap", gap + "px");
  };
  fit();
  // 돌리거나 앱 전환 직후엔 innerHeight 가 잠깐 엉뚱한 값이다(970x970 실측) — 가라앉은 뒤 다시 잰다
  let t1 = 0, t2 = 0;
  const later = () => { fit(); clearTimeout(t1); clearTimeout(t2); t1 = setTimeout(fit, 300); t2 = setTimeout(fit, 1000); };
  addEventListener("resize", later);
  addEventListener("orientationchange", later);
  addEventListener("pageshow", later);
  document.addEventListener("visibilitychange", () => document.hidden || later());
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isRemote ? <Remote /> : <App />}
  </StrictMode>
);
