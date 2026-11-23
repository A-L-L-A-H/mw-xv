export const MODEL_ICON_NAMES = Object.freeze({
  'base.partner': 'partner',
  'base.company': 'company',
  'base.user': 'users',
  'base.activity': 'activity',
  'base.attachment': 'attachment',
  'base.tag': 'tag',
  'base.country': 'globe',
  'base.country_state': 'map-pin',
  'base.bank': 'bank',
  'base.partner_bank': 'credit-card',
  'base.sequence': 'hash',
  'base.currency': 'currency',
  'base.language': 'language',
  'organization.team': 'team',
  'auth.refresh_token': 'key',
} as const);

export type ModelIconName = (typeof MODEL_ICON_NAMES)[keyof typeof MODEL_ICON_NAMES];

export function modelIconName(model: string): ModelIconName {
  return (
    MODEL_ICON_NAMES[model as keyof typeof MODEL_ICON_NAMES] ??
    (model.startsWith('auth.') ? 'security' : 'model')
  );
}
