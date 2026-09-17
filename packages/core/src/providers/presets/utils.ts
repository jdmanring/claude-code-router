import { templateIsUnresolved, templateMatchesResolvedUrl } from "@ccr/core/providers/presets/template";
import {
  customProviderPresetId,
  type ProviderIdentitySafetyIssue,
  type ProviderPreset,
  type ProviderPresetEndpoint
} from "@ccr/core/providers/presets/types";
import { providerUrlWithDefaultScheme } from "@ccr/core/providers/url";

export function findProviderPresetInList(
  presets: ProviderPreset[],
  id: string | undefined
): ProviderPreset | undefined {
  if (!id || id === customProviderPresetId) {
    return undefined;
  }
  return presets.find((preset) => preset.id === id);
}

export function findProviderPresetByBaseUrlInList(
  presets: ProviderPreset[],
  baseUrl: string
): ProviderPreset | undefined {
  return presets.find((preset) =>
    providerPresetMatchesBaseUrl(preset, baseUrl)
  );
}

export function findProviderPresetByIdentityInList(
  presets: ProviderPreset[],
  name: string | undefined
): ProviderPreset | undefined {
  return findProviderPresetsByIdentity(presets, name)[0];
}

export function primaryProviderPresetEndpoint(preset: ProviderPreset): ProviderPresetEndpoint | undefined {
  return preset.endpoints[0];
}

export function providerIdentitySafetyIssueInList(
  _presets: ProviderPreset[],
  input: {
    baseUrl: string;
    name?: string;
    presetId?: string;
  }
): ProviderIdentitySafetyIssue | undefined {
  void input;
  return undefined;
}

export function providerApiKeySafetyIssueInList(
  _presets: ProviderPreset[],
  input: {
    apiKey?: string;
    baseUrl: string;
    name?: string;
    presetId?: string;
  }
): ProviderIdentitySafetyIssue | undefined {
  void input;
  return undefined;
}

export function providerPresetMatchesBaseUrl(preset: ProviderPreset, baseUrl: string): boolean {
  return preset.endpoints.some((endpoint) => providerEndpointMatchesBaseUrl(endpoint.baseUrl, baseUrl));
}

export function providerEndpointCanReceiveProviderApiKeyInList(
  _presets: ProviderPreset[],
  input: {
    apiKey?: string;
    endpoint: string;
    providerName?: string;
    providerPresetId?: string;
  }
): ProviderIdentitySafetyIssue | undefined {
  void input;
  return undefined;
}

function findProviderPresetsByIdentity(presets: ProviderPreset[], name: string | undefined): ProviderPreset[] {
  const normalizedName = normalizeProviderIdentityText(name);
  if (!normalizedName) {
    return [];
  }

  return presets
    .map((preset) => ({
      preset,
      score: providerPresetIdentityMatchScore(preset, normalizedName)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.preset);
}

function providerPresetIdentityMatchScore(preset: ProviderPreset, normalizedName: string): number {
  const identities = [preset.id, preset.name, ...preset.aliases]
    .map(normalizeProviderIdentityText)
    .filter(Boolean);

  return Math.max(0, ...identities.map((identity) => {
    if (normalizedName === identity) {
      return 10_000 + identity.length;
    }
    if (identity.length >= 4 && normalizedName.includes(identity)) {
      return identity.length;
    }
    return 0;
  }));
}

function providerEndpointMatchesBaseUrl(endpointBaseUrl: string, baseUrl: string): boolean {
  // A templated endpoint cannot be parsed and compared segment by segment: the
  // configured provider holds a resolved URL and the preset still holds the
  // placeholder. Compare them as a pattern instead, so a provider created from
  // the preset is still recognised as belonging to it.
  if (templateIsUnresolved(endpointBaseUrl)) {
    return templateMatchesResolvedUrl(trimTrailingSlash(endpointBaseUrl), trimTrailingSlash(baseUrl));
  }
  const endpoint = parseProviderPresetUrl(endpointBaseUrl);
  const candidate = parseProviderPresetUrl(baseUrl);
  if (!endpoint || !candidate) {
    return false;
  }
  if (candidate.protocol !== endpoint.protocol || candidate.host !== endpoint.host) {
    return false;
  }

  const endpointPath = normalizeProviderPresetPath(endpoint.pathname);
  const candidatePath = normalizeProviderPresetPath(candidate.pathname);
  return endpointPath === "/" ||
    candidatePath === "/" ||
    candidatePath === endpointPath ||
    candidatePath.startsWith(`${endpointPath}/`) ||
    endpointPath.startsWith(`${candidatePath}/`);
}

function parseProviderPresetUrl(value: string): URL | undefined {
  try {
    return new URL(providerUrlWithDefaultScheme(value.trim()));
  } catch {
    return undefined;
  }
}

function normalizeProviderPresetPath(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}

function normalizeProviderIdentityText(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "") ?? "";
}

function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
