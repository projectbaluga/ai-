import "./style.css";
import { borrowerFormMarkup, loanFormMarkup, paymentFormMarkup, bindRecordForms } from "./record-forms";
import { reportsMarkup, bindReports } from "./reports";

type Borrower = { id: string; full_name: string; phone?: string | null; notes?: string | null };
type Loan = { id: string; borrower_id: string; principal_minor: number; currency: string; status: string; interest_type: string; interest_value: number; interest_period: string };
type Payment = { id: string; loan_id: string; amount_minor: number; paid_at: string };
type AuditEntry = { id: string; action: string; entity_type: string; entity_id: string; created_at: string };
type ApiList<T> = { results: T[] };
type AssistantProposal = { type: string; payload: Record<string, unknown>; summary: string; requiresConfirmation: true };
type AssistantReply = { message: string; proposedActions?: AssistantProposal[]; needsClarification?: boolean };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");

const state = {
  page: "assistant",
  borrowers: [] as Borrower[],
  loans: [] as Loan[],
  payments: [] as Payment[],
  activity: [] as AuditEntry[],
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
          <button data-page="assistant" class="nav-item active"><span>✦</span> Ask AI</button><button data-page="home" class="nav-item"><span>⌂</span> Overview</button>
          <button data-page="borrowers" class="nav-item"><span>♙</span> Borrowers</button>
          <button data-page="loans" class="nav-item"><span>▤</span> Loans</button>
          <button data-page="activity" class="nav-item"><span>↻</span> Activity</button>
          <button data-page="reports" class="nav-item"><span>▥</span> Reports</button>
        </nav>
        <div class="sidebar-bottom"><div class="owner-avatar">O</div><div><strong>Owner workspace</strong><small>Private lending records</small></div></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div><span class="mobile-brand">AI Workspace</span><span class="crumb">Lending / <b id="page-label">Overview</b></span></div><div class="top-actions"><span class="connection" id="connection"><i></i> Checking connection</span><button class="logout-button" id="logout-button" type="button">Sign out</button></div></header>
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
  const titles: Record<string, string> = { assistant: "Ask AI", home: "Overview", borrowers: "Borrowers", loans: "Loans", activity: "Activity", reports: "Reports" };
  label.textContent = titles[state.page] ?? "Overview";
  const assistantPanel = document.querySelector<HTMLElement>("#assistant-panel");
  const assistantFab = document.querySelector<HTMLElement>("#assistant-open");
  const isAssistantHome = state.page === "assistant";
  if (assistantPanel) { assistantPanel.hidden = !isAssistantHome; assistantPanel.classList.toggle("ai-first", isAssistantHome); }
  if (assistantFab) (assistantFab as HTMLElement).hidden = isAssistantHome;
  target.classList.toggle("assistant-home", isAssistantHome);
  if (isAssistantHome) {
    target.innerHTML = `<div class="ai-home-intro"><p class="eyebrow">YOUR AI LENDING WORKSPACE</p><h1>What would you like to do?</h1><p class="muted">Magtanong, maghanap ng records, mag-review ng payments, o maghanda ng transaction. You can speak or type naturally.</p><div class="ai-suggestions"><button data-prompt="Show my lending overview">Show lending overview</button><button data-prompt="Find a borrower">Find a borrower</button><button data-prompt="Show recent payments">Recent payments</button><button data-prompt="Show my active loans">Active loans</button></div></div>`;
    target.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(b => b.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = b.dataset.prompt ?? ""; input.focus(); } }));
    return;
  }
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === state.page));

  if (state.page === "home") {
    const active = state.loans.filter((l) => l.status === "active").length;
    const borrowerCount = state.borrowers.length;
    const paymentTotal = state.payments.reduce((sum, p) => sum + p.amount_minor, 0);
    target.innerHTML = `
      <div class="page-intro"><div><p class="eyebrow">YOUR LENDING AT A GLANCE</p><h1>Good day.</h1><p class="muted">Here’s what’s happening in your lending workspace.</p></div><span class="date-pill">${new Intl.DateTimeFormat("en-PH",{dateStyle:"full"}).format(new Date())}</span></div>
      <div class="stat-grid">
        <article class="stat-card"><span class="stat-icon violet">₱</span><span class="stat-label">Outstanding balance</span><strong>${state.connected ? "Not calculated" : "—"}</strong><small>Interest and payment allocation rules pending</small></article>
        <article class="stat-card"><span class="stat-icon blue">▤</span><span class="stat-label">Active loans</span><strong>${state.connected ? active : "—"}</strong><small>${state.connected ? "Current active loan records" : "Connect your secure account"}</small></article>
        <article class="stat-card"><span class="stat-icon green">♙</span><span class="stat-label">Borrowers</span><strong>${state.connected ? borrowerCount : "—"}</strong><small>${state.connected ? "Active borrower records" : "No figures shown until connected"}</small></article>
        <article class="stat-card"><span class="stat-icon amber">↗</span><span class="stat-label">Payments received</span><strong>${state.connected ? peso(paymentTotal) : "—"}</strong><small>${state.connected ? "Recorded payments total" : "Verified records only"}</small></article>
      </div>
      ${!state.connected ? `<section class="setup-banner"><div class="setup-icon">⌁</div><div><strong>Secure account connection needed</strong><p>The dashboard is ready, but live lending figures are hidden until owner login and secure API sessions are configured. No sample financial data is being displayed.</p></div></section>` : ""}
      <div class="section-heading"><div><p class="eyebrow">WORKSPACE</p><h2>Recent activity</h2></div><button class="text-button" data-page="activity">View all →</button></div>
      <section class="activity-card">${state.connected && state.payments.length ? state.payments.slice(0,5).map((p) => `<div class="activity-row"><span class="activity-icon">₱</span><div><strong>Payment recorded</strong><small>${new Date(p.paid_at).toLocaleDateString("en-PH")}</small></div><b>${peso(p.amount_minor)}</b></div>`).join("") : `<div class="empty-state"><span>◷</span><strong>No recent activity to show</strong><p>${state.connected ? "New payments and loan updates will appear here." : "Your real transactions will appear here after secure connection."}</p></div>`}</section>`;
  } else if (state.page === "borrowers") {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">PEOPLE YOU LEND TO</p><h1>Borrowers</h1><p class="muted">Manage borrower details and find records with your AI assistant.</p></div></div><section class="list-card">${state.connected && state.borrowers.length ? state.borrowers.map(b => `<details class="record-detail"><summary class="record-row"><span class="record-avatar">${escapeHtml(b.full_name.slice(0,1).toUpperCase())}</span><span class="record-main"><strong>${escapeHtml(b.full_name)}</strong><small>${escapeHtml(b.phone ?? "No phone number")} · ${state.loans.filter(l => l.borrower_id === b.id).length} loan(s)</small></span><span class="detail-hint">View details⌄</span></summary><div class="record-detail-body">${borrowerDetailsMarkup(b)}<div class="record-actions"><button type="button" data-edit-borrower="${escapeHtml(b.id)}">Edit borrower</button><button type="button" data-archive-borrower="${escapeHtml(b.id)}">Archive</button></div></div></details>`).join("") : empty("Borrower records will appear here after secure owner login.")}</section>`;
  } else if (state.page === "loans") {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">LENDING PORTFOLIO</p><h1>Loans</h1><p class="muted">Review principal amounts and loan status.</p></div></div><section class="list-card">${state.connected && state.loans.length ? state.loans.map(l => `<details class="record-detail"><summary class="record-row"><span class="record-avatar loan-avatar">₱</span><span class="record-main"><strong>${peso(l.principal_minor)}</strong><small>${escapeHtml(state.borrowers.find(b => b.id === l.borrower_id)?.full_name ?? "Borrower record unavailable")} · ${escapeHtml(l.status)}</small></span><span class="status-tag">${escapeHtml(l.status)}</span><span class="detail-hint">View details⌄</span></summary><div class="record-detail-body">${loanDetailsMarkup(l)}<div class="record-actions"><button type="button" data-edit-loan="${escapeHtml(l.id)}">Edit interest terms</button></div></div></details>`).join("") : empty("Loan records will appear here after secure owner login.")}</section>`;
  } else if (state.page === "reports") {
    target.innerHTML = reportsMarkup();
    bindReports(target);
  } else {
    const rows = state.activity.map(a => "<div class=\"record-row\"><span class=\"record-avatar loan-avatar\">↻</span><div><strong>" + escapeHtml(a.action.replaceAll("_", " ")) + " · " + escapeHtml(a.entity_type) + "</strong><small>" + new Date(a.created_at).toLocaleString("en-PH") + " · Ref: " + escapeHtml(a.entity_id.slice(0,8)) + "</small></div></div>").join("");
    target.innerHTML = "<div class=\"page-intro\"><div><p class=\"eyebrow\">AUDIT TRAIL</p><h1>Activity</h1><p class=\"muted\">Confirmed changes recorded by the system.</p></div></div><section class=\"list-card\">" + (state.connected && state.activity.length ? rows : empty("Confirmed activity will appear here after secure owner login.")) + "</section>";
  }
  if (state.page === "borrowers") {
    target.insertAdjacentHTML("afterbegin", borrowerFormMarkup());
    bindRecordForms(target, loadData, state.borrowers, state.loans);
  }
  if (state.page === "loans") {
    target.insertAdjacentHTML("afterbegin", loanFormMarkup(state.borrowers) + paymentFormMarkup(state.loans, state.borrowers));
    bindRecordForms(target, loadData);
  }
  target.querySelectorAll<HTMLElement>("[data-page]").forEach(el => el.addEventListener("click", () => { state.page = el.dataset.page ?? "home"; renderPage(); }));
}

function empty(message: string) { return `<div class="empty-state"><span>▤</span><strong>No records to display</strong><p>${escapeHtml(message)}</p></div>`; }

function borrowerDetailsMarkup(borrower: Borrower) {
  const loans = state.loans.filter(loan => loan.borrower_id === borrower.id);
  const payments = loans.flatMap(loan => state.payments.filter(payment => payment.loan_id === loan.id).map(payment => ({ ...payment, loan })));
  return `<div class="detail-grid">
    <div><span class="detail-label">Borrower ID</span><code>${escapeHtml(borrower.id)}</code></div>
    <div><span class="detail-label">Phone</span><strong>${escapeHtml(borrower.phone || "Not provided")}</strong></div>
    <div class="detail-wide"><span class="detail-label">Notes</span><p>${escapeHtml(borrower.notes || "No notes recorded.")}</p></div>
  </div>
  <h4>Related loans (${loans.length})</h4>
  ${loans.length ? loans.map(loan => `<div class="related-record"><div><strong>${peso(loan.principal_minor)}</strong><small>${escapeHtml(loan.status)} · ${escapeHtml(loan.interest_type)} interest</small></div><span>${payments.filter(payment => payment.loan_id === loan.id).length} payment(s)</span></div>`).join("") : `<p class="muted">No loan records linked to this borrower.</p>`}
  <h4>Recorded payments (${payments.length})</h4>
  ${payments.length ? payments.map(payment => `<div class="related-record"><div><strong>${peso(payment.amount_minor)}</strong><small>Loan principal: ${peso(payment.loan.principal_minor)}</small></div><time>${new Date(payment.paid_at).toLocaleDateString("en-PH")}</time></div>`).join("") : `<p class="muted">No payments recorded for this borrower.</p>`}
  <p class="detail-disclaimer">These are stored record values only. Outstanding balance and interest are not calculated.</p>`;
}

function loanDetailsMarkup(loan: Loan) {
  const borrower = state.borrowers.find(item => item.id === loan.borrower_id);
  const payments = state.payments.filter(payment => payment.loan_id === loan.id);
  return `<div class="detail-grid">
    <div><span class="detail-label">Loan ID</span><code>${escapeHtml(loan.id)}</code></div>
    <div><span class="detail-label">Borrower</span><strong>${escapeHtml(borrower?.full_name ?? "Borrower record unavailable")}</strong></div>
    <div><span class="detail-label">Principal recorded</span><strong>${peso(loan.principal_minor)}</strong></div>
    <div><span class="detail-label">Currency</span><strong>${escapeHtml(loan.currency)}</strong></div>
    <div><span class="detail-label">Interest type</span><strong>${escapeHtml(loan.interest_type)}</strong></div>
    <div><span class="detail-label">Stored interest value</span><strong>${escapeHtml(String(loan.interest_value))} · ${escapeHtml(loan.interest_period)}</strong></div>
    <div><span class="detail-label">Status</span><strong>${escapeHtml(loan.status)}</strong></div>
  </div>
  <h4>Recorded payments (${payments.length})</h4>
  ${payments.length ? payments.map(payment => `<div class="related-record"><div><strong>${peso(payment.amount_minor)}</strong><small>Payment ID: ${escapeHtml(payment.id)}</small></div><time>${new Date(payment.paid_at).toLocaleString("en-PH")}</time></div>`).join("") : `<p class="muted">No payments recorded for this loan.</p>`}
  <p class="detail-disclaimer">Payment history is shown as recorded. No payment allocation, accrued interest, or outstanding balance is inferred.</p>`;
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!)); }

function bindShell() {
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach(b => b.addEventListener("click", () => { state.page = b.dataset.page ?? "home"; renderPage(); }));
  document.querySelector("#assistant-open")?.addEventListener("click", openAssistant);
  document.querySelector("#logout-button")?.addEventListener("click", logout);
  document.querySelector("#assistant-close")?.addEventListener("click", closeAssistant);
  document.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", sendMessage);
  document.querySelector<HTMLButtonElement>("#voice-btn")?.addEventListener("click", toggleVoice);
  document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(b => b.addEventListener("click", () => { const input = document.querySelector<HTMLTextAreaElement>("#chat-input"); if (input) { input.value = b.dataset.prompt ?? ""; input.focus(); } }));
}

function openAssistant() { state.page = "assistant"; renderPage(); document.querySelector<HTMLTextAreaElement>("#chat-input")?.focus(); }
function closeAssistant() { state.page = "home"; renderPage(); }

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


function renderContextPanel(query: string) {
  const list = document.querySelector<HTMLElement>("#chat-messages");
  if (!list || !state.connected) return;
  const q = query.toLocaleLowerCase();
  let title = "";
  let rows: Array<{ title: string; detail: string }> = [];
  if (/borrower|utang|nangutang|customer|tao|pangalan/.test(q)) {
    const matches = state.borrowers.filter(b => !q.replace(/borrower|utang|nangutang|customer|tao|pangalan|sino|hanap|find|show|list|lahat|all|details|detail|ni|si|ang|the|for|about/g, " ").trim() || b.full_name.toLocaleLowerCase().split(/\\s+/).some(part => q.includes(part)));
    title = "Borrower records";
    rows = matches.slice(0, 12).map(b => ({ title: b.full_name, detail: [b.phone || "No phone recorded", state.loans.filter(l => l.borrower_id === b.id).length + " linked loan(s)"].join(" · ") }));
  } else if (/loan|utang|pautang/.test(q)) {
    title = "Loan records";
    rows = state.loans.slice(0, 12).map(l => ({ title: peso(l.principal_minor) + " · " + l.status, detail: state.borrowers.find(b => b.id === l.borrower_id)?.full_name ?? "Borrower unavailable" }));
  } else if (/payment|bayad|hulog|nabayad/.test(q)) {
    title = "Recorded payments";
    rows = state.payments.slice(0, 12).map(p => ({ title: peso(p.amount_minor), detail: new Date(p.paid_at).toLocaleString("en-PH") + " · " + (state.loans.find(l => l.id === p.loan_id)?.id.slice(0, 8) ?? "Loan unavailable") }));
  } else if (/activity|history|kasaysayan|recent|recently/.test(q)) {
    title = "Recent confirmed activity";
    rows = state.activity.slice(0, 12).map(a => ({ title: a.action.replaceAll("_", " "), detail: a.entity_type + " · " + new Date(a.created_at).toLocaleString("en-PH") }));
  } else if (/overview|dashboard|summary|kabuuan/.test(q)) {
    title = "Verified workspace snapshot";
    rows = [
      { title: state.borrowers.length + " borrower record(s)", detail: "Stored borrower records" },
      { title: state.loans.length + " loan record(s)", detail: "Stored loan records; no balance inferred" },
      { title: state.payments.length + " payment record(s)", detail: "Recorded payment entries" },
      { title: state.activity.length + " activity record(s)", detail: "Confirmed audit entries" }
    ];
  }
  if (!title) return;
  const card = document.createElement("section");
  card.className = "context-panel";
  const heading = document.createElement("h4");
  heading.textContent = title;
  card.appendChild(heading);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "No matching verified records were found.";
    card.appendChild(empty);
  } else {
    rows.forEach(row => {
      const item = document.createElement("div");
      item.className = "context-row";
      const strong = document.createElement("strong");
      strong.textContent = row.title;
      const small = document.createElement("small");
      small.textContent = row.detail;
      item.append(strong, small);
      card.appendChild(item);
    });
  }
  const note = document.createElement("p");
  note.className = "context-note";
  note.textContent = "Context from stored records only. Outstanding balances, accrued interest, and payment allocation are not calculated here.";
  card.appendChild(note);
  list.appendChild(card);
  list.scrollTop = list.scrollHeight;
}

function renderProposal(proposal: AssistantProposal) {
  const list = document.querySelector<HTMLElement>("#chat-messages");
  if (!list) return;
  const card = document.createElement("section");
  card.className = "proposal-card";
  const heading = document.createElement("strong");
  heading.textContent = "Proposed action · approval required";
  const summary = document.createElement("p");
  summary.textContent = proposal.summary;
  const details = document.createElement("pre");
  details.textContent = JSON.stringify(proposal.payload, null, 2);
  const prepare = document.createElement("button");
  prepare.className = "proposal-button";
  prepare.textContent = "Review transaction details";
  prepare.addEventListener("click", async () => {
    prepare.disabled = true;
    prepare.textContent = "Preparing…";
    try {
      const response = await fetch("/api/actions/prepare", {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ type: proposal.type, payload: proposal.payload })
      });
      const data = await response.json() as { actionId?: string; error?: string };
      if (!response.ok || !data.actionId) throw new Error(data.error ?? "Could not prepare this action.");
      const notice = document.createElement("p");
      notice.className = "proposal-notice";
      notice.textContent = "Review the details above. Nothing is saved until you press Confirm and save.";
      const confirm = document.createElement("button");
      confirm.className = "proposal-confirm";
      confirm.textContent = "Confirm and save";
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        confirm.textContent = "Saving…";
        try {
          const result = await fetch("/api/actions/" + encodeURIComponent(data.actionId!) + "/confirm", {
            method: "POST", credentials: "same-origin"
          });
          const resultData = await result.json() as { error?: string; status?: string };
          if (!result.ok) throw new Error(resultData.error ?? "The transaction could not be saved.");
          notice.textContent = "Confirmed and saved successfully. Refreshing lending records…";
          confirm.remove();
          await loadData();
          addMessage("assistant", "Confirmed po. Na-save ang transaction at na-refresh ang lending records.");
        } catch (error) {
          notice.textContent = error instanceof Error ? error.message : "Save failed. Please check the records.";
          confirm.disabled = false;
          confirm.textContent = "Try confirmation again";
        }
      });
      prepare.remove();
      card.appendChild(notice);
      card.appendChild(confirm);
    } catch (error) {
      prepare.disabled = false;
      prepare.textContent = error instanceof Error ? error.message : "Try again";
    }
  });
  card.appendChild(heading);
  card.appendChild(summary);
  card.appendChild(details);
  card.appendChild(prepare);
  list.appendChild(card);
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
    renderContextPanel(content);
    if (data.proposedActions?.length) data.proposedActions.forEach(renderProposal);
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


function renderLogin(message = "") {
  app!.innerHTML = `
    <main class="login-screen">
      <form class="login-card" id="login-form">
        <div class="login-mark">A</div>
        <p class="eyebrow">PRIVATE OWNER WORKSPACE</p>
        <h1>Welcome back.</h1>
        <p class="muted">Sign in to securely access your lending records and AI assistant.</p>
        <label for="owner-password">Owner passphrase</label>
        <input id="owner-password" type="password" autocomplete="current-password" required maxlength="512" placeholder="Enter your private passphrase" />
        <p class="login-error" id="login-error">${escapeHtml(message)}</p>
        <button class="login-submit" type="submit">Sign in securely</button>
        <small>Your passphrase is sent only to the app API over HTTPS and is never stored in this browser.</small>
      </form>
    </main>`;
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector<HTMLButtonElement>(".login-submit");
    const password = document.querySelector<HTMLInputElement>("#owner-password")?.value ?? "";
    if (button) { button.disabled = true; button.textContent = "Signing in…"; }
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ password })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Sign in failed.");
      shell();
      await loadData();
    } catch (error) {
      renderLogin(error instanceof Error ? error.message : "Unable to sign in.");
    }
  });
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  state.connected = false;
  state.messages = [];
  renderLogin("You have signed out.");
}

async function startApp() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!response.ok) { renderLogin(); return; }
    shell();
    await loadData();
  } catch {
    renderLogin("The secure API is not reachable yet. Please try again later.");
  }
}

async function loadData() {
  const connection = document.querySelector<HTMLElement>("#connection");
  try {
    const [borrowers, loans, payments, activity] = await Promise.all([
      fetch("/api/borrowers"), fetch("/api/loans"), fetch("/api/payments"), fetch("/api/activity")
    ]);
    if ([borrowers, loans, payments, activity].some(r => r.status === 401 || r.status === 403)) throw new Error("Owner login required");
    if (![borrowers, loans, payments, activity].every(r => r.ok)) throw new Error("API unavailable");
    state.borrowers = (await borrowers.json() as ApiList<Borrower>).results;
    state.loans = (await loans.json() as ApiList<Loan>).results;
    state.payments = (await payments.json() as ApiList<Payment>).results;
    state.activity = (await activity.json() as ApiList<AuditEntry>).results;
    state.connected = true;
    if (connection) { connection.innerHTML = "<i></i> Secure data connected"; connection.classList.add("online"); }
  } catch {
    state.connected = false;
    if (connection) { connection.innerHTML = "<i></i> Setup required"; connection.classList.add("offline"); }
  } finally { state.loading = false; renderPage(); }
}

if ("speechSynthesis" in window) state.voiceAvailable = true;
void startApp();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.error));
}
