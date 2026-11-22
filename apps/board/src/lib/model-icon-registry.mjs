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
});

export function modelIconName(model) {
  return MODEL_ICON_NAMES[model] ?? (model.startsWith('auth.') ? 'security' : 'model');
}
