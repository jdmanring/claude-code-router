import type { ProviderPreset, ProviderPresetVariable } from "@ccr/core/providers/presets/types";

/**
 * Endpoint templating for provider presets.
 *
 * Some providers put an identifier inside the URL itself rather than in a
 * header: Cloudflare carries an account id, Vertex a project and a region,
 * Bedrock a region. A preset writes `{key}` where that value belongs and
 * declares the key under `variables`; the add-provider form collects it and
 * stores a resolved URL.
 *
 * Nothing but the preset ever holds a placeholder. That keeps the rest of the
 * system unchanged, with one exception: matching a configured provider back to
 * the preset it came from has to compare a resolved URL against a template,
 * which `templateMatchesResolvedUrl` does.
 */

// A key is a conservative identifier so a literal brace in a URL is never
// mistaken for a placeholder.
const placeholderPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Keys the value refers to, in first-seen order and without duplicates. */
export function templateVariableKeys(value: string | undefined): string[] {
  if (!value) return [];
  const keys: string[] = [];
  for (const match of value.matchAll(placeholderPattern)) {
    const key = match[1];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** True when the value still carries at least one placeholder. */
export function templateIsUnresolved(value: string | undefined): boolean {
  return templateVariableKeys(value).length > 0;
}

/** Every key any of the preset's endpoints refers to. */
export function presetTemplateKeys(preset: ProviderPreset): string[] {
  const keys: string[] = [];
  for (const endpoint of preset.endpoints) {
    for (const key of templateVariableKeys(endpoint.baseUrl)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * Substitutes declared values. A key with no value, or an empty one, is left
 * as a placeholder so callers can tell "not filled in yet" from "filled in
 * with nothing" and refuse to store a half-resolved URL.
 */
export function resolveTemplate(value: string, values: Record<string, string | undefined>): string {
  return value.replace(placeholderPattern, (placeholder, key: string) => {
    const supplied = values[key]?.trim();
    return supplied ? supplied : placeholder;
  });
}

/** The variable a key declares, if the preset declares it. */
export function presetVariable(preset: ProviderPreset, key: string): ProviderPresetVariable | undefined {
  return preset.variables?.find((variable) => variable.key === key);
}

/**
 * Why a value is not acceptable for a variable, or undefined when it is.
 * Returned as a reason rather than a boolean so the form can say what is wrong.
 */
export function variableValueIssue(variable: ProviderPresetVariable, value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return `${variable.label} is required.`;
  // A value carrying a slash or a brace would silently reshape the URL.
  if (/[/\\{}\s]/.test(trimmed)) return `${variable.label} cannot contain spaces, slashes or braces.`;
  if (variable.pattern) {
    let expression: RegExp;
    try {
      expression = new RegExp(`^(?:${variable.pattern})$`);
    } catch {
      // A preset with an unusable pattern must not block the person.
      return undefined;
    }
    if (!expression.test(trimmed)) return `${variable.label} is not in the expected format.`;
  }
  return undefined;
}

/**
 * Faults in the preset itself rather than in what someone typed: a placeholder
 * with no declaration, or a declaration nothing refers to. Both are silent
 * otherwise, the first producing a URL that can never resolve and the second a
 * field that changes nothing.
 */
export function presetTemplateIssues(preset: ProviderPreset): string[] {
  const used = presetTemplateKeys(preset);
  const declared = (preset.variables ?? []).map((variable) => variable.key);
  const issues: string[] = [];
  for (const key of used) {
    if (!declared.includes(key)) issues.push(`${preset.id}: endpoint uses {${key}}, which no variable declares`);
  }
  for (const key of declared) {
    if (!used.includes(key)) issues.push(`${preset.id}: variable ${key} is declared but no endpoint uses it`);
  }
  return issues;
}

/**
 * Whether a resolved URL could have come from this template. Used to show a
 * configured provider under the preset it was created from, which plain string
 * comparison cannot do once the placeholders are gone.
 *
 * A placeholder matches one path or host segment, never a separator, so
 * `.../accounts/{accountId}/ai` cannot be satisfied by a value carrying its own
 * slashes.
 */
export function templateMatchesResolvedUrl(template: string, resolved: string): boolean {
  if (!templateIsUnresolved(template)) return template === resolved;
  let pattern = "";
  let lastIndex = 0;
  for (const match of template.matchAll(placeholderPattern)) {
    pattern += escapeRegExp(template.slice(lastIndex, match.index));
    pattern += "[^/?#]+";
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  pattern += escapeRegExp(template.slice(lastIndex));
  try {
    return new RegExp(`^${pattern}$`).test(resolved);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reads values back out of a resolved URL, so editing a provider created from a
 * template shows what was filled in rather than an empty form. Returns nothing
 * when the URL did not come from this template.
 */
export function extractTemplateValues(template: string, resolved: string): Record<string, string> | undefined {
  const keys = templateVariableKeys(template);
  if (keys.length === 0) return template === resolved ? {} : undefined;
  let pattern = "";
  let lastIndex = 0;
  for (const match of template.matchAll(placeholderPattern)) {
    pattern += escapeRegExp(template.slice(lastIndex, match.index));
    pattern += "([^/?#]+)";
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  pattern += escapeRegExp(template.slice(lastIndex));
  let found: RegExpExecArray | null;
  try {
    found = new RegExp(`^${pattern}$`).exec(resolved);
  } catch {
    return undefined;
  }
  if (!found) return undefined;
  const values: Record<string, string> = {};
  keys.forEach((key, index) => {
    values[key] = found[index + 1] ?? "";
  });
  return values;
}
