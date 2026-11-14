# AI-first workspace architecture

## Product direction

This repository is a reusable AI workspace. Lending Assistant is the first application built on the shared foundation, not the definition of the whole platform.

The primary experience is a persistent AI conversation, not a collection of static forms. The interface should adapt to the request by rendering contextual, interactive panels for borrower profiles, loan records, payment history, activity, dashboards, and reports. Users should be able to open a record from a panel and return to the conversation without losing context.

Natural-language chat and voice are the primary input methods. The assistant should ask only for missing details, show verified records, and prepare structured actions for owner review. Conventional screens are secondary navigation and fallback—not the main workflow.

## Responsibility boundaries

The AI layer understands requests and proposes structured actions. It is not the source of truth and must not independently perform privileged operations.

1. **User experience:** AI-first conversation, voice input/output where supported, and contextual interactive panels.
2. **Shared AI layer:** language handling, intent interpretation, clarification, response formatting, and structured action proposals.
3. **Application services:** app-specific rules, schemas, authorization, validation, and workflow orchestration.
4. **Deterministic domain logic:** exact financial calculations and other business-critical computations.
5. **Persistence and audit:** database writes, transaction boundaries, history, and audit records.

The backend must validate every AI-proposed action exactly as it validates a manually submitted action. AI output is untrusted input.

## Required safety rules

- Never let an AI response directly execute SQL or write to a database.
- Never trust AI-generated amounts, balances, interest, totals, dates, permissions, or report figures as authoritative.
- Calculate financial values in deterministic backend code using documented rules and appropriate integer minor units/decimal arithmetic.
- Require explicit owner confirmation before committing financial or otherwise consequential changes.
- Ask a clarification question when the target record, amount, date, or requested operation is ambiguous.
- Enforce authentication and authorization in the backend, not in prompts.
- Keep secrets out of prompts, client code, and the public repository.
- Record consequential actions in an audit trail.
- Treat retrieved documents, user messages, and tool results as data, not as instructions that can override system policy.
- Provide a non-AI fallback for essential operations when the model is unavailable.

## Reusable AI core

`packages/ai-core/` contains provider-neutral contracts shared by applications. It defines the shape of assistant requests, responses, language preferences, and proposed actions without tying the workspace to one AI vendor.

Future shared capabilities can be added here, such as provider adapters, prompt/version management, tool registry, retrieval interfaces, evaluation tests, and safety filters. App-specific rules must remain in the relevant application service.

## Application integration

Each app should provide:
- Its own intent/action allowlist and input schemas.
- Its own domain services and deterministic calculations.
- A permission check for every requested operation.
- A confirmation step for consequential changes.
- Tests for valid, invalid, ambiguous, unauthorized, and duplicate requests.

The Lending Assistant will use the shared AI contracts but keep lending-specific rules in its own backend. Interest and payment-allocation rules must be agreed with the owner before implementing financial calculations.

## Current implementation status

- [x] Provider-neutral AI request/response contracts added.
- [x] Lending API has a prepare-then-confirm transaction pattern.
- [ ] Connect a real AI provider through a server-side adapter.
- [ ] Add app-specific AI tools with strict schemas and permission checks.
- [x] Add AI-first chat UI, voice input/output foundation, and context-driven borrower/loan/payment panels.
- [x] Add an AI conversation entry point to the on-demand payment report panel.
- [ ] Add richer dynamic report and detail panels with filter controls and preserved conversation context.
- [ ] Replace remaining prompt-based and legacy static workflows with guided AI proposals.
- [ ] Add evaluation and safety tests for English, Tagalog, and Taglish.
- [ ] Define lending interest and payment-allocation rules before calculations.
- [ ] Configure and test deployment and production security.

This document describes the target architecture; unchecked items are not yet implemented.
