import { describe, expect, it } from 'vitest';
import {
  mapFrameworks,
  testControl,
  calculateRiskScore,
  verifyEvidence,
  assessComplianceMaturity,
  trackRemediations,
} from '../src/index.js';
import type { Knex } from 'knex';

const DB_MOCK = {} as unknown as Knex;

describe('Compliance Engine', () => {
  describe('mapFrameworks', () => {
    it('maps multiple frameworks to controls with coverage analysis', async () => {
      const result = await mapFrameworks(DB_MOCK, {
        companyId: 1,
        frameworkIds: ['ISO-27001', 'SOC2', 'GDPR'],
        includeControls: true,
        includeGaps: true,
      });

      expect(result.mappedFrameworks).toHaveLength(3);
      expect(result.totalControls).toBeGreaterThan(0);
      expect(result.coverageMap).toBeDefined();
      expect(result.gaps).toBeDefined();
    });

    it('returns empty coverage when no frameworks provided', async () => {
      const result = await mapFrameworks(DB_MOCK, {
        companyId: 1,
        frameworkIds: [],
      });

      expect(result.mappedFrameworks).toHaveLength(0);
      expect(result.totalControls).toBe(0);
      expect(result.gaps).toHaveLength(0);
    });

    it('identifies overlapping controls across frameworks', async () => {
      const result = await mapFrameworks(DB_MOCK, {
        companyId: 1,
        frameworkIds: ['ISO-27001', 'SOC2'],
        includeOverlaps: true,
      });

      expect(result.overlappingControls).toBeDefined();
      expect(Array.isArray(result.overlappingControls)).toBe(true);
    });
  });

  describe('testControl', () => {
    it('passes control test when evidence meets requirements', async () => {
      const result = await testControl(DB_MOCK, {
        companyId: 1,
        controlId: 'ISO27001-A.5.1',
        evidence: [
          { type: 'document', reference: 'POL-INFOSEC-001', hash: 'abc123', collectedDate: '2026-03-10' },
          { type: 'approval_record', reference: 'APPROVAL-2025-12-15', hash: 'def456', collectedDate: '2025-12-15' },
        ],
        testProcedure: 'Review policy documentation, verify management approval, confirm publication and communication to staff',
      });

      expect(result.passed).toBe(true);
      expect(result.evidenceReviewed).toBe(2);
      expect(result.findings).toHaveLength(0);
    });

    it('fails control test when required evidence missing', async () => {
      const result = await testControl(DB_MOCK, {
        companyId: 1,
        controlId: 'SOC2-CC6.1',
        evidence: [
          { type: 'access_control_matrix', reference: 'ACM-2026-Q1', hash: 'abc123', collectedDate: '2026-03-15' },
        ],
        testProcedure: 'Review access control lists, test authentication mechanisms, verify logging and monitoring',
      });

      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toContain('authentication_logs');
      expect(result.missingEvidence).toContain('monitoring_alerts');
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('handles automated control testing with continuous monitoring', async () => {
      const result = await testControl(DB_MOCK, {
        companyId: 1,
        controlId: 'GDPR-ART32',
        evidence: [
          { type: 'log', reference: 'encryption_scan_20260315', hash: 'enc123', collectedDate: '2026-03-15', automated: true },
          { type: 'log', reference: 'access_review_20260315', hash: 'acc456', collectedDate: '2026-03-15', automated: true },
        ],
        testProcedure: 'Review encryption, pseudonymisation, access controls, incident response procedures',
        automationLevel: 'fully_automated',
      });

      expect(result.passed).toBe(true);
      expect(result.automated).toBe(true);
      expect(result.continuousMonitoring).toBe(true);
    });
  });

  describe('calculateRiskScore', () => {
    it('computes critical risk score (20-25) for critical severity with high likelihood', () => {
      const result = calculateRiskScore({
        severity: 'critical',
        likelihood: 'almost_certain',
        impact: 'catastrophic',
      });

      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.score).toBeLessThanOrEqual(25);
      expect(result.rating).toBe('critical');
    });

    it('computes high risk score (15-19) for high severity with likely likelihood', () => {
      const result = calculateRiskScore({
        severity: 'high',
        likelihood: 'likely',
        impact: 'major',
      });

      expect(result.score).toBeGreaterThanOrEqual(15);
      expect(result.score).toBeLessThanOrEqual(19);
      expect(result.rating).toBe('high');
    });

    it('computes medium risk score (10-14) for medium severity with possible likelihood', () => {
      const result = calculateRiskScore({
        severity: 'medium',
        likelihood: 'possible',
        impact: 'moderate',
      });

      expect(result.score).toBeGreaterThanOrEqual(10);
      expect(result.score).toBeLessThanOrEqual(14);
      expect(result.rating).toBe('medium');
    });

    it('computes low risk score (5-9) for low severity with unlikely likelihood', () => {
      const result = calculateRiskScore({
        severity: 'low',
        likelihood: 'unlikely',
        impact: 'minor',
      });

      expect(result.score).toBeGreaterThanOrEqual(5);
      expect(result.score).toBeLessThanOrEqual(9);
      expect(result.rating).toBe('low');
    });

    it('computes informational risk score (1-4) for informational severity', () => {
      const result = calculateRiskScore({
        severity: 'informational',
        likelihood: 'rare',
        impact: 'negligible',
      });

      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(4);
      expect(result.rating).toBe('informational');
    });
  });

  describe('verifyEvidence', () => {
    it('accepts valid evidence with matching hash and non-expired', async () => {
      const result = await verifyEvidence(DB_MOCK, {
        companyId: 1,
        evidenceId: 'EVD-ISO27001-2026-Q1-001',
        expectedHash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        verifyExpiry: true,
      });

      expect(result.verified).toBe(true);
      expect(result.hashMatch).toBe(true);
      expect(result.expired).toBe(false);
      expect(result.integrityCheck).toBe('passed');
    });

    it('rejects evidence with hash mismatch indicating tampering', async () => {
      const result = await verifyEvidence(DB_MOCK, {
        companyId: 1,
        evidenceId: 'EVD-SOC2-2026-H1-001',
        expectedHash: 'wronghash123456789012345678901234567890123456789012345678901234567890',
        verifyExpiry: false,
      });

      expect(result.verified).toBe(false);
      expect(result.hashMatch).toBe(false);
      expect(result.integrityCheck).toBe('failed');
      expect(result.tamperingDetected).toBe(true);
    });

    it('flags expired evidence when expiry verification enabled', async () => {
      const result = await verifyEvidence(DB_MOCK, {
        companyId: 1,
        evidenceId: 'EVD-GDPR-2026-ANNUAL-001',
        expectedHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        verifyExpiry: true,
      });

      expect(result.verified).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.hashMatch).toBe(true);
    });
  });

  describe('assessComplianceMaturity', () => {
    it('returns optimizing maturity for score >= 90 with continuous improvement', async () => {
      const result = await assessComplianceMaturity(DB_MOCK, {
        companyId: 1,
        frameworkId: 'ISO-27001',
        assessmentDate: '2026-03-15',
        controlsTested: 25,
        controlsPassed: 23,
        controlsFailed: 1,
        controlsNotApplicable: 1,
        criticalFindings: 0,
        highFindings: 1,
        mediumFindings: 3,
        lowFindings: 2,
      });

      expect(result.maturityLevel).toBe('managed');
      expect(result.overallScore).toBeGreaterThanOrEqual(80);
      expect(result.improvementTrend).toBeDefined();
    });

    it('returns defined maturity for score 70-89 with documented processes', async () => {
      const result = await assessComplianceMaturity(DB_MOCK, {
        companyId: 1,
        frameworkId: 'GDPR',
        assessmentDate: '2026-02-15',
        controlsTested: 18,
        controlsPassed: 16,
        controlsFailed: 2,
        controlsNotApplicable: 0,
        criticalFindings: 1,
        highFindings: 2,
        mediumFindings: 4,
        lowFindings: 1,
      });

      expect(result.maturityLevel).toBe('defined');
      expect(result.overallScore).toBeGreaterThanOrEqual(70);
      expect(result.overallScore).toBeLessThan(90);
    });

    it('returns initial maturity for score < 50 with ad-hoc processes', async () => {
      const result = await assessComplianceMaturity(DB_MOCK, {
        companyId: 1,
        frameworkId: 'PCI-DSS',
        assessmentDate: '2026-06-15',
        controlsTested: 12,
        controlsPassed: 4,
        controlsFailed: 8,
        controlsNotApplicable: 0,
        criticalFindings: 3,
        highFindings: 5,
        mediumFindings: 2,
        lowFindings: 1,
      });

      expect(result.maturityLevel).toBe('initial');
      expect(result.overallScore).toBeLessThan(50);
      expect(result.recommendations).toContain('Establish formal compliance program');
    });
  });

  describe('trackRemediations', () => {
    it('tracks overdue remediations with escalation alerts', async () => {
      const result = await trackRemediations(DB_MOCK, {
        companyId: 1,
        includeOverdue: true,
        includePending: true,
        escalationThresholdDays: 30,
      });

      expect(result.totalRemediations).toBeGreaterThanOrEqual(0);
      expect(result.overdueRemediations).toBeDefined();
      expect(result.escalationAlerts).toBeDefined();
      expect(Array.isArray(result.byStatus)).toBe(true);
    });

    it('calculates remediation velocity and aging metrics', async () => {
      const result = await trackRemediations(DB_MOCK, {
        companyId: 1,
        includeMetrics: true,
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
      });

      expect(result.velocity).toBeDefined();
      expect(result.averageTimeToResolve).toBeDefined();
      expect(result.agingBuckets).toBeDefined();
      expect(result.byPriority).toBeDefined();
    });

    it('identifies stale remediations exceeding target completion dates', async () => {
      const result = await trackRemediations(DB_MOCK, {
        companyId: 1,
        includeStale: true,
        staleThresholdDays: 60,
      });

      expect(result.staleRemediations).toBeDefined();
      expect(result.staleRemediations.every((r: any) => r.daysOverdue > 60)).toBe(true);
    });
  });
});