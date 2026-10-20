// 공개 페이지의 전화(tel:) 버튼 클릭을 /api/calls 로 집계한다. 실제 통화 연결 여부는 알 수 없다.
(function () {
  const LINES = { "01044893936": "mobile", "0557622565": "office" };

  document.addEventListener("click", function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a) return;
    const line = LINES[String(a.getAttribute("href")).replace(/\D/g, "")];
    if (!line || !/^https?:$/.test(location.protocol)) return;
    try { if (sessionStorage.getItem("isAdmin") === "true") return; } catch (err) {}

    const body = JSON.stringify({ line: line });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/calls", new Blob([body], { type: "application/json" }))) return;
    } catch (err) {}
    try {
      fetch("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (err) {}
  }, true);
})();
