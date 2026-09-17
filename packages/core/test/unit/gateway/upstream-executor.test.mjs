import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeAppGatewayModelRoutes } from "@ccr/core/agents/claude-app/gateway-routes.ts";
import { prepareClaudeAppDiscoveredModelRequest } from "@ccr/core/gateway/features/model-discovery.ts";
import { fetchUpstreamWithFallback, prepareGatewayUpstreamAttemptForTest } from "@ccr/core/gateway/upstream/executor.ts";
import { RequestRouteTraceRecorder } from "@ccr/core/observability/route-trace.ts";
import {
  providerCredentialsAllCooling,
  recordProviderCredentialOutcome
} from "@ccr/core/providers/credential-pool.ts";
import { providerCredentialInternalName } from "@ccr/core/providers/runtime-topology.ts";

const retryConfig = {
  Providers: [],
  Router: { fallback: { mode: "retry", models: [], retryCount: 1 }, rules: [] },
  virtualModelProfiles: []
};
const retryFallback = { mode: "retry", models: [], retryCount: 1 };

async function assertRetryBackoffStopsAfterAbort(fetchImpl) {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const controller = new AbortController();
  let fetchCount = 0;
  globalThis.fetch = async (...args) => {
    fetchCount += 1;
    return fetchImpl(...args);
  };
  globalThis.setTimeout = (_callback, delay, ..._args) => {
    const timer = originalSetTimeout(() => {}, delay);
    timer.unref?.();
    queueMicrotask(() => controller.abort(new Error("client disconnected")));
    return timer;
  };

  try {
    const outcome = await Promise.race([
      fetchUpstreamWithFallback({
        body: Buffer.from('{"model":"test-model"}'),
        config: retryConfig,
        coreAuthToken: "core-token",
        fallback: retryFallback,
        headers: {},
        method: "POST",
        path: "/v1/messages",
        routedModel: "test-model",
        signal: controller.signal,
        upstreamUrl: "http://127.0.0.1:3456/v1/messages"
      }).then(
        () => ({ kind: "resolved" }),
        (error) => ({ error, kind: "rejected" })
      ),
      new Promise((resolve) => setImmediate(() => resolve({ kind: "pending" })))
    ]);

    assert.notEqual(outcome.kind, "pending");
    assert.equal(outcome.kind, "rejected");
    assert.match(outcome.error.message, /client disconnected/);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

const streamErrorConfig = {
  Providers: [
    {
      capabilities: [{ baseUrl: "https://stream-primary.example", type: "anthropic_messages" }],
      id: "stream-primary",
      models: ["primary-model"],
      name: "Stream Primary"
    },
    {
      capabilities: [{ baseUrl: "https://stream-recovery.example", type: "anthropic_messages" }],
      id: "stream-recovery",
      models: ["recovery-model"],
      name: "Stream Recovery"
    }
  ],
  Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
  virtualModelProfiles: []
};

const streamChainFallback = {
  mode: "model-chain",
  models: ["Stream Recovery/recovery-model"],
  retryCount: 0
};

// Byte-for-byte the frame OpenRouter emits when the upstream provider rejects a
// request that has already been answered with 200 headers.

const providerErrorFrame =
  'event: error\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"Provider returned error"}}\n\n';

const healthyFirstFrame = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';

function sseResponse(body) {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200
  });
}

// Emits each string as its own network chunk so frames that straddle a chunk
// boundary are exercised rather than assumed away.

function sseChunkedResponse(chunks) {
  const encoder = new TextEncoder();
  return sseResponse(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  }));
}

async function runStreamAttempt({ fallback, responses }) {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const index = captured.length;
    captured.push(JSON.parse(init.body));
    return responses[index]();
  };

  try {
    const result = await fetchUpstreamWithFallback({
      body: Buffer.from(JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
        model: "Stream Primary/primary-model",
        stream: true
      })),
      config: streamErrorConfig,
      coreAuthToken: "core-token",
      fallback,
      headers: {},
      method: "POST",
      path: "/v1/messages",
      routedModel: "Stream Primary/primary-model",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });
    return { captured, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("retry backoff stops after client aborts a retryable HTTP response", async () => {
  await assertRetryBackoffStopsAfterAbort(async () => new Response(null, { status: 503 }));
});

test("retry backoff stops after client aborts a network error", async () => {
  await assertRetryBackoffStopsAfterAbort(async () => {
    throw new Error("upstream unavailable");
  });
});

test("fallback cancels unfinished error bodies without waiting for cancellation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const cancellation of ["complete", "reject", "pending"]) {
      let fetchCount = 0;
      let cancelled = false;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"error":"rate limited"}'));
        },
        cancel() {
          cancelled = true;
          if (cancellation === "reject") return Promise.reject(new Error("cleanup failed"));
          if (cancellation === "pending") return new Promise(() => {});
        }
      });
      globalThis.fetch = async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? new Response(body, { headers: { "retry-after": "0.001" }, status: 429 })
          : new Response("{}", { status: 200 });
      };

      const result = await fetchUpstreamWithFallback({
        body: Buffer.from('{"model":"test-model"}'),
        config: retryConfig,
        coreAuthToken: "core-token",
        fallback: retryFallback,
        headers: {},
        method: "POST",
        path: "/v1/messages",
        routedModel: "test-model",
        signal: AbortSignal.timeout(1000),
        upstreamUrl: "http://127.0.0.1:3456/v1/messages"
      });
      assert.equal(cancelled, true, cancellation);
      assert.equal(fetchCount, 2, cancellation);
      assert.equal(result.response.status, 200, cancellation);
      assert.equal(result.failedAttempts.length, 1, cancellation);
      assert.equal(result.failedAttempts[0].statusCode, 429, cancellation);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouter discount provider constraints are removed from different fallback model attempts", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  try {
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", {
        headers: { "content-type": "application/json" },
        status: bodies.length === 1 ? 503 : 200
      });
    };

    const result = await fetchUpstreamWithFallback({
      body: Buffer.from(JSON.stringify({
        messages: [],
        model: "OpenRouter/z-ai/glm-primary",
        provider: {
          ignore: ["legacy"],
          order: ["cheap"]
        }
      })),
      config: {
        Providers: [],
        Router: {
          fallback: {
            mode: "model-chain",
            models: ["OpenRouter/z-ai/glm-fallback"],
            retryCount: 0
          },
          rules: []
        },
        virtualModelProfiles: []
      },
      coreAuthToken: "core-token",
      fallback: {
        mode: "model-chain",
        models: ["OpenRouter/z-ai/glm-fallback"],
        retryCount: 0
      },
      headers: {
        "x-ccr-openrouter-discount-model": "z-ai/glm-primary",
        "x-ccr-openrouter-discount-provider-id": "openrouter"
      },
      method: "POST",
      path: "/v1/chat/completions",
      routedModel: "OpenRouter/z-ai/glm-primary",
      upstreamUrl: "http://127.0.0.1:3456/v1/chat/completions"
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.failedAttempts.length, 1);
    assert.deepEqual(bodies[0].provider, {
      ignore: ["legacy"],
      order: ["cheap"]
    });
    assert.equal(bodies[1].model, "OpenRouter/z-ai/glm-fallback");
    assert.equal(bodies[1].provider, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("target-provider routing preserves slash-namespaced model ids", () => {
  const cases = [
    {
      model: "openai/gpt-oss-20b",
      provider: "Groq",
      url: "https://api.groq.example/openai/v1"
    },
    {
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      provider: "NVIDIA",
      url: "https://integrate.api.nvidia.com/v1"
    },
    {
      model: "google/gemini-2.5-pro",
      provider: "OpenRouter",
      url: "https://openrouter.ai/api/v1"
    }
  ];

  for (const item of cases) {
    const attempt = prepareGatewayUpstreamAttemptForTest({
      body: {
        messages: [],
        model: item.model
      },
      config: {
        Providers: [
          {
            capabilities: [{ baseUrl: item.url, type: "openai_chat_completions" }],
            credentials: [{ apiKey: "provider-key", id: "provider-main" }],
            models: [item.model],
            name: item.provider
          }
        ],
        Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
        virtualModelProfiles: []
      },
      headers: {
        "x-target-provider": item.provider
      },
      method: "POST",
      path: "/v1/chat/completions",
      routedModel: item.model
    });

    assert.equal(attempt.body.model, item.model);
    assert.equal(attempt.logicalProvider, item.provider);
  }
});

test("OpenAI Responses upstream preserves response-native request bodies", () => {
  const input = [
    {
      content: [{ text: "Developer rules", type: "input_text" }],
      role: "developer",
      type: "message"
    },
    {
      content: [{ text: "inspect the repo", type: "input_text" }],
      role: "user",
      type: "message"
    },
    {
      content: "System guardrails",
      role: "system",
      type: "message"
    }
  ];
  const attempt = prepareGatewayUpstreamAttemptForTest({
    body: {
      input,
      instructions: "You are Codex.",
      model: "Provider/gpt-5.5",
      reasoning_split: true,
      stream: true
    },
    config: {
      Providers: [
        {
          capabilities: [{ baseUrl: "https://openai-compatible.example/v1", type: "openai_responses" }],
          credentials: [{ apiKey: "provider-key", id: "provider-main" }],
          models: ["gpt-5.5"],
          name: "Provider"
        }
      ],
      Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
      virtualModelProfiles: []
    },
    headers: {},
    method: "POST",
    path: "/v1/responses",
    routedModel: "Provider/gpt-5.5"
  });

  assert.equal(attempt.body.model, "gpt-5.5");
  assert.equal(attempt.body.instructions, "You are Codex.");
  assert.deepEqual(attempt.body.input, input);
  assert.equal(attempt.body.reasoning_split, true);
  assert.equal(attempt.credentialProtocol, "openai_responses");
});

test("Claude App OpenRouter routes do not send conflicting vendor-prefixed model selectors to the core gateway", () => {
  const targetModel = "OpenRouter/google/gemini-3.7-flash";
  const config = {
    Providers: [
      {
        apiKey: "openrouter-key",
        capabilities: [
          { baseUrl: "https://openrouter.ai/api/v1", type: "openai_chat_completions" },
          { baseUrl: "https://openrouter.ai/api/v1", type: "openai_responses" }
        ],
        id: "openrouter",
        models: ["google/gemini-3.7-flash"],
        name: "OpenRouter"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    profile: {
      enabled: true,
      profiles: [
        {
          agent: "claude-code",
          enabled: true,
          id: "claude-code-openrouter",
          model: targetModel,
          name: "Claude Code OpenRouter",
          scope: "global"
        }
      ]
    },
    virtualModelProfiles: []
  };
  const route = buildClaudeAppGatewayModelRoutes(config).find((item) => item.targetModel === targetModel);
  assert.ok(route);

  const rewrite = prepareClaudeAppDiscoveredModelRequest(
    config,
    "POST",
    "/v1/messages",
    Buffer.from(JSON.stringify({ max_tokens: 8, messages: [{ role: "user", content: "hello" }], model: route.id }))
  );
  assert.equal(rewrite?.routedModel, targetModel);

  const rewrittenBody = JSON.parse(rewrite.body.toString("utf8"));
  const attempt = prepareGatewayUpstreamAttemptForTest({
    body: rewrittenBody,
    config,
    headers: {},
    method: "POST",
    path: "/v1/messages",
    routedModel: rewrite.routedModel
  });

  assert.equal(attempt.headers["x-target-provider"], "openrouter::openai_chat_completions");
  assert.equal(coreGatewayTargetProviderConflict(attempt), false);
  assert.equal(attempt.body.model, "openrouter::openai_chat_completions/google/gemini-3.7-flash");
});

test("target-provider routing keeps vendor-prefixed model ids even when the prefix names another provider", () => {
  const config = {
    Providers: [
      {
        capabilities: [{ baseUrl: "https://api.openai.example/v1", type: "openai_chat_completions" }],
        credentials: [{ apiKey: "openai-key", id: "openai-main" }],
        id: "openai",
        models: ["gpt-oss-20b"],
        name: "OpenAI"
      },
      {
        capabilities: [{ baseUrl: "https://api.groq.example/openai/v1", type: "openai_chat_completions" }],
        credentials: [{ apiKey: "groq-key", id: "groq-main" }],
        id: "groq",
        models: ["openai/gpt-oss-20b"],
        name: "Groq"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };

  const attempt = prepareGatewayUpstreamAttemptForTest({
    body: {
      messages: [],
      model: "openai/gpt-oss-20b"
    },
    config,
    headers: {
      "x-target-provider": "Groq"
    },
    method: "POST",
    path: "/v1/chat/completions",
    routedModel: "openai/gpt-oss-20b"
  });

  assert.equal(attempt.body.model, "openai/gpt-oss-20b");
  assert.equal(attempt.logicalProvider, "Groq");
});

function coreGatewayTargetProviderConflict(attempt) {
  const bodyModel = typeof attempt.body?.model === "string" ? attempt.body.model : "";
  const targetProvider = attempt.headers?.["x-target-provider"];
  if (!bodyModel || !targetProvider) {
    return false;
  }
  const slashIndex = bodyModel.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= bodyModel.length - 1) {
    return false;
  }
  const providerHint = bodyModel.slice(0, slashIndex);
  if (providerHint === targetProvider) {
    return false;
  }
  const modelProvider = coreGatewayBuiltinProvider(providerHint);
  const targetProviderType = coreGatewayProviderType(targetProvider);
  return Boolean(modelProvider && targetProviderType && modelProvider !== targetProviderType);
}

function coreGatewayProviderType(providerSelector) {
  if (providerSelector.includes("::openai_chat_completions") || providerSelector.includes("::openai_responses")) {
    return "openai";
  }
  if (providerSelector.includes("::anthropic_messages")) {
    return "anthropic";
  }
  if (providerSelector.includes("::gemini_generate_content") || providerSelector.includes("::gemini_interactions")) {
    return "gemini";
  }
  return coreGatewayBuiltinProvider(providerSelector);
}

function coreGatewayBuiltinProvider(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai") {
    return "openai";
  }
  if (normalized === "anthropic" || normalized === "claude") {
    return "anthropic";
  }
  if (normalized === "gemini" || normalized === "google") {
    return "gemini";
  }
  return undefined;
}

test("target-provider routing preserves slash model ids for providers without explicit capabilities", () => {
  const config = {
    Providers: [
      {
        api_base_url: "https://api.openai.example/v1",
        credentials: [{ apiKey: "openai-key", id: "openai-main" }],
        id: "openai",
        models: ["gpt-oss-20b"],
        name: "OpenAI",
        type: "openai_chat_completions"
      },
      {
        api_base_url: "https://api.groq.example/openai/v1",
        credentials: [{ apiKey: "groq-key", id: "groq-main" }],
        id: "groq",
        models: ["openai/gpt-oss-20b"],
        name: "Groq",
        provider: "openai",
        type: "openai_chat_completions"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };

  const attempt = prepareGatewayUpstreamAttemptForTest({
    body: {
      messages: [],
      model: "openai/gpt-oss-20b"
    },
    config,
    headers: {
      "x-target-provider": "Groq"
    },
    method: "POST",
    path: "/v1/chat/completions",
    routedModel: "openai/gpt-oss-20b"
  });

  assert.equal(attempt.body.model, "openai/gpt-oss-20b");
  assert.equal(attempt.logicalProvider, "Groq");
  assert.equal(attempt.credentialProtocol, "openai_chat_completions");
  assert.equal(attempt.headers["x-target-providers"], "groq::openai_chat_completions::cred:groq-main");
});

test("model-chain fallback rebuilds every protocol attempt from the canonical request", async () => {
  const config = {
    Providers: [
      {
        capabilities: [{ baseUrl: "https://anthropic-primary.example", type: "anthropic_messages" }],
        id: "anthropic-primary",
        models: ["claude-primary"],
        name: "Anthropic Primary"
      },
      {
        capabilities: [{ baseUrl: "https://openai-fallback.example", type: "openai_responses" }],
        id: "openai-fallback",
        models: ["gpt-fallback"],
        name: "OpenAI Fallback"
      },
      {
        capabilities: [{ baseUrl: "https://anthropic-recovery.example", type: "anthropic_messages" }],
        id: "anthropic-recovery",
        models: ["claude-recovery"],
        name: "Anthropic Recovery"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };
  const fallback = {
    mode: "model-chain",
    models: ["OpenAI Fallback/gpt-fallback", "Anthropic Recovery/claude-recovery"],
    retryCount: 0
  };
  const canonicalBody = {
    context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
    messages: [{ content: "hello", role: "user" }],
    model: "Anthropic Primary/claude-primary",
    output_config: { effort: "high", verbosity: "medium" },
    system: [{ cache_control: { type: "ephemeral" }, text: "system", type: "text" }],
    thinking: { type: "adaptive" }
  };
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    captured.push({
      body: JSON.parse(init.body),
      headers: init.headers
    });
    const status = captured.length === 1 ? 429 : captured.length === 2 ? 400 : 200;
    return new Response('{"ok":true}', {
      headers: {
        "content-type": "application/json",
        "retry-after": "0.001"
      },
      status
    });
  };

  try {
    const trace = new RequestRouteTraceRecorder(Date.now());
    const result = await fetchUpstreamWithFallback({
      body: Buffer.from(JSON.stringify(canonicalBody)),
      config,
      coreAuthToken: "core-token",
      fallback,
      headers: {},
      method: "POST",
      path: "/v1/messages",
      routedModel: canonicalBody.model,
      trace,
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });

    assert.equal(result.response.status, 200);
    assert.equal(captured.length, 3);
    assert.deepEqual(captured.map((attempt) => attempt.body.model), [
      "claude-primary",
      "gpt-fallback",
      "claude-recovery"
    ]);
    assert.deepEqual(captured[0].body.thinking, { type: "adaptive" });
    assert.equal(captured[1].body.thinking, undefined);
    assert.deepEqual(captured[2].body.thinking, { type: "adaptive" });
    assert.deepEqual(captured[2].body.context_management, canonicalBody.context_management);
    assert.deepEqual(captured[2].body.output_config, canonicalBody.output_config);
    assert.equal(captured[0].headers["x-target-provider"], "anthropic-primary::anthropic_messages");
    assert.equal(captured[1].headers["x-target-provider"], "openai-fallback::openai_responses");
    assert.equal(captured[2].headers["x-target-provider"], "anthropic-recovery::anthropic_messages");
    const finishedTrace = trace.finish();
    const capabilityRoutingHops = finishedTrace.hops
      .filter((hop) => hop.name === "provider.capability-routing");
    assert.deepEqual(
      capabilityRoutingHops.map((hop) => hop.attempt),
      [1, 2, 3]
    );
    assert.deepEqual(
      capabilityRoutingHops[0].changes.map((change) => change.path),
      ["/body/model", "/routing/model"]
    );
    assert.deepEqual(
      finishedTrace.hops
        .find((hop) => hop.name === "fallback.execution-plan")
        ?.changes.map((change) => change.path),
      ["/routing/fallback"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model-chain fallback moves to a different model without waiting out the failed provider's backoff", async () => {
  const config = {
    Providers: [
      {
        capabilities: [{ baseUrl: "https://primary.example", type: "anthropic_messages" }],
        id: "primary",
        models: ["model-a"],
        name: "Primary"
      },
      {
        capabilities: [{ baseUrl: "https://secondary.example", type: "anthropic_messages" }],
        id: "secondary",
        models: ["model-b"],
        name: "Secondary"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const scheduledBackoffsMs = [];
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    // The exhausted provider asks for a 30s pause before it is retried.
    return fetchCount === 1
      ? new Response("{}", { headers: { "retry-after": "30" }, status: 429 })
      : new Response('{"ok":true}', { status: 200 });
  };
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (typeof ms === "number" && ms >= 1000) {
      scheduledBackoffsMs.push(ms);
    }
    return originalSetTimeout(callback, ms, ...args);
  };

  try {
    const result = await fetchUpstreamWithFallback({
      body: Buffer.from('{"messages":[],"model":"Primary/model-a"}'),
      config,
      coreAuthToken: "core-token",
      fallback: { mode: "model-chain", models: ["Secondary/model-b"], retryCount: 0 },
      headers: {},
      method: "POST",
      path: "/v1/messages",
      routedModel: "Primary/model-a",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });

    assert.equal(result.response.status, 200);
    assert.equal(fetchCount, 2);
    // The second attempt is a different model on a different provider with its
    // own quota, so the first provider's retry-after must not stall it.
    assert.deepEqual(scheduledBackoffsMs, []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("model-chain fallback re-addresses each attempt instead of repeating the failed provider", async () => {
  const config = {
    Providers: [
      {
        capabilities: [{ baseUrl: "https://primary.example", type: "anthropic_messages" }],
        id: "primary",
        models: ["model-a"],
        name: "Primary"
      },
      {
        capabilities: [{ baseUrl: "https://secondary.example", type: "anthropic_messages" }],
        id: "secondary",
        models: ["model-b"],
        name: "Secondary"
      }
    ],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };
  const originalFetch = globalThis.fetch;
  const routedModelHeaders = [];
  let fetchCount = 0;

  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    routedModelHeaders.push(init?.headers?.["x-ccr-routed-model"]);
    // The primary is rate limited, so only the second attempt may succeed.
    return fetchCount === 1
      ? new Response("{}", { status: 429 })
      : new Response('{"ok":true}', { status: 200 });
  };

  try {
    const result = await fetchUpstreamWithFallback({
      body: Buffer.from('{"messages":[],"model":"Primary/model-a"}'),
      config,
      coreAuthToken: "core-token",
      fallback: { mode: "model-chain", models: ["Secondary/model-b"], retryCount: 0 },
      // The request pipeline stamps this header once, from the primary model.
      headers: { "x-ccr-routed-model": "Primary/model-a" },
      method: "POST",
      path: "/v1/messages",
      routedModel: "Primary/model-a",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });

    assert.equal(result.response.status, 200);
    assert.equal(fetchCount, 2);
    // The core gateway resolves the provider from this header before it reads
    // the body, so a stale primary value sends the fallback attempt straight
    // back to the provider that just returned 429.
    assert.match(routedModelHeaders[0], /model-a$/);
    assert.match(routedModelHeaders[1], /model-b$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an SSE error frame inside HTTP 200 hands the attempt to the fallback chain", async () => {
  const { captured, result } = await runStreamAttempt({
    fallback: streamChainFallback,
    responses: [
      () => sseResponse(providerErrorFrame),
      () => sseResponse(healthyFirstFrame)
    ]
  });

  assert.equal(captured.length, 2, "an error frame must not be accepted as a successful attempt");
  assert.deepEqual(captured.map((body) => body.model), ["primary-model", "recovery-model"]);
  assert.equal(result.response.status, 200);
  assert.equal(result.failedAttempts.length, 1);
  assert.equal(result.failedAttempts[0].statusCode, 529);
  assert.match(result.failedAttempts[0].error ?? "", /Provider returned error/);
  assert.equal(await result.response.text(), healthyFirstFrame);
});

test("a healthy stream is forwarded byte-for-byte across chunk boundaries", async () => {
  // The first frame is deliberately split mid-JSON: a peek that decodes without
  // buffering the remainder would corrupt or drop the payload here.
  const chunks = [
    'event: message_start\ndata: {"type":"message_st',
    'art","message":{"id":"msg_1"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ];

  const { captured, result } = await runStreamAttempt({
    fallback: streamChainFallback,
    responses: [() => sseChunkedResponse(chunks)]
  });

  assert.equal(captured.length, 1, "a healthy stream must not trigger a fallback attempt");
  assert.equal(result.response.status, 200);
  assert.equal(await result.response.text(), chunks.join(""));
});

test("keepalive frames ahead of the first real event are not read as a failure", async () => {
  const chunks = [
    ": keepalive\n\n",
    'event: ping\ndata: {"type":"ping"}\n\n',
    healthyFirstFrame
  ];

  const { captured, result } = await runStreamAttempt({
    fallback: streamChainFallback,
    responses: [() => sseChunkedResponse(chunks)]
  });

  assert.equal(captured.length, 1);
  assert.equal(await result.response.text(), chunks.join(""));
});

test("an empty HTTP 200 stream body is treated as a failed attempt", async () => {
  const { captured, result } = await runStreamAttempt({
    fallback: streamChainFallback,
    responses: [
      () => sseResponse(""),
      () => sseResponse(healthyFirstFrame)
    ]
  });

  assert.equal(captured.length, 2, "a 200 with no body at all is the original bug report");
  assert.equal(result.failedAttempts.length, 1);
  assert.equal(result.failedAttempts[0].statusCode, 529);
  assert.equal(await result.response.text(), healthyFirstFrame);
});

test("without a fallback target the in-stream error surfaces as a retryable 529", async () => {
  const { captured, result } = await runStreamAttempt({
    fallback: { mode: "off", models: [], retryCount: 0 },
    responses: [() => sseResponse(providerErrorFrame)]
  });

  assert.equal(captured.length, 1);
  assert.equal(
    result.response.status,
    529,
    "a 200 carrying only an error frame must not reach the client as a success"
  );
  // The upstream explanation is preserved so the client reports the real cause.
  assert.equal(await result.response.text(), providerErrorFrame);
});

test("detectStreamErrors=false forwards the error frame verbatim", async () => {
  const { captured, result } = await runStreamAttempt({
    fallback: { ...streamChainFallback, detectStreamErrors: false },
    responses: [() => sseResponse(providerErrorFrame)]
  });

  assert.equal(captured.length, 1, "detection is opt-out; no fallback attempt may be made");
  assert.equal(result.response.status, 200);
  assert.equal(await result.response.text(), providerErrorFrame);
});

test("a model whose every credential is cooling moves to the back of the chain", async () => {
  const primary = {
    capabilities: [{ baseUrl: "https://primary.example", type: "anthropic_messages" }],
    credentials: [{ apiKey: "primary-key", id: "primary-cred" }],
    id: "primary",
    models: ["model-a"],
    name: "Cooling Primary"
  };
  const secondary = {
    capabilities: [{ baseUrl: "https://secondary.example", type: "anthropic_messages" }],
    credentials: [{ apiKey: "secondary-key", id: "secondary-cred" }],
    id: "secondary",
    models: ["model-b"],
    name: "Warm Secondary"
  };
  const config = {
    Providers: [primary, secondary],
    Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
    virtualModelProfiles: []
  };

  // The primary's only credential is out of quota for the next hour.
  recordProviderCredentialOutcome(
    config,
    "POST",
    {
      credentialChain: [providerCredentialInternalName(primary, "anthropic_messages", primary.credentials[0])],
      credentialProtocol: "anthropic_messages",
      logicalProvider: primary.name
    },
    429,
    new Headers({ "retry-after": "3600" })
  );
  assert.equal(providerCredentialsAllCooling(primary, primary.credentials), true);

  const originalFetch = globalThis.fetch;
  const routedModelHeaders = [];
  globalThis.fetch = async (_url, init) => {
    routedModelHeaders.push(init?.headers?.["x-ccr-routed-model"]);
    return new Response("{}", { status: 429 });
  };

  try {
    await fetchUpstreamWithFallback({
      body: Buffer.from('{"messages":[],"model":"Cooling Primary/model-a"}'),
      config,
      coreAuthToken: "core-token",
      fallback: { mode: "model-chain", models: ["Warm Secondary/model-b"], retryCount: 0 },
      headers: { "x-ccr-routed-model": "Cooling Primary/model-a" },
      method: "POST",
      path: "/v1/messages",
      routedModel: "Cooling Primary/model-a",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });
  } catch {
    // Every attempt fails here; the order of the attempts is what is under test.
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Deprioritised, not dropped: the cooling model is still tried last.
  assert.equal(routedModelHeaders.length, 2);
  assert.match(routedModelHeaders[0], /model-b$/);
  assert.match(routedModelHeaders[1], /model-a$/);
});
