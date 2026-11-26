import type { LeaveType } from './models/index.js';

export interface LeaveRequestInput {
  readonly employeeNo: string;
  readonly leaveType: LeaveType;
  readonly startDate: string;
  readonly endDate: string;
  readonly availableBalanceDays: number;
}

export interface LeaveValidationResult {
  readonly valid: boolean;
  readonly daysCount: number;
  readonly errors: readonly string[];
}

export interface PayrollEmployeeInput {
  readonly employeeNo: string;
  readonly baseSalaryMinor: number;
  readonly allowanceMinor: number;
  readonly deductionMinor: number;
}

export interface PayrollLineResult {
  readonly employeeNo: string;
  readonly grossMinor: number;
  readonly deductionMinor: number;
  readonly netMinor: number;
}

export interface PayrollCalculationResult {
  readonly lines: readonly PayrollLineResult[];
  readonly totalGrossMinor: number;
  readonly totalDeductionsMinor: number;
  readonly totalNetMinor: number;
}

export function calculateLeaveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 0;
  }
  const diffDays = Math.floor((end - start) / 86_400_000);
  return diffDays + 1;
}

export function validateLeaveRequest(input: LeaveRequestInput): LeaveValidationResult {
  const errors: string[] = [];
  const daysCount = calculateLeaveDays(input.startDate, input.endDate);

  if (daysCount <= 0) {
    errors.push('endDate must be on or after startDate');
  }
  if (input.leaveType !== 'unpaid' && daysCount > input.availableBalanceDays) {
    errors.push(
      `Insufficient leave balance: requested=${daysCount}, available=${input.availableBalanceDays}`
    );
  }

  return {
    valid: errors.length === 0,
    daysCount,
    errors,
  };
}

export function calculatePayroll(
  employees: readonly PayrollEmployeeInput[]
): PayrollCalculationResult {
  const lines: PayrollLineResult[] = employees.map((emp) => {
    const grossMinor = emp.baseSalaryMinor + emp.allowanceMinor;
    const netMinor = Math.max(0, grossMinor - emp.deductionMinor);
    return {
      employeeNo: emp.employeeNo,
      grossMinor,
      deductionMinor: emp.deductionMinor,
      netMinor,
    };
  });

  const totalGrossMinor = lines.reduce((sum, line) => sum + line.grossMinor, 0);
  const totalDeductionsMinor = lines.reduce((sum, line) => sum + line.deductionMinor, 0);
  const totalNetMinor = lines.reduce((sum, line) => sum + line.netMinor, 0);

  return {
    lines,
    totalGrossMinor,
    totalDeductionsMinor,
    totalNetMinor,
  };
}
