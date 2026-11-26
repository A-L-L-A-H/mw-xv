import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  Department,
  Employee,
  LeaveRequest,
  AttendanceRecord,
  PayrollRun,
} from './models/index.js';
import { httpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'hr',
  version: '1.0.0',
  depends: ['base'],
  models: [Department, Employee, LeaveRequest, AttendanceRecord, PayrollRun],
  httpPlugins: [httpPlugin],
  data: [
    seed(Department, 'hr.department_general', {
      code: 'DEPT-GEN',
      name: 'General Operations',
      company: ref('base.company_default'),
      is_active: true,
    }),
  ],
});
