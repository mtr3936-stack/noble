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

// ---- Google 시트 연동 (SHEET_FEED_URL 이 설정되면 시트가 추천매물의 원본이 됩니다) ----

const SHEET_CACHE_SECONDS = 60;

function sheetCategory(kind) {
  const k = String(kind || "");
  if (/분양권|입주권/.test(k)) return "presale";
  if (/아파트/.test(k)) return "apt";
  if (/토지|주택|단독|다가구|다세대|빌라|전원/.test(k)) return "land";
  return "commercial";
}

function sheetTrade(trade) {
  const t = String(trade || "");
  if (/월세|임대/.test(t)) return "monthly";
  if (/전세/.test(t)) return "jeonse";
  return "trade";
}

function toManwon(value) {
  const digits = String(value || "").replace(/[^\d.]/g, "");
  return digits ? Math.round(Number(digits)) : NaN;
}

function formatManwon(n, withUnit) {
  if (!isFinite(n) || n <= 0) return "";
  const unit = withUnit ? "만" : "";
  if (n < 10000) return n.toLocaleString("ko-KR") + unit;
  const eok = Math.floor(n / 10000);
  const rest = n % 10000;
  return eok + "억" + (rest ? " " + rest.toLocaleString("ko-KR") + "만" : "");
}

function sheetPrice(raw, trade) {
  const s = String(raw || "").trim();
  if (trade === "monthly") {
    const [dep, mon] = s.split("/").map(x => x.trim());
    const d = formatManwon(toManwon(dep), false) || dep || "";
    const m = formatManwon(toManwon(mon), true) || mon || "";
    return { price: d, monthly: m };
  }
  return { price: formatManwon(toManwon(s), true) || s, monthly: "" };
}

function fromSheetItem(item, today) {
  const trade = sheetTrade(item.trade);
  const { price, monthly } = sheetPrice(item.price, trade);
  const address = String(item.address || "").trim();
  const dong = String(item.dong || "").trim();
  return sanitize({
    id: item.id,
    name: dong ? address + " [" + dong + "]" : address,
    category: sheetCategory(item.kind),
    trade: trade,
    price: price,
    monthly: monthly,
    area: item.area,
    floor: item.floor,
    tags: item.moveIn ? [item.moveIn] : [],
    description: item.feature,
    visible: true,
    status: "active",
    updated_at: today
  });
}

async function readSheet(url) {
  const r = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!r.ok) throw new Error("시트 피드 응답 오류(" + r.status + ")");
  const j = await r.json();
  if (!j || !Array.isArray(j.items)) throw new Error("시트 피드 형식 오류");
  const today = String(j.updated || new Date().toISOString()).slice(0, 10);
  return j.items.slice(0, MAX_TOTAL).map(item => fromSheetItem(item, today)).filter(p => p.name);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const info = repoInfo();
  const sheetUrl = String(process.env.SHEET_FEED_URL || "").trim();

  if (req.method === "GET" && sheetUrl) {
    try {
      const list = await readSheet(sheetUrl);
      res.setHeader("Cache-Control", "public, s-maxage=" + SHEET_CACHE_SECONDS + ", stale-while-revalidate=600");
      return res.status(200).json({ properties: list, source: "sheet" });
    } catch (e) {
      console.error("sheet feed failed, falling back to repo file:", e);
    }
  }

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
