import type { Transaction } from 'objection';
import { extractRelationId, isValidIsoDate, resolveMutationField } from '@moonwitness/orm';
import { CompanyMembership } from '@moonwitness/orm-base';
import { OrganizationDepartment, OrganizationTeam } from '@moonwitness/orm-organization';
import {
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
} from './models.js';

type MutationRecord = Readonly<Record<string, unknown>>;
type ModelRow = Readonly<Record<string, unknown>>;

function optionalValidDate(value: unknown): boolean {
  return value === undefined || value === null || value === '' || isValidIsoDate(value);
}

async function userBelongsToCompany(
  userId: number | null,
  companyId: number,
  trx?: Transaction
): Promise<boolean> {
  if (userId === null) return true;
  const membership = await CompanyMembership.query(trx)
    .where({ user_id: userId, company_id: companyId })
    .first();
  return membership !== undefined;
}

async function taskParentChainIsAcyclic(
  parentId: number | null,
  currentId: number | undefined,
  trx?: Transaction
): Promise<boolean> {
  const visited = new Set<number>();
  if (currentId !== undefined) visited.add(currentId);
  let nextId = parentId;
  while (nextId !== null) {
    if (visited.has(nextId)) return false;
    visited.add(nextId);
    const row = (await ProjectTask.query(trx).findById(nextId)) as unknown as ModelRow | undefined;
    if (!row) return false;
    const next = row.parent_id;
    nextId = typeof next === 'number' ? next : null;
  }
  return true;
}

async function blockingDependencyGraphIsAcyclic(
  taskId: number,
  dependsOnId: number,
  trx?: Transaction
): Promise<boolean> {
  if (taskId === dependsOnId) return false;
  // Adding edge taskId -> dependsOnId creates a cycle iff taskId is already reachable from dependsOnId.
  const visited = new Set<number>([dependsOnId]);
  const queue: number[] = [dependsOnId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = (await ProjectTaskDependency.query(trx)
      .where({ task_id: current, kind: 'blocks' })
      .select('depends_on_id')) as unknown as ModelRow[];
    for (const edge of outgoing) {
      const target = edge.depends_on_id;
      if (typeof target !== 'number') continue;
      if (target === taskId) return false;
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return true;
}

/** Validate company ownership, org alignment, dates, and acyclic task hierarchies/dependencies. */
export async function isValidProjectMutation(
  modelName: string,
  values: MutationRecord,
  current?: ModelRow,
  trx?: Transaction
): Promise<boolean> {
  if (
    modelName !== Project.modelName &&
    modelName !== ProjectStage.modelName &&
    modelName !== ProjectMilestone.modelName &&
    modelName !== ProjectTask.modelName &&
    modelName !== ProjectTaskDependency.modelName
  ) {
    return true;
  }

  const companyId = extractRelationId(values, current, 'company');
  if (companyId === null) return false;
  const currentId = typeof current?.id === 'number' ? current.id : undefined;

  if (modelName === Project.modelName) {
    if (
      currentId !== undefined &&
      current?.company_id !== companyId &&
      ((await ProjectStage.query(trx).where('project_id', currentId).first()) ||
        (await ProjectMilestone.query(trx).where('project_id', currentId).first()) ||
        (await ProjectTask.query(trx).where('project_id', currentId).first()))
    ) {
      return false;
    }

    const departmentId = extractRelationId(values, current, 'department');
    if (departmentId !== null) {
      const department = (await OrganizationDepartment.query(trx).findById(
        departmentId
      )) as unknown as ModelRow | undefined;
      if (!department || department.company_id !== companyId) return false;
    }

    const teamId = extractRelationId(values, current, 'team');
    if (teamId !== null) {
      const team = (await OrganizationTeam.query(trx).findById(teamId)) as unknown as
        ModelRow | undefined;
      if (!team || team.company_id !== companyId) return false;
      if (departmentId !== null && team.department_id !== departmentId) return false;
    }

    const ownerId = extractRelationId(values, current, 'owner');
    if (!(await userBelongsToCompany(ownerId, companyId, trx))) return false;

    const startDate = resolveMutationField(values, current, 'start_date');
    const targetDate = resolveMutationField(values, current, 'target_date');
    if (!optionalValidDate(startDate) || !optionalValidDate(targetDate)) return false;
    if (isValidIsoDate(startDate) && isValidIsoDate(targetDate) && targetDate < startDate)
      return false;
    return true;
  }

  if (modelName === ProjectStage.modelName) {
    const projectId = extractRelationId(values, current, 'project');
    if (projectId !== null) {
      const project = (await Project.query(trx).findById(projectId)) as unknown as
        ModelRow | undefined;
      if (!project || project.company_id !== companyId) return false;
    }
    if (
      currentId !== undefined &&
      (current?.company_id !== companyId || (current?.project_id ?? null) !== projectId) &&
      (await ProjectTask.query(trx).where('stage_id', currentId).first())
    ) {
      return false;
    }
    const code = resolveMutationField(values, current, 'code');
    if (projectId === null && typeof code === 'string') {
      const duplicateDefault = await ProjectStage.query(trx)
        .where({ company_id: companyId, code })
        .whereNull('project_id')
        .first();
      if (duplicateDefault && duplicateDefault.id !== currentId) return false;
    }
    const wipLimit = resolveMutationField(values, current, 'wip_limit');
    if (
      wipLimit !== undefined &&
      wipLimit !== null &&
      (typeof wipLimit !== 'number' || !Number.isSafeInteger(wipLimit) || wipLimit < 1)
    ) {
      return false;
    }
    return true;
  }

  if (modelName === ProjectMilestone.modelName) {
    const projectId = extractRelationId(values, current, 'project');
    if (projectId === null) return false;
    const project = (await Project.query(trx).findById(projectId)) as unknown as
      ModelRow | undefined;
    if (!project || project.company_id !== companyId) return false;
    if (
      currentId !== undefined &&
      (current?.company_id !== companyId || current?.project_id !== projectId) &&
      (await ProjectTask.query(trx).where('milestone_id', currentId).first())
    ) {
      return false;
    }
    const ownerId = extractRelationId(values, current, 'owner');
    if (!(await userBelongsToCompany(ownerId, companyId, trx))) return false;
    const dueDate = resolveMutationField(values, current, 'due_date');
    return optionalValidDate(dueDate);
  }

  if (modelName === ProjectTask.modelName) {
    const projectId = extractRelationId(values, current, 'project');
    const stageId = extractRelationId(values, current, 'stage');
    if (projectId === null || stageId === null) return false;

    const [projectRaw, stageRaw] = await Promise.all([
      Project.query(trx).findById(projectId),
      ProjectStage.query(trx).findById(stageId),
    ]);
    const project = projectRaw as unknown as ModelRow | undefined;
    const stage = stageRaw as unknown as ModelRow | undefined;
    if (!project || project.company_id !== companyId) return false;
    if (
      !stage ||
      stage.company_id !== companyId ||
      (stage.project_id !== null && stage.project_id !== projectId)
    ) {
      return false;
    }

    if (
      currentId !== undefined &&
      (current?.company_id !== companyId || current?.project_id !== projectId) &&
      ((await ProjectTask.query(trx).where('parent_id', currentId).first()) ||
        (await ProjectTaskDependency.query(trx).where('task_id', currentId).first()) ||
        (await ProjectTaskDependency.query(trx).where('depends_on_id', currentId).first()))
    ) {
      return false;
    }

    const milestoneId = extractRelationId(values, current, 'milestone');
    if (milestoneId !== null) {
      const milestone = (await ProjectMilestone.query(trx).findById(milestoneId)) as unknown as
        ModelRow | undefined;
      if (!milestone || milestone.company_id !== companyId || milestone.project_id !== projectId) {
        return false;
      }
    }

    const parentId = extractRelationId(values, current, 'parent');
    if (parentId !== null) {
      const parent = (await ProjectTask.query(trx).findById(parentId)) as unknown as
        ModelRow | undefined;
      if (!parent || parent.company_id !== companyId || parent.project_id !== projectId) {
        return false;
      }
      if (!(await taskParentChainIsAcyclic(parentId, currentId, trx))) return false;
    }

    const assigneeId = extractRelationId(values, current, 'assignee');
    const reviewerId = extractRelationId(values, current, 'reviewer');
    if (!(await userBelongsToCompany(assigneeId, companyId, trx))) return false;
    if (!(await userBelongsToCompany(reviewerId, companyId, trx))) return false;

    const estimateMinutes = resolveMutationField(values, current, 'estimate_minutes');
    if (
      estimateMinutes !== undefined &&
      estimateMinutes !== null &&
      (typeof estimateMinutes !== 'number' ||
        !Number.isSafeInteger(estimateMinutes) ||
        estimateMinutes < 0)
    ) {
      return false;
    }

    const dueDate = resolveMutationField(values, current, 'due_date');
    return optionalValidDate(dueDate);
  }

  if (modelName === ProjectTaskDependency.modelName) {
    const taskId = extractRelationId(values, current, 'task');
    const dependsOnId = extractRelationId(values, current, 'depends_on');
    if (taskId === null || dependsOnId === null || taskId === dependsOnId) return false;

    const [taskRaw, blockerRaw] = await Promise.all([
      ProjectTask.query(trx).findById(taskId),
      ProjectTask.query(trx).findById(dependsOnId),
    ]);
    const task = taskRaw as unknown as ModelRow | undefined;
    const blocker = blockerRaw as unknown as ModelRow | undefined;
    if (!task || !blocker) return false;
    if (task.company_id !== companyId || blocker.company_id !== companyId) return false;

    const kind = resolveMutationField(values, current, 'kind') ?? 'blocks';
    if (kind === 'blocks') {
      return blockingDependencyGraphIsAcyclic(taskId, dependsOnId, trx);
    }
    return true;
  }

  return true;
}
