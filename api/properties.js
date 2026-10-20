import crypto from "crypto";

const MAX_ACTIVE = 12;
const MAX_TOTAL = 100;
const CATEGORIES = ["apt", "commercial", "presale", "land"];
const TRADES = ["trade", "jeonse", "monthly"];

function repoInfo() {
  return {
    token: String(process.env.GITHUB_TOKEN || "").replace(/\s+/g, ""),
    owner: process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "mtr3936-stack",
    repo: process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "noble",
    path: process.env.PROPERTIES_FILE_PATH || "data/properties.json",
    branch: process.env.GITHUB_BRANCH || ""
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

function contentsUrl(info) {
  const path = info.path.split("/").map(encodeURIComponent).join("/");
  return "https://api.github.com/repos/" + encodeURIComponent(info.owner) + "/" + encodeURIComponent(info.repo) + "/contents/" + path;
}

function githubHeaders(info) {
  return {
    "Authorization": "Bearer " + info.token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "board-builder",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubError(r) {
  let msg = r.statusText || "Error";
  try { const j = await r.json(); if (j && j.message) msg = j.message; } catch (e) {}
  const err = new Error("GitHub " + msg + "(" + r.status + ")");
  err.status = r.status;
  return err;
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function sanitize(input) {
  const p = input && typeof input === "object" ? input : {};
  const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",");
  return {
    id: text(p.id, 40),
    name: text(p.name, 80),
    category: CATEGORIES.includes(p.category) ? p.category : "apt",
    trade: TRADES.includes(p.trade) ? p.trade : "trade",
    price: text(p.price, 40),
    monthly: text(p.monthly, 40),
    area: text(p.area, 60),
    floor: text(p.floor, 60),
    tags: tags.map(t => text(t, 20)).filter(Boolean).slice(0, 8),
    description: text(p.description, 200),
    visible: p.visible !== false,
    status: p.status === "sold" ? "sold" : "active",
    updated_at: text(p.updated_at, 30)
  };
}

async function readList(info) {
  const ref = info.branch ? "?ref=" + encodeURIComponent(info.branch) : "";
  const r = await fetch(contentsUrl(info) + ref, { headers: githubHeaders(info), cache: "no-store" });
  if (r.status === 404) return { list: [], sha: null };
  if (!r.ok) throw await githubError(r);
  const j = await r.json();
  const raw = Buffer.from(String(j.content || ""), "base64").toString("utf8").trim();
  const list = raw ? JSON.parse(raw) : [];
  return { list: (Array.isArray(list) ? list : []).map(sanitize), sha: j.sha };
}

async function writeList(info, list, sha) {
  const body = {
    message: "properties: update recommended listings",
    content: Buffer.from(JSON.stringify(list, null, 2) + "\n", "utf8").toString("base64")
  };
  if (sha) body.sha = sha;
  if (info.branch) body.branch = info.branch;
  const r = await fetch(contentsUrl(info), {
    method: "PUT",
    headers: Object.assign({}, githubHeaders(info), { "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw await githubError(r);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const info = repoInfo();
  if (!info.token) {
    return res.status(503).json({ error: "GITHUB_TOKEN 환경변수가 설정되지 않았습니다." });
  }

  try {
    if (req.method === "GET") {
      const { list } = await readList(info);
      return res.status(200).json({ properties: list });
    }

    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
    }

    const input = readBody(req).properties;
    if (!Array.isArray(input)) return res.status(400).json({ error: "properties 배열이 필요합니다." });
    if (input.length > MAX_TOTAL) return res.status(400).json({ error: "매물은 최대 " + MAX_TOTAL + "건까지 보관할 수 있습니다." });

    const seen = new Set();
    const list = input.map(sanitize).map((p, i) => {
      if (!p.id || seen.has(p.id)) p.id = "P" + Date.now() + "-" + i;
      seen.add(p.id);
      return p;
    });
    if (list.some(p => !p.name)) return res.status(400).json({ error: "매물명은 필수입니다." });
    if (list.filter(p => p.status === "active").length > MAX_ACTIVE) {
      return res.status(400).json({ error: "추천 매물은 최대 " + MAX_ACTIVE + "건까지 등록할 수 있습니다." });
    }

    for (let attempt = 0; ; attempt++) {
      const { sha } = await readList(info);
      try {
        await writeList(info, list, sha);
        break;
      } catch (e) {
        if (attempt < 2 && (e.status === 409 || e.status === 422)) continue;
        throw e;
      }
    }
    return res.status(200).json({ properties: list });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "저장소 처리 실패: " + e.message });
  }
}
