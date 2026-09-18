/**
 * Strips `content` from reasoning items in an OpenAI Responses request.
 *
 * The Responses API accepts a reasoning item carrying `summary` and
 * `encrypted_content`, and requires its `content` to be empty. Conversation
 * history replayed from an Anthropic-shaped client arrives with the reasoning
 * text in `content`, and the upstream rejects the whole request:
 *
 *   400 invalid_request_error / array_above_max_length
 *   "Invalid 'input[2].content': array too long.
 *    Expected an array with maximum length 0, but got an array with length 1"
 *
 * Measured 2026-09-18 on a real request: 216 input items, 36 of them reasoning
 * items with a populated `content`. Every request carrying reasoning history
 * failed this way, so the provider never answered regardless of its quota.
 *
 * Only reasoning items are touched. `summary` and `encrypted_content` are what
 * the upstream actually reads, and both are left alone, so nothing the model
 * needs for continuity is lost.
 */

const REASONING = "reasoning";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the number of items changed, mutating `input` in place. */
export function stripReasoningContent(input) {
  if (!Array.isArray(input)) {
    return 0;
  }
  let stripped = 0;
  for (const item of input) {
    if (!isRecord(item) || item.type !== REASONING) {
      continue;
    }
    if (Array.isArray(item.content) && item.content.length > 0) {
      item.content = [];
      stripped += 1;
    }
  }
  return stripped;
}

export function setup(context) {
  const logger = context?.logger;
  return {
    onStop: () => {},
    // Registration happens through the context so the surface is declared in
    // one place; the host applies it to every upstream request.
    ...registerTransform(context, logger)
  };
}

function registerTransform(context, logger) {
  context.registerGatewayRequestTransform({
    id: "responses-reasoning-content",
    transform: (input) => {
      const body = input?.body;
      if (!isRecord(body) || !Array.isArray(body.input)) {
        return undefined;
      }
      const stripped = stripReasoningContent(body.input);
      if (stripped === 0) {
        return undefined;
      }
      logger?.info?.(
        `[responses-reasoning-content] cleared content on ${stripped} reasoning item(s) for ${input.routedModel ?? "an upstream request"}`
      );
      return { body };
    }
  });
  return {};
}

export default setup;
