import type { FastifyPluginAsync } from 'fastify';
import { Registry } from '@moonwitness/orm';
import { Company, CompanyMembership, type User } from '@moonwitness/orm-base';
import { canAccess } from '../auth/policy.js';
import {
  actionRegistry,
  getRegistryGeneration,
  menuRegistry,
} from '../addons/action-menu-registry.js';
import { config } from '../config/env.js';

export interface BootstrapRoutesOptions {
  readonly activeAddons?: readonly string[];
}

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> = async (
  fastify,
  options
) => {
  const activeAddonList = options.activeAddons ?? [];
  const activeAddonSet = new Set(activeAddonList);

  fastify.get(
    '/api/app/bootstrap',
    {
      schema: {
        tags: ['ORM'],
        summary:
          'Return authenticated user profile, active company, hierarchical menus, authorized actions, and models metadata',
      },
    },
    async (req, reply) => {
      if (!req.auth) {
        return reply.code(401).send({
          success: false,
          error: 'Authentication required',
          code: 'UNAUTHORIZED',
          requestId: req.id,
        });
      }

      const UserModel = req.env.get<typeof User>('base.user');
      const user = (await UserModel.query()
        .findById(req.auth.userId)
        .withGraphFetched('partner')) as unknown as
        | {
            id: number;
            login: string;
            role: string;
            partner_id?: number;
            partner?: { id: number; name?: string; email?: string };
          }
        | undefined;

      const membershipTable = CompanyMembership.tableName;
      const companyTable = Company.tableName;
      const companies = (await CompanyMembership.query()
        .join(companyTable, `${membershipTable}.company_id`, `${companyTable}.id`)
        .where(`${membershipTable}.user_id`, req.auth.userId)
        .where(`${membershipTable}.active`, true)
        .where(`${companyTable}.active`, true)
        .orderBy(`${membershipTable}.is_default`, 'desc')
        .orderBy(`${companyTable}.id`, 'asc')
        .select(
          `${companyTable}.id as id`,
          `${companyTable}.name as name`,
          `${membershipTable}.is_default as is_default`
        )) as unknown as { id: number; name: string; is_default: boolean | number }[];

      const activeCompany =
        companies.find((c) => c.id === req.auth?.companyId) ?? companies[0] ?? null;

      const accessibleModels = Array.from(Registry.getAll().keys())
        .filter((name) => canAccess(req.auth?.role, name, 'read', req.auth?.groupPermissions))
        .map((name) => ({
          name,
          permissions: {
            read: true,
            create: canAccess(req.auth?.role, name, 'create', req.auth?.groupPermissions),
            write: canAccess(req.auth?.role, name, 'write', req.auth?.groupPermissions),
            unlink: canAccess(req.auth?.role, name, 'unlink', req.auth?.groupPermissions),
          },
        }));

      const menus = menuRegistry.buildTreeForAuth(req.auth, {
        includeDevelopment: config.env !== 'production',
        activeAddons: activeAddonSet.size > 0 ? activeAddonSet : undefined,
      });

      const actions = actionRegistry.listForAuth(req.auth).map((action) => ({
        id: action.id,
        name: action.name,
        type: action.type,
        model: action.model,
        target: action.target,
        domain: action.domain,
        context: action.context,
        viewModes: action.viewModes,
        tag: action.tag,
      }));

      return {
        success: true,
        requestId: req.id,
        data: {
          registryGeneration: getRegistryGeneration(),
          user: {
            id: req.auth.userId,
            login: user?.login ?? null,
            name: user?.partner?.name ?? user?.login ?? null,
            email: user?.partner?.email ?? null,
            role: req.auth.role,
            partnerId: req.auth.partnerId ?? null,
            companyId: req.auth.companyId ?? null,
          },
          activeCompany: activeCompany ? { id: activeCompany.id, name: activeCompany.name } : null,
          companies: companies.map((c) => ({
            id: c.id,
            name: c.name,
            isDefault: Boolean(c.is_default),
          })),
          addons: activeAddonList,
          menus,
          actions,
          models: accessibleModels,
          skin: {
            theme: 'default',
          },
        },
      };
    }
  );
};
