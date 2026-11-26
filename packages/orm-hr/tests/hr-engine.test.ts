import { describe, expect, it } from 'vitest';
import {
  calculateLeaveDays,
  validateLeaveRequest,
  calculatePayroll,
  hrSeedManifest,
} from '../src/index.js';

describe('orm-hr', () => {
  it('calculates inclusive leave days and validates leave balance', () => {
    expect(calculateLeaveDays('2026-11-26', '2026-11-28')).toBe(3);

    const valid = validateLeaveRequest({
      employeeNo: 'EMP-001',
      leaveType: 'annual',
      startDate: '2026-11-26',
      endDate: '2026-11-28',
      availableBalanceDays: 5,
    });
    expect(valid.valid).toBe(true);
    expect(valid.daysCount).toBe(3);

    const insufficient = validateLeaveRequest({
      employeeNo: 'EMP-001',
      leaveType: 'annual',
      startDate: '2026-11-26',
      endDate: '2026-11-30',
      availableBalanceDays: 2,
    });
    expect(insufficient.valid).toBe(false);
  });

  it('calculates payroll totals accurately', () => {
    const payroll = calculatePayroll([
      {
        employeeNo: 'EMP-001',
        baseSalaryMinor: 500000,
        allowanceMinor: 50000,
        deductionMinor: 25000,
      },
      {
        employeeNo: 'EMP-002',
        baseSalaryMinor: 400000,
        allowanceMinor: 0,
        deductionMinor: 10000,
      },
    ]);

    expect(payroll.totalGrossMinor).toBe(950000);
    expect(payroll.totalDeductionsMinor).toBe(35000);
    expect(payroll.totalNetMinor).toBe(915000);
  });

  it('exposes hrSeedManifest with orm-base dependency', () => {
    expect(hrSeedManifest.seedVersion).toBe('1.0.0');
    expect(hrSeedManifest.dependencies).toContain('orm-base');
  });
});
