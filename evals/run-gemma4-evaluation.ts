import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildLendingAssistantSystemPrompt, LENDING_ASSISTANT_PROMPT_VERSION } from "../workers/api/src/lending-assistant-prompt.ts";
import { PHILIPPINE_LENDING_KNOWLEDGE_VERSION } from "../workers/api/src/philippine-lending-knowledge.ts";

type ConversationTurn = { role: "user" | "assistant"; content: string };
type EvaluationCase = {
  id: string;
  category: string;
  turns: ConversationTurn[];
  expectedBehavior: string;
  criticalFailure: string;
  safetyCritical: boolean;
};
type Dataset = {
  title: string;
  datasetVersion: string;
  modelId: string;
  cases: EvaluationCase[];
};
type CaseResult = {
  id: string;
  category: string;
  safetyCritical: boolean;
  expectedBehavior: string;
  criticalFailure: string;
  response: string | null;
  latencyMs: number | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  apiSuccess: boolean;
  error?: string;
  score: null;
  criticalFailureDetected: null;
  reviewStatus: "manual_review_required";
};

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN. Configure them as protected GitHub environment secrets.");
}

const dataset = JSON.parse(await (await import("node:fs/promises")).readFile("evals/gemma4-lending-cases.json", "utf8")) as Dataset;
if (!Array.isArray(dataset.cases) || dataset.cases.length !== 40) {
  throw new Error(`Expected exactly 40 evaluation cases; found ${dataset.cases?.length ?? "none"}.`);
}

const systemPrompt =
  buildLendingAssistantSystemPrompt({
    language: "tl-en",
    recordContext: {
      available: false,
      note: "Isolated model-only evaluation. No database or borrower/loan/payment records are connected. Do not guess or claim to have searched records."
    },
    targetedMatches: {
      searched: false,
      reason: "No database lookup is performed during this model-only evaluation."
    }
  }) +
  "\n\nTRANSACTION CONVERSATION STATE: " +
  JSON.stringify({
    status: "none",
    carriesTransactionContext: false,
    instruction: "This is an isolated model-only evaluation. Use only the conversation turns supplied for this case. No verified records or live transaction state are connected. Never imply a database lookup occurred or claim a financial write succeeded."
  });

const timestamp = new Date().toISOString();
const fileStamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const outputDir = "evals/results";
await mkdir(outputDir, { recursive: true });

const results: CaseResult[] = [];
let fatalError = false;

function responseText(payload: any): string {
  const value = payload?.result?.response ?? payload?.response ?? "";
  if (typeof value === "string") {
    return value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }
  return JSON.stringify(value);
}

function usageData(payload: any) {
  return payload?.result?.usage ?? payload?.usage ?? null;
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

for (let index = 0; index < dataset.cases.length; index++) {
  const testCase = dataset.cases[index];
  const startedAt = Date.now();
  let caseResult: CaseResult = {
    id: testCase.id,
    category: testCase.category,
    safetyCritical: testCase.safetyCritical,
    expectedBehavior: testCase.expectedBehavior,
    criticalFailure: testCase.criticalFailure,
    response: null,
    latencyMs: null,
    usage: null,
    apiSuccess: false,
    score: null,
    criticalFailureDetected: null,
    reviewStatus: "manual_review_required"
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${dataset.modelId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              ...testCase.turns
            ],
            max_tokens: 2400,
            temperature: 0.35,
            chat_template_kwargs: { enable_thinking: true }
          }),
          signal: AbortSignal.timeout(120_000)
        }
      );

      const rawBody = await response.text();
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new Error(`Workers AI returned non-JSON HTTP ${response.status}: ${rawBody.slice(0, 500)}`);
      }

      if (!response.ok || payload?.success === false) {
        const detail = JSON.stringify(payload?.errors ?? payload?.messages ?? payload).slice(0, 1200);
        const error = new Error(`Workers AI HTTP ${response.status}: ${detail}`);
        (error as any).status = response.status;
        throw error;
      }

      caseResult.response = responseText(payload);
      caseResult.usage = usageData(payload);
      caseResult.latencyMs = Date.now() - startedAt;
      caseResult.apiSuccess = true;
      break;
    } catch (error) {
      const status = (error as any)?.status;
      const message = error instanceof Error ? error.message : String(error);
      caseResult.error = message;
      if ([400, 401, 403, 404].includes(status) || attempt === 2) {
        fatalError = true;
        break;
      }
      await wait(1500 * (attempt + 1));
    }
  }

  results.push(caseResult);
  console.log(
    `\n===== ${testCase.id} (${index + 1}/${dataset.cases.length}) | ${caseResult.apiSuccess ? `${caseResult.latencyMs}ms` : "ERROR"} =====\n${caseResult.response ?? caseResult.error ?? "No response"}\n`
  );

  if (!caseResult.apiSuccess && fatalError) break;
  if (index < dataset.cases.length - 1) await wait(750);
}

const totals = results.reduce(
  (acc, item) => {
    if (item.usage) {
      acc.promptTokens += item.usage.prompt_tokens ?? 0;
      acc.completionTokens += item.usage.completion_tokens ?? 0;
      acc.totalTokens += item.usage.total_tokens ?? 0;
    }
    if (item.latencyMs !== null) acc.latencyMs += item.latencyMs;
    if (item.apiSuccess) acc.completed += 1;
    else acc.errors += 1;
    return acc;
  },
  { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0, completed: 0, errors: 0 }
);

const report = {
  title: dataset.title,
  runAt: timestamp,
  modelId: dataset.modelId,
  datasetVersion: dataset.datasetVersion,
  promptVersion: LENDING_ASSISTANT_PROMPT_VERSION,
  knowledgeVersion: PHILIPPINE_LENDING_KNOWLEDGE_VERSION,
  runtime: { max_tokens: 2400, temperature: 0.35, enable_thinking: true },
  evaluationMode: "direct Workers AI inference; no Worker route, D1 database, or write executor",
  dataPolicy: "Synthetic conversations only; no production records or financial writes",
  totals: {
    casesRequested: dataset.cases.length,
    casesCompleted: totals.completed,
    apiErrors: totals.errors,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    averageLatencyMs: totals.completed ? Math.round(totals.latencyMs / totals.completed) : null
  },
  scoring: "Not auto-scored. Apply the seven-category human rubric in docs/AI-QUALITY-EVALUATION.md; each case remains pending manual review.",
  results
};

const jsonPath = join(outputDir, `gemma4-evaluation-${fileStamp}.json`);
const markdownPath = join(outputDir, `gemma4-evaluation-${fileStamp}.md`);
await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

const markdown = [
  "# Gemma 4 lending evaluation report",
  "",
  `- Run date: ${timestamp}`,
  `- Model: ${dataset.modelId}`,
  `- Dataset: ${dataset.datasetVersion} (${dataset.cases.length} cases)`,
  `- Prompt version: ${LENDING_ASSISTANT_PROMPT_VERSION}`,
  `- Knowledge version: ${PHILIPPINE_LENDING_KNOWLEDGE_VERSION}`,
  `- Runtime: max_tokens=2400, temperature=0.35, enable_thinking=true`,
  "- Mode: direct Workers AI inference only; no Worker route, D1 database, or write executor",
  "",
  "## Run totals",
  "",
  `- Completed: ${totals.completed}/${dataset.cases.length}`,
  `- API errors: ${totals.errors}`,
  `- Prompt tokens: ${totals.promptTokens}`,
  `- Completion tokens: ${totals.completionTokens}`,
  `- Total tokens: ${totals.totalTokens}`,
  `- Average latency: ${totals.completed ? Math.round(totals.latencyMs / totals.completed) + " ms" : "n/a"}`,
  "",
  "> Model responses are not automatically scored. Complete the seven-category rubric and critical-failure review before treating this as a pass/fail result.",
  "",
  ...results.flatMap(item => [
    `## ${item.id} — ${item.category}`,
    "",
    `**Safety-critical:** ${item.safetyCritical ? "Yes" : "No"}`,
    `**Expected:** ${item.expectedBehavior}`,
    `**Critical failure to check:** ${item.criticalFailure}`,
    `**Latency:** ${item.latencyMs === null ? "n/a" : item.latencyMs + " ms"}`,
    "",
    "**Gemma response:**",
    "",
    item.response ? item.response : `API ERROR: ${item.error ?? "No response"}`,
    "",
    "**Manual score:** pending (0–14) | **Critical failure:** pending review",
    "",
    "---",
    ""
  ])
].join("\n");
await writeFile(markdownPath, markdown, "utf8");

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const summary = [
    "# Gemma 4 evaluation run",
    "",
    `- **Model:** ${dataset.modelId}`,
    `- **Prompt / knowledge:** ${LENDING_ASSISTANT_PROMPT_VERSION} / ${PHILIPPINE_LENDING_KNOWLEDGE_VERSION}`,
    `- **Cases:** ${totals.completed}/${dataset.cases.length} completed; ${totals.errors} API errors`,
    `- **Tokens:** ${totals.totalTokens} total (${totals.promptTokens} prompt, ${totals.completionTokens} completion)`,
    `- **Average latency:** ${totals.completed ? Math.round(totals.latencyMs / totals.completed) + " ms" : "n/a"}`,
    "- **Scoring:** Pending manual review; this workflow does not declare a model pass.",
    "- **Safety:** Direct inference only. No production Worker route, D1 connection, or financial write.",
    "",
    "| Case | Category | Status | Response preview |",
    "|---|---|---|---|",
    ...results.map(item => `| ${item.id} | ${item.category} | ${item.apiSuccess ? "Completed" : "API error"} | ${(item.response ?? item.error ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 220)} |`),
    "",
    "Full JSON and Markdown responses are attached as the workflow artifact."
  ].join("\n");
  await appendFile(summaryPath, summary + "\n", "utf8");
}

console.log(JSON.stringify({
  reportJson: jsonPath,
  reportMarkdown: markdownPath,
  casesCompleted: totals.completed,
  casesRequested: dataset.cases.length,
  apiErrors: totals.errors,
  totalTokens: totals.totalTokens
}, null, 2));

if (fatalError || totals.completed !== dataset.cases.length) process.exitCode = 1;
