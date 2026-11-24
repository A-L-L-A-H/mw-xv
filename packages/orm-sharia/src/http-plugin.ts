import type { Knex } from 'knex';
import {
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequestBase,
  type AuthenticatedContext,
} from '@moonwitness/orm';
import {
  ShariaContract,
  ZakatAssessment,
  ProfitSharingDistribution,
  WaqfAsset,
  HalalComplianceAudit,
} from './models/index.js';
import { Company, Partner, User, ConfigParameter } from '@moonwitness/orm-base';
import {
  calculateZakat,
  distributeProfitSharing,
  validateShariaContract,
  computeWaqfMerkle,
  appendWaqfMerkleEvent,
  type ZakatCalculationInput,
  type ZakatCalculationResult,
  type ProfitSharingInput,
  type ProfitSharingResult,
  type ContractValidationInput,
  type ContractValidationResult,
  type WaqfMerkleInput,
  type WaqfMerkleResult,
} from './sharia-engine.js';

function requireDb(req: AddonHttpRequestBase): Knex {
  const app = req as unknown as { server?: { db?: Knex } };
  const db = app.server?.db;
  if (!db) throw new Error('Database not available on request context');
  return db;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const shariaHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/sharia/zakat/calculate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const {
      assessmentDate,
      hijriYear,
      zakatType,
      assetCategory,
      grossAssetsMinor,
      deductibleLiabilitiesMinor,
      nisabGoldPricePerGramMinor,
      zakatRateBps,
    } = req.body;

    if (
      !assessmentDate ||
      !hijriYear ||
      !zakatType ||
      !assetCategory ||
      grossAssetsMinor === undefined ||
      deductibleLiabilitiesMinor === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error:
          'assessmentDate, hijriYear, zakatType, assetCategory, grossAssetsMinor, deductibleLiabilitiesMinor are required',
      });
    }

    const validTypes = [
      'maal',
      'fitrah',
      'profession',
      'trade',
      'agriculture',
      'livestock',
      'rikaz',
    ];
    const validCategories = [
      'gold',
      'silver',
      'cash',
      'receivables',
      'inventory',
      'investment',
      'property',
      'other',
    ];
    if (!validTypes.includes(zakatType as string)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid zakatType. Must be one of: ${validTypes.join(', ')}`,
      });
    }
    if (!validCategories.includes(assetCategory as string)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid assetCategory. Must be one of: ${validCategories.join(', ')}`,
      });
    }

    try {
      const input: ZakatCalculationInput = {
        companyId: auth.companyId,
        assessmentDate: assessmentDate as string,
        hijriYear: Number(hijriYear),
        zakatType: zakatType as ZakatCalculationInput['zakatType'],
        assetCategory: assetCategory as ZakatCalculationInput['assetCategory'],
        grossAssetsMinor: Number(grossAssetsMinor),
        deductibleLiabilitiesMinor: Number(deductibleLiabilitiesMinor),
        nisabGoldPricePerGramMinor:
          nisabGoldPricePerGramMinor !== undefined ? Number(nisabGoldPricePerGramMinor) : undefined,
        zakatRateBps: zakatRateBps !== undefined ? Number(zakatRateBps) : undefined,
      };

      const result = await calculateZakat(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/sharia/contracts/validate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const {
      type,
      assetValueMinor,
      profitMarginMinor,
      profitSharingRatio,
      financingAmountMinor,
      tenorMonths,
      dsnMuiReference,
      ribaFreeConfirmed,
      ghararFreeConfirmed,
    } = req.body;

    if (
      !type ||
      assetValueMinor === undefined ||
      !dsnMuiReference ||
      ribaFreeConfirmed === undefined ||
      ghararFreeConfirmed === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error:
          'type, assetValueMinor, dsnMuiReference, ribaFreeConfirmed, ghararFreeConfirmed are required',
      });
    }

    const validTypes = ['murabahah', 'mudharabah', 'musyarakah', 'ijarah'];
    if (!validTypes.includes(type as string)) {
      return reply
        .code(400)
        .send({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    try {
      const input: ContractValidationInput = {
        type: type as ContractValidationInput['type'],
        assetValueMinor: Number(assetValueMinor),
        profitMarginMinor: profitMarginMinor !== undefined ? Number(profitMarginMinor) : undefined,
        profitSharingRatio: profitSharingRatio as string | undefined,
        financingAmountMinor:
          financingAmountMinor !== undefined ? Number(financingAmountMinor) : undefined,
        tenorMonths: tenorMonths !== undefined ? Number(tenorMonths) : undefined,
        dsnMuiReference: dsnMuiReference as string,
        ribaFreeConfirmed: Boolean(ribaFreeConfirmed),
        ghararFreeConfirmed: Boolean(ghararFreeConfirmed),
      };

      const result = validateShariaContract(input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/sharia/profit-sharing/post', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const {
      contractId,
      periodStart,
      periodEnd,
      grossProfitMinor,
      operatingExpensesMinor,
      distributionDate,
      notes,
    } = req.body;

    if (
      !contractId ||
      !periodStart ||
      !periodEnd ||
      grossProfitMinor === undefined ||
      operatingExpensesMinor === undefined ||
      !distributionDate
    ) {
      return reply.code(400).send({
        success: false,
        error:
          'contractId, periodStart, periodEnd, grossProfitMinor, operatingExpensesMinor, distributionDate are required',
      });
    }

    try {
      const input: ProfitSharingInput = {
        contractId: Number(contractId),
        periodStart: periodStart as string,
        periodEnd: periodEnd as string,
        grossProfitMinor: Number(grossProfitMinor),
        operatingExpensesMinor: Number(operatingExpensesMinor),
        distributionDate: distributionDate as string,
        approvedById: auth.userId,
        notes: notes as string | undefined,
      };

      const result = await distributeProfitSharing(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/sharia/waqf/merkle-verify', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { assetId, trail } = req.body;

    if (!assetId || !Array.isArray(trail)) {
      return reply
        .code(400)
        .send({ success: false, error: 'assetId and trail array are required' });
    }

    try {
      const input: WaqfMerkleInput = {
        assetId: Number(assetId),
        trail: trail as WaqfMerkleInput['trail'],
      };

      const result = await computeWaqfMerkle(requireDb(req), input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/sharia/waqf/merkle-append', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { assetId, event, timestamp, valueMinor, description } = req.body;

    if (!assetId || !event || !timestamp || valueMinor === undefined || !description) {
      return reply.code(400).send({
        success: false,
        error: 'assetId, event, timestamp, valueMinor, description are required',
      });
    }

    const validEvents = [
      'acquisition',
      'valuation',
      'yield_distribution',
      'transfer',
      'disbursement',
    ];
    if (!validEvents.includes(event as string)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid event. Must be one of: ${validEvents.join(', ')}`,
      });
    }

    try {
      const result = await appendWaqfMerkleEvent(requireDb(req), Number(assetId), {
        event: event as WaqfMerkleInput['trail'][number]['event'],
        timestamp: timestamp as string,
        valueMinor: Number(valueMinor),
        description: description as string,
      });
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = shariaHttpPlugin;
