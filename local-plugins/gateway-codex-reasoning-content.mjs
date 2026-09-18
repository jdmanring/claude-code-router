// A gateway plugin for the vendored @the-next-ai/ai-gateway runtime, not for
// CCR's own plugin host.
//
// The OpenAI Responses API rejects a reasoning item that carries a non-empty
// `content` array:
//
//   Invalid 'input[2].content': array too long.
//   Expected an array with maximum length 0, but got an array with length 1.
//
// Replaying a conversation that already contains reasoning items therefore
// fails deterministically, which burns the chain entry on every request.
//
// This cannot be fixed from a CCR request transform: at that stage the body is
// still Anthropic-shaped, and the Responses `input[]` is built afterwards,
// inside this runtime. A provider hook is the first point that sees the built
// upstream request, so it is the first point where the field exists to remove.
//
// `summary` and `encrypted_content` are what make a reasoning item useful to
// the model on replay, so only `content` is emptied.

export const manifest = {
  capabilities: ["providerHooks"],
  name: "codex-reasoning-content",
  version: "1.0.0"
};

export function stripReasoningContent(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.input)) {
    return { body, stripped: 0 };
  }
  let stripped = 0;
  const input = body.input.map((item) => {
    if (!item || typeof item !== "object" || item.type !== "reasoning") return item;
    if (!Array.isArray(item.content) || item.content.length === 0) return item;
    stripped += 1;
    return { ...item, content: [] };
  });
  return stripped === 0 ? { body, stripped } : { body: { ...body, input }, stripped };
}

// The body arrives parsed for `json`, but a hook must not assume an encoding it
// did not set. A string body is parsed and re-serialized so the result is the
// same shape the runtime handed over.
function withStrippedBody(upstreamRequest) {
  const raw = upstreamRequest.body;
  if (typeof raw === "string") {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { stripped: 0, upstreamRequest };
    }
    const { body, stripped } = stripReasoningContent(parsed);
    return stripped === 0
      ? { stripped, upstreamRequest }
      : { stripped, upstreamRequest: { ...upstreamRequest, body: JSON.stringify(body) } };
  }
  const { body, stripped } = stripReasoningContent(raw);
  return stripped === 0
    ? { stripped, upstreamRequest }
    : { stripped, upstreamRequest: { ...upstreamRequest, body } };
}

export function createGatewayPlugin() {
  // Load-time signature. Without it, a plugin that never matches and a plugin
  // that never loaded look identical in the log, which is how an earlier
  // attempt at this fix was mistaken for a working one.
  console.log("[codex-reasoning-content] provider hook registered");
  return {
    providerHooks: [
      {
        key: "codex-reasoning-content",
        // Deliberately unmatched by provider: the constraint belongs to the
        // Responses request shape, not to one account. Bodies without a
        // reasoning item carrying content are returned untouched, so a
        // provider that never sends one never sees a change.
        transformRequest(input) {
          const { stripped, upstreamRequest } = withStrippedBody(input.upstreamRequest);
          if (stripped > 0) {
            console.log(`[codex-reasoning-content] emptied content on ${stripped} reasoning item(s)`);
          }
          return { ok: true, value: upstreamRequest };
        }
      }
    ]
  };
}

export default createGatewayPlugin;
