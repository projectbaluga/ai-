type PaymentReport = {
  from: string;
  to: string;
  paymentCount: number;
  totalMinor: number;
  byDay: Array<{ day: string; payment_count: number; total_minor: number }>;
};

export function reportsMarkup(): string {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 29);
  const from = fromDate.toISOString().slice(0, 10);
  return '<div class="page-intro"><div><p class="eyebrow">ON-DEMAND REPORTS</p><h1>Reports</h1><p class="muted">Generate a payment summary for a date range you choose.</p></div></div>' +
    '<section class="form-card"><h2>Payment report</h2><form id="payment-report-form" class="record-form form-columns">' +
    '<label>From<input name="from" type="date" value="' + from + '" required></label>' +
    '<label>To<input name="to" type="date" value="' + to + '" required></label>' +
    '<button class="form-submit" type="submit">Generate report</button></form><div id="payment-report-result"></div></section>' +
    '<p class="form-note">This report totals recorded payments only. It does not calculate outstanding balances, interest, or payoff amounts.</p>';
}

export function bindReports(root: HTMLElement): void {
  root.querySelector<HTMLFormElement>("#payment-report-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const from = String(data.get("from"));
    const to = String(data.get("to"));
    const target = root.querySelector<HTMLElement>("#payment-report-result");
    if (!target) return;
    if (!from || !to || from > to) {
      target.textContent = "Please select a valid date range.";
      return;
    }
    target.textContent = "Generating report…";
    try {
      const response = await fetch("/api/reports/payments?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to), { credentials: "same-origin" });
      const result = await response.json() as PaymentReport & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not generate report.");
      const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(result.totalMinor / 100);
      const rows = result.byDay.map(row => '<div class="activity-row"><span class="activity-icon">₱</span><div><strong>' + row.day + '</strong><small>' + row.payment_count + ' payment(s)</small></div><b>' + new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(row.total_minor / 100) + '</b></div>').join("");
      target.innerHTML = '<div class="report-summary"><div><small>Payments received</small><strong>' + money + '</strong></div><div><small>Number of payments</small><strong>' + result.paymentCount + '</strong></div></div>' +
        '<h3 class="report-subtitle">Daily breakdown</h3><div class="report-daily">' + (rows || '<div class="empty-state"><strong>No payments in this period</strong></div>') + '</div>';
    } catch (error) {
      target.textContent = error instanceof Error ? error.message : "Report unavailable.";
    }
  });
}
