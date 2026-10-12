/* 흐르는 중인 답의 글 — React state 바깥의 아주 작은 저장소.
   답 글자를 대화 state(sessions)에 넣으면 그걸 쥔 App(5000줄) 전체가 글자 조각마다 다시 그려진다.
   그래서 흐르는 동안은 여기에만 쓰고, 이 값을 구독하는 답 본문 칸(AskView 의 LiveBody)만 다시 그린다.
   답이 정착하면(완료·중단·실패) 부르는 쪽이 최종 글을 대화 state 에 넣고 여기서 지운다. */
import { useSyncExternalStore } from "react";

const texts = new Map(); // "세션id:메시지 번호" → 지금까지 받은 글
const subs = new Set();
const emit = () => subs.forEach((f) => f());
const key = (sid, i) => sid + ":" + i;

export const liveText = {
  set(sid, i, t) { texts.set(key(sid, i), t); emit(); },
  clear(sid, i) { if (texts.delete(key(sid, i))) emit(); },
  get(sid, i) { return texts.get(key(sid, i)); },
};

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
// 흐르는 글이 있으면 그것, 없으면 대화 state 의 글(fallback)
export function useLiveText(sid, i, fallback) {
  const t = useSyncExternalStore(subscribe, () => (sid ? texts.get(key(sid, i)) : undefined));
  return t ?? fallback;
}
