# Production readiness checklist

This repository is not deployed. Complete and verify the items below before connecting a Cloudflare account or deploying production resources.

## Repository and CI

- [x] Typecheck, unit tests, D1 integration tests, and production build run in GitHub Actions.
- [x] Dependency audit runs in CI.
- [ ] Add and commit a package lockfile, then switch CI and deployment workflows from `npm install` to `npm ci` for reproducible installs.
- [ ] Review and pin third-party GitHub Actions to immutable commit SHAs before production use.

## Security and access

- [x] Add D1-backed login rate limiting: five attempts per IP per 15-minute window, with hashed IP identifiers and reset after successful login.
- [ ] Add abuse monitoring and alerting for repeated blocked attempts.
- [ ] Generate a long, random owner passphrase and store it only as the Worker `OWNER_API_TOKEN` secret. Never commit the value.
- [ ] Restrict and review GitHub Actions secrets and Cloudflare API token scopes before enabling manual deployment workflows.
- [ ] Verify cookie session, logout, same-origin write protection, and authorization behavior against the deployed Pages-to-Worker service binding.
- [ ] Confirm that backups, retention, and recovery procedures are in place before storing real borrower information.

## Cloudflare configuration (later; do not create resources until the repository is approved)

- [ ] Create the D1 database and replace the placeholder database ID in `workers/api/wrangler.toml`.
- [ ] Apply migrations in order and verify the resulting schema before enabling traffic.
- [ ] Configure the Workers AI binding and verify that `@cf/google/gemma-4-26b-a4b-it` is available to the target account.
- [ ] Configure the Pages project and confirm its `API` service binding points to `ai-workspace-api`.
- [ ] Set the Worker secret and GitHub Actions secrets/variables required by the manual deployment workflows.
- [ ] Deploy the API Worker first, then the Pages app; verify health, login, read-only queries, AI responses, and owner-confirmed writes using test data.

## Lending rules and data integrity

- [ ] Obtain the owner's explicit approval for the interest, payment allocation, due-date, rounding, and loan-closure rules in `interest-calculation-rules.md`.
- [ ] Implement calculation functions with deterministic tests only after those rules are approved.
- [ ] Keep calculated balances, accrued interest, payoff amounts, and overdue status unavailable until the approved rules are implemented and verified.
- [ ] Test a full backup/restore and a complete borrower-to-loan-to-payment workflow using non-production data.

## Release gate

Do not deploy or enter real borrower data until all unchecked security, configuration, and data-integrity items above are completed and the owner has reviewed the release.
