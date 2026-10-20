export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    api: true,
    github_ready: !!String(process.env.GITHUB_TOKEN || "").trim(),
    admin_ready: !!String(process.env.ADMIN_PASSWORD || "").trim()
  });
}
