import { defineModel, fields } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';

export type EmploymentType = 'full_time' | 'part_time' | 'contract';
export type EmployeeStatus = 'active' | 'on_leave' | 'terminated';
export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity';
export type LeaveStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave';
export type PayrollStatus = 'draft' | 'approved' | 'paid';

export const Department = defineModel('hr.department', {
  table: 'hr_departments',
  order: 'code asc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Department Code' }),
    name: fields.string({ required: true, label: 'Department Name' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    manager: fields.belongsTo(User, { label: 'Manager' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const Employee = defineModel('hr.employee', {
  table: 'hr_employees',
  order: 'employee_no asc',
  fields: {
    employee_no: fields.string({ required: true, unique: true, label: 'Employee No' }),
    full_name: fields.string({ required: true, label: 'Full Name' }),
    email: fields.string({ required: true, unique: true, label: 'Work Email' }),
    department: fields.belongsTo(Department, { required: true, label: 'Department' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    user: fields.belongsTo(User, { label: 'User Account' }),
    job_title: fields.string({ required: true, label: 'Job Title' }),
    employment_type: fields.string({
      required: true,
      default: 'full_time',
      values: ['full_time', 'part_time', 'contract'],
      label: 'Employment Type',
    }),
    status: fields.string({
      required: true,
      default: 'active',
      values: ['active', 'on_leave', 'terminated'],
      label: 'Status',
    }),
    hire_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Hire Date',
    }),
    base_salary_minor: fields.integer({
      required: true,
      default: 0,
      label: 'Base Salary (minor units)',
    }),
  },
});

export const LeaveRequest = defineModel('hr.leave_request', {
  table: 'hr_leave_requests',
  order: 'start_date desc',
  fields: {
    request_no: fields.string({ required: true, unique: true, label: 'Request No' }),
    employee: fields.belongsTo(Employee, { required: true, label: 'Employee' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    leave_type: fields.string({
      required: true,
      values: ['annual', 'sick', 'unpaid', 'maternity', 'paternity'],
      label: 'Leave Type',
    }),
    start_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Start Date',
    }),
    end_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'End Date',
    }),
    days_count: fields.integer({ required: true, label: 'Days Count' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'submitted', 'approved', 'rejected', 'cancelled'],
      label: 'Status',
    }),
    reason: fields.text({ label: 'Reason' }),
  },
});

export const AttendanceRecord = defineModel('hr.attendance_record', {
  table: 'hr_attendance_records',
  order: 'work_date desc',
  fields: {
    employee: fields.belongsTo(Employee, { required: true, label: 'Employee' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    work_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Work Date',
    }),
    worked_minutes: fields.integer({ required: true, default: 0, label: 'Worked Minutes' }),
    status: fields.string({
      required: true,
      default: 'present',
      values: ['present', 'late', 'absent', 'leave'],
      label: 'Status',
    }),
  },
});

export const PayrollRun = defineModel('hr.payroll_run', {
  table: 'hr_payroll_runs',
  order: 'period_end desc',
  fields: {
    run_no: fields.string({ required: true, unique: true, label: 'Payroll Run No' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    period_start: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period Start',
    }),
    period_end: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period End',
    }),
    total_gross_minor: fields.integer({ required: true, default: 0, label: 'Total Gross (minor units)' }),
    total_deductions_minor: fields.integer({
      required: true,
      default: 0,
      label: 'Total Deductions (minor units)',
    }),
    total_net_minor: fields.integer({ required: true, default: 0, label: 'Total Net (minor units)' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'approved', 'paid'],
      label: 'Status',
    }),
  },
});
