import crypto from "crypto";

const POST_FIELDS = ["id", "title", "category", "author", "date", "thumbnail", "content"];

function repoInfo() {
  return {
    token: String(process.env.GITHUB_TOKEN || "").replace(/\s+/g, ""),
    owner: process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "mtr3936-stack",
    repo: process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "noble",
    path: process.env.DATA_FILE_PATH || "data/posts.json",
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

function normalizePosts(list) {
  return (Array.isArray(list) ? list : [])
    .filter(p => p && p.id != null)
    .map(p => Object.assign({}, p, { id: String(p.id) }))
    .sort((a, b) => {
      const d = String(b.date || "").localeCompare(String(a.date || ""));
      if (d) return d;
      return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
    });
}

async function readPosts(info) {
  const ref = info.branch ? "?ref=" + encodeURIComponent(info.branch) : "";
  const r = await fetch(contentsUrl(info) + ref, { headers: githubHeaders(info), cache: "no-store" });
  if (r.status === 404) return { posts: [], sha: null };
  if (!r.ok) throw await githubError(r);
  const j = await r.json();
  const text = Buffer.from(String(j.content || ""), "base64").toString("utf8").trim();
  return { posts: normalizePosts(text ? JSON.parse(text) : []), sha: j.sha };
}

async function writePosts(info, posts, sha, message) {
  const body = {
    message: message,
    content: Buffer.from(JSON.stringify(posts, null, 2) + "\n", "utf8").toString("base64")
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

async function mutatePosts(info, mutator, message) {
  for (let attempt = 0; ; attempt++) {
    const { posts, sha } = await readPosts(info);
    const result = mutator(posts);
    try {
      await writePosts(info, normalizePosts(result.posts), sha, message);
      return result;
    } catch (e) {
      if (attempt < 2 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

function pickPost(input) {
  const post = {};
  for (const k of POST_FIELDS) {
    if (input[k] != null) post[k] = String(input[k]);
  }
  return post;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.client = true;
  return err;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const info = repoInfo();
  if (!info.token) {
    return res.status(503).json({ error: "GITHUB_TOKEN 환경변수가 설정되지 않았습니다." });
  }

  try {
    if (req.method === "GET") {
      const { posts } = await readPosts(info);
      return res.status(200).json({ posts: posts });
    }

    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, PUT, DELETE");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해 주세요." });
    }

    const body = readBody(req);

    if (req.method === "DELETE") {
      const id = String((req.query && req.query.id) || body.id || "");
      if (!id) return res.status(400).json({ error: "id가 필요합니다." });
      await mutatePosts(info, posts => {
        if (!posts.some(p => p.id === id)) throw httpError(404, "게시글을 찾을 수 없습니다.");
        return { posts: posts.filter(p => p.id !== id) };
      }, "post: delete " + id);
      return res.status(200).json({ ok: true, id: id });
    }

    const input = pickPost(body.post || body);
    if (!input.title || !input.content) {
      return res.status(400).json({ error: "제목과 본문은 필수입니다." });
    }
    input.updated_at = new Date().toISOString();

    const result = await mutatePosts(info, posts => {
      if (req.method === "PUT") {
        const i = posts.findIndex(p => p.id === input.id);
        if (!input.id || i < 0) throw httpError(404, "게시글을 찾을 수 없습니다.");
        posts[i] = Object.assign({}, posts[i], input);
        return { posts: posts, post: posts[i], isNew: false };
      }
      if (!input.id || posts.some(p => p.id === input.id)) input.id = String(Date.now());
      posts.unshift(input);
      return { posts: posts, post: input, isNew: true };
    }, (req.method === "PUT" ? "post: update " : "post: create ") + input.title);

    return res.status(200).json({ post: result.post, isNew: result.isNew });
  } catch (e) {
    if (e.client) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(502).json({ error: "저장소 처리 실패: " + e.message });
  }
}
