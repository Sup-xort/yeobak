/* 부트스트랩 아이콘(bootstrap-icons, MIT) — 쓰는 것만 ?raw 로 가져와 번들에 넣는다.
   크기는 글자 크기(1em)를 따르고 색은 currentColor. 새 아이콘은 아래 표에 한 줄 추가. */
import crop from "bootstrap-icons/icons/crop.svg?raw";
import stars from "bootstrap-icons/icons/stars.svg?raw";
import arrowUp from "bootstrap-icons/icons/arrow-up.svg?raw";
import stopFill from "bootstrap-icons/icons/stop-fill.svg?raw";
import chevronDown from "bootstrap-icons/icons/chevron-down.svg?raw";
import chevronUp from "bootstrap-icons/icons/chevron-up.svg?raw";
import pencilSquare from "bootstrap-icons/icons/pencil-square.svg?raw";
import xLg from "bootstrap-icons/icons/x-lg.svg?raw";
import image from "bootstrap-icons/icons/image.svg?raw";
import check2 from "bootstrap-icons/icons/check2.svg?raw";
import copy from "bootstrap-icons/icons/copy.svg?raw";
import arrowClockwise from "bootstrap-icons/icons/arrow-clockwise.svg?raw";
import exclamationCircle from "bootstrap-icons/icons/exclamation-circle.svg?raw";
import checkCircleFill from "bootstrap-icons/icons/check-circle-fill.svg?raw";

import i_phone from "bootstrap-icons/icons/phone.svg?raw";
import i_chat from "bootstrap-icons/icons/chat.svg?raw";
import i_tablet from "bootstrap-icons/icons/tablet.svg?raw";
import i_collection from "bootstrap-icons/icons/collection.svg?raw";
import i_journal_text from "bootstrap-icons/icons/journal-text.svg?raw";
import i_clock_history from "bootstrap-icons/icons/clock-history.svg?raw";
import i_star from "bootstrap-icons/icons/star.svg?raw";
import i_star_fill from "bootstrap-icons/icons/star-fill.svg?raw";
import i_broadcast from "bootstrap-icons/icons/broadcast.svg?raw";
import i_image_fill from "bootstrap-icons/icons/image-fill.svg?raw";
import i_plus_lg from "bootstrap-icons/icons/plus-lg.svg?raw";
import i_book from "bootstrap-icons/icons/book.svg?raw";
import i_hdd from "bootstrap-icons/icons/hdd.svg?raw";
import i_link_45deg from "bootstrap-icons/icons/link-45deg.svg?raw";
import i_key from "bootstrap-icons/icons/key.svg?raw";
import i_question_circle from "bootstrap-icons/icons/question-circle.svg?raw";
import i_chevron_expand from "bootstrap-icons/icons/chevron-expand.svg?raw";
import i_trash3 from "bootstrap-icons/icons/trash3.svg?raw";
import i_arrow_repeat from "bootstrap-icons/icons/arrow-repeat.svg?raw";
import i_cpu from "bootstrap-icons/icons/cpu.svg?raw";
import i_arrow_return_left from "bootstrap-icons/icons/arrow-return-left.svg?raw";

const RAW = {
  crop, stars, "arrow-up": arrowUp, "stop-fill": stopFill, "chevron-down": chevronDown, "chevron-up": chevronUp,
  "pencil-square": pencilSquare, "x-lg": xLg, image, check2, copy, "arrow-clockwise": arrowClockwise,
  "exclamation-circle": exclamationCircle,
  "phone": i_phone, "chat": i_chat, "tablet": i_tablet, "collection": i_collection, "journal-text": i_journal_text, "clock-history": i_clock_history, "star": i_star, "star-fill": i_star_fill, "broadcast": i_broadcast, "image-fill": i_image_fill, "plus-lg": i_plus_lg, "book": i_book, "check-circle-fill": checkCircleFill,
  "arrow-return-left": i_arrow_return_left,
  "hdd": i_hdd, "link-45deg": i_link_45deg, "key": i_key, "question-circle": i_question_circle, "chevron-expand": i_chevron_expand, "trash3": i_trash3, "arrow-repeat": i_arrow_repeat, "cpu": i_cpu,
};
// width/height 를 떼야 CSS(1em)가 먹는다
const SVG = Object.fromEntries(Object.entries(RAW).map(([k, v]) =>
  [k, v.replace(/\s(width|height)="16"/g, "").replace(/\sclass="[^"]*"/, "")]));

export default function Bi({ name, className = "" }) {
  return <i className={"bi " + className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG[name] || "" }} />;
}
