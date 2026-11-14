type BorrowerOption = { id: string; full_name: string };
type LoanOption = { id: string; borrower_id: string; principal_minor: number; status: string };

function safe(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));
}

export function borrowerFormMarkup(): string {
  return '<section class="form-card"><h2>Add a borrower</h2><form id="borrower-form" class="record-form">' +
    '<label>Full name<input name="fullName" required maxlength="160" placeholder="Borrower full name"></label>' +
    '<label>Phone number<input name="phone" maxlength="40" placeholder="Optional"></label>' +
    '<label>Notes<textarea name="notes" rows="2" maxlength="1000" placeholder="Optional notes"></textarea></label>' +
    '<button class="form-submit" type="submit">Review borrower</button></form><div id="record-review"></div></section>';
}

export function loanFormMarkup(borrowers: BorrowerOption[]): string {
  const options = borrowers.map(b => '<option value="' + safe(b.id) + '">' + safe(b.full_name) + '</option>').join("");
  return '<section class="form-card"><h2>Create a loan</h2><form id="loan-form" class="record-form">' +
    '<label>Borrower<select name="borrowerId" required>' + options + '</select></label>' +
    '<label>Principal amount (PHP)<input name="principal" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>' +
    '<div class="form-columns"><label>Interest type<select name="interestType"><option value="none">No interest</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></label>' +
    '<label>Interest value<input name="interestValue" type="number" min="0" step="0.01" value="0" required></label></div>' +
    '<label>Interest period<select name="interestPeriod"><option value="one_time">One time</option><option value="monthly">Monthly</option></select></label>' +
    '<p class="form-note">Interest terms are stored as entered. Interest accrual and payoff totals are not calculated until the exact rules are finalized.</p>' +
    '<button class="form-submit" type="submit" ' + (borrowers.length ? "" : "disabled") + '>Review loan</button></form><div id="record-review"></div></section>';
}

export function paymentFormMarkup(loans: LoanOption[], borrowers: BorrowerOption[]): string {
  const active = loans.filter(l => l.status === "active").map(l => {
    const name = borrowers.find(b => b.id === l.borrower_id)?.full_name ?? "Borrower";
    return '<option value="' + safe(l.id) + '">' + safe(name) + ' · PHP ' + (l.principal_minor / 100).toFixed(2) + '</option>';
  }).join("");
  const today = new Date().toISOString().slice(0, 10);
  return '<section class="form-card"><h2>Record a payment</h2><form id="payment-form" class="record-form">' +
    '<label>Active loan<select name="loanId" required>' + active + '</select></label>' +
    '<label>Payment amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>' +
    '<label>Payment date<input name="paidAt" type="date" value="' + today + '" required></label>' +
    '<label>Notes<textarea name="notes" rows="2" maxlength="1000" placeholder="Optional"></textarea></label>' +
    '<button class="form-submit" type="submit" ' + (active ? "" : "disabled") + '>Review payment</button></form><div id="record-review"></div></section>';
}

async function prepareAndReview(type: string, payload: Record<string, unknown>, summary: string, target: HTMLElement, refresh: () => Promise<void>) {
  target.textContent = "Preparing review…";
  try {
    const response = await fetch("/api/actions/prepare", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json() as { actionId?: string; error?: string };
    if (!response.ok || !data.actionId) throw new Error(data.error ?? "Could not prepare this transaction.");
    target.innerHTML = "";
    const details = document.createElement("p");
    details.className = "form-note";
    details.textContent = summary + " · " + JSON.stringify(payload) + ". Nothing has been saved yet.";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "form-submit";
    confirm.textContent = "Confirm and save";
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      confirm.textContent = "Saving…";
      try {
        const result = await fetch("/api/actions/" + encodeURIComponent(data.actionId!) + "/confirm", { method: "POST", credentials: "same-origin" });
        const resultData = await result.json() as { error?: string };
        if (!result.ok) throw new Error(resultData.error ?? "Could not save this transaction.");
        target.textContent = "Saved successfully. Refreshing records…";
        await refresh();
      } catch (error) {
        details.textContent = error instanceof Error ? error.message : "Save failed.";
        confirm.disabled = false;
        confirm.textContent = "Try again";
      }
    });
    target.appendChild(details);
    target.appendChild(confirm);
  } catch (error) {
    target.textContent = error instanceof Error ? error.message : "Unable to prepare transaction.";
  }
}

export function bindRecordForms(root: HTMLElement, refresh: () => Promise<void>, borrowers: BorrowerOption[] = []): void {
  root.querySelector<HTMLFormElement>("#borrower-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const payload = {
      fullName: String(data.get("fullName") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || null,
      notes: String(data.get("notes") ?? "").trim() || null
    };
    const target = root.querySelector<HTMLElement>("#record-review");
    if (target) void prepareAndReview("create_borrower", payload, "Add borrower", target, refresh);
  });

  root.querySelector<HTMLFormElement>("#loan-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const principalMinor = Math.round(Number(data.get("principal")) * 100);
    const interestValue = Number(data.get("interestValue"));
    const interestType = String(data.get("interestType"));
    if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0 || !Number.isFinite(interestValue) || interestValue < 0 || (interestType === "none" && interestValue !== 0)) {
      window.alert("Please check the principal and interest values.");
      return;
    }
    const payload = {
      borrowerId: String(data.get("borrowerId")), principalMinor, currency: "PHP",
      interestType, interestValue, interestPeriod: String(data.get("interestPeriod"))
    };
    const target = root.querySelector<HTMLElement>("#record-review");
    if (target) void prepareAndReview("create_loan", payload, "Create loan", target, refresh);
  });

  root.querySelectorAll<HTMLButtonElement>("[data-edit-borrower]").forEach(button => button.addEventListener("click", () => {
    const borrower = borrowers.find(item => item.id === button.dataset.editBorrower);
    if (!borrower) return;
    const fullName = window.prompt("Borrower full name", borrower.full_name);
    if (!fullName || !fullName.trim()) return;
    const phone = window.prompt("Phone number (leave blank if none)", "");
    const notes = window.prompt("Notes (optional)", "");
    const target = root.querySelector<HTMLElement>("#record-review");
    if (target) void prepareAndReview("update_borrower", { borrowerId: borrower.id, fullName: fullName.trim(), phone: phone?.trim() || null, notes: notes?.trim() || null }, "Update borrower", target, refresh);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-archive-borrower]").forEach(button => button.addEventListener("click", () => {
    const borrower = borrowers.find(item => item.id === button.dataset.archiveBorrower);
    if (!borrower || !window.confirm("Archive " + borrower.full_name + "? The history will be kept.")) return;
    const target = root.querySelector<HTMLElement>("#record-review");
    if (target) void prepareAndReview("archive_borrower", { borrowerId: borrower.id }, "Archive borrower", target, refresh);
  }));
  root.querySelector<HTMLFormElement>("#payment-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const amountMinor = Math.round(Number(data.get("amount")) * 100);
    const paidAt = String(data.get("paidAt"));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !paidAt) {
      window.alert("Please check the payment amount and date.");
      return;
    }
    const payload = {
      loanId: String(data.get("loanId")), amountMinor,
      paidAt: new Date(paidAt + "T12:00:00").toISOString(),
      notes: String(data.get("notes") ?? "").trim() || null
    };
    const target = root.querySelector<HTMLElement>("#record-review");
    if (target) void prepareAndReview("record_payment", payload, "Record payment", target, refresh);
  });
}
