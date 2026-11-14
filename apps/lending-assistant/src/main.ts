import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");

app.innerHTML = `
  <main class="shell">
    <header>
      <p class="eyebrow">AI WORKSPACE / LENDING MODULE</p>
      <h1>Lending Assistant</h1>
      <p class="muted">Lending records, collections, and reports in one place.</p>
    </header>
    <section class="notice">
      <strong>Starter workspace</strong>
      <p>This is the initial Android-friendly PWA foundation. Connect and secure the API before recording real borrower or payment information.</p>
    </section>
    <section class="panel">
      <h2>Assistant</h2>
      <p class="muted">The chat interface is a placeholder until authentication, lending rules, and transaction confirmation are implemented.</p>
      <label for="message">Ask your lending assistant</label>
      <textarea id="message" rows="3" placeholder="Hal. Magkano pa ang balance ni Pedro?"></textarea>
      <button id="send" type="button">Send</button>
      <p id="reply" class="muted" role="status">No request sent.</p>
    </section>
    <footer>AI Workspace · Lending Assistant</footer>
  </main>`;

const send = document.querySelector<HTMLButtonElement>("#send");
const message = document.querySelector<HTMLTextAreaElement>("#message");
const reply = document.querySelector<HTMLParagraphElement>("#reply");

send?.addEventListener("click", () => {
  if (!reply) return;
  reply.textContent = message?.value.trim()
    ? "The assistant service is not connected yet. No transaction was created."
    : "Please enter a message first.";
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}