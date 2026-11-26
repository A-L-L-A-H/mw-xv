import { Company, CompanyMembership } from '@moonwitness/orm-base';

export async function hasCompanyAccess(
  userId: number,
  companyId: number,
  role: string
): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId < 1) return false;
  if (!Number.isSafeInteger(companyId) || companyId < 1) return false;
  const company = await Company.query().findOne({ id: companyId, active: true });
  if (!company) return false;
  const membership = await CompanyMembership.query().findOne({
    user_id: userId,
    company_id: companyId,
    active: true,
  });
  if (membership) return true;
  if (role === 'system') return true;
  return false;
}
