/**
 * Domain logic for the content factory: template rendering, variable
 * validation, and status-transition guards. Pure functions only — no I/O.
 */

export const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface TemplateStructure {
  sections: Array<{
    title: string;
    body: string;
  }>;
}

export interface RenderResult {
  rendered: string;
  missingVariables: string[];
}

export function extractTemplateVariables(structure: unknown): string[] {
  if (!isTemplateStructure(structure)) return [];
  const names = new Set<string>();
  for (const section of structure.sections) {
    for (const text of [section.title, section.body]) {
      for (const match of text.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

export function isTemplateStructure(structure: unknown): structure is TemplateStructure {
  if (
    typeof structure !== 'object' ||
    structure === null ||
    !Array.isArray((structure as TemplateStructure).sections)
  ) {
    return false;
  }
  return (structure as TemplateStructure).sections.every(
    (section) =>
      typeof section === 'object' &&
      section !== null &&
      typeof section.title === 'string' &&
      typeof section.body === 'string'
  );
}

export function validateVariables(
  schema: unknown,
  provided: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  if (typeof schema !== 'object' || schema === null) {
    return { valid: true, missing: [] };
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (typeof properties !== 'object' || properties === null) {
    return { valid: true, missing: [] };
  }
  const required = Array.isArray((schema as { required?: unknown }).required)
    ? ((schema as { required: unknown[] }).required as unknown[]).filter(
        (v): v is string => typeof v === 'string'
      )
    : [];
  const missing = required.filter(
    (name) => provided[name] === undefined || provided[name] === null
  );
  return { valid: missing.length === 0, missing };
}

export function renderTemplate(
  structure: TemplateStructure,
  variables: Record<string, unknown>
): RenderResult {
  const missingVariables = new Set<string>();
  const renderText = (text: string): string =>
    text.replace(TEMPLATE_VARIABLE_PATTERN, (_full, name: string) => {
      const value = variables[name];
      if (value === undefined || value === null) {
        missingVariables.add(name);
        return '';
      }
      return String(value);
    });

  const rendered = structure.sections
    .map((section) => `# ${renderText(section.title)}\n\n${renderText(section.body)}`)
    .join('\n\n');

  return { rendered, missingVariables: [...missingVariables] };
}

const TEMPLATE_TRANSITIONS: Record<string, string[]> = {
  draft: ['review', 'archived'],
  review: ['approved', 'draft'],
  approved: ['archived', 'review'],
  archived: [],
};

export function canTransitionTemplateStatus(from: string, to: string): boolean {
  return TEMPLATE_TRANSITIONS[from]?.includes(to) ?? false;
}

const ASSET_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'failed'],
  processing: ['ready', 'failed'],
  ready: [],
  failed: ['pending'],
};

export function canTransitionAssetStatus(from: string, to: string): boolean {
  return ASSET_TRANSITIONS[from]?.includes(to) ?? false;
}

const CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
  planned: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransitionCampaignStatus(from: string, to: string): boolean {
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}
