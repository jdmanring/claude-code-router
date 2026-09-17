import type { AppConfig, GatewayProviderConfig, ProviderCredentialConfig } from "@ccr/core/contracts/app";
import { estimateLimitUsage, limitRules, readWindowCounter } from "@ccr/core/gateway/limits/window-limiter";
import { parseRetryAfterHeaderMs } from "@ccr/core/gateway/upstream/retry-policy";
import {
  type ApiKeyLimitRule,
  type ApiKeyLimitUsage,
  type UpstreamAttempt
} from "@ccr/core/gateway/internal/shared";
import {
  findProviderByPublicOrInternalName,
  findProviderCredentialByRuntimeId,
  findProviderCredentialBySlug,
  parseProviderCredentialInternalName,
  providerCredentialRuntimeId
} from "@ccr/core/providers/runtime-topology";

const providerCredentialCooldownMs = 60_000;
// A daily quota reports its reset through retry-after, often hours away.
// Honour it instead of re-hitting an exhausted credential every minute, but
// cap it so a malformed header cannot retire a credential for good.
const providerCredentialCooldownMaxMs = 6 * 60 * 60 * 1000;
// ponytail: cooldowns live in this module-global map, so a gateway restart
// forgets them; persist to storage if restarts start costing real quota.
const providerCredentialCooldowns = new Map<string, { reason: string; until: number }>();

export function providerCredentialLimitState(
  provider: GatewayProviderConfig,
  credential: ProviderCredentialConfig,
  usage: ApiKeyLimitUsage
): { blocked: boolean; utilization: number } {
  const rules = limitRules(credential.limits, usage);
  if (rules.length === 0) return { blocked: false, utilization: 0 };

  const now = Date.now();
  let blocked = false;
  let utilization = 0;
  for (const rule of rules) {
    const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
    const counter = readWindowCounter(providerCredentialCounterKey(provider, credential, rule, windowStart), windowStart, rule.windowMs, now);
    blocked ||= counter.value + rule.requested > rule.limit;
    utilization = Math.max(utilization, (counter.value + rule.requested) / rule.limit);
  }
  return { blocked, utilization };
}

export function recordProviderCredentialOutcome(
  config: AppConfig,
  method: string,
  attempt: UpstreamAttempt,
  statusCode: number,
  responseHeaders: Headers
): void {
  if (!attempt.logicalProvider || !attempt.credentialProtocol || !attempt.credentialChain?.length) return;
  const provider = findProviderByPublicOrInternalName(config, attempt.logicalProvider);
  if (!provider) return;

  const responseCredentialId = responseHeaders.get("x-ccr-provider-credential-id")?.trim();
  const responseCredential = responseCredentialId
    ? findProviderCredentialByRuntimeId(provider, responseCredentialId)
    : undefined;
  const credential = responseCredential ?? providerCredentialFromInternalName(provider, attempt.credentialChain[0]);
  if (!credential) return;

  if (statusCode >= 200 && statusCode < 500 && statusCode !== 401 && statusCode !== 403 && statusCode !== 429) {
    incrementProviderCredentialCounters(provider, credential, estimateLimitUsage(method, attempt.body ?? Buffer.alloc(0)));
    clearProviderCredentialCooldown(provider, credential);
    return;
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode >= 500) {
    setProviderCredentialCooldown(provider, credential, cooldownMsForResponse(responseHeaders), `HTTP ${statusCode}`);
  }
}

export function readProviderCredentialCooldown(
  provider: GatewayProviderConfig,
  credential: ProviderCredentialConfig
): { reason: string; until: number } | undefined {
  const key = providerCredentialStateKey(provider, credential);
  const cooldown = providerCredentialCooldowns.get(key);
  if (!cooldown) return undefined;
  if (cooldown.until > Date.now()) return cooldown;
  providerCredentialCooldowns.delete(key);
  return undefined;
}

export function providerCredentialsAllCooling(
  provider: GatewayProviderConfig,
  credentials: readonly ProviderCredentialConfig[]
): boolean {
  return credentials.length > 0 &&
    credentials.every((credential) => readProviderCredentialCooldown(provider, credential) !== undefined);
}

function cooldownMsForResponse(responseHeaders: Headers): number {
  const retryAfterMs = parseRetryAfterHeaderMs(responseHeaders.get("retry-after"));
  return retryAfterMs !== undefined && retryAfterMs > providerCredentialCooldownMs
    ? Math.min(retryAfterMs, providerCredentialCooldownMaxMs)
    : providerCredentialCooldownMs;
}

function providerCredentialFromInternalName(provider: GatewayProviderConfig, internalName: string | undefined): ProviderCredentialConfig | undefined {
  const parsed = parseProviderCredentialInternalName(internalName);
  return parsed ? findProviderCredentialBySlug(provider, parsed.credentialSlug) : undefined;
}

function incrementProviderCredentialCounters(provider: GatewayProviderConfig, credential: ProviderCredentialConfig, usage: ApiKeyLimitUsage): void {
  const rules = limitRules(credential.limits, usage);
  const now = Date.now();
  for (const rule of rules) {
    const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
    readWindowCounter(providerCredentialCounterKey(provider, credential, rule, windowStart), windowStart, rule.windowMs, now).value += rule.requested;
  }
}

function providerCredentialCounterKey(
  provider: GatewayProviderConfig,
  credential: ProviderCredentialConfig,
  rule: ApiKeyLimitRule,
  windowStart: number
): string {
  return ["provider-credential", provider.name, providerCredentialRuntimeId(provider, credential), rule.name, rule.metric, rule.windowMs, windowStart].join("|");
}

function setProviderCredentialCooldown(provider: GatewayProviderConfig, credential: ProviderCredentialConfig, cooldownMs: number, reason: string): void {
  providerCredentialCooldowns.set(providerCredentialStateKey(provider, credential), { reason, until: Date.now() + cooldownMs });
}

function clearProviderCredentialCooldown(provider: GatewayProviderConfig, credential: ProviderCredentialConfig): void {
  providerCredentialCooldowns.delete(providerCredentialStateKey(provider, credential));
}

function providerCredentialStateKey(provider: GatewayProviderConfig, credential: ProviderCredentialConfig): string {
  return `${provider.name}::${providerCredentialRuntimeId(provider, credential)}`;
}
