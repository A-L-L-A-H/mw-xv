import type { AuthContext } from '../plugins/auth.plugin.js';
import { canAccess, canExecuteAction, type ActionAclDefinition } from '../auth/policy.js';

export type ActionType = 'window' | 'server' | 'client' | 'record';

export interface ActionResult {
  readonly type: 'reload' | 'navigate' | 'open_window' | 'notify' | 'download';
  readonly target?: string;
  readonly message?: string;
  readonly level?: 'info' | 'success' | 'warning' | 'error';
  readonly payload?: Record<string, unknown>;
}

export interface ActionDefinition extends ActionAclDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: ActionType;
  readonly model?: string;
  readonly target?: 'current' | 'dialog';
  readonly domain?: readonly unknown[];
  readonly context?: Record<string, unknown>;
  readonly viewModes?: readonly string[];
  readonly tag?: string;
  readonly handler?: string;
}

export interface MenuNodeDefinition {
  readonly id: string;
  readonly parentId?: string;
  readonly label: string;
  readonly icon?: string;
  readonly sequence?: number;
  readonly actionId?: string;
  readonly model?: string;
  readonly groups?: readonly string[];
  readonly developmentOnly?: boolean;
  readonly addon?: string;
}

export interface MenuTreeNode extends MenuNodeDefinition {
  readonly children: MenuTreeNode[];
}

export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();
  private generation = 1;

  register(action: ActionDefinition): void {
    if (!/^[a-z0-9_]+\.[a-z0-9_.-]+$/i.test(action.id)) {
      throw new Error(`Invalid action ID "${action.id}": must match <addon>.<slug>`);
    }
    this.actions.set(action.id, action);
    this.generation += 1;
  }

  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  listAll(): readonly ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  listForAuth(auth: AuthContext): readonly ActionDefinition[] {
    return this.listAll().filter((action) => {
      if (action.model) {
        return canExecuteAction(auth, action.model, action);
      }
      if (action.allowedGroups && action.allowedGroups.length > 0) {
        if (auth.role === 'system' || auth.role === 'superadmin') return true;
        const callerGroups = new Set(auth.groupNames ?? []);
        return action.allowedGroups.some((g) => callerGroups.has(g));
      }
      return true;
    });
  }

  getGeneration(): number {
    return this.generation;
  }

  clear(): void {
    this.actions.clear();
    this.generation += 1;
  }
}

export class MenuRegistry {
  private readonly menus = new Map<string, MenuNodeDefinition>();
  private generation = 1;

  register(menu: MenuNodeDefinition): void {
    this.menus.set(menu.id, menu);
    this.generation += 1;
  }

  registerMany(menus: readonly MenuNodeDefinition[]): void {
    for (const menu of menus) {
      this.menus.set(menu.id, menu);
    }
    this.validateAcyclic();
    this.generation += 1;
  }

  validateAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Menu cycle detected involving menu "${id}"`);
      }
      visiting.add(id);
      const node = this.menus.get(id);
      if (node?.parentId) {
        if (!this.menus.has(node.parentId)) {
          throw new Error(`Orphan menu "${id}": parentId "${node.parentId}" does not exist`);
        }
        visit(node.parentId);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const id of this.menus.keys()) {
      visit(id);
    }
  }

  buildTreeForAuth(
    auth: AuthContext,
    options?: { includeDevelopment?: boolean; activeAddons?: ReadonlySet<string> }
  ): MenuTreeNode[] {
    const includeDev = options?.includeDevelopment ?? false;
    const activeAddons = options?.activeAddons;
    const isAdmin = auth.role === 'system' || auth.role === 'superadmin';
    const callerGroups = new Set(auth.groupNames ?? []);

    const visible = new Map<string, MenuTreeNode>();
    for (const menu of this.menus.values()) {
      if (menu.developmentOnly && !includeDev) continue;
      if (menu.addon && activeAddons && !activeAddons.has(menu.addon)) continue;
      if (menu.model && !canAccess(auth.role, menu.model, 'read', auth.groupPermissions)) continue;
      if (!isAdmin && menu.groups && menu.groups.length > 0) {
        if (!menu.groups.some((g) => callerGroups.has(g))) continue;
      }
      visible.set(menu.id, { ...menu, children: [] });
    }

    const roots: MenuTreeNode[] = [];
    for (const node of visible.values()) {
      if (node.parentId && visible.has(node.parentId)) {
        visible.get(node.parentId)!.children.push(node);
      } else if (!node.parentId) {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: MenuTreeNode[]): MenuTreeNode[] => {
      nodes.sort(
        (a, b) => (a.sequence ?? 100) - (b.sequence ?? 100) || a.label.localeCompare(b.label)
      );
      for (const node of nodes) {
        sortNodes(node.children);
      }
      return nodes;
    };

    return sortNodes(roots);
  }

  getGeneration(): number {
    return this.generation;
  }

  clear(): void {
    this.menus.clear();
    this.generation += 1;
  }
}

export const actionRegistry = new ActionRegistry();
export const menuRegistry = new MenuRegistry();

export function getRegistryGeneration(): number {
  return actionRegistry.getGeneration() + menuRegistry.getGeneration();
}
