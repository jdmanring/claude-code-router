import assert from "node:assert/strict";
import test from "node:test";
import { gatewayService } from "@ccr/core/gateway/service.ts";

/**
 * `getCompiledRouteDiagnostics` exists to surface a rule that compiled inactive
 * and silently stopped matching, whose symptom is otherwise silence. Its own
 * comment names the trap it guards: an absent plugin returns an empty array,
 * and an empty array would otherwise read as "no problems" when it means
 * "nothing was compiled".
 *
 * The plugin field is TypeScript-private, which is compile-time only, so these
 * set it directly on the compiled object rather than adding a test hook to
 * production code. Each restores what it found.
 */
function withPlugin(plugin, run) {
  const original = gatewayService.plugin;
  gatewayService.plugin = plugin;
  try { return run(); } finally { gatewayService.plugin = original; }
}

function capturingWarnings(run) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try { run(); } finally { console.warn = original; }
  return lines;
}

test("with no routing plugin, the empty result is announced rather than silent", () => {
  // Without the warning the caller cannot tell "nothing is wrong" from
  // "nothing was compiled", and the UI reports no routing problems for a
  // config whose rules never match.
  let result;
  const warnings = capturingWarnings(() => {
    withPlugin(undefined, () => { result = gatewayService.getCompiledRouteDiagnostics(); });
  });
  assert.deepEqual(result, []);
  assert.equal(warnings.length, 1, "an absent plugin produced no warning");
  assert.match(warnings[0], /no routing plugin is loaded/);
});

test("diagnostics from the plugin are returned, not swallowed", () => {
  // The anti-stub assertion. Every other expectation here is an empty array,
  // so without this the method could return [] unconditionally and the file
  // would still pass.
  const diagnostic = { code: "rule-inactive", message: "condition matches no slot", model: "x/y", ruleId: "rule-2" };
  const result = withPlugin(
    { getRouteDiagnostics: () => [diagnostic] },
    () => gatewayService.getCompiledRouteDiagnostics()
  );
  assert.deepEqual(result, [diagnostic]);
});

test("a plugin reporting nothing wrong is distinguishable from an absent one", () => {
  // Both return an empty array; only one warns. That difference is the whole
  // contract, so it is asserted rather than assumed.
  const warnings = capturingWarnings(() => {
    const result = withPlugin({ getRouteDiagnostics: () => [] }, () => gatewayService.getCompiledRouteDiagnostics());
    assert.deepEqual(result, []);
  });
  assert.deepEqual(warnings, [], "a loaded plugin with no findings must not warn");
});
