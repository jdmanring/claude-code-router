#!/usr/bin/env node
// Which of a provider's candidate models is the right one for an agent slot?
//
// Ranking by name, family or parameter count is a claim from priors, and this
// repository has been wrong making it three times in one session: a flagship
// that failed, a 550B model that tied with a much smaller sibling, and a
// code-specialised model that won a code question and lost every task needing
// an instruction followed.
//
// One question decides nothing, because a probe shaped like one model's
// specialty selects that model. These four shapes are what an agent slot
// actually serves: following an output constraint, reasoning, reading code,
// and respecting a length limit.
//
//   node scripts/model-probe.mjs <provider> <model> [<model> ...]
//     --gap MS   delay between requests (default 2000; raise for a provider
//                that enforces spacing, Literouter wants 7500)
//
// It spends one request per model per task, so four per model. Say what that
// costs against the provider's allowance before running it.

import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

/**
 * Each task pairs a prompt with the check its answer must pass.
 *
 * The checks are the judgement worth pinning, so they are exported and tested
 * against the exact wrong answers observed rather than invented ones: a model
 * that prints only the first call's list, one that answers a request for a
 * number with a chain-of-thought preamble, and one that ignores a word limit.
 */
export const tasks = [
  {
    check: (out) => /^[a-z]+\s+[a-z]+\s+[a-z]+$/.test(out.trim()),
    name: "follows an output constraint",
    prompt: "Reply with exactly three lowercase words and no punctuation, describing what a compiler does. Nothing else."
  },
  {
    // The ladder floats with the ship, so the count does not change.
    check: (out) => /\b5\b/.test(out) && !/\b(4|6|8)\b/.test(out),
    name: "reasons about a trick premise",
    prompt: "A rope ladder hangs over the side of a ship. Rungs are 30cm apart. At low tide 5 rungs are above water. The tide rises 90cm. How many rungs are above water at high tide? Answer with just the number."
  },
  {
    // The default list is created once and shared, so both calls see both.
    check: (out) => /\[\s*1\s*,\s*2\s*\][^[]*\[\s*1\s*,\s*2\s*\]/.test(out),
    name: "reads code semantics",
    prompt: "What exactly does this print?\n\ndef f(n, acc=[]):\n    acc.append(n)\n    return acc\nprint(f(1), f(2))\n\nAnswer with only the printed line."
  },
  {
    check: (out) => out.trim() !== "" && out.trim().split(/\s+/).length <= 20,
    name: "respects a length limit",
    prompt: "In 20 words or fewer: what does an API gateway fallback chain do when the first provider returns 429?"
  }
];

/** An empty answer is a failure, not a pass, whatever the status said. */
export function scoreAnswer(task, status, output) {
  if (status !== 200) return `HTTP ${status}`;
  if (typeof output !== "string" || output.trim() === "") return "empty";
  return task.check(output) ? "pass" : "fail";
}

async function main() {
  const argv = process.argv.slice(2);
  const gapIndex = argv.indexOf("--gap");
  const gap = gapIndex === -1 ? 2000 : Number(argv[gapIndex + 1]);
  const positional = argv.filter((value, index) => !value.startsWith("--") && argv[index - 1] !== "--gap");
  const [providerName, ...models] = positional;
  if (!providerName || models.length === 0) {
    console.error("usage: node scripts/model-probe.mjs <provider> <model> [<model> ...] [--gap MS]");
    process.exit(2);
  }

  const home = process.env.CCR_INTERNAL_HOME_DIR ?? os.homedir();
  const config = JSON.parse(new DatabaseSync(path.join(home, ".claude-code-router", "config.sqlite"), { readOnly: true })
    .prepare("select value_json from app_config where key='default'").get().value_json);
  const provider = (config.Providers ?? []).find((entry) => entry.name === providerName);
  if (!provider) { console.error(`No provider named ${providerName}`); process.exit(2); }
  // The chat route is what these tasks speak. A provider CCR addresses with
  // another protocol can still answer here, and then this measures the model
  // rather than the path CCR takes to it, which is worth saying out loud.
  const chat = provider.capabilities?.find((entry) => entry.type === "openai_chat_completions");
  if (!chat) console.log(`note: ${providerName} has no openai_chat_completions capability, so CCR reaches it another way`);
  const base = (chat ?? provider.capabilities?.[0])?.baseUrl ?? provider.baseUrl;

  console.log(`${models.length} model(s) x ${tasks.length} tasks = ${models.length * tasks.length} requests against ${providerName}\n`);
  const totals = [];
  for (const model of models) {
    let passed = 0;
    console.log(`=== ${model}`);
    for (const task of tasks) {
      let status = 0, output = "";
      try {
        const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
          body: JSON.stringify({ max_tokens: 400, messages: [{ content: task.prompt, role: "user" }], model }),
          headers: { Authorization: `Bearer ${provider.api_key}`, "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(45000)
        });
        status = response.status;
        const text = await response.text();
        try { output = JSON.parse(text).choices?.[0]?.message?.content ?? ""; } catch { output = text.slice(0, 80); }
      } catch (error) { status = 0; output = error.message; }
      const verdict = scoreAnswer(task, status, output);
      if (verdict === "pass") passed += 1;
      console.log(`  ${verdict.padEnd(9)} ${task.name.padEnd(30)} ${JSON.stringify(String(output).replace(/\s+/g, " ").slice(0, 52))}`);
      await new Promise((resolve) => setTimeout(resolve, gap));
    }
    totals.push({ model, passed });
  }

  console.log("");
  for (const { model, passed } of totals.sort((a, b) => b.passed - a.passed)) {
    console.log(`  ${passed} of ${tasks.length}  ${model}`);
  }
  console.log("\nFour readings per model. A one-task margin is not a result.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
