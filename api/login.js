import crypto from "crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sessionKey(password) {
  return crypto.createHash("sha256")
    .update("board-session:" + password + ":" + (process.env.SESSION_SECRET || ""))
    .digest();
}

function sha256(str) {
  return crypto.createHash("sha256").update(String(str)).digest();
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const password = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!password) {
    return res.status(500).json({ error: "ADMIN_PASSWORD 환경변수가 설정되지 않았습니다." });
  }

  const input = String(readBody(req).password || "");
  if (!crypto.timingSafeEqual(sha256(input), sha256(password))) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }

  const expires = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac("sha256", sessionKey(password)).update("admin." + expires).digest("base64url");
  res.status(200).json({ token: expires + "." + sig, expires: expires });
}
