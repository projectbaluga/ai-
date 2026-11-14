# Lending calculation rules requiring owner approval

The application must not guess these rules. Until they are agreed and covered by tests, the dashboard and AI must not display calculated outstanding balances, accrued interest, payoff amounts, or overdue status.

## Interest definition

1. Fixed interest: Is the value a one-time PHP amount for the whole loan, a monthly PHP amount, or an amount per installment?
2. Percentage interest: Is the rate applied to the original principal or the remaining principal?
3. Monthly interest: Is it simple interest or compound interest?
4. Start date: Does interest begin on the loan release date, the next calendar month, or another agreed date?
5. Partial months: Should a partial month count as a full month, be prorated by days, or be ignored?
6. Rounding: Should interest be rounded to the nearest centavo per period, per payment, or only at final settlement?

## Payment allocation

1. When a borrower pays, is the payment applied to accrued interest first or principal first?
2. Can a borrower make partial payments of any amount?
3. What happens when a payment is larger than the remaining amount due?
4. Are late fees or penalties supported? If yes, how are they calculated and approved?
5. Can the owner manually waive interest or fees, and must that action be separately audited?

## Loan lifecycle

1. Are due dates required, optional, or not used?
2. Can a loan have a fixed installment schedule, or are payment dates and amounts fully flexible?
3. When should a loan become paid: when calculated balance reaches zero, or only after owner confirmation?
4. Can loan terms be changed after release? If yes, should changes apply prospectively only and require a reason?

## Current safe behavior

- Store principal and payments as integer centavos.
- Store interest type, value, and period exactly as entered.
- Show recorded payments and original principal as stored data.
- Do not infer a current balance by subtracting all payments from principal, because payments may first cover interest or fees.
- Require owner review and confirmation for all supported create/update/archive transactions.
- Add deterministic calculation functions and boundary tests only after the owner approves the rules above.
