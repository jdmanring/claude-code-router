// What a client sent, recorded as shape rather than content.
//
// The request log stores the body the gateway sent upstream, after routing and
// after the vendored child converts between protocol families. Nothing records
// what arrived, so "did the gateway drop a field the client sent?" cannot be
// answered for any field. That question came up three times in one session and
// was unanswerable each time: an explicit prompt-cache marker reaches no
// provider, and there is no way to tell a client that never sent one from a
// gateway that dropped it.
//
// Storing the inbound body would answer it and cost too much. The body store
// already holds 4.3GB, and inbound bodies are the same size as upstream ones,
// so capturing them doubles it to answer a question about which keys are
// present. The set of key paths is about a thousandth of that and answers the
// question directly, because a dropped field is a missing path.
//
// It deliberately records no values. A path says `system[].cache_control.type`
// was present, never what it held, so this adds no exposure that the body store
// does not already carry and is safe where a body would not be.

/** Bounds, so a pathological body cannot grow the column without limit. */
const maxDepth = 6;
const maxPaths = 250;

/**
 * The set of key paths in a JSON body, as sorted unique dotted strings.
 *
 * Array indices collapse to `[]`, so a hundred messages yield one
 * `messages[].role` rather than a hundred numbered paths. That is what makes
 * the result small and comparable between two bodies whose arrays differ in
 * length, which is the normal case across a protocol conversion.
 *
 * Returns an empty array for anything that is not a JSON object, including a
 * body that failed to parse. An empty result therefore means "nothing to
 * compare", never "the client sent no fields": callers must not read absence
 * here as evidence about the traffic.
 */
export function jsonFieldPaths(body: Buffer | string | undefined): string[] {
  if (body === undefined) return [];
  const text = typeof body === "string" ? body : body.toString("utf8");
  if (text.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const paths = new Set<string>();
  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (paths.size >= maxPaths || depth > maxDepth) return;
    if (Array.isArray(value)) {
      // One representative path per array, not one per element.
      for (const entry of value) {
        walk(entry, `${prefix}[]`, depth + 1);
        if (paths.size >= maxPaths) return;
      }
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (paths.size >= maxPaths) return;
      const here = prefix === "" ? key : `${prefix}.${key}`;
      paths.add(here);
      walk(child, here, depth + 1);
    }
  };
  walk(parsed, "", 0);
  return [...paths].sort();
}

/** The recorded form: one line per path, which sorts and diffs without parsing. */
export function encodeFieldPaths(paths: readonly string[]): string {
  return paths.join("\n");
}

export function decodeFieldPaths(encoded: string | undefined): string[] {
  return typeof encoded === "string" && encoded.length > 0 ? encoded.split("\n") : [];
}

/**
 * Paths the client sent that did not survive to the upstream body.
 *
 * Returns an empty array when either side is empty rather than reporting every
 * inbound path as dropped. An unrecorded or unparseable upstream body is no
 * reading, and calling that a total loss would manufacture a finding on every
 * request whose body capture is off.
 */
export function droppedFieldPaths(
  inbound: readonly string[],
  upstream: readonly string[]
): string[] {
  if (inbound.length === 0 || upstream.length === 0) return [];
  const present = new Set(upstream);
  return inbound.filter((path) => !present.has(path));
}
