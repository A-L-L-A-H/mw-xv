import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  Department,
  Employee,
  LeaveRequest,
  AttendanceRecord,
  PayrollRun,
} from './models/index.js';

export const manifest = defineAddon({
  name: 'hr',
  version: '1.0.0',
  depends: ['base'],
  models: [Department, Employee, LeaveRequest, AttendanceRecord, PayrollRun],
  data: [
    seed(Department, 'hr.department_general', {
      code: 'DEPT-GEN',
      name: 'General Operations',
      company: ref('base.company_default'),
      is_active: true,
    }),
  ],
});
