/* NIM 키와 모델이 살아있는지 확인한다. 키는 화면에 찍지 않는다.
 *   node --env-file=.env scripts/check-key.mjs [모델ID]
 * 모델ID 를 주면 .env 의 NIM_MODEL 대신 그걸 시험한다. */
const key = process.env.NIM_API_KEY || "";
const model = process.argv[2] || process.env.NIM_MODEL || "meta/llama-3.3-70b-instruct";
const base = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";

if (!key) {
  console.error("✗ NIM_API_KEY 가 비어있습니다. .env 를 확인하세요.");
  process.exit(1);
}
console.log(`키 형식: ${key.startsWith("nvapi-") ? "✓ nvapi- 로 시작" : "⚠ nvapi- 로 시작하지 않음"}  (길이 ${key.length})`);
console.log(`모델   : ${model}`);

const t0 = Date.now();
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "'set' 의 뜻을 한 단어로만." }],
    max_tokens: 20,
  }),
  signal: AbortSignal.timeout(30_000),
});

const ms = Date.now() - t0;
const verdict =
  res.status === 200 ? "✓ 정상 — 키와 모델 모두 유효합니다"
  : res.status === 401 ? "✗ 키가 잘못됐거나 만료됐습니다"
  : res.status === 404 ? "✗ 그런 모델이 없습니다 (ID 오타?)"
  : res.status === 410 ? "✗ 퇴역한 모델입니다 — 다른 ID 를 쓰세요"
  : res.status === 429 ? "⚠ 크레딧/레이트리밋 초과"
  : "⚠ 예상 못 한 응답";
console.log(`응답   : ${res.status} (${ms}ms)  ${verdict}`);

if (res.status === 200) {
  const j = await res.json();
  console.log(`출력   : ${JSON.stringify(j.choices?.[0]?.message?.content ?? "")}`);
} else {
  console.log(`본문   : ${(await res.text().catch(() => "")).slice(0, 300)}`);
}
