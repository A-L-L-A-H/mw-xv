import { defineView } from '@moonwitness/orm';
import {
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
} from './models.js';

export const views = [
  defineView(Project, {
    title: 'Projects',
    list: {
      columns: ['code', 'name', 'status', 'department', 'team', 'owner', 'target_date', 'company'],
      order: 'sequence asc, name asc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'on_hold']] },
        { color: 'muted', domain: [['status', '=', 'archived']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Project Overview',
          columns: 2,
          fields: ['code', 'name', 'status', 'company', 'partner', 'sequence'],
        },
        {
          title: 'Ownership & Schedule',
          columns: 2,
          fields: ['department', 'team', 'owner', 'start_date', 'target_date'],
        },
        {
          title: 'Scope',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['code', 'name', 'description'],
      filters: [
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'Planned', domain: [['status', '=', 'planned']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Department', field: 'department_id' },
        { label: 'Team', field: 'team_id' },
      ],
    },
    kanban: {
      groupBy: 'status',
      stageOrder: ['planned', 'active', 'on_hold', 'completed', 'archived'],
      cardTitle: 'name',
      cardFields: ['code', 'team_id', 'owner_id', 'target_date'],
      badgeField: 'status',
    },
    graph: {
      dimension: 'status',
      type: 'bar',
    },
  }),
  defineView(ProjectStage, {
    title: 'Project Stages',
    list: {
      columns: ['sequence', 'name', 'code', 'project', 'wip_limit', 'is_closed', 'fold'],
      order: 'sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Stage Configuration',
          columns: 2,
          fields: [
            'company',
            'project',
            'code',
            'name',
            'sequence',
            'wip_limit',
            'is_closed',
            'fold',
          ],
        },
      ],
    },
    search: {
      fields: ['name', 'code'],
      filters: [
        { label: 'Default Stages', domain: [['project_id', '=', null]] },
        { label: 'Closed Stages', domain: [['is_closed', '=', true]] },
      ],
    },
  }),
  defineView(ProjectMilestone, {
    title: 'Milestones',
    list: {
      columns: ['code', 'name', 'project', 'status', 'due_date', 'owner'],
      order: 'due_date asc, id asc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'reached']] },
        { color: 'danger', domain: [['status', '=', 'missed']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Milestone Details',
          columns: 2,
          fields: ['company', 'project', 'code', 'name', 'status', 'due_date', 'owner'],
        },
        {
          title: 'Notes',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['code', 'name', 'description'],
      filters: [
        { label: 'Open', domain: [['status', '=', 'open']] },
        { label: 'Reached', domain: [['status', '=', 'reached']] },
        { label: 'Missed', domain: [['status', '=', 'missed']] },
      ],
      groupBy: [
        { label: 'Project', field: 'project_id' },
        { label: 'Status', field: 'status' },
      ],
    },
  }),
  defineView(ProjectTask, {
    title: 'Tasks',
    list: {
      columns: ['code', 'title', 'project', 'stage', 'priority', 'status', 'assignee', 'due_date'],
      order: 'position asc, id desc',
      decorations: [
        { color: 'danger', domain: [['status', '=', 'blocked']] },
        { color: 'warning', domain: [['priority', '=', 'urgent']] },
        { color: 'success', domain: [['status', '=', 'done']] },
        { color: 'muted', domain: [['status', '=', 'cancelled']] },
      ],
    },
    form: {
      header: { statusField: 'status' },
      sections: [
        {
          title: 'Task Summary',
          columns: 2,
          fields: ['code', 'title', 'company', 'project', 'stage', 'milestone', 'parent'],
        },
        {
          title: 'Execution & Ownership',
          columns: 2,
          fields: [
            'status',
            'priority',
            'assignee',
            'reviewer',
            'due_date',
            'estimate_minutes',
            'position',
            'external_ref',
          ],
        },
        {
          title: 'Details & Blockers',
          fields: ['description', 'blocked_reason'],
        },
      ],
    },
    search: {
      fields: ['code', 'title', 'description', 'external_ref'],
      filters: [
        { label: 'In Progress', domain: [['status', '=', 'in_progress']] },
        { label: 'Blocked', domain: [['status', '=', 'blocked']] },
        { label: 'In Review', domain: [['status', '=', 'review']] },
        { label: 'Done', domain: [['status', '=', 'done']] },
        { label: 'High / Urgent', domain: [['priority', 'in', ['high', 'urgent']]] },
      ],
      groupBy: [
        { label: 'Stage', field: 'stage_id' },
        { label: 'Project', field: 'project_id' },
        { label: 'Assignee', field: 'assignee_id' },
        { label: 'Priority', field: 'priority' },
      ],
    },
    kanban: {
      groupBy: 'stage_id',
      cardTitle: 'title',
      cardFields: ['code', 'priority', 'assignee_id', 'due_date'],
      badgeField: 'priority',
      quickCreate: true,
    },
    graph: {
      dimension: 'status',
      type: 'bar',
    },
  }),
  defineView(ProjectTaskDependency, {
    title: 'Task Dependencies',
    list: {
      columns: ['task', 'kind', 'depends_on', 'company'],
      order: 'task_id asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Dependency Link',
          columns: 2,
          fields: ['company', 'task', 'kind', 'depends_on'],
        },
      ],
    },
    search: {
      fields: [],
      filters: [
        { label: 'Blocking', domain: [['kind', '=', 'blocks']] },
        { label: 'Related', domain: [['kind', '=', 'relates_to']] },
      ],
    },
  }),
];
