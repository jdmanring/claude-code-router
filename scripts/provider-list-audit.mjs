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

/**
 * A provider may appear more than once on purpose: the list carries some of
 * them in a plans section and again in a free-tier section, with a
 * cross-reference. Each appearance is kept separately so a check for a
 * repeated field does not fire on the document's own structure.
 */
export function blockHeadings(text) {
  const headings = new Map();
  const lines = text.split("\n");
  let current;
  for (const [index, line] of lines.entries()) {
    // A provider block is a flush-left heading over an indented body. Prose
    // paragraphs here are hard-wrapped flush left too, and the introduction is
    // even followed by an indented legend, so the body alone does not separate
    // them. What does is what sits above: a wrapped prose line always has
    // another flush-left line directly over it, while a heading opens after a
    // blank line, a dashed rule, a section label, or the indented body of the
    // block above, since blocks here are stacked with no blank line between.
    //
    // A line ending in a colon is taken as a section label. That is wrong for
    // a provider heading written with a trailing colon, whose body would be
    // absorbed by the block above it. The exposure is bounded: a CONFIGURED
    // provider swallowed this way reports loudly as NO BLOCK, because
    // headingFor stops resolving it. Only a block for a provider absent from
    // the config can go quiet, and the not-yet-connected entries that shape
    // describes are exempt from the orphan check anyway. Without this a wrapped
    // prose line reads as a provider and absorbs the fields of the block below
    // it; requiring the body on the very next line instead would silently drop
    // any heading followed by a blank line, taking both directions of the
    // audit quiet at once.
    const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    const above = lines[index - 1];
    const opensABlock = above === undefined || above.trim() === "" || above.startsWith(" ")
      || /^-+$/.test(above.trim()) || above.trim().endsWith(":");
    const isHeading = line && !line.startsWith(" ") && !line.startsWith("-") && !line.endsWith(":")
      && opensABlock && next !== undefined && next.startsWith(" ");
    if (isHeading) {
      current = line.split(" - ")[0].split(" — ")[0].trim().toLowerCase();
      if (!headings.has(current)) headings.set(current, []);
      headings.get(current).push([]);
    } else if (current) {
      const occurrences = headings.get(current);
      occurrences[occurrences.length - 1].push(line);
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

/**
 * Blocks describing a provider the configuration no longer has.
 *
 * The forward check cannot see a REMOVED provider: its block stays behind and
 * still reads as a live one. A block stating a tracking verdict is a claim
 * about the running config, so it has to resolve to a configured provider. A
 * block saying "not configured" claims nothing and is exempt, which is how the
 * deliberate not-yet-connected entries stay quiet.
 */
export function orphanedBlocks(headings, described) {
  const orphaned = [];
  for (const [heading, occurrences] of headings) {
    const trackingLines = occurrences.flat().filter((line) => /^\s*usage tracking:/i.test(line));
    // Anchored to the value, not matched anywhere in the line. The document
    // writes a verdict then a trailing clause, so a substring test exempts
    // "tracked, though the balance meter is not configured" and the check goes
    // permanently quiet on exactly the block it exists to find.
    const claimsTheConfig = trackingLines.some((line) => !/^\s*usage tracking:\s*not configured/i.test(line));
    if (claimsTheConfig && !described.has(heading)) orphaned.push(heading);
  }
  return orphaned;
}

function main() {
  const text = fs.readFileSync(listPath, "utf8");
  const headings = blockHeadings(text);
  const config = JSON.parse(new DatabaseSync(path.join(os.homedir(), ".claude-code-router", "config.sqlite"), { readOnly: true })
    .prepare("select value_json from app_config where key='default'").get().value_json);
  const providers = (config.Providers ?? []).filter((p) => p.enabled !== false);

  const missing = [];
  const disagree = [];
  const duplicated = [];
  for (const provider of providers) {
    const heading = headingFor(provider.name, headings);
    if (!heading) { missing.push(provider.name); continue; }
    const occurrences = headings.get(heading);
    const says = /usage tracking:\s*tracked/i.test(occurrences.flat().join(" "));
    const is = provider.account?.enabled === true;
    if (says !== is) disagree.push(`${provider.name}: list says tracked=${says}, config says ${is}`);
    // Two tracking lines in ONE appearance means one is stale, and which wins
    // depends on which a reader reaches first. Two appearances carrying one
    // line each is the document's own structure and is fine.
    for (const [index, body] of occurrences.entries()) {
      const trackingLines = body.filter((line) => /^\s*usage tracking:/i.test(line)).length;
      if (trackingLines > 1) duplicated.push(`${provider.name}: appearance ${index + 1} has ${trackingLines} tracking lines`);
    }
  }

  const described = new Set(providers.map((p) => headingFor(p.name, headings)).filter(Boolean));
  const orphaned = orphanedBlocks(headings, described);

  for (const name of missing) console.log(`NO BLOCK   ${name}`);
  for (const name of orphaned) console.log(`ORPHANED   ${name}`);
  for (const line of disagree) console.log(`DISAGREES  ${line}`);
  for (const line of duplicated) console.log(`DUPLICATED ${line}`);
  console.log(`\n${providers.length} enabled providers: ${missing.length} with no block, `
    + `${disagree.length} whose tracking claim disagrees with the config, `
    + `${duplicated.length} with more than one tracking line, `
    + `${orphaned.length} block(s) describing a provider the config no longer has`);
  process.exitCode = missing.length + disagree.length + duplicated.length + orphaned.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
