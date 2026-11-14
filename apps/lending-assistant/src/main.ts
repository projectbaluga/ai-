import "./style.css";
import { reportsMarkup, bindReports } from "./reports";

type Borrower = { id: string; full_name: string; phone?: string | null; notes?: string | null };
type Loan = { id: string; borrower_id: string; principal_minor: number; currency: string; status: string; interest_type: string; interest_value: number; interest_period: string; interest_frequency?: string; due_date?: string | null; repayment_timing_note?: string | null; repayment_frequency?: string; installment_count?: number | null; installment_amount_minor?: number | null };
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
  pendingReviews: [] as Array<{ actionId: string; notice: HTMLElement; confirm: HTMLButtonElement; cancel: HTMLButtonElement }>,
  busy: false,
  actionBusy: false,
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
    document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === state.page));
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
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">PEOPLE YOU LEND TO</p><h1>Borrowers</h1><p class="muted">Manage borrower details and find records with your AI assistant.</p></div></div><section class="list-card">${state.connected && state.borrowers.length ? state.borrowers.map(b => `<details class="record-detail" data-record-id="${escapeHtml(b.id)}"><summary class="record-row"><span class="record-avatar">${escapeHtml(b.full_name.slice(0,1).toUpperCase())}</span><span class="record-main"><strong>${escapeHtml(b.full_name)}</strong><small>${escapeHtml(b.phone ?? "No phone number")} · ${state.loans.filter(l => l.borrower_id === b.id).length} loan(s)</small></span><span class="detail-hint">View details⌄</span></summary><div class="record-detail-body">${borrowerDetailsMarkup(b)}</div></details>`).join("") : empty("Borrower records will appear here after secure owner login.")}</section>`;
  } else if (state.page === "loans") {
    target.innerHTML = `<div class="page-intro"><div><p class="eyebrow">LENDING PORTFOLIO</p><h1>Loans</h1><p class="muted">Review principal amounts and loan status.</p></div></div><section class="list-card">${state.connected && state.loans.length ? state.loans.map(l => `<details class="record-detail" data-record-id="${escapeHtml(l.id)}"><summary class="record-row"><span class="record-avatar loan-avatar">₱</span><span class="record-main"><strong>${peso(l.principal_minor)}</strong><small>${escapeHtml(state.borrowers.find(b => b.id === l.borrower_id)?.full_name ?? "Borrower record unavailable")} · ${escapeHtml(l.status)}</small></span><span class="status-tag">${escapeHtml(l.status)}</span><span class="detail-hint">View details⌄</span></summary><div class="record-detail-body">${loanDetailsMarkup(l)}</div></details>`).join("") : empty("Loan records will appear here after secure owner login.")}</section>`;
  } else if (state.page === "reports") {
    target.innerHTML = reportsMarkup();
    bindReports(target);
  } else {
    const rows = state.activity.map(a => "<div class=\"record-row\"><span class=\"record-avatar loan-avatar\">↻</span><div><strong>" + escapeHtml(a.action.replaceAll("_", " ")) + " · " + escapeHtml(a.entity_type) + "</strong><small>" + new Date(a.created_at).toLocaleString("en-PH") + " · Ref: " + escapeHtml(a.entity_id.slice(0,8)) + "</small></div></div>").join("");
    target.innerHTML = "<div class=\"page-intro\"><div><p class=\"eyebrow\">AUDIT TRAIL</p><h1>Activity</h1><p class=\"muted\">Confirmed changes recorded by the system.</p></div></div><section class=\"list-card\">" + (state.connected && state.activity.length ? rows : empty("Confirmed activity will appear here after secure owner login.")) + "</section>";
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
    <div><span class="detail-label">Stored interest value</span><strong>${escapeHtml(loan.interest_type === "none" ? "Walang interest" : String(loan.interest_value) + " · " + (loan.interest_frequency ?? loan.interest_period))}</strong></div>
    <div><span class="detail-label">Due date</span><strong>${escapeHtml(loan.due_date || "Walang exact date na naitala")}</strong></div>
    <div><span class="detail-label">Napag-usapang bayaran</span><strong>${escapeHtml(loan.repayment_timing_note || "Wala")}</strong></div>
    <div><span class="detail-label">Repayment schedule</span><strong>${escapeHtml(loan.repayment_frequency || "one_time")}</strong></div>
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
  if (role === "user") list.querySelectorAll(".quick-replies").forEach(node => node.remove());
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  bubble.textContent = content;
  list.appendChild(bubble);
  if (role === "assistant") renderQuickReplies(content, list);
  if (role === "assistant" && state.voiceMode && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = /[\\u0E00-\\u0E7F]/.test(content) ? "fil-PH" : "en-PH";
    window.speechSynthesis.speak(utterance);
  }
  list.scrollTop = list.scrollHeight;
}


function renderQuickReplies(message: string, list: HTMLElement) {
  const text = message.toLocaleLowerCase();
  const recentUserMessages = state.messages.slice(-10).filter(item => item.role === "user");
  const recentLoan = recentUserMessages.some(item =>
    /\b(borrowed|loaned|lent|nagpautang|pinahiram|nangutang|umutang|pinautang)\b/i.test(item.content));
  const asksInterestType = /\b(one[- ]?time|monthly|monthly interest|one-time interest|paminsan|buwanan)\b/i.test(text) &&
    /\b(interest|interes|tubo|rate|porsyento)\b/i.test(text);
  const asksInterestExistence = /\b(interest[- ]?free|interest|interes|tubo)\b/i.test(text) &&
    /\b(agreed|napagkasunduan|may|wala|none|free|ba po|ba\??)\b/i.test(text);
  const asksConfirmation = /\b(should i|would you like|do you want|shall i|gusto (niyo|mo)|nais (niyo|mo)|proceed|continue|save (the )?(note|changes|update)|update the note|register|record the loan|magpatuloy|ituloy|i-save|isave|kumpirmahin|confirm)\b/i.test(text) &&
    /\?|please confirm|approval required|pakireview|review.*before/i.test(text);
  const asksCorrection = /\b(correct|change|revise|edit|baguhin|palitan|itama)\b/i.test(text) &&
    /\b(detail|information|terms|amount|rate|pangalan|detalye)\b/i.test(text);
  let choices: string[] = [];
  let question = "";

  if (asksInterestType && /\bone[- ]?time.{0,45}(or|\/|versus|vs\.?).{0,45}monthly|monthly.{0,45}(or|\/|versus|vs\.?).{0,45}one[- ]?time|one[- ]?time.*monthly|monthly.*one[- ]?time|paminsan.*buwanan|buwanan.*paminsan/i.test(text)) {
    question = "Piliin ang napagkasunduang interest:";
    choices = ["One-time interest", "Monthly interest"];
  } else if (asksInterestExistence && !/\b(one[- ]?time|monthly)\b/i.test(text)) {
    question = "Ano ang napagkasunduan ninyo sa interest?";
    choices = ["Walang interest", "May interest", "Hindi pa napagkasunduan"];
  } else if (asksConfirmation) {
    question = "Piliin ang gusto ninyong gawin:";
    choices = ["Oo, magpatuloy", "Hindi muna", "Baguhin ang detalye"];
  } else if (asksCorrection) {
    question = "Ano ang gusto ninyong gawin?";
    choices = ["Panatilihin ang detalye", "Baguhin ang detalye", "Kanselahin muna"];
  } else if (recentLoan && /\b(pakiulit|repeat|could not|couldn't|hindi.*maihanda|action.*maayos|try again|please provide.*details)\b/i.test(text)) {
    question = "Para maipagpatuloy ang loan, ano ang napagkasunduan sa interest?";
    choices = ["Walang interest", "May interest", "Hindi pa napagkasunduan"];
  }

  if (!choices.length) return;
  const wrap = document.createElement("div");
  wrap.className = "quick-replies";
  if (question) {
    const prompt = document.createElement("p");
    prompt.className = "quick-replies-prompt";
    prompt.textContent = question;
    wrap.appendChild(prompt);
  }
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-reply";
    button.textContent = choice;
    button.addEventListener("click", () => {
      const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
      const form = document.querySelector<HTMLFormElement>("#chat-form");
      if (!input || !form || state.busy || state.actionBusy) return;
      input.value = choice;
      form.requestSubmit();
    });
    wrap.appendChild(button);
  }
  list.appendChild(wrap);
}

function renderContextPanel(query: string) {
  const list = document.querySelector<HTMLElement>("#chat-messages");
  if (!list || !state.connected) return;
  const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, " ").trim();
  const q = normalize(query);
  const ignored = new Set(["show", "find", "list", "open", "view", "search", "all", "my", "me", "please", "po", "ang", "mga", "ng", "sa", "si", "kay", "for", "the", "a", "an", "with", "about", "record", "records"]);
  const tokens = q.split(/\s+/).filter(word => word.length > 1 && !ignored.has(word));
  const has = (...terms: string[]) => terms.some(term => q.includes(normalize(term)));
  const borrowerCandidates = state.borrowers.map(b => {
    const nameTokens = normalize(b.full_name).split(/\s+/).filter(Boolean);
    const matched = nameTokens.filter(word => tokens.includes(word));
    return { borrower: b, matched: matched.length, complete: nameTokens.length > 0 && nameTokens.every(word => tokens.includes(word)) };
  }).filter(item => item.matched > 0)
    .sort((a, b) => Number(b.complete) - Number(a.complete) || b.matched - a.matched);
  const exactBorrowers = borrowerCandidates.filter(item => item.complete).map(item => item.borrower);
  const singleNameCandidates = tokens.length === 1 ? borrowerCandidates.map(item => item.borrower) : [];
  const namedBorrowers = exactBorrowers.length ? exactBorrowers :
    singleNameCandidates.length === 1 ? singleNameCandidates : [];
  const ambiguousBorrowers = !exactBorrowers.length && singleNameCandidates.length > 1 ? singleNameCandidates : [];
  const loanIdMatches = state.loans.filter(loan => q.includes(normalize(loan.id)));
  const paymentIdMatches = state.payments.filter(payment => q.includes(normalize(payment.id)));
  const card = document.createElement("section");
  card.className = "context-panel";
  const heading = document.createElement("h4");
  const rows = document.createElement("div");
  rows.className = "context-panel-list";
  let count = 0;
  const addRow = (title: string, detail: string, page: string, id: string, tag: string) => {
    const item = document.createElement("article");
    item.className = "context-row";
    const copy = document.createElement("div");
    copy.className = "context-row-copy";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = detail;
    copy.appendChild(strong);
    copy.appendChild(small);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "context-open";
    action.textContent = "Open";
    action.addEventListener("click", () => {
      state.page = page;
      renderPage();
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-record-id]")).find(el => el.dataset.recordId === id);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    item.appendChild(copy);
    item.appendChild(action);
    item.dataset.kind = tag;
    rows.appendChild(item);
    count++;
  };
  let kind = "";
  if (has("report", "reports", "ulat", "statement", "collection summary")) kind = "reports";
  else if (paymentIdMatches.length || has("payment", "bayad", "hulog", "nabayad", "payments")) kind = "payments";
  else if (loanIdMatches.length || has("loan", "loans", "pautang", "utang record", "active loan")) kind = "loans";
  else if (has("borrower", "borrowers", "customer", "kliyente", "tao", "sino") || namedBorrowers.length || ambiguousBorrowers.length) kind = "borrowers";
  else if (has("activity", "history", "kasaysayan", "recent activity")) kind = "activity";
  else if (has("overview", "dashboard", "summary", "kabuuan", "workspace")) kind = "overview";
  if (kind === "borrowers") {
    heading.textContent = ambiguousBorrowers.length ? "Possible borrower matches" : "Borrower records";
    const generic = has("lahat", "all", "list", "show", "find") && !namedBorrowers.length && !ambiguousBorrowers.length;
    const matches = namedBorrowers.length ? namedBorrowers :
      ambiguousBorrowers.length ? ambiguousBorrowers :
      generic || has("borrower", "borrowers", "customer", "kliyente", "tao", "sino") ? state.borrowers : [];
    matches.slice(0, 12).forEach(b => {
      const related = state.loans.filter(l => l.borrower_id === b.id);
      addRow(b.full_name, (b.phone || "No phone recorded") + " · " + related.length + " linked loan(s)", "borrowers", b.id, "borrower");
    });
    if (ambiguousBorrowers.length) {
      const hint = document.createElement("p");
      hint.className = "context-note";
      hint.textContent = "More than one borrower matches that name. Please specify the full name before preparing a change.";
      card.appendChild(hint);
    }
  } else if (kind === "loans") {
    heading.textContent = "Loan records";
    const generic = !namedBorrowers.length && !loanIdMatches.length &&
      (has("lahat", "all", "list", "show", "active") || has("loan", "loans", "pautang", "utang record"));
    const matches = loanIdMatches.length ? loanIdMatches : state.loans.filter(l =>
      (generic || namedBorrowers.some(b => b.id === l.borrower_id)) &&
      (!has("active", "aktibo") || l.status === "active"));
    matches.slice(0, 12).forEach(l => {
      const borrower = state.borrowers.find(b => b.id === l.borrower_id);
      addRow(peso(l.principal_minor) + " · " + l.status, (borrower?.full_name ?? "Borrower unavailable") + " · " + l.interest_type + " interest", "loans", l.id, "loan");
    });
  } else if (kind === "payments") {
    heading.textContent = "Recorded payment entries";
    const matches = paymentIdMatches.length ? paymentIdMatches : state.payments.filter(p => {
      const loan = state.loans.find(l => l.id === p.loan_id);
      return !namedBorrowers.length || !!loan && namedBorrowers.some(b => b.id === loan.borrower_id);
    });
    matches.slice(0, 12).forEach(p => {
      const loan = state.loans.find(l => l.id === p.loan_id);
      const borrower = loan && state.borrowers.find(b => b.id === loan.borrower_id);
      addRow(peso(p.amount_minor), (borrower?.full_name ?? "Borrower unavailable") + " · " + new Date(p.paid_at).toLocaleString("en-PH"), "loans", p.loan_id, "payment");
    });
  } else if (kind === "reports") {
    heading.textContent = "On-demand reports";
    const description = document.createElement("p");
    description.className = "context-note";
    description.textContent = "You can generate a payment report for a date range you choose. It totals recorded payments only; it does not estimate balances, interest, or payoff amounts.";
    rows.appendChild(description);
    const openReport = document.createElement("button");
    openReport.type = "button";
    openReport.className = "context-open";
    openReport.textContent = "Open payment reports";
    openReport.addEventListener("click", () => {
      state.page = "reports";
      renderPage();
      document.querySelector("#payment-report-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    rows.appendChild(openReport);
    count++;
  } else if (kind === "activity") {
    heading.textContent = "Confirmed activity";
    state.activity.slice(0, 12).forEach(a => {
      const payment = a.entity_type === "payment" ? state.payments.find(item => item.id === a.entity_id) : undefined;
      const targetPage = a.entity_type === "borrower" ? "borrowers" : "loans";
      const targetId = payment ? payment.loan_id : a.entity_id;
      const targetExists = a.entity_type === "borrower"
        ? state.borrowers.some(item => item.id === targetId)
        : state.loans.some(item => item.id === targetId);
      if (targetExists) {
        addRow(a.action.replaceAll("_", " "), a.entity_type + " · " + new Date(a.created_at).toLocaleString("en-PH"), targetPage, targetId, "activity");
      } else {
        const item = document.createElement("article");
        item.className = "context-row";
        const copy = document.createElement("div");
        copy.className = "context-row-copy";
        const strong = document.createElement("strong");
        strong.textContent = a.action.replaceAll("_", " ");
        const small = document.createElement("small");
        small.textContent = a.entity_type + " · " + new Date(a.created_at).toLocaleString("en-PH") + " · Record unavailable";
        copy.appendChild(strong);
        copy.appendChild(small);
        item.appendChild(copy);
        rows.appendChild(item);
        count++;
      }
    });
  } else if (kind === "overview") {
    heading.textContent = "Verified workspace snapshot";
    [
      [state.borrowers.length + " borrower record(s)", "Stored borrower records"],
      [state.loans.length + " loan record(s)", "Stored loan records · no balance inferred"],
      [state.payments.length + " payment record(s)", "Recorded payment entries"],
      [state.activity.length + " activity record(s)", "Confirmed audit entries"]
    ].forEach(([title, detail]) => {
      const item = document.createElement("article");
      item.className = "context-row context-stat";
      const strong = document.createElement("strong");
      strong.textContent = title;
      const small = document.createElement("small");
      small.textContent = detail;
      item.appendChild(strong);
      item.appendChild(small);
      rows.appendChild(item);
      count++;
    });
  } else return;
  card.appendChild(heading);
  if (!count) {
    const empty = document.createElement("p");
    empty.className = "context-empty";
    empty.textContent = "No matching stored records were found.";
    card.appendChild(empty);
  } else card.appendChild(rows);
  const note = document.createElement("p");
  note.className = "context-note";
  note.textContent = "Verified stored records only. Outstanding balances, accrued interest, and payment allocation are not calculated.";
  card.appendChild(note);
  list.appendChild(card);
  list.scrollTop = list.scrollHeight;
}
function showDeleteAllPasswordModal(notice: HTMLElement) {
  const existing = document.querySelector("#delete-all-modal");
  existing?.remove();
  const overlay = document.createElement("div");
  overlay.id = "delete-all-modal";
  overlay.className = "secure-modal-backdrop";
  overlay.innerHTML = `
    <section class="secure-modal" role="dialog" aria-modal="true" aria-labelledby="delete-all-title">
      <button type="button" class="secure-modal-close" aria-label="Close">×</button>
      <p class="eyebrow">OWNER SECURITY CHECK</p>
      <h2 id="delete-all-title">Delete all lending records?</h2>
      <p class="secure-modal-warning">This permanently deletes all borrower, loan, payment, and pending-action records. This cannot be undone.</p>
      <p class="secure-modal-copy">Your audit history will be retained. Enter your owner password to authorize this operation.</p>
      <form id="delete-all-form">
        <label for="delete-all-password">Owner password</label>
        <input id="delete-all-password" type="password" autocomplete="current-password" required maxlength="512" placeholder="Enter owner password" />
        <p class="secure-modal-error" id="delete-all-error" role="alert"></p>
        <div class="secure-modal-actions">
          <button type="button" class="secure-modal-cancel">Cancel</button>
          <button type="submit" class="secure-modal-submit">Verify password and delete</button>
        </div>
      </form>
    </section>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    const actionButton = document.querySelector<HTMLButtonElement>(".proposal-card .proposal-button");
    if (actionButton && actionButton.textContent === "Continue to password check") actionButton.disabled = false;
  };
  overlay.querySelector(".secure-modal-close")?.addEventListener("click", close);
  overlay.querySelector(".secure-modal-cancel")?.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  const password = overlay.querySelector<HTMLInputElement>("#delete-all-password");
  password?.focus();
  overlay.querySelector<HTMLFormElement>("#delete-all-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = overlay.querySelector<HTMLButtonElement>(".secure-modal-submit");
    const error = overlay.querySelector<HTMLElement>("#delete-all-error");
    const secret = password?.value ?? "";
    if (!secret || !button) return;
    button.disabled = true;
    button.textContent = "Verifying and deleting…";
    if (error) error.textContent = "";
    try {
      const response = await fetch("/api/admin/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: secret })
      });
      const result = await response.json() as { error?: string; status?: string; deleted?: { borrowers: number; loans: number; payments: number } };
      if (!response.ok || result.status !== "deleted") throw new Error(result.error ?? "Deletion was not completed.");
      password!.value = "";
      close();
      notice.textContent = "Deletion completed. " + result.deleted!.borrowers + " borrower(s), " + result.deleted!.loans + " loan(s), and " + result.deleted!.payments + " payment(s) deleted. Audit history retained.";
      await loadData();
      addMessage("assistant", "Na-delete ang lending records matapos ma-verify ang owner password. Napanatili ang audit history.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deletion failed. No success was reported.";
      if (message.includes("Incorrect owner password") && password) password.value = "";
      if (error) error.textContent = message;
      button.disabled = false;
      button.textContent = "Verify password and delete";
      password?.focus();
    }
  });
}

function renderProposal(proposal: AssistantProposal) {
  const list = document.querySelector<HTMLElement>("#chat-messages");
  if (!list) return;
  const card = document.createElement("section");
  card.className = "proposal-card";
  if (proposal.type === "clear_all_records") {
    const heading = document.createElement("strong");
    heading.textContent = "Destructive action · owner password required";
    const summary = document.createElement("p");
    summary.textContent = proposal.summary;
    const warning = document.createElement("p");
    warning.className = "proposal-notice";
    warning.textContent = "Deletes all borrowers, loans, payments, and pending actions. Audit history is retained.";
    const authorize = document.createElement("button");
    authorize.className = "proposal-button";
    authorize.textContent = "Continue to password check";
    authorize.addEventListener("click", () => {
      authorize.disabled = true;
      showDeleteAllPasswordModal(warning);
    });
    card.appendChild(heading);
    card.appendChild(summary);
    card.appendChild(warning);
    card.appendChild(authorize);
    list.appendChild(card);
    list.scrollTop = list.scrollHeight;
    return;
  }
  const heading = document.createElement("strong");
  heading.textContent = proposal.type === "create_loan" ? "Suriin ang detalye ng utang" : "Suriin ang gagawing pagbabago";
  const summary = document.createElement("p");
  summary.textContent = proposal.type === "create_loan"
    ? "Pakitingnan kung tama ang mga detalye. Wala pang mase-save hangga't hindi ninyo pinipindot ang save."
    : proposal.summary;
  const details = document.createElement("pre");
  if (proposal.type === "create_loan") {
    const payload = proposal.payload as Record<string, unknown>;
    const borrower = typeof payload.borrowerFullName === "string" ? payload.borrowerFullName :
      state.borrowers.find(item => item.id === payload.borrowerId)?.full_name ?? "Nakalista nang borrower";
    const principal = typeof payload.principalMinor === "number" ? (payload.principalMinor / 100).toLocaleString("en-PH", { style: "currency", currency: "PHP" }) : "—";
    const frequency = String(payload.interestFrequency ?? payload.interestPeriod ?? "one_time");
    const frequencyLabel: Record<string, string> = { one_time: "one-time", daily: "araw-araw", weekly: "lingguhan", monthly: "buwanan", annual: "taunan" };
    const interest = payload.interestType === "none" ? "Walang interest" :
      String(payload.interestValue) + (payload.interestType === "percentage" ? "%" : " pesos") +
      " · " + (frequencyLabel[frequency] ?? frequency);
    const repaymentLabel: Record<string, string> = { one_time: "Isang bayaran", daily: "Araw-araw", weekly: "Lingguhan", biweekly: "Kada dalawang linggo", monthly: "Buwanan" };
    details.textContent = "Hihiraman: " + borrower + (payload.borrowerFullName ? " (irehistro kung bago pa)" : "") +
      "\nHalagang ipinahiram: " + principal + "\nInterest: " + interest +
      (payload.dueDate ? "\nTakdang petsa: " + String(payload.dueDate) : "") +
      (payload.repaymentTimingNote ? "\nNapag-usapang bayaran: " + String(payload.repaymentTimingNote) : "") +
      (payload.repaymentFrequency ? "\nParaan ng bayad: " + (repaymentLabel[String(payload.repaymentFrequency)] ?? String(payload.repaymentFrequency)) : "") +
      (payload.installmentCount ? "\nBilang ng hulog: " + String(payload.installmentCount) : "") +
      (typeof payload.installmentAmountMinor === "number" ? "\nHalaga kada hulog: " + peso(payload.installmentAmountMinor) : "");
  } else {
    details.textContent = JSON.stringify(proposal.payload, null, 2);
  }
  const prepare = document.createElement("button");
  prepare.className = "proposal-button";
  prepare.textContent = proposal.type === "create_loan" ? "I-save ang loan na ito" : "Review transaction details";
  prepare.addEventListener("click", async () => {
    if (state.actionBusy || state.busy) return;
    state.actionBusy = true;
    prepare.disabled = true;
    prepare.textContent = "Preparing…";
    try {
      const response = await fetch("/api/actions/prepare", {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ type: proposal.type, payload: proposal.payload })
      });
      const data = await response.json() as { actionId?: string; error?: string; expiresInMinutes?: number };
      if (!response.ok || !data.actionId) throw new Error(data.error ?? "Could not prepare this action.");
      const notice = document.createElement("p");
      notice.className = "proposal-notice";
      notice.textContent = "Hindi pa ito nase-save. Pindutin ang button sa ibaba kung tama na ang lahat.";
      const confirm = document.createElement("button");
      confirm.className = "proposal-confirm";
      confirm.textContent = proposal.type === "create_loan" ? "I-save ang loan" : "Kumpirmahin at i-save";
      confirm.addEventListener("click", async () => {
        if (state.actionBusy || state.busy) return;
        state.actionBusy = true;
        confirm.disabled = true;
        confirm.textContent = "Saving…";
        try {
          const result = await fetch("/api/actions/" + encodeURIComponent(data.actionId!) + "/confirm", {
            method: "POST", credentials: "same-origin"
          });
          const resultData = await result.json() as { error?: string; status?: string; borrowerCreated?: boolean };
          if (!result.ok) throw new Error(resultData.error ?? "The transaction could not be saved.");
          notice.textContent = "Nai-save na. Ina-update ang listahan ng records…";
          confirm.remove();
          await loadData();
          state.pendingReviews = state.pendingReviews.filter(item => item.actionId !== data.actionId);
          addMessage("assistant", resultData.borrowerCreated
            ? "Nairehistro si " + String((proposal.payload as Record<string, unknown>).borrowerFullName ?? "ang borrower") + " at na-save ang loan. Na-refresh na ang lending records."
            : "Na-save ang loan. Na-refresh na ang lending records.");
        } catch (error) {
          notice.textContent = error instanceof Error ? error.message : "Save failed. Please check the records.";
          confirm.disabled = false;
          confirm.textContent = "Try confirmation again";
        } finally { state.actionBusy = false; }
      });
      const cancel = document.createElement("button");
      cancel.className = "proposal-cancel";
      cancel.textContent = "Cancel review";
      cancel.addEventListener("click", async () => {
        if (state.actionBusy || state.busy) return;
        state.actionBusy = true;
        cancel.disabled = true;
        confirm.disabled = true;
        cancel.textContent = "Cancelling…";
        try {
          const result = await fetch("/api/actions/" + encodeURIComponent(data.actionId!) + "/cancel", {
            method: "POST", credentials: "same-origin"
          });
          const resultData = await result.json() as { error?: string; status?: string };
          if (!result.ok || resultData.status !== "cancelled") throw new Error(resultData.error ?? "Could not cancel this review.");
          notice.textContent = "Cancelled. Nothing was saved.";
          confirm.remove();
          cancel.remove();
          state.pendingReviews = state.pendingReviews.filter(item => item.actionId !== data.actionId);
        } catch (error) {
          notice.textContent = error instanceof Error ? error.message : "Cancellation failed. Check the action status before retrying.";
          cancel.disabled = false;
          confirm.disabled = false;
          cancel.textContent = "Cancel review";
        } finally { state.actionBusy = false; }
      });
      prepare.remove();
      card.appendChild(notice);
      card.appendChild(confirm);
      card.appendChild(cancel);
      state.pendingReviews.push({ actionId: data.actionId, notice, confirm, cancel });
      state.actionBusy = false;
      // One tap on the clearly labelled save button is the owner's approval:
      // prepare the protected action and confirm it immediately.
      if (proposal.type === "create_loan") confirm.click();
    } catch (error) {
      prepare.disabled = false;
      prepare.textContent = error instanceof Error ? error.message : "Try again";
      state.actionBusy = false;
    }
  });
  card.appendChild(heading);
  card.appendChild(summary);
  card.appendChild(details);
  card.appendChild(prepare);
  list.appendChild(card);
  list.scrollTop = list.scrollHeight;
}

async function invalidatePendingReviews() {
  for (const review of [...state.pendingReviews]) {
    review.confirm.disabled = true;
    review.cancel.disabled = true;
    const response = await fetch("/api/actions/" + encodeURIComponent(review.actionId) + "/cancel", {
      method: "POST", credentials: "same-origin"
    });
    const data = await response.json() as { error?: string; status?: string };
    if (!response.ok || data.status !== "cancelled") {
      review.confirm.disabled = false;
      review.cancel.disabled = false;
      throw new Error(data.error ?? "A pending review could not be safely invalidated.");
    }
    review.notice.textContent = "Review cancelled because a new message started. Nothing was saved.";
    review.confirm.remove();
    review.cancel.remove();
    state.pendingReviews = state.pendingReviews.filter(item => item.actionId !== review.actionId);
  }
}

async function sendMessage(event: SubmitEvent) {
  event.preventDefault();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
  const content = input?.value.trim();
  if (!content || state.busy || state.actionBusy) return;
  if (state.pendingReviews.length) {
    state.actionBusy = true;
    try {
      await invalidatePendingReviews();
    } catch (error) {
      addMessage("assistant", (error instanceof Error ? error.message : "May pending review pa.") + " Hindi muna ipinadala ang bagong message para hindi magamit ang lumang approval. Pakitingnan ang pending review.");
      state.actionBusy = false;
      return;
    }
    state.actionBusy = false;
  }
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