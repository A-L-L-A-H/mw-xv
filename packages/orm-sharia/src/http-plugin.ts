import {
  requireAddonDb,
  requireAuth,
  type AddonHttpPlugin,
  type AddonHttpReply,
  type AddonHttpRequest,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  calculateZakat,
  distributeProfitSharing,
  validateShariaContract,
  computeWaqfMerkle,
  appendWaqfMerkleEvent,
  type ContractValidationInput,
  type WaqfMerkleInput,
  type ZakatCalculationInput,
} from './sharia-engine.js';

const ZAKAT_TYPES = ['maal', 'fitrah', 'profession', 'trade', 'agriculture', 'livestock', 'rikaz'];
const ASSET_CATEGORIES = [
  'gold',
  'silver',
  'cash',
  'receivables',
  'inventory',
  'investment',
  'property',
  'other',
];
const CONTRACT_TYPES = ['murabahah', 'mudharabah', 'musyarakah', 'ijarah'];
const WAQF_EVENTS = ['acquisition', 'valuation', 'yield_distribution', 'transfer', 'disbursement'];

type HttpReq = AddonHttpRequest;
type HttpReply = AddonHttpReply;

function missingKeys(body: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => body[k] === undefined || body[k] === '' || body[k] === null);
}

function optionalNum(value: unknown): number | undefined {
  return value === undefined ? undefined : Number(value);
}

async function handleZakatCalculate(req: HttpReq, reply: HttpReply) {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!isRecord(req.body)) {
    return reply.code(400).send({ success: false, error: 'Invalid payload: body must be object' });
  }
  const required = [
    'assessmentDate',
    'hijriYear',
    'zakatType',
    'assetCategory',
    'grossAssetsMinor',
    'deductibleLiabilitiesMinor',
  ];
  if (missingKeys(req.body, required).length > 0) {
    return reply.code(400).send({ success: false, error: 'Missing required zakat fields' });
  }
  if (
    !ZAKAT_TYPES.includes(String(req.body.zakatType)) ||
    !ASSET_CATEGORIES.includes(String(req.body.assetCategory))
  ) {
    return reply.code(400).send({ success: false, error: 'Invalid zakatType or assetCategory' });
  }
  try {
    const result = await calculateZakat(requireAddonDb(req), {
      companyId: auth.companyId,
      assessmentDate: String(req.body.assessmentDate),
      hijriYear: Number(req.body.hijriYear),
      zakatType: req.body.zakatType as ZakatCalculationInput['zakatType'],
      assetCategory: req.body.assetCategory as ZakatCalculationInput['assetCategory'],
      grossAssetsMinor: Number(req.body.grossAssetsMinor),
      deductibleLiabilitiesMinor: Number(req.body.deductibleLiabilitiesMinor),
      nisabGoldPricePerGramMinor: optionalNum(req.body.nisabGoldPricePerGramMinor),
      zakatRateBps: optionalNum(req.body.zakatRateBps),
    });
    return reply.code(200).send({ success: true, data: result });
  } catch (err: unknown) {
    return reply.code(400).send({ success: false, error: (err as Error).message });
  }
}

async function handleContractValidate(req: HttpReq, reply: HttpReply) {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!isRecord(req.body)) {
    return reply.code(400).send({ success: false, error: 'Invalid payload: body must be object' });
  }
  const required = [
    'type',
    'assetValueMinor',
    'dsnMuiReference',
    'ribaFreeConfirmed',
    'ghararFreeConfirmed',
  ];
  if (missingKeys(req.body, required).length > 0) {
    return reply.code(400).send({ success: false, error: 'Missing required contract fields' });
  }
  if (!CONTRACT_TYPES.includes(String(req.body.type))) {
    return reply.code(400).send({ success: false, error: 'Invalid contract type' });
  }
  const data = validateShariaContract({
    type: req.body.type as ContractValidationInput['type'],
    assetValueMinor: Number(req.body.assetValueMinor),
    profitMarginMinor: optionalNum(req.body.profitMarginMinor),
    profitSharingRatio: req.body.profitSharingRatio as string | undefined,
    financingAmountMinor: optionalNum(req.body.financingAmountMinor),
    tenorMonths: optionalNum(req.body.tenorMonths),
    dsnMuiReference: String(req.body.dsnMuiReference),
    ribaFreeConfirmed: Boolean(req.body.ribaFreeConfirmed),
    ghararFreeConfirmed: Boolean(req.body.ghararFreeConfirmed),
  });
  return reply.code(200).send({ success: true, data });
}

async function handleProfitSharingPost(req: HttpReq, reply: HttpReply) {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!isRecord(req.body)) {
    return reply.code(400).send({ success: false, error: 'Invalid payload: body must be object' });
  }
  const required = [
    'contractId',
    'periodStart',
    'periodEnd',
    'grossProfitMinor',
    'operatingExpensesMinor',
    'distributionDate',
  ];
  if (missingKeys(req.body, required).length > 0) {
    return reply
      .code(400)
      .send({ success: false, error: 'Missing required profit-sharing fields' });
  }
  try {
    const data = await distributeProfitSharing(requireAddonDb(req), {
      contractId: Number(req.body.contractId),
      periodStart: String(req.body.periodStart),
      periodEnd: String(req.body.periodEnd),
      grossProfitMinor: Number(req.body.grossProfitMinor),
      operatingExpensesMinor: Number(req.body.operatingExpensesMinor),
      distributionDate: String(req.body.distributionDate),
      approvedById: auth.userId,
      notes: req.body.notes as string | undefined,
    });
    return reply.code(200).send({ success: true, data });
  } catch (err: unknown) {
    return reply.code(400).send({ success: false, error: (err as Error).message });
  }
}

async function handleWaqfVerify(req: HttpReq, reply: HttpReply) {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!isRecord(req.body) || !req.body.assetId || !Array.isArray(req.body.trail)) {
    return reply.code(400).send({ success: false, error: 'assetId and trail array are required' });
  }
  try {
    const data = await computeWaqfMerkle(requireAddonDb(req), {
      assetId: Number(req.body.assetId),
      trail: req.body.trail as WaqfMerkleInput['trail'],
    });
    return reply.code(200).send({ success: true, data });
  } catch (err: unknown) {
    return reply.code(400).send({ success: false, error: (err as Error).message });
  }
}

async function handleWaqfAppend(req: HttpReq, reply: HttpReply) {
  const auth = requireAuth(req, reply);
  if (!auth) return;
  if (!isRecord(req.body)) {
    return reply.code(400).send({ success: false, error: 'Invalid payload: body must be object' });
  }
  if (
    missingKeys(req.body, ['assetId', 'event', 'timestamp', 'valueMinor', 'description']).length > 0
  ) {
    return reply.code(400).send({ success: false, error: 'Missing required waqf event fields' });
  }
  if (!WAQF_EVENTS.includes(String(req.body.event))) {
    return reply.code(400).send({ success: false, error: 'Invalid waqf event' });
  }
  try {
    const data = await appendWaqfMerkleEvent(
      requireAddonDb(req),
      Number(req.body.assetId),
      {
        event: req.body.event as WaqfMerkleInput['trail'][number]['event'],
        timestamp: String(req.body.timestamp),
        valueMinor: Number(req.body.valueMinor),
        description: String(req.body.description),
      },
      auth.userId
    );
    return reply.code(200).send({ success: true, data });
  } catch (err: unknown) {
    return reply.code(400).send({ success: false, error: (err as Error).message });
  }
}

export const shariaHttpPlugin: AddonHttpPlugin = async (app) => {
  app.post('/api/sharia/zakat/calculate', handleZakatCalculate);
  app.post('/api/sharia/contracts/validate', handleContractValidate);
  app.post('/api/sharia/profit-sharing/post', handleProfitSharingPost);
  app.post('/api/sharia/waqf/merkle-verify', handleWaqfVerify);
  app.post('/api/sharia/waqf/merkle-append', handleWaqfAppend);
};

export const httpPlugin = shariaHttpPlugin;
