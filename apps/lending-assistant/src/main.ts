import "./style.css";

type Borrower = { id: string; full_name: string; phone?: string | null };
type Loan = { id: string; borrower_id: string; principal_minor: number; currency: string; status: string };
type Payment = { id: string; loan_id: string; amount_minor: number; paid_at: string };
type ApiList<T> = { results: T[] };
type AssistantReply = { message: string; proposedActions?: Array<{ type: string; payload: Record<string, unknown>; summary: string; requiresConfirmation: true }>; needsClarification?: boolean };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");

const state = {
  page: "home",
  borrowers: [] as Borrower[],
  loans: [] as Loan[],
  payments: [] as Payment[],
  connected: false,
  loading: true,
  messages: [] as Array<{ role: "user" | "assistant"; content: string }>,
  busy: false,
  listening: false,
  voiceMode: false,
  voiceAvailable: false,
};

const peso = (minor: number) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", maximumFractionDigits: 2
}).format(minor / 100);

function shell() {
  app!.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" aria-label="AI Workspace home"><span class="brand-mark">A</span><span>AI Workspace<small>LENDING ASSISTANT</small></span></a>
        <nav class="side-nav" aria-label="Main navigation">
          <button data-page="home" class="nav-item active"><span>⌂</span> Overview</button>
          <button data-page="borrowers" class="nav-item"><span>♙</span> Borrowers</button>
          <button data-page="loans" class="nav-item"><span>▤</span> Loans</button>
          <button data-page="activity" class="nav-item"><span>↻</span> Activity</button>
        </nav>
        <div class="sidebar-bottom"><div class="owner-avatar">O</div><div><strong>Owner workspace</strong><small>Private lending records</small></div></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div><span class="mobile-brand">AI Workspace</span><span class="crumb">Lending / <b id="page-label">Overview</b></span></div><span class="connection" id="connection"><i></i> Checking connection</span></header>
        <section class="content" id="page-content"></section>
      </main>
      <button class="assistant-fab" id="assistant-open" aria-label="Open AI assistant"><span>✦</span><b>Ask AI</b></button>
      <section class="assistant-panel" id="assistant-panel" aria-label="AI Lending Assistant" hidden>
        <header class="assistant-head"><div class="ai-avatar">✦</div><div><strong>AI Lending Assistant</strong><small id="assistant-status">Ready to help · English / Tagalog</small></div><button class="icon-btn" id="assistant-close" aria-label="Close assistant">×</button></header>
        <div class="chat-messages" id="chat-messages"><div class="welcome-message"><span class="welcome-spark">✦</span><h3>Kumusta! How can I help?</h3><p>Ask about your lending records, borrowers, or payments. I’ll use verified records when the secure connection is ready.</p><div class="prompt-chips"><button data-prompt="Show my lending overview">Lending overview</button><button data-prompt="Find a borrower">Find a borrower</button><button data-prompt="Summarize recent payments">Recent payments</button></div></div></div>
        <form class="chat-form" id="chat-form"><textarea id="chat-input" rows="1" placeholder="Type in English, Tagalog, or Taglish…" aria-label="Message the AI assistant"></textarea><div class="chat-actions"><button type="button" class="voice-btn" id="voice-btn" aria-label="Speak a message">♩ <span>Voice</span></button><span class="chat-hint">AI suggestions need your approval</span><button class="send-btn" type="submit" aria-label="Send message">↑</button></div></form>
      </section>
    </div>`;
  renderPage();
  bindShell();
}

function renderPage() {
  const target = document.querySelector<HTMLElement>("#page-content");
  const label = document.querySelector<HTMLElement>("#page-label");
  if (!target || !label) return;
  const titles: Record<string, string> = { home: "Overview", borrowers: "Borrowers", loans: "Loans", activity: "Activity" };
  label.textContent = titles[state.page] ?? "Overview";
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === state.page));

  if (state.page === "home") {
    const active = state.loans.filter((l) => l.status === "active").length;
    const borrowerCount = state.borrowers.length;
    const paymentTotal = state.payments.reduce((sum, p) => sum + p.amount_minor, 0);
    target.innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">YOUR LENDING AT A GLANCE</p><h1>Good day.</h1><p class="muted">Here’s what’s happening in your lending workspace.</p></div><span class="date-pill">${new Intl.DateTimeFormat("en-PH",{dateStyle:"full"}).format(new Date())}</span></div>
      <div class="stat-grid">
        <article class="stat-card"><span class="stat-icon violet">₱</span><span class="stat-label">Outstanding balance</span><strong>${state.connected ? "—" : "Not available"}</strong><small>Requires verified balance calculation</small></article>
        <article class="stat-card"><span class="stat-icon blue">▤</span><span class="stat-label">Active loans</span><strong>${state.connected ? active : "—"}</strong><small>${state.connected ? "Current active loan records" : "Connect your secure account"}</small></article>
        <article class="stat-card"><span class="stat-icon green">♙</span><span class="stat-label">Borrowers</span><strong>${state.connected ? borrowerCount : "—"}</strong><small>${state.connected ? "Active borrower records" : "No figures shown until connected"}</small></article>
        <article class="stat-card"><span class="stat-icon amber">↗</span><span class="stat-label">Payments received</span><strong>${state.connected ? peso(paymentTotal) : "—"}</strong><small>${state.connected ? "Recorded payments total" : "Verified records only"}</small></article>
      </div>
      ${!state.connected ? `<section class="setup-banner"><div class="setup-icon">⌁</div><div><strong>Secure account connection needed</strong><p>The dashboard is ready, but live lending figures are hidden until owner login and secure API sessions are configured. No sample financial data is being displayed.</p></div></section>` : ""}
      <div class="section-heading"><div><p class="eyebrow">WORKSPACE</p><h2>Recent activity</h2></div><button class="text-button" data-page="activity">View all →</button></div>
      <section class="activity-card">${state.connected && state.payments.length ? state.payments.slice(0,5).map((p) => `<div class="activity-row"><span class="activity-icon">₱</span><div><strong>Payment recorded</strong><small>${new Date(p.paid_at).toLocaleDateString("en-PH")}</small></div><b>${peso(p.amount_minor)}</b></div>`).join("") : `<div class="empty-state"><span>◷</span><strong>No recent activity to show</strong><p>${state.connected ? "New payments and loan updates will appear here." : "Your real transactions will appear here after secure connection."}</p></div>`}</section>`;
  } else if (state.page === "borrowers") {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">PEOPLE YOU LEND TO</p><h1>Borrowers</h1><p class="muted">Manage borrower details and find records with your AI assistant.</p></div></div><section class="list-card">${state.connected && state.borrowers.length ? state.borrowers.map(b => `<div class="record-row"><span class="record-avatar">${escapeHtml(b.full_name.slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(b.full_name)}</strong><small>${escapeHtml(b.phone ?? "No phone number")}</small></div></div>`).join("") : empty("Borrower records will appear here after secure owner login.")}</section>`;
  } else if (state.page === "loans") {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">LENDING PORTFOLIO</p><h1>Loans</h1><p class="muted">Review principal amounts and loan status.</p></div></div><section class="list-card">${state.connected && state.loans.length ? state.loans.map(l => `<div class="record-row"><span class="record-avatar loan-avatar">₱</span><div><strong>${peso(l.principal_minor)}</strong><small>${escapeHtml(l.currency)} · ${escapeHtml(l.status)}</small></div><span class="status-tag">${escapeHtml(l.status)}</span></div>`).join("") : empty("Loan records will appear here after secure owner login.")}</section>`;
  } else {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">AUDIT TRAIL</p><h1>Activity</h1><p class="muted">A clear history of recorded lending activity.</p></div></div><section class="list-card">${state.connected && state.payments.length ? state.payments.map(p => `<div class="record-row"><span class="record-avatar loan-avatar">₱</span><div><strong>Payment · ${peso(p.amount_minor)}</strong><small>${new Date(p.paid_at).toLocaleString("en-PH")}</small></div></div>`).join("") : empty("Your activity history will appear here after secure owner login.")}</section>`;
  }
  target.querySelectorAll<HTMLElement>("[data-page]").forEach(el => el.addEventListener("click", () => { state.page = el.dataset.page ?? "home"; renderPage(); }));
}

function empty(message: string) { return `<div class="empty-state"><span>▤</span><strong>No records to display</strong><p>${escapeHtml(message)}</p></div>`; }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!)); }

function bindShell() {
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach(b => b.addEventListener("click", () => { state.page = b.dataset.page ?? "home"; renderPage(); }));
  document.querySelector("#assistant-open")?.addEventListener("click", openAssistant);
  document.querySelector("#assistant-close")?.addEventListener("click", closeAssistant);
  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", sendMessage);
  document.querySelector<HTMLButtonElement>("#voice-btn")?.addEventListener("click", toggleVoice);
  document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(b => b.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = b.dataset.prompt ?? ""; input.focus(); } }));
}

function openAssistant() { document.querySelector<HTMLElement>("#assistant-panel")!.hidden = false; document.querySelector<HTMLTextAreaElement>("#chat-input")?.focus(); }
function closeAssistant() { document.querySelector<HTMLElement>("#assistant-panel")!.hidden = true; }

function addMessage(role: "user" | "assistant", content: string) {
  state.messages.push({ role, content });
  const list = document.querySelector<HTMLElement>("#chat-messages");
  if (!list) return;
  if (state.messages.length === 1) list.innerHTML = "";
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  bubble.textContent = content;
  list.appendChild(bubble);
  if (role === "assistant" && state.voiceMode && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = /[\\u0E00-\\u0E7F]/.test(content) ? "fil-PH" : "en-PH";
    window.speechSynthesis.speak(utterance);
  }
  list.scrollTop = list.scrollHeight;
}

async function sendMessage(event: SubmitEvent) {
  event.preventDefault();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
  const content = input?.value.trim();
  if (!content || state.busy) return;
  addMessage("user", content);
  if (input) input.value = "";
  if (!state.connected) {
    addMessage("assistant", "Salamat! Naka-ready ang assistant interface, pero kailangan munang ma-configure ang secure owner login bago ako makabasa ng private lending records o makagamit ng AI service. Walang transaction na ginawa.");
    return;
  }
  state.busy = true;
  try {
    const response = await fetch("/api/assistant", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: state.messages.slice(-20), language: "tl-en" })
    });
    const data = await response.json() as AssistantReply & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Assistant request failed.");
    addMessage("assistant", data.message);
    if (data.proposedActions?.length) data.proposedActions.forEach(a => addMessage("assistant", `For your approval: ${a.summary}. This is only a proposal; it has not been saved.`));
  } catch (error) {
    addMessage("assistant", error instanceof Error ? error.message : "Hindi muna available ang assistant. Walang na-save na transaction.");
  } finally { state.busy = false; }
}

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start(): void; stop(): void;
};
let recognition: SpeechRecognitionLike | null = null;
function toggleVoice() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Speech = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Speech) {
    addMessage("assistant", "Hindi supported ng browser na ito ang voice input. Maaari pa rin kayong mag-type ng message.");
    return;
  }
  if (state.listening && recognition) { recognition.stop(); return; }
  recognition = new Speech();
  state.voiceMode = true;
  recognition.lang = "fil-PH";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(result => result[0].transcript).join(" ");
    const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
    if (input) { input.value = transcript; input.focus(); }
  };
  recognition.onend = () => { state.listening = false; document.querySelector("#voice-btn")?.classList.remove("recording"); };
  recognition.onerror = recognition.onend;
  state.listening = true;
  document.querySelector("#voice-btn")?.classList.add("recording");
  try { recognition.start(); } catch { recognition.onend?.(); }
}

async function loadData() {
  const connection = document.querySelector<HTMLElement>("#connection");
  try {
    const [borrowers, loans, payments] = await Promise.all([
      fetch("/api/borrowers"), fetch("/api/loans"), fetch("/api/payments")
    ]);
    if ([borrowers, loans, payments].some(r => r.status === 401 || r.status === 403)) throw new Error("Owner login required");
    if (![borrowers, loans, payments].every(r => r.ok)) throw new Error("API unavailable");
    state.borrowers = (await borrowers.json() as ApiList<Borrower>).results;
    state.loans = (await loans.json() as ApiList<Loan>).results;
    state.payments = (await payments.json() as ApiList<Payment>).results;
    state.connected = true;
    if (connection) { connection.innerHTML = "<i></i> Secure data connected"; connection.classList.add("online"); }
  } catch {
    state.connected = false;
    if (connection) { connection.innerHTML = "<i></i> Setup required"; connection.classList.add("offline"); }
  } finally { state.loading = false; renderPage(); }
}

if ("speechSynthesis" in window) state.voiceAvailable = true;
shell();
void loadData();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.error));
}
