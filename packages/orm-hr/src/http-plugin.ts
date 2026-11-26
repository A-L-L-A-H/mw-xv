import {
  requireAddonDb,
  requireAuth,
  type AddonHttpPlugin,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  calculateLeaveDays,
  validateLeaveRequest,
  calculatePayroll,
  type LeaveRequestInput,
  type PayrollEmployeeInput,
} from './hr-engine.js';
import type { LeaveType } from './models/index.js';

const VALID_LEAVE_TYPES: readonly LeaveType[] = [
  'annual',
  'sick',
  'unpaid',
  'maternity',
  'paternity',
];

export const hrHttpPlugin: AddonHttpPlugin = async (app) => {
  app.get('/api/hr/departments', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    try {
      const db = requireAddonDb(req);
      const departments = await db('hr_departments')
        .where({ company_id: auth.companyId })
        .orderBy('code', 'asc')
        .select('id', 'code', 'name', 'company_id', 'manager_id', 'is_active');
      return reply.code(200).send({ success: true, data: departments });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/hr/leave/days', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { startDate, endDate } = req.body;
    if (typeof startDate !== 'string' || typeof endDate !== 'string') {
      return reply.code(400).send({
        success: false,
        error: 'startDate and endDate are required',
      });
    }

    const daysCount = calculateLeaveDays(startDate, endDate);
    return reply.code(200).send({ success: true, data: { startDate, endDate, daysCount } });
  });

  app.post('/api/hr/leave/validate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { employeeNo, leaveType, startDate, endDate, availableBalanceDays } = req.body;
    if (
      typeof employeeNo !== 'string' ||
      typeof leaveType !== 'string' ||
      typeof startDate !== 'string' ||
      typeof endDate !== 'string' ||
      availableBalanceDays === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error: 'employeeNo, leaveType, startDate, endDate, and availableBalanceDays are required',
      });
    }

    if (!VALID_LEAVE_TYPES.includes(leaveType as LeaveType)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid leaveType. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}`,
      });
    }

    try {
      const input: LeaveRequestInput = {
        employeeNo,
        leaveType: leaveType as LeaveType,
        startDate,
        endDate,
        availableBalanceDays: Number(availableBalanceDays),
      };
      const result = validateLeaveRequest(input);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/hr/payroll/calculate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { employees } = req.body;
    if (!Array.isArray(employees)) {
      return reply.code(400).send({ success: false, error: 'employees array is required' });
    }

    try {
      const result = calculatePayroll(employees as PayrollEmployeeInput[]);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = hrHttpPlugin;
