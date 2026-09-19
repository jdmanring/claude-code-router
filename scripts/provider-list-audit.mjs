#!/usr/bin/env node
// Does the provider list still describe the running configuration?
//
// The list is written by hand and the config changes under it, so a claim in
// the list can quietly stop being true. This checks the two claims that are
// machine-checkable: that every configured provider has a block, and that
// "usage tracking: tracked" agrees with whether a usage connector is enabled.
//
//   node scripts/provider-list-audit.mjs [path to the list]
//
// It deliberately checks nothing else. Pool scope, gates and model status are
// prose judgements and a passing run says nothing about them.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const listPath = process.argv[2] ?? path.join(os.homedir(), "Projects", "provider-model-list.md");

// The list is written for a person, so its headings are the provider's brand
// name rather than the configured id. Each pair was confirmed by reading both.
export const listNameAliases = {
  "agnes-free": "agnes free",
  "agnes-paid": "agnes plus",
  "claude code api": "claude max",
  "cloudflare": "cloudflare workers paid",
  "codex api": "openai codex",
  "github-copilot-free": "github copilot pro",
  "go": "opencode go",
  "google gemini": "google gemini ai studio",
  "huggingface": "huggingface pro",
  "meganova": "meganova ai",
  "mistral": "mistral studio",
  "nvidia": "nvidia nim",
  "ollama": "ollama cloud",
  "opencode go responses": "opencode go",
  "v0": "v.0",
  "z.ai (global) - general endpoint": "z.ai",
  "zen": "opencode zen"
};

export function blockHeadings(text) {
  const headings = new Map();
  let current;
  for (const line of text.split("\n")) {
    const isHeading = line && !line.startsWith(" ") && !line.startsWith("-") && !/^[A-Z][A-Z ,()]+:$/.test(line);
    if (isHeading) {
      current = line.split(" - ")[0].split(" — ")[0].trim().toLowerCase();
      if (!headings.has(current)) headings.set(current, []);
    } else if (current) {
      headings.get(current).push(line);
    }
  }
  return headings;
}

export function headingFor(providerName, headings) {
  const name = providerName.toLowerCase();
  if (headings.has(name)) return name;
  const alias = listNameAliases[name];
  return alias && headings.has(alias) ? alias : undefined;
}

function main() {
  const text = fs.readFileSync(listPath, "utf8");
  const headings = blockHeadings(text);
  const config = JSON.parse(new DatabaseSync(path.join(os.homedir(), ".claude-code-router", "config.sqlite"), { readOnly: true })
    .prepare("select value_json from app_config where key='default'").get().value_json);
  const providers = (config.Providers ?? []).filter((p) => p.enabled !== false);

  const missing = [];
  const disagree = [];
  for (const provider of providers) {
    const heading = headingFor(provider.name, headings);
    if (!heading) { missing.push(provider.name); continue; }
    const says = /usage tracking:\s*tracked/i.test(headings.get(heading).join(" "));
    const is = provider.account?.enabled === true;
    if (says !== is) disagree.push(`${provider.name}: list says tracked=${says}, config says ${is}`);
  }

  for (const name of missing) console.log(`NO BLOCK   ${name}`);
  for (const line of disagree) console.log(`DISAGREES  ${line}`);
  console.log(`\n${providers.length} enabled providers: ${missing.length} with no block, ${disagree.length} whose tracking claim disagrees with the config`);
  process.exitCode = missing.length + disagree.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
