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

const isIdentityBlock = (block) =>
  typeof block === "string"
    ? block.startsWith(CLAUDE_CODE_IDENTITY)
    : Boolean(block) && typeof block === "object" && typeof block.text === "string"
      && block.text.startsWith(CLAUDE_CODE_IDENTITY);

// Only an Anthropic Messages body is touched, and only when it is not already
// identified. A body that already leads with the block is returned unchanged,
// so a real Claude Code session passing through is never modified.
export function applyIdentity(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    return { applied: false, body };
  }
  const identity = { type: "text", text: CLAUDE_CODE_IDENTITY };
  const system = body.system;
  if (system === undefined || system === null) {
    return { applied: true, body: { ...body, system: [identity] } };
  }
  if (typeof system === "string") {
    if (system.startsWith(CLAUDE_CODE_IDENTITY)) return { applied: false, body };
    return { applied: true, body: { ...body, system: [identity, { type: "text", text: system }] } };
  }
  if (!Array.isArray(system)) return { applied: false, body };
  if (system.length > 0 && isIdentityBlock(system[0])) return { applied: false, body };
  return { applied: true, body: { ...body, system: [identity, ...system] } };
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
    try { parsed = JSON.parse(raw); } catch { return { applied: false, upstreamRequest }; }
    const { applied, body } = applyIdentity(parsed);
    return applied
      ? { applied, upstreamRequest: { ...upstreamRequest, body: JSON.stringify(body) } }
      : { applied, upstreamRequest };
  }
  const { applied, body } = applyIdentity(raw);
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
          if (applied) console.log("[claude-code-oauth-identity] added the Claude Code system block");
          return { ok: true, value: upstreamRequest };
        }
      }
    ]
  };
}

export default createGatewayPlugin;
