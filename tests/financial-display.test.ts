import { describe, expect, it } from "vitest";
import { addFinancialDisplayAmounts } from "../workers/api/src/index";

describe("AI financial context display amounts", () => {
  it("adds peso strings from integer centavos without changing raw values", () => {
    const context = addFinancialDisplayAmounts({
      available: true,
      loans: [{ principal_minor: 100000, installment_amount_minor: 25050 }],
      recentPayments: [{ amount_minor: 5000 }]
    });
    expect(context.loans).toEqual([{
      principal_minor: 100000,
      principal_display: "₱1,000.00",
      installment_amount_minor: 25050,
      installment_amount_display: "₱250.50"
    }]);
    expect(context.recentPayments).toEqual([{ amount_minor: 5000, amount_display: "₱50.00" }]);
  });

  it("leaves invalid or absent minor-unit values unformatted", () => {
    const context = addFinancialDisplayAmounts({
      loans: [{ principal_minor: -100 }, { principal_minor: 1.5 }, { principal_minor: "100000" }]
    });
    expect(context.loans).toEqual([
      { principal_minor: -100 },
      { principal_minor: 1.5 },
      { principal_minor: "100000" }
    ]);
  });

  it("formats targeted payment matches too", () => {
    const context = addFinancialDisplayAmounts({
      searched: true,
      payments: [{ amount_minor: 123456 }]
    });
    expect(context.payments).toEqual([{ amount_minor: 123456, amount_display: "₱1,234.56" }]);
  });
});
