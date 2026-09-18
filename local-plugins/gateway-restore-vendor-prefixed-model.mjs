// A gateway plugin for the vendored @the-next-ai/ai-gateway runtime.
//
// The runtime drops a leading path segment from the model id when that segment
// repeats the protocol family. Addressed on `openai_chat_completions`, a model
// called `openai/gpt-oss-120b` leaves as `gpt-oss-120b`, and a provider that
// lists only the prefixed id answers 400 model_not_found. Measured against a
// local sink: `openai/clean-model` arrived as `clean-model`, while
// `qwen/...`, `z-ai/...` and an unrelated `vendorx/...` arrived intact.
//
// NOT CURRENTLY REACHED. Measured 2026-09-18: with the hook registered and
// carrying 70 candidate ids, transformRequest was never invoked for a
// chat-completions provider request, while the reasoning-content hook fires
// normally for an openai_responses request. Provider hooks therefore do not run
// on this dispatch path, so the repair below cannot take effect where it is
// needed. Kept, with its tests, for when the right interception point is found.
//
// The request CCR hands the runtime is correct, so this restores the id rather
// than changing it: the full model is recovered only when the provider's own
// configured list says the shortened form is not something it offers and
// exactly one configured id ends with it. Where that is ambiguous, or the
// shortened id is itself valid, the request is left alone.

export const manifest = {
  capabilities: ["providerHooks"],
  name: "restore-vendor-prefixed-model",
  version: "1.0.0"
};

// The compiled config the runtime receives does not carry the provider's model
// list, so the hook is given one through its own plugin config. Measured: with
// only targetProviderConfig to go on, the hook loaded and never found a
// candidate, which is indistinguishable from having nothing to do.
function configuredModels(input, fallbackModels) {
  const raw = input?.targetProviderConfig?.models;
  const fromTarget = Array.isArray(raw)
    ? raw.map((entry) => (typeof entry === "string" ? entry : entry?.id ?? entry?.name))
      .filter((entry) => typeof entry === "string" && entry)
    : [];
  return fromTarget.length > 0 ? fromTarget : fallbackModels;
}

export function restoreModel(sent, models) {
  if (typeof sent !== "string" || !sent || !Array.isArray(models) || models.length === 0) {
    return undefined;
  }
  // The provider offers exactly what was sent, so nothing was lost.
  if (models.some((m) => m === sent)) return undefined;
  const candidates = models.filter((m) => m.endsWith(`/${sent}`));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function patchedBody(raw, models) {
  const apply = (parsed) => {
    const restored = restoreModel(parsed?.model, models);
    return restored === undefined ? undefined : { ...parsed, model: restored };
  };
  if (typeof raw === "string") {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return undefined; }
    const next = apply(parsed);
    return next === undefined ? undefined : JSON.stringify(next);
  }
  if (!raw || typeof raw !== "object") return undefined;
  return apply(raw);
}

export function createGatewayPlugin(factoryInput) {
  // Every prefixed model id configured across all providers. A restore is only
  // made when exactly one of them ends with what was sent, so a list spanning
  // providers stays safe: an id that two providers could claim is left alone.
  const fallbackModels = (factoryInput?.plugin?.config?.models ?? [])
    .filter((entry) => typeof entry === "string" && entry.includes("/"));
  console.log(`[restore-vendor-prefixed-model] provider hook registered with ${fallbackModels.length} known prefixed model(s)`);
  return {
    providerHooks: [
      {
        key: "restore-vendor-prefixed-model",
        transformRequest(input) {
          const models = configuredModels(input, fallbackModels);
          const next = patchedBody(input.upstreamRequest?.body, models);
          if (next === undefined) {
            return { ok: true, value: input.upstreamRequest };
          }
          const sent = typeof input.upstreamRequest.body === "string"
            ? JSON.parse(input.upstreamRequest.body).model
            : input.upstreamRequest.body.model;
          console.log(`[restore-vendor-prefixed-model] restored ${JSON.stringify(sent)} for ${input.targetProvider ?? "provider"}`);
          return { ok: true, value: { ...input.upstreamRequest, body: next } };
        }
      }
    ]
  };
}

export default createGatewayPlugin;
