import crypto from "crypto";

// 전화 버튼 클릭 집계. 카운터는 GitHub 저장소가 아닌 Upstash Redis(Vercel Marketplace)에 저장한다.
const LINES = ["mobile", "office"];
const KEY_TTL_SECONDS = 400 * 24 * 60 * 60;

function storeInfo() {
  return {
    url: String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, ""),
    token: String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").replace(/\s+/g, "")
  };
}

function sessionKey(password) {
  return crypto.createHash("sha256")
    .update("board-session:" + password + ":" + (process.env.SESSION_SECRET || ""))
    .digest();
}

function isAuthorized(req) {
  const password = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!password) return false;
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", sessionKey(password)).update("admin." + m[1]).digest();
  const given = Buffer.from(m[2], "base64url");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// 한국 시간(Asia/Seoul) 기준 YYYY-MM-DD
function seoulDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function counterKey(date, line) {
  return "calls:" + date + ":" + line;
}

async function redis(store, path, command) {
  const r = await fetch(store.url + path, {
    method: "POST",
    headers: { "Authorization": "Bearer " + store.token, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j && j.error)) throw new Error("Redis " + ((j && j.error) || r.statusText || "Error") + "(" + r.status + ")");
  return j;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const store = storeInfo();
  const configured = !!(store.url && store.token);

  try {
    if (req.method === "POST") {
      // sendBeacon은 응답을 보지 않으므로, 잘못된 요청이나 미설정 상태도 조용히 204로 끝낸다.
      const line = String(readBody(req).line || (req.query && req.query.line) || "");
      if (!configured || !LINES.includes(line)) return res.status(204).end();
      const key = counterKey(seoulDate(Date.now()), line);
      await redis(store, "/pipeline", [["INCR", key], ["EXPIRE", key, String(KEY_TTL_SECONDS)]]);
      return res.status(204).end();
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
    }
    if (!configured) {
      return res.status(200).json({ configured: false });
    }

    const today = seoulDate(Date.now());
    const yesterday = seoulDate(Date.now() - 24 * 60 * 60 * 1000);
    const keys = [today, yesterday].flatMap(d => LINES.map(line => counterKey(d, line)));
    const { result } = await redis(store, "", ["MGET"].concat(keys));
    const n = i => Number((result || [])[i]) || 0;
    return res.status(200).json({
      configured: true,
      today: { date: today, mobile: n(0), office: n(1) },
      yesterday: { date: yesterday, mobile: n(2), office: n(3) }
    });
  } catch (e) {
    console.error(e);
    if (req.method === "POST") return res.status(204).end();
    return res.status(502).json({ error: "통계 저장소 처리 실패: " + e.message });
  }
}
