import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { u } from "./paths.js";

// 폐기된 폰 리모트 주소(옛 홈 화면 아이콘)로 오면 본체로
if (location.pathname.startsWith(u("/remote"))) history.replaceState(null, "", u("/"));

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
    <App />
  </StrictMode>
);
