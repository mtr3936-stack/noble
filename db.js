let _config = null;

const LOCAL_POSTS_KEY = "board_posts";
const LOCAL_ADMIN_PASSWORD = "admin1234";
const BOARD_CATEGORIES = ["공지사항", "진주혁신도시", "부동산정책", "시장동향", "단지소식"];
const CATEGORY_STYLES = {
  "공지사항": "bg-inverse-surface text-inverse-on-surface",
  "진주혁신도시": "bg-primary text-on-primary",
  "부동산정책": "bg-primary-fixed text-on-primary-fixed-variant",
  "시장동향": "bg-surface-container-high text-foreground-strong",
  "단지소식": "bg-secondary-fixed text-on-secondary-fixed"
};

async function loadConfig() {
  if (_config) return _config;
  let api = {}, file = {};
  await Promise.all([
    fetch("/api/config", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : {}))
      .then(j => { api = j || {}; })
      .catch(() => {}),
    fetch("config/git_config.json", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : {}))
      .then(j => { file = j || {}; })
      .catch(() => {})
  ]);
  _config = {
    api: api.api === true,
    github_ready: !!api.github_ready,
    admin_ready: !!api.admin_ready,
    github_owner: String(file.github_owner || "").trim(),
    github_repo: String(file.github_repo || "").trim(),
    data_file_path: String(file.data_file_path || "data/posts.json").trim()
  };
  return _config;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  const s = String(value || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + "." + m[2] + "." + m[3] : s;
}

function todayString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function categoryClass(category) {
  return CATEGORY_STYLES[category] || "bg-surface-container-high text-foreground-strong";
}

function safeImageUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[A-Za-z0-9_\-./]+$/.test(s) && !s.startsWith("//")) return s;
  return "";
}

function readingMinutes(content) {
  return Math.max(1, Math.round(markdownToText(content).length / 500));
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

function readLocalPosts() {
  try {
    const raw = localStorage.getItem(LOCAL_POSTS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeLocalPosts(posts) {
  try { localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts)); } catch (e) {}
}

async function fetchFilePosts(cfg) {
  try {
    const r = await fetch(cfg.data_file_path + "?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (e) {}
  return [];
}

async function getPosts() {
  const cfg = await loadConfig();
  if (cfg.api) {
    if (cfg.github_ready) {
      try {
        const r = await fetch("/api/posts", { cache: "no-store" });
        if (r.ok) return normalizePosts((await r.json()).posts);
      } catch (e) {}
    }
    return normalizePosts(await fetchFilePosts(cfg));
  }
  const local = readLocalPosts();
  return normalizePosts(local || (await fetchFilePosts(cfg)));
}

async function getPost(id) {
  const posts = await getPosts();
  return posts.find(p => p.id === String(id)) || null;
}

function getSessionToken() {
  return String(sessionStorage.getItem("adminToken") || "").replace(/\s+/g, "");
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = getSessionToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  return headers;
}

async function readJson(r) {
  try { return await r.json(); } catch (e) { return {}; }
}

async function apiRequest(method, url, body) {
  const r = await fetch(url, {
    method: method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await readJson(r);
  if (r.status === 401) {
    sessionStorage.clear();
    throw new Error(j.error || "로그인이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!r.ok) throw new Error(j.error || "저장 실패: " + (r.statusText || "Error") + "(" + r.status + ")");
  return j;
}

async function savePost(post) {
  const cfg = await loadConfig();
  const data = {
    id: post.id ? String(post.id) : "",
    title: String(post.title || "").trim(),
    category: String(post.category || BOARD_CATEGORIES[0]),
    author: String(post.author || "조우정 대표"),
    date: String(post.date || todayString()),
    thumbnail: safeImageUrl(post.thumbnail),
    content: String(post.content || "")
  };
  if (!data.title || !data.content.trim()) throw new Error("제목과 본문을 입력해 주세요.");

  if (cfg.api) {
    if (!cfg.github_ready) throw new Error("GitHub 토큰이 설정되지 않았습니다. Vercel 환경 변수 GITHUB_TOKEN을 확인해 주세요.");
    const j = await apiRequest(data.id ? "PUT" : "POST", "/api/posts", { post: data });
    return j.post;
  }

  const posts = await getPosts();
  if (data.id) {
    const i = posts.findIndex(p => p.id === data.id);
    if (i < 0) throw new Error("게시글을 찾을 수 없습니다.");
    posts[i] = Object.assign({}, posts[i], data, { updated_at: new Date().toISOString() });
  } else {
    data.id = String(Date.now());
    posts.unshift(data);
  }
  writeLocalPosts(normalizePosts(posts));
  return data;
}

async function deletePost(id) {
  const cfg = await loadConfig();
  const key = String(id);
  if (cfg.api) {
    if (!cfg.github_ready) throw new Error("GitHub 토큰이 설정되지 않았습니다. Vercel 환경 변수 GITHUB_TOKEN을 확인해 주세요.");
    await apiRequest("DELETE", "/api/posts?id=" + encodeURIComponent(key));
    return true;
  }
  const posts = await getPosts();
  writeLocalPosts(posts.filter(p => p.id !== key));
  return true;
}

async function login(password) {
  const cfg = await loadConfig();
  const input = String(password || "");
  if (cfg.api) {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: input })
    });
    const j = await readJson(r);
    if (!r.ok || !j.token) return { ok: false, error: j.error || "비밀번호가 올바르지 않습니다." };
    sessionStorage.setItem("adminToken", j.token);
    sessionStorage.setItem("adminExpires", String(j.expires));
    sessionStorage.setItem("isAdmin", "true");
    return { ok: true };
  }
  if (input !== LOCAL_ADMIN_PASSWORD) return { ok: false, error: "비밀번호가 올바르지 않습니다." };
  sessionStorage.setItem("isAdmin", "true");
  return { ok: true };
}

function logout() {
  sessionStorage.clear();
}

function isAdmin() {
  if (sessionStorage.getItem("isAdmin") !== "true") return false;
  const expires = Number(sessionStorage.getItem("adminExpires") || 0);
  if (expires && expires < Date.now()) {
    sessionStorage.clear();
    return false;
  }
  return true;
}

function requireAdmin() {
  if (!isAdmin()) {
    location.replace("admin.html");
    return false;
  }
  return true;
}

function handleAgentLogin(event) {
  if (event) event.preventDefault();
  location.href = "admin.html";
}

function formatInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, url) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    }
    return label;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

function renderInline(text) {
  const parts = String(text).split("`");
  if (parts.length % 2 === 0) {
    const last = parts.pop();
    parts[parts.length - 1] += "`" + last;
  }
  return parts.map((part, i) => (i % 2 === 1 ? "<code>" + escapeHtml(part) + "</code>" : formatInline(part))).join("");
}

function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.map(renderInline).join("<br>") + "</p>");
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
      continue;
    }

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      i--;
      out.push("<blockquote>" + renderMarkdown(quote.join("\n")) + "</blockquote>");
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push("<li>" + renderInline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>");
        i++;
      }
      i--;
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push("<li>" + renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, "")) + "</li>");
        i++;
      }
      i--;
      out.push("<ol>" + items.join("") + "</ol>");
      continue;
    }

    para.push(line.trim());
  }

  flushPara();
  return out.join("\n");
}

function markdownToText(src) {
  return String(src || "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*```.*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "$1")
    .replace(/\*\*|~~|`/g, "")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

window.loadConfig = loadConfig;
window.getPosts = getPosts;
window.getPost = getPost;
window.savePost = savePost;
window.deletePost = deletePost;
window.login = login;
window.logout = logout;
window.isAdmin = isAdmin;
window.requireAdmin = requireAdmin;
window.handleAgentLogin = handleAgentLogin;
window.renderMarkdown = renderMarkdown;
window.markdownToText = markdownToText;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.todayString = todayString;
window.categoryClass = categoryClass;
window.safeImageUrl = safeImageUrl;
window.readingMinutes = readingMinutes;
window.BOARD_CATEGORIES = BOARD_CATEGORIES;
