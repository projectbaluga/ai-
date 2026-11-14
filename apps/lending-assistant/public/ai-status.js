(() => {
  let status = "unchecked";
  let detail = "AI service has not been checked in this session.";
  const labels = {
    unchecked: "AI · Not checked",
    thinking: "AI · Thinking",
    online: "AI · Online",
    unavailable: "AI · Unavailable"
  };
  const descriptions = {
    unchecked: "AI service not checked yet · English / Tagalog",
    thinking: "Processing your message…",
    online: "AI service responded successfully · English / Tagalog",
    unavailable: "AI service request failed · try again later"
  };

  const style = document.createElement("style");
  style.textContent = `
    .ai-service-indicator{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid transparent}
    .ai-service-indicator:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
    .ai-service-indicator.unchecked{color:#7b8495;background:#f0f2f6;border-color:#e7eaf0}
    .ai-service-indicator.thinking{color:#9a6a1e;background:#fff6e5;border-color:#f5e6c5}
    .ai-service-indicator.thinking:before{animation:ai-status-pulse 1s ease-in-out infinite}
    .ai-service-indicator.online{color:#23845d;background:#eaf8f1;border-color:#d6f0e3}
    .ai-service-indicator.unavailable{color:#b24e59;background:#fff0f1;border-color:#f5dadd}
    @keyframes ai-status-pulse{50%{opacity:.25;transform:scale(.75)}}
    @media(max-width:700px){.ai-service-indicator{font-size:8px;padding:6px 7px;gap:4px}}
  `;
  document.head.appendChild(style);

  function render() {
    const topbar = document.querySelector(".top-actions");
    if (topbar && !document.querySelector("#ai-service-indicator")) {
      const indicator = document.createElement("span");
      indicator.id = "ai-service-indicator";
      indicator.className = "ai-service-indicator unchecked";
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");
      topbar.insertBefore(indicator, topbar.querySelector("#logout-button"));
    }
    const indicator = document.querySelector("#ai-service-indicator");
    if (indicator) {
      if (indicator.textContent !== labels[status]) indicator.textContent = labels[status];
      const nextClass = "ai-service-indicator " + status;
      if (indicator.className !== nextClass) indicator.className = nextClass;
      if (indicator.title !== detail) indicator.title = detail;
    }
    const panelStatus = document.querySelector("#assistant-status");
    if (panelStatus) {
      if (panelStatus.textContent !== descriptions[status]) panelStatus.textContent = descriptions[status];
      if (panelStatus.dataset.aiStatus !== status) panelStatus.dataset.aiStatus = status;
    }
  }

  function setStatus(next, message) {
    status = next;
    if (message) detail = message;
    render();
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path = "";
    try { path = new URL(rawUrl, window.location.href).pathname; } catch { path = rawUrl; }
    const isAiRequest = path.endsWith("/api/assistant");
    if (isAiRequest) setStatus("thinking", "The assistant is processing a request.");
    try {
      const response = await originalFetch(input, init);
      if (isAiRequest) {
        if (response.ok) setStatus("online", "The latest assistant request returned a successful response.");
        else setStatus("unavailable", "The latest assistant request returned HTTP " + response.status + ".");
      }
      return response;
    } catch (error) {
      if (isAiRequest) setStatus("unavailable", error instanceof Error ? error.message : "The assistant request could not reach the service.");
      throw error;
    }
  };

  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  render();
})();