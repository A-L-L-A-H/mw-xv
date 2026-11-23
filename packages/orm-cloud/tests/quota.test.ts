import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAAS_PLANS,
  deployViaMoonWitnessMesh,
  evaluateTenantPaasQuota,
  PaasQuotaExceededError,
  planSubscriptionEnforcement,
} from '../src/index.js';

describe('Commercial PaaS Quota & Auto-Billing Enforcement', () => {
  describe('DEFAULT_PAAS_PLANS', () => {
    it('defines starter, pro, and enterprise tiers with monotonic limits', () => {
      expect(DEFAULT_PAAS_PLANS.starter.maxApps).toBeLessThan(DEFAULT_PAAS_PLANS.pro.maxApps);
      expect(DEFAULT_PAAS_PLANS.pro.maxApps).toBeLessThan(DEFAULT_PAAS_PLANS.enterprise.maxApps);

      expect(DEFAULT_PAAS_PLANS.starter.maxRamMb).toBeLessThan(DEFAULT_PAAS_PLANS.pro.maxRamMb);
      expect(DEFAULT_PAAS_PLANS.pro.maxRamMb).toBeLessThan(DEFAULT_PAAS_PLANS.enterprise.maxRamMb);

      expect(DEFAULT_PAAS_PLANS.starter.maxCustomDomains).toBeLessThan(
        DEFAULT_PAAS_PLANS.pro.maxCustomDomains
      );
      expect(DEFAULT_PAAS_PLANS.pro.maxCustomDomains).toBeLessThan(
        DEFAULT_PAAS_PLANS.enterprise.maxCustomDomains
      );

      expect(DEFAULT_PAAS_PLANS.starter.allowDedicatedMesh).toBe(false);
      expect(DEFAULT_PAAS_PLANS.pro.allowDedicatedMesh).toBe(false);
      expect(DEFAULT_PAAS_PLANS.enterprise.allowDedicatedMesh).toBe(true);
    });
  });

  describe('evaluateTenantPaasQuota', () => {
    it('allows active tenant within plan limits', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-acme',
        plan: 'starter',
        subscriptionStatus: 'active',
        currentApps: 2,
        currentRamMb: 512,
        currentCustomDomains: 0,
        requestedApps: 1,
        requestedRamMb: 512,
        requestedCustomDomains: 1,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.code).toBeUndefined();
      expect(decision.projectedUsage).toEqual({ apps: 3, ramMb: 1024, customDomains: 1 });
      expect(decision.limits).toEqual(DEFAULT_PAAS_PLANS.starter);
    });

    it('fails closed with SUBSCRIPTION_INACTIVE when subscription is not active', () => {
      for (const status of ['suspended', 'cancelled', 'past_due', 'expired', 'unknown_state']) {
        const decision = evaluateTenantPaasQuota({
          tenantId: 'tenant-inactive',
          plan: 'pro',
          subscriptionStatus: status,
          currentApps: 0,
          currentRamMb: 0,
          currentCustomDomains: 0,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.code).toBe('SUBSCRIPTION_INACTIVE');
      }
    });

    it('fails closed with PAAS_PLAN_UNKNOWN for unrecognized plan tiers', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-unknown-plan',
        plan: 'legacy-tier',
        subscriptionStatus: 'active',
        currentApps: 0,
        currentRamMb: 0,
        currentCustomDomains: 0,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('PAAS_PLAN_UNKNOWN');
    });

    it('denies with PAAS_MAX_APPS_EXCEEDED when projected apps exceed plan limit', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-apps',
        plan: 'starter',
        subscriptionStatus: 'active',
        currentApps: DEFAULT_PAAS_PLANS.starter.maxApps,
        currentRamMb: 256,
        currentCustomDomains: 0,
        requestedApps: 1,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('PAAS_MAX_APPS_EXCEEDED');
    });

    it('denies with PAAS_MAX_RAM_EXCEEDED when projected RAM exceeds plan limit', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-ram',
        plan: 'starter',
        subscriptionStatus: 'active',
        currentApps: 1,
        currentRamMb: DEFAULT_PAAS_PLANS.starter.maxRamMb,
        currentCustomDomains: 0,
        requestedApps: 1,
        requestedRamMb: 256,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('PAAS_MAX_RAM_EXCEEDED');
    });

    it('denies with PAAS_CUSTOM_DOMAIN_EXCEEDED when projected custom domains exceed plan limit', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-domain',
        plan: 'starter',
        subscriptionStatus: 'active',
        currentApps: 1,
        currentRamMb: 256,
        currentCustomDomains: DEFAULT_PAAS_PLANS.starter.maxCustomDomains,
        requestedApps: 1,
        requestedCustomDomains: 1,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('PAAS_CUSTOM_DOMAIN_EXCEEDED');
    });

    it('enforces dedicated mesh entitlement by plan', () => {
      const denied = evaluateTenantPaasQuota({
        tenantId: 'tenant-pro',
        plan: 'pro',
        subscriptionStatus: 'active',
        currentApps: 1,
        currentRamMb: 512,
        currentCustomDomains: 1,
        requireDedicatedMesh: true,
      });

      expect(denied.allowed).toBe(false);
      expect(denied.code).toBe('PAAS_DEDICATED_MESH_NOT_ALLOWED');

      const allowed = evaluateTenantPaasQuota({
        tenantId: 'tenant-ent',
        plan: 'enterprise',
        subscriptionStatus: 'active',
        currentApps: 1,
        currentRamMb: 512,
        currentCustomDomains: 1,
        requireDedicatedMesh: true,
      });

      expect(allowed.allowed).toBe(true);
    });

    it('fails closed on negative or non-finite usage numbers', () => {
      const decision = evaluateTenantPaasQuota({
        tenantId: 'tenant-invalid',
        plan: 'enterprise',
        subscriptionStatus: 'active',
        currentApps: -1,
        currentRamMb: 0,
        currentCustomDomains: 0,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('PAAS_MAX_APPS_EXCEEDED');
    });
  });

  describe('planSubscriptionEnforcement', () => {
    it('plans deterministic stop operations when subscription transitions to suspended or cancelled', () => {
      const suspendedPlan = planSubscriptionEnforcement({
        tenantId: 'tenant-1',
        previousStatus: 'active',
        nextStatus: 'suspended',
        appIds: ['app-b', 'app-a', 'app-b', '  '],
        correlationId: 'evt-suspend-1',
        evaluatedAt: '2026-11-23T00:00:00.000Z',
      });

      expect(suspendedPlan.action).toBe('stop');
      expect(suspendedPlan.targetAppIds).toEqual(['app-a', 'app-b']);
      expect(suspendedPlan.operations).toEqual([
        { appId: 'app-a', action: 'stop' },
        { appId: 'app-b', action: 'stop' },
      ]);
      expect(suspendedPlan.audit).toEqual({
        tenantId: 'tenant-1',
        previousStatus: 'active',
        nextStatus: 'suspended',
        action: 'stop',
        reason: 'Subscription transitioned to suspended; stopping tenant apps',
        affectedAppCount: 2,
        correlationId: 'evt-suspend-1',
        evaluatedAt: '2026-11-23T00:00:00.000Z',
      });

      const cancelledPlan = planSubscriptionEnforcement({
        tenantId: 'tenant-1',
        previousStatus: 'active',
        nextStatus: 'cancelled',
        appIds: ['app-c'],
      });
      expect(cancelledPlan.action).toBe('stop');
      expect(cancelledPlan.targetAppIds).toEqual(['app-c']);
    });

    it('plans resume operations when subscription is reactivated', () => {
      const resumed = planSubscriptionEnforcement({
        tenantId: 'tenant-2',
        previousStatus: 'suspended',
        nextStatus: 'active',
        appIds: ['app-2', 'app-1'],
        evaluatedAt: '2026-11-23T01:00:00.000Z',
      });

      expect(resumed.action).toBe('resume');
      expect(resumed.targetAppIds).toEqual(['app-1', 'app-2']);
      expect(resumed.operations).toEqual([
        { appId: 'app-1', action: 'resume' },
        { appId: 'app-2', action: 'resume' },
      ]);
      expect(resumed.audit.affectedAppCount).toBe(2);
    });

    it('plans noop when subscription remains active', () => {
      const noopPlan = planSubscriptionEnforcement({
        tenantId: 'tenant-3',
        previousStatus: 'active',
        nextStatus: 'active',
        appIds: ['app-1'],
      });

      expect(noopPlan.action).toBe('noop');
      expect(noopPlan.targetAppIds).toEqual([]);
      expect(noopPlan.operations).toEqual([]);
      expect(noopPlan.audit.affectedAppCount).toBe(0);
    });
  });

  describe('deployViaMoonWitnessMesh quotaCheck integration', () => {
    it('blocks deployment before fetch when quotaCheck fails', async () => {
      const fetchMock = vi.fn<typeof fetch>();

      await expect(
        deployViaMoonWitnessMesh({
          endpoint: 'http://100.64.0.10:8080',
          token: 'test-token',
          slug: 'billing-app',
          image: 'ghcr.io/moonwitness/app:latest',
          fetchImpl: fetchMock,
          quotaCheck: {
            tenantId: 'tenant-blocked',
            plan: 'starter',
            subscriptionStatus: 'suspended',
            currentApps: 0,
            currentRamMb: 0,
            currentCustomDomains: 0,
          },
        })
      ).rejects.toThrow(PaasQuotaExceededError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('proceeds with deployment when quotaCheck passes', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            appId: 'app-123',
            slug: 'billing-app',
            status: 'deploying',
            url: 'https://billing-app.mesh.local',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

      const result = await deployViaMoonWitnessMesh({
        endpoint: 'http://100.64.0.10:8080',
        token: 'test-token',
        slug: 'billing-app',
        image: 'ghcr.io/moonwitness/app:latest',
        fetchImpl: fetchMock,
        quotaCheck: {
          tenantId: 'tenant-ok',
          plan: 'pro',
          subscriptionStatus: 'active',
          currentApps: 2,
          currentRamMb: 1024,
          currentCustomDomains: 1,
          requestedApps: 1,
          requestedRamMb: 512,
        },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.appId).toBe('app-123');
      expect(result.status).toBe('deploying');
    });

    it('preserves backwards compatibility when quotaCheck is omitted', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ appId: 'legacy-1', slug: 'legacy', status: 'running' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const result = await deployViaMoonWitnessMesh({
        endpoint: 'http://100.64.0.10:8080',
        token: 'test-token',
        slug: 'legacy',
        image: 'nginx:alpine',
        fetchImpl: fetchMock,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.appId).toBe('legacy-1');
    });
  });
});
