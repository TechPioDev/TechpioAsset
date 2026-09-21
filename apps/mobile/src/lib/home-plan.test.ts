import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES, type SystemRole } from '@techpioasset/domain';
import { visibleMenu } from './menu';
import { MAX_QUICK_ACTIONS, MAX_ROLE_TABS, homePlan, personaOf } from './home-plan';

const planFor = (role: SystemRole) => homePlan([role], ROLE_PERMISSIONS[role]);

describe('who the Home screen is arranged around', () => {
  it('gives every system role a persona of its own kind', () => {
    const personas = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, planFor(role).persona]));
    expect(personas).toEqual({
      SUPER_ADMIN: 'admin',
      COMPANY_ADMIN: 'admin',
      IT_ADMIN: 'it',
      IT_TECHNICIAN: 'it',
      OFFICE_ADMIN: 'stores',
      INVENTORY_MANAGER: 'stores',
      FINANCE: 'finance',
      PROCUREMENT_MANAGER: 'finance',
      HR: 'hr',
      AUDITOR: 'auditor',
      MANAGER: 'approver',
      EMPLOYEE: 'employee',
      VENDOR: 'vendor',
    });
  });

  it('arranges somebody with two jobs around the hands-on one', () => {
    const permissions = [...ROLE_PERMISSIONS.IT_ADMIN, ...ROLE_PERMISSIONS.MANAGER];
    expect(personaOf(['MANAGER', 'IT_ADMIN'], permissions)).toBe('it');
  });

  it('keeps somebody on staff who also holds Vendor out of the supplier screen', () => {
    const permissions = [...ROLE_PERMISSIONS.EMPLOYEE, ...ROLE_PERMISSIONS.VENDOR];
    expect(personaOf(['EMPLOYEE', 'VENDOR'], permissions)).not.toBe('employee');
    expect(personaOf(['IT_ADMIN', 'VENDOR'], [...ROLE_PERMISSIONS.IT_ADMIN])).toBe('it');
  });

  it('reads a custom role by what it may do', () => {
    expect(personaOf(['STOREKEEPER'], [PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.INVENTORY_READ])).toBe('stores');
    expect(personaOf(['TEAM_LEAD'], [PERMISSIONS.REQUESTS_APPROVE])).toBe('approver');
    expect(personaOf(['SOMETHING'], [])).toBe('employee');
  });
});

describe('what each role is offered', () => {
  it('never offers an action, a queue or a tab the account may not use', () => {
    for (const role of SYSTEM_ROLES) {
      const permissions = ROLE_PERMISSIONS[role];
      const plan = planFor(role);
      // Everything on Home must also be in the Menu this account sees: the Menu
      // is the app's one statement of "what may this person open".
      const reachable = new Set(
        visibleMenu(permissions, [role]).flatMap((group) => group.items.map((item) => item.href)),
      );
      for (const action of plan.quickActions) {
        expect(reachable.has(action.href), `${role}: ${action.key} -> ${action.href}`).toBe(true);
      }
      expect(plan.quickActions.length).toBeLessThanOrEqual(MAX_QUICK_ACTIONS);
      expect(plan.tabs.length).toBeLessThanOrEqual(MAX_ROLE_TABS);
    }
  });

  it('gives every role something to do from Home, and at least one tab', () => {
    for (const role of SYSTEM_ROLES) {
      const plan = planFor(role);
      expect(plan.quickActions.length, role).toBeGreaterThan(0);
      expect(plan.tabs.length, role).toBeGreaterThan(0);
    }
  });

  it('puts the scanner on the bar for the people who walk the floor', () => {
    expect(planFor('IT_TECHNICIAN').tabs).toContain('scan');
    expect(planFor('AUDITOR').tabs).toContain('scan');
    expect(planFor('INVENTORY_MANAGER').tabs).toContain('inventory');
  });

  it('leads a manager with what is waiting on them', () => {
    const plan = planFor('MANAGER');
    expect(plan.tabs[0]).toBe('approvals');
    expect(plan.queues).toEqual(['awaiting-me']);
    expect(plan.quickActions[0]!.key).toBe('approvals');
  });

  it('shows an employee their equipment first, and no queue they cannot clear', () => {
    const plan = planFor('EMPLOYEE');
    expect(plan.equipmentFirst).toBe(true);
    expect(plan.queues).toEqual([]);
    expect(plan.quickActions.map((a) => a.key)).toContain('request');
  });

  it('gives a supplier its offers and nothing about equipment', () => {
    const plan = planFor('VENDOR');
    expect(plan.tabs).toEqual(['catalogue']);
    expect(plan.queues).toEqual([]);
    expect(plan.quickActions.map((a) => a.key)).toEqual(['offers', 'company']);
  });

  it('drops what a stripped-down account cannot do instead of showing a dead door', () => {
    const plan = homePlan(['IT_TECHNICIAN'], [PERMISSIONS.ASSETS_READ]);
    expect(plan.persona).toBe('it');
    expect(plan.quickActions.map((a) => a.key)).toEqual(['scan', 'equipment']);
    expect(plan.queues).toEqual([]);
    expect(plan.tabs).toEqual(['assets', 'scan']);
  });
});
