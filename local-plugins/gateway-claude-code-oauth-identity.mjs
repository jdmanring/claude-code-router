// A gateway plugin for the vendored @the-next-ai/ai-gateway runtime, not for
// CCR's own plugin host.
//
// An Anthropic OAuth token carrying the `user:sessions:claude_code` scope is
// only accepted on /v1/messages when the request identifies itself as Claude
// Code in its first system block. Without that block Anthropic answers
//
//   429 {"type":"error","error":{"type":"rate_limit_error","message":"Error"}}
//
// which names the wrong cause: the same token, in the same second, answers 200
// once the block is present, and /api/oauth/usage reports every limit at
// severity "normal" (measured: session 1%, weekly 40%, tier
// default_claude_max_20x). Read as a quota, it takes a paid plan out of the
// chain for no reason and sends the reader looking at billing.
//
// The block is what the official client sends for a credential scoped to it,
// so this restores the request the scope was issued for rather than adding
// anything to it.

export const manifest = {
  capabilities: ["providerHooks"],
  name: "claude-code-oauth-identity",
  version: "1.0.0"
};

export const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// Anthropic accepts the identity only as an EXACT first system block. Measured
// against the API with one token seconds apart: no system block, an unrelated
// first block, the identity placed second, and the identity carrying trailing
// text are all refused with the same empty 429; only an exact first block is
// accepted, and further blocks after it are free.
//
// A prefix test would therefore pass over the one shape CCR actually produces:
// adapting a request for a non-Anthropic protocol flattens the two blocks the
// interactive CLI sends into a single string that begins with the identity and
// continues into the rest of the prompt.
const identityLeads = (system) => {
  const first = Array.isArray(system) ? system[0] : system;
  if (typeof first === "string") return first === CLAUDE_CODE_IDENTITY;
  return Boolean(first) && typeof first === "object" && first.text === CLAUDE_CODE_IDENTITY;
};

/**
 * `declined` names every reason except the benign one. Without the block
 * Anthropic answers an empty 429, which reads as an exhausted plan, so a
 * silent decline is indistinguishable from the failure this prevents.
 */
export function applyIdentity(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    return { applied: false, body, declined: "the body is not an Anthropic messages request" };
  }
  const system = body.system;
  // The only benign case: the client already identified itself.
  if (identityLeads(system)) return { applied: false, body };
  const identity = { type: "text", text: CLAUDE_CODE_IDENTITY };
  if (system === undefined || system === null || system === "") {
    return { applied: true, body: { ...body, system: [identity] } };
  }
  const rest = typeof system === "string"
    ? [{ type: "text", text: system }]
    : Array.isArray(system) ? system : undefined;
  if (!rest) return { applied: false, body, declined: `system is ${typeof system}, neither a string nor an array` };
  return { applied: true, body: { ...body, system: [identity, ...rest] } };
}

// The gate is the credential, not the host: a request authorised some other way
// must not be rewritten just because it is addressed to the same API.
export function usesClaudeCodeOauth(upstreamRequest) {
  const headers = upstreamRequest?.headers ?? {};
  let beta = "";
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "anthropic-beta") beta = String(value ?? "");
  }
  return beta.toLowerCase().includes("oauth-2025-04-20");
}

function withIdentity(upstreamRequest) {
  const raw = upstreamRequest.body;
  if (typeof raw === "string") {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) {
      console.warn(`[claude-code-oauth-identity] not applied: the body is not JSON (${error.message})`);
      return { applied: false, upstreamRequest };
    }
    const { applied, body, declined } = applyIdentity(parsed);
    if (declined) console.warn(`[claude-code-oauth-identity] not applied: ${declined}`);
    return applied
      ? { applied, upstreamRequest: { ...upstreamRequest, body: JSON.stringify(body) } }
      : { applied, upstreamRequest };
  }
  const { applied, body, declined } = applyIdentity(raw);
  if (declined) console.warn(`[claude-code-oauth-identity] not applied: ${declined}`);
  return applied ? { applied, upstreamRequest: { ...upstreamRequest, body } } : { applied, upstreamRequest };
}

export function createGatewayPlugin() {
  // Load-time signature. A plugin that never matches and a plugin that never
  // loaded are otherwise indistinguishable in the log.
  console.log("[claude-code-oauth-identity] provider hook registered");
  let announced = false;
  return {
    providerHooks: [
      {
        key: "claude-code-oauth-identity",
        transformRequest(input) {
          const upstream = input.upstreamRequest;
          if (!announced) {
            announced = true;
            console.log("[claude-code-oauth-identity] transformRequest reached this dispatch path");
          }
          if (!usesClaudeCodeOauth(upstream)) return { ok: true, value: upstream };
          const { applied, upstreamRequest } = withIdentity(upstream);
          if (applied) console.log("[claude-code-oauth-identity] led the request with the Claude Code system block");
          return { ok: true, value: upstreamRequest };
        }
      }
    ]
  };
}

export default createGatewayPlugin;
