import type { GatewayProviderProtocol, ProviderAccountConfig } from "@ccr/core/contracts/app";

export type ProviderPresetEndpoint = {
  baseUrl: string;
  label?: string;
  protocols: GatewayProviderProtocol[];
  websiteUrl?: string;
};

export type ProviderOfficialKeyPattern = {
  flags?: string;
  source: string;
};

/**
 * A value the person must supply before a preset's endpoint is usable, such as
 * the account identifier Cloudflare embeds in its path, or a Vertex project and
 * region. The endpoint carries `{key}` where the value belongs.
 *
 * A template exists only inside a preset. A configured provider always stores a
 * resolved URL, so nothing downstream of the add-provider form has to reason
 * about placeholders.
 */
export type ProviderPresetVariable = {
  /** Shown under the field: where to find the value. */
  description?: string;
  /** Matches the `{key}` written in the endpoint. */
  key: string;
  /** Field label. */
  label: string;
  /** Source of a regular expression the value must match in full. */
  pattern?: string;
  /** Example value shown in the empty field. */
  placeholder?: string;
};

export type ProviderPreset = {
  account?: ProviderAccountConfig;
  aliases: string[];
  defaultModelDisplayNames?: Record<string, string>;
  defaultModels?: string[];
  endpoints: ProviderPresetEndpoint[];
  id: string;
  name: string;
  officialApiKeyPatterns?: ProviderOfficialKeyPattern[];
  /**
   * Values the endpoints need before they resolve. Every `{key}` appearing in
   * an endpoint must be declared here, which `presetTemplateIssues` enforces.
   */
  variables?: ProviderPresetVariable[];
  websiteUrl?: string;
};

export type ProviderIdentitySafetyIssue = {
  message: string;
  preset: ProviderPreset;
};

export const customProviderPresetId = "custom";

export const defaultProviderAccountConfig: ProviderAccountConfig = {
  connectors: [],
  enabled: false
};

export const standardProviderAccountConfig: ProviderAccountConfig = {
  connectors: [
    {
      auth: "provider-api-key",
      type: "standard"
    }
  ],
  enabled: true
};
