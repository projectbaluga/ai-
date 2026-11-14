(() => {
  type AiStatus = "unchecked" | "thinking" | "online" | "unavailable";
  let status: AiStatus = "unchecked";
  let detail = "AI service has not been checked in this session.";
  let installed = false;

  const labels: Record<AiStatus, string> = {
    unchecked: "AI · Not checked",
    thinking: "AI · Thinking",
    online: "AI · Online",
    unavailable: "AI · Unavailable"
  };

  function render() {
    const topbar = document.querySelector<HTMLElement>(".top-actions");
    if (topbar && !document.querySelector("#ai-service-indicator")) {
      const indicator = document.createElement("span");
      indicator.id = "ai-service-indicator";
      indicator.className = "ai-service-indicator unchecked";
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");
      topbar.insertBefore(indicator, topbar.querySelector("#logout-button"));
    }
    const indicator = document.querySelector<HTMLElement>("#ai-service-indicator");
    if (indicator) {
      indicator.textContent = labels[status];
      indicator.className = "ai-service-indicator " + status;
      indicator.title = detail;
    }
    const panelStatus = document.querySelector<HTMLElement>("#assistant-status");
    if (panelStatus) {
      const descriptions: Record<AiStatus, string> = {
        unchecked: "AI service not checked yet · English / Tagalog",
        thinking: "Processing your message…",
        online: "AI service responded successfully · English / Tagalog",
        unavailable: "AI service request failed · try again later"
      };
      panelStatus.textContent = descriptions[status];
      panelStatus.dataset.aiStatus = status;
    }
  }

  function setStatus(next: AiStatus, message?: string) {
    status = next;
    if (message) detail = message;
    render();
  }

  if (!installed) {
    installed = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
  }

  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  render();
})();