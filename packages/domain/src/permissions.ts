/**
 * Permission catalogue and the system role matrix (PLAN.md section 4, spec section 3).
 *
 * Permissions are the atom; roles are named bags of them. Nothing in the codebase
 * may branch on a role name - guards check `assets:assign`, never
 * `role === 'IT_ADMIN'` - because spec section 3 requires roles and their grants
 * to be reconfigurable at runtime by a Super Admin.
 */

export const PERMISSIONS = {
  // Assets
  ASSETS_READ: 'assets:read',
  ASSETS_CREATE: 'assets:create',
  ASSETS_UPDATE: 'assets:update',
  ASSETS_IMPORT: 'assets:import',
  ASSETS_ASSIGN: 'assets:assign',
  ASSETS_RETURN: 'assets:return',
  ASSETS_TRANSFER: 'assets:transfer',
  ASSETS_DISPOSE: 'assets:dispose',
  /**
   * Remove a record that should never have existed - a row from a bad import,
   * a duplicate, a typo saved as an asset.
   *
   * Deliberately separate from assets:dispose. Disposal is a real event in a
   * device's life and belongs in its history; deletion says the device was
   * never there. Recording a spreadsheet mistake as a disposal would put a
   * fictional event in the audit trail and the asset reports.
   */
  ASSETS_DELETE: 'assets:delete',
  ASSETS_COST_READ: 'assets:cost:read',

  // Quantity-tracked stock. v2.4 adds the warehouse layer: locations,
  // transfers between them, and converting stock units into tracked assets.
  INVENTORY_READ: 'inventory:read',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_LOCATIONS_MANAGE: 'inventory:locations:manage',
  INVENTORY_TRANSFER: 'inventory:transfer',
  INVENTORY_CONVERT: 'inventory:convert',

  // Invoices and procurement
  INVOICES_READ: 'invoices:read',
  INVOICES_UPLOAD: 'invoices:upload',
  INVOICES_CORRECT_EXTRACTION: 'invoices:correct-extraction',
  INVOICES_VERIFY: 'invoices:verify',
  VENDORS_READ: 'vendors:read',
  VENDORS_MANAGE: 'vendors:manage',

  /**
   * v2.42 - the vendor portal.
   *
   * Held only by external supplier users, and deliberately a separate resource
   * from `vendors:*`, which is the internal vendor register. A vendor managing
   * its own catalogue is not the same act as an administrator managing the list
   * of vendors, and one permission covering both would let a supplier edit its
   * competitors' records.
   *
   * None of these grant sight of anything beyond the vendor's own rows; that is
   * enforced by vendorId scoping in the services, not by the permission name.
   */
  VENDOR_PORTAL_ACCESS: 'vendor-portal:access',
  VENDOR_PRODUCTS_READ: 'vendor-products:read',
  VENDOR_PRODUCTS_MANAGE: 'vendor-products:manage',
  VENDOR_PRODUCTS_REVIEW: 'vendor-products:review',
  VENDOR_ORDERS_READ: 'vendor-orders:read',
  VENDOR_INVOICES_READ: 'vendor-invoices:read',
  VENDOR_QUOTES_RESPOND: 'vendor-quotes:respond',
  PURCHASE_ORDERS_READ: 'purchase-orders:read',
  PURCHASE_ORDERS_MANAGE: 'purchase-orders:manage',

  // Requests and workflow
  REQUESTS_CREATE: 'requests:create',
  REQUESTS_CREATE_ON_BEHALF: 'requests:create-on-behalf',
  REQUESTS_READ: 'requests:read',
  REQUESTS_APPROVE: 'requests:approve',
  REQUESTS_CANCEL: 'requests:cancel',
  /**
   * v2.25 - enter the commercial side of a request: inventory check, vendor,
   * prices, quote. Held by Office Admin, Finance and the admins; deliberately
   * NOT by the employee who raised it, because this figure is what decides
   * whether Finance reviews the spend.
   */
  REQUESTS_ASSESS: 'requests:assess',
  /**
   * v2.27 - stop a request at a step that is yours.
   *
   * Separate from REQUESTS_APPROVE because owning a step and being trusted to
   * approve spend are different things. An Inventory Manager staffing the
   * Inventory check stage is the person best placed to spot a duplicate, but
   * `requests:approve` would also hand them fulfilment (`/advance`), internal
   * comments on every request, submit-on-behalf and an approval-delegation
   * panel - none of which is "stop a duplicate", and all of which contradicts a
   * role documented as read-and-assess only.
   *
   * Every role that can approve also holds this: approving a step has always
   * implied being able to refuse it, and splitting the permission must not
   * quietly remove that.
   */
  REQUESTS_DECLINE: 'requests:decline',

  // People
  EMPLOYEES_READ: 'employees:read',
  EMPLOYEES_CREATE: 'employees:create',
  EMPLOYEES_IMPORT: 'employees:import',
  ONBOARDING_MANAGE: 'onboarding:manage',
  ONBOARDING_FULFIL: 'onboarding:fulfil',
  OFFBOARDING_MANAGE: 'offboarding:manage',
  OFFBOARDING_FULFIL: 'offboarding:fulfil',

  // Lifecycle
  MAINTENANCE_READ: 'maintenance:read',
  MAINTENANCE_REQUEST: 'maintenance:request',
  MAINTENANCE_MANAGE: 'maintenance:manage',

  // Reporting
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',

  // Administration
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  /** Sign in as another user (v2.12). Granted to no explicit role list -
   * only ALL_PERMISSIONS holders (Super Admin, Company Admin) carry it. */
  USERS_IMPERSONATE: 'users:impersonate',
  ROLES_MANAGE: 'roles:manage',
  PERMISSIONS_MANAGE: 'permissions:manage',
  CATEGORIES_MANAGE: 'categories:manage',
  WORKFLOWS_CONFIGURE: 'workflows:configure',
  SETTINGS_MANAGE: 'settings:manage',

  // Licenses (v2.3). Cost visibility mirrors the asset rule: Finance + Super
  // Admin only. Key reveals are separately gated and always audited.
  LICENSES_READ: 'licenses:read',
  LICENSES_CREATE: 'licenses:create',
  LICENSES_UPDATE: 'licenses:update',
  LICENSES_DELETE: 'licenses:delete',
  LICENSES_ASSIGN: 'licenses:assign',
  LICENSES_REVOKE: 'licenses:revoke',
  LICENSES_RENEW: 'licenses:renew',
  LICENSES_KEYS_REVEAL: 'licenses:keys:reveal',
  LICENSES_COST_READ: 'licenses:cost:read',

  // Procurement (v2.4). Approving above the Finance threshold additionally
  // requires the cost permission (the standing Finance + Super Admin rule).
  PROCUREMENT_PR_CREATE: 'procurement:pr:create',
  PROCUREMENT_PR_READ: 'procurement:pr:read',
  PROCUREMENT_PR_APPROVE: 'procurement:pr:approve',
  PROCUREMENT_PR_CONVERT: 'procurement:pr:convert',
  PROCUREMENT_PO_ISSUE: 'procurement:po:issue',
  PROCUREMENT_RECEIVE: 'procurement:receive',
  /** Accept a mismatched three-way match anyway - always audited. */
  PROCUREMENT_MATCH_OVERRIDE: 'procurement:match:override',

  // Budgets (v2.9). Setting the limit is a Finance act; SEEING the numbers
  // rides on ASSETS_COST_READ, because a budget is a money figure and the
  // standing rule is that money is Finance + Super Admin only.
  FINANCE_BUDGETS_MANAGE: 'finance:budgets:manage',
  /** Raise an RFQ, record what vendors quote, and award one (v2.9). */
  PROCUREMENT_RFQ_MANAGE: 'procurement:rfq:manage',

  // Discovery (v2.5). Ingest is for agents/admins; reconcile resolves the
  // review queue. Discovery proposes - humans (or exact serials) decide.
  DISCOVERY_READ: 'discovery:read',
  DISCOVERY_INGEST: 'discovery:ingest',
  DISCOVERY_RECONCILE: 'discovery:reconcile',

  // Analytics (v2.6). Read-only aggregates; spend figures additionally need
  // ASSETS_COST_READ - the API gates per aggregate, never the UI alone.
  ANALYTICS_READ: 'analytics:read',

  // Integrations (v2.6). Webhooks, SCIM token, hub - Super Admin only via ALL.
  INTEGRATIONS_MANAGE: 'integrations:manage',

  // AI
  AI_CONFIGURE: 'ai:configure',
  AI_REVIEW_RESULTS: 'ai:review-results',

  // Audit and labelling
  AUDIT_READ: 'audit:read',
  QR_GENERATE: 'qr:generate',
  QR_PRINT: 'qr:print',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * How much of a resource a grant reaches. Enforced in the repository layer, not
 * the controller, so it holds for reports and exports too - not merely for the
 * screens someone remembered to guard.
 */
export const DATA_SCOPES = ['ALL', 'DEPARTMENT', 'DIRECT_REPORTS', 'OWN'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'IT_ADMIN',
  'HR',
  'OFFICE_ADMIN',
  'FINANCE',
  'MANAGER',
  'EMPLOYEE',
  'AUDITOR',
  // v2.1 Workstream C — the canonical 13-role model (blueprint §1). The eight
  // above are retained as-is (IT_ADMIN=IT Manager, HR=HR Manager, FINANCE=Finance
  // Manager, OFFICE_ADMIN=Office Admin, MANAGER=Department Manager); these five are
  // net-new. Each new role carries only permissions whose modules exist today.
  'COMPANY_ADMIN',
  'IT_TECHNICIAN',
  'PROCUREMENT_MANAGER',
  'INVENTORY_MANAGER',
  // v2.42 - back, and this time with permissions. It was removed in v2.40
  // because it granted nothing: an account holding it could sign in and reach a
  // dashboard that failed, which is worse than a role that does not exist. It
  // returns only now that the vendor portal gives it something to do.
  'VENDOR',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

const P = PERMISSIONS;

/** Actions that only read. Used to prove the Auditor role can never mutate. */
const WRITE_ACTION_PATTERN =
  // `assess` and `decline` were both missing (v2.27). Assessing writes prices
  // and reserves stock, and declining ends a request outright - so without them
  // the Auditor invariant classified two mutations as reads and would have let
  // a read-only role through had either been granted to it.
  /:(create|update|delete|assign|return|transfer|dispose|adjust|upload|verify|approve|decline|assess|cancel|manage|configure|import|correct-extraction|generate|print|fulfil|request|create-on-behalf|revoke|renew|reveal|convert|issue|receive|override|ingest|reconcile)$/;

export function isReadOnlyPermission(permission: Permission): boolean {
  return !WRITE_ACTION_PATTERN.test(permission);
}

export const ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  /**
   * No REQUESTS_ASSESS (v2.26). IT decides whether the equipment is warranted -
   * that is the IT review step - but the price is what routes a request past
   * Finance, and the rule is that only Office Admin, Finance and Super Admin
   * may set it. IT held it for a while and never used it.
   */
  IT_ADMIN: [
    P.VENDOR_PRODUCTS_READ,
    P.VENDOR_PRODUCTS_REVIEW,
    P.ASSETS_READ,
    P.DISCOVERY_READ,
    P.DISCOVERY_INGEST,
    P.DISCOVERY_RECONCILE,
    P.PROCUREMENT_PR_CREATE,
    P.PROCUREMENT_PR_READ,
    P.INVENTORY_TRANSFER,
    P.INVENTORY_CONVERT,
    P.LICENSES_READ,
    P.LICENSES_CREATE,
    P.LICENSES_UPDATE,
    P.LICENSES_DELETE,
    P.LICENSES_ASSIGN,
    P.LICENSES_REVOKE,
    P.LICENSES_RENEW,
    P.ASSETS_CREATE,
    P.ASSETS_UPDATE,
    P.ASSETS_IMPORT,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    // Asset price is visible to Finance and Super Admin only.
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    // Invoice capture ("scan a bill") is Finance + Super Admin only; IT keeps
    // read-only visibility because assets link to their purchase invoices.
    P.INVOICES_READ,
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_CREATE,
    // v2.24 - whoever may raise a request may withdraw their own. The route
    // is guarded by this permission, so without it a specialist who raised a
    // ticket could not cancel it - only Registered Employees could.
    P.REQUESTS_CANCEL,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.EMPLOYEES_READ,
    P.ONBOARDING_FULFIL,
    P.OFFBOARDING_FULFIL,
    P.MAINTENANCE_READ,
    P.MAINTENANCE_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.AUDIT_READ,
    P.QR_GENERATE,
    P.QR_PRINT,
  ],

  // Spec section 3: "HR must not see financial invoice details unless a specific
  // financial-view permission is granted." ASSETS_COST_READ and INVOICES_READ are
  // therefore deliberately absent and must be granted individually.
  HR: [
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    // v2.24 - whoever may raise a request may withdraw their own. The route
    // is guarded by this permission, so without it a specialist who raised a
    // ticket could not cancel it - only Registered Employees could.
    P.REQUESTS_CANCEL,
    P.REQUESTS_CREATE_ON_BEHALF,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.EMPLOYEES_READ,
    P.EMPLOYEES_CREATE,
    P.EMPLOYEES_IMPORT,
    P.ONBOARDING_MANAGE,
    P.OFFBOARDING_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
  ],

  OFFICE_ADMIN: [
    P.VENDOR_PRODUCTS_READ,
    // Most suppliers never sign in to the portal, so staff keep the catalogue
    // for them. Cost entry stays with the roles authorised to touch money.
    P.VENDOR_PRODUCTS_MANAGE,
    P.VENDOR_PRODUCTS_REVIEW,
    P.ASSETS_READ,
    P.ASSETS_CREATE,
    P.ASSETS_UPDATE,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    // Asset price is visible to Finance and Super Admin only.
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    // Invoice capture ("scan a bill") is Finance + Super Admin only.
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_ASSESS,
    P.REQUESTS_CREATE,
    // v2.24 - whoever may raise a request may withdraw their own. The route
    // is guarded by this permission, so without it a specialist who raised a
    // ticket could not cancel it - only Registered Employees could.
    P.REQUESTS_CANCEL,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.EMPLOYEES_READ,
    P.ONBOARDING_FULFIL,
    P.OFFBOARDING_FULFIL,
    P.MAINTENANCE_READ,
    P.MAINTENANCE_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.QR_GENERATE,
    P.QR_PRINT,
  ],

  FINANCE: [
    P.VENDOR_PRODUCTS_READ,
    P.VENDOR_PRODUCTS_MANAGE,
    P.VENDOR_PRODUCTS_REVIEW,
    P.ANALYTICS_READ,
    P.ASSETS_READ,
    P.ASSETS_COST_READ,
    // Disposal is a financial act - proceeds, write-offs, the book value it
    // closes out - so it sits with Finance. IT cannot hold it: dispose plus
    // inventory:adjust is an SoD pair (write kit off, adjust the count, and
    // missing equipment disappears), and IT keeps inventory:adjust.
    P.ASSETS_DISPOSE,
    // v2.30. Finance owns pricing, and the spreadsheet is how a batch of prices
    // arrives. Without this the only account that could import costs was the
    // Super Admin, because import and cost-visibility met in no other role -
    // so the person responsible for the figures had to ask the tenant owner to
    // upload them.
    //
    // It does widen what Finance can change: the importer writes names, types,
    // condition, status and assignment, none of which Finance can edit one at a
    // time (they hold no assets:update). Two mitigations already stand - a
    // recorded price is write-once even here, and every price written is
    // audited to its row - but the bulk write itself is real and deliberate.
    P.ASSETS_IMPORT,
    P.FINANCE_BUDGETS_MANAGE,
    P.PROCUREMENT_PR_READ,
    P.PROCUREMENT_PR_APPROVE,
    P.PROCUREMENT_MATCH_OVERRIDE,
    P.LICENSES_READ,
    P.LICENSES_COST_READ,
    P.LICENSES_RENEW,
    P.INVENTORY_READ,
    // Read-only: repair and service costs are financial data, so Finance can
    // see maintenance records — running repairs stays with IT (maintenance:manage).
    P.MAINTENANCE_READ,
    P.INVOICES_READ,
    P.INVOICES_UPLOAD,
    P.INVOICES_CORRECT_EXTRACTION,
    P.INVOICES_VERIFY,
    P.VENDORS_READ,
    P.VENDORS_MANAGE,
    P.PURCHASE_ORDERS_READ,
    P.PURCHASE_ORDERS_MANAGE,
    P.REQUESTS_ASSESS,
    P.REQUESTS_CREATE,
    // v2.24 - whoever may raise a request may withdraw their own. The route
    // is guarded by this permission, so without it a specialist who raised a
    // ticket could not cancel it - only Registered Employees could.
    P.REQUESTS_CANCEL,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.AI_REVIEW_RESULTS,
    P.AUDIT_READ,
  ],

  MANAGER: [
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    // v2.24 - whoever may raise a request may withdraw their own. The route
    // is guarded by this permission, so without it a specialist who raised a
    // ticket could not cancel it - only Registered Employees could.
    P.REQUESTS_CANCEL,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.EMPLOYEES_READ,
    P.REPORTS_READ,
  ],

  EMPLOYEE: [
    P.PROCUREMENT_PR_CREATE,
    P.PROCUREMENT_PR_READ,
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_CANCEL,
    // maintenance:request removed (v2.12): no endpoint ever enforced it -
    // employees report issues through Requests (DAMAGE/REPAIR), and a grant
    // that gates nothing only misleads an auditor reading the matrix.
  ],

  AUDITOR: [
    P.ANALYTICS_READ,
    P.ASSETS_READ,
    // Asset price is Finance + Super Admin only (per product decision), so the
    // read-only auditor no longer sees costs or the financial spend reports.
    P.INVENTORY_READ,
    P.INVOICES_READ,
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_READ,
    P.EMPLOYEES_READ,
    P.MAINTENANCE_READ,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.USERS_READ,
    P.AUDIT_READ,
    P.LICENSES_READ,
    P.PROCUREMENT_PR_READ,
    P.DISCOVERY_READ,
  ],

  // Tenant owner. In single-company v1 this is grant-equivalent to Super Admin;
  // the two differ by authority plane (Super Admin = platform/MSP), which becomes
  // meaningful once platform:* permissions and multi-tenant MSP land.
  COMPANY_ADMIN: ALL_PERMISSIONS,

  // Executes IT work — deploy, assign, repair. A subset of IT_ADMIN (IT Manager).
  IT_TECHNICIAN: [
    P.ASSETS_READ,
    P.DISCOVERY_READ,
    P.DISCOVERY_RECONCILE,
    P.LICENSES_READ,
    P.LICENSES_ASSIGN,
    P.LICENSES_REVOKE,
    P.ASSETS_UPDATE,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    P.MAINTENANCE_READ,
    P.MAINTENANCE_MANAGE,
    P.REQUESTS_READ,
    P.QR_GENERATE,
    P.QR_PRINT,
  ],

  // Sourcing and purchasing. Owns vendors + POs; approves requests.
  PROCUREMENT_MANAGER: [
    P.VENDOR_PRODUCTS_READ,
    P.VENDOR_PRODUCTS_MANAGE,
    P.VENDOR_PRODUCTS_REVIEW,
    P.ASSETS_READ,
    P.PROCUREMENT_RFQ_MANAGE,
    P.PROCUREMENT_PR_CREATE,
    P.PROCUREMENT_PR_READ,
    P.PROCUREMENT_PR_APPROVE,
    P.PROCUREMENT_PR_CONVERT,
    P.PROCUREMENT_PO_ISSUE,
    P.PROCUREMENT_RECEIVE,
    P.LICENSES_READ,
    P.LICENSES_CREATE,
    P.LICENSES_UPDATE,
    P.LICENSES_RENEW,
    P.VENDORS_READ,
    P.VENDORS_MANAGE,
    P.PURCHASE_ORDERS_READ,
    P.PURCHASE_ORDERS_MANAGE,
    P.INVOICES_READ,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REQUESTS_DECLINE,
    P.REPORTS_READ,
  ],

  // Stockroom / warehouse. Renamed+widened from the legacy "Asset Manager".
  INVENTORY_MANAGER: [
    P.ASSETS_READ,
    /**
     * v2.26 - an Inventory Manager could not see a request at all, let alone
     * answer one. The role owns stock, and "is this already on the shelf?" is
     * the inventory question in the request flow: the Inventory check stage
     * exists to ask it. Without these two the role could be named on that stage
     * and still be refused at the door - which is exactly what happened when
     * the owner assigned it and the request stayed invisible.
     *
     * READ and ASSESS only. Assessing is recording what stock says; approving
     * is a judgement about whether the company should spend, and that stays
     * with the approving roles.
     */
    P.REQUESTS_READ,
    P.REQUESTS_ASSESS,
    P.REQUESTS_DECLINE,
    P.PROCUREMENT_PR_READ,
    P.PROCUREMENT_RECEIVE,
    P.PURCHASE_ORDERS_READ,
    P.INVENTORY_LOCATIONS_MANAGE,
    P.INVENTORY_TRANSFER,
    P.INVENTORY_CONVERT,
    P.ASSETS_CREATE,
    P.ASSETS_UPDATE,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    P.QR_GENERATE,
    P.QR_PRINT,
    P.REPORTS_READ,
  ],
  /**
   * External supplier users. Everything here is scoped to the vendor's own rows
   * by vendorId in the service layer - the permission says "may manage a
   * catalogue", the scope decides whose.
   *
   * Note what is absent: no assets, no people, no inventory, no requests, no
   * internal pricing or comparison. A supplier is a guest in this tenant, and
   * the grant list is the place that has to stay boring.
   */
  VENDOR: [
    P.VENDOR_PORTAL_ACCESS,
    P.VENDOR_PRODUCTS_READ,
    P.VENDOR_PRODUCTS_MANAGE,
    P.VENDOR_ORDERS_READ,
    P.VENDOR_INVOICES_READ,
    P.VENDOR_QUOTES_RESPOND,
  ],

  // External supplier. The vendor-portal module does not exist yet, so this role
  // is seeded as an assignable placeholder with no permissions until it ships.
};

/**
 * Default read scope per role. A role holding `assets:read` still only sees what
 * its scope allows; EMPLOYEE is pinned to OWN, which is what makes spec section 3's
 * "Employees must not see other employees' assets" structural rather than advisory.
 */
export const ROLE_DEFAULT_SCOPE: Readonly<Record<SystemRole, DataScope>> = {
  SUPER_ADMIN: 'ALL',
  IT_ADMIN: 'ALL',
  HR: 'ALL',
  OFFICE_ADMIN: 'ALL',
  FINANCE: 'ALL',
  MANAGER: 'DIRECT_REPORTS',
  EMPLOYEE: 'OWN',
  AUDITOR: 'ALL',
  // v2.1 Workstream C — the five net-new canonical roles.
  COMPANY_ADMIN: 'ALL',
  IT_TECHNICIAN: 'ALL',
  PROCUREMENT_MANAGER: 'ALL',
  INVENTORY_MANAGER: 'ALL',
  /// External supplier: only ever its own records.
  VENDOR: 'OWN',
};

/**
 * Roles that may never be granted a write permission, whatever an administrator
 * later configures. Spec section 3: the Auditor has "No create, edit, assignment,
 * approval, or deletion permission."
 */
export const READ_ONLY_ROLES: readonly SystemRole[] = ['AUDITOR'];

export class ReadOnlyRoleViolationError extends Error {
  constructor(role: SystemRole, permission: Permission) {
    super(`Role ${role} is read-only and may not be granted ${permission}`);
    this.name = 'ReadOnlyRoleViolationError';
  }
}

export function assertGrantAllowed(role: SystemRole, permission: Permission): void {
  if (READ_ONLY_ROLES.includes(role) && !isReadOnlyPermission(permission)) {
    throw new ReadOnlyRoleViolationError(role, permission);
  }
}

export function roleHasPermission(role: SystemRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Union of every permission across a user's roles. */
export function resolvePermissions(roles: readonly SystemRole[]): ReadonlySet<Permission> {
  const resolved = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) resolved.add(permission);
  }
  return resolved;
}

/** Narrowest scope wins when a user holds several roles. */
export function resolveScope(roles: readonly SystemRole[]): DataScope {
  const precedence: readonly DataScope[] = ['OWN', 'DIRECT_REPORTS', 'DEPARTMENT', 'ALL'];
  let widest: DataScope = 'OWN';
  for (const role of roles) {
    const scope = ROLE_DEFAULT_SCOPE[role];
    if (precedence.indexOf(scope) > precedence.indexOf(widest)) widest = scope;
  }
  return widest;
}

const SYSTEM_ROLE_SET: ReadonlySet<string> = new Set(SYSTEM_ROLES);

// ---------------------------------------------------------------------------
// v2.1 Workstream C — module:resource:action taxonomy layer.
//
// v1 permissions are `resource:action`. The v2 blueprint groups them under a
// coarser `module` and allows wildcard grants (e.g. `assets:*`). This layer maps
// each permission to its module and provides wildcard matching, WITHOUT rewriting
// the existing strings — both the plain grant and a `module:*` grant resolve.
// ---------------------------------------------------------------------------

/** Blueprint module each v1 resource belongs to (blueprint §5). */
export const RESOURCE_MODULE: Readonly<Record<string, string>> = {
  assets: 'assets',
  qr: 'assets',
  inventory: 'inventory',
  invoices: 'procurement',
  vendors: 'procurement',
  'purchase-orders': 'procurement',
  requests: 'requests',
  employees: 'people',
  onboarding: 'people',
  offboarding: 'people',
  maintenance: 'maintenance',
  reports: 'reports',
  users: 'admin',
  roles: 'admin',
  permissions: 'admin',
  categories: 'admin',
  workflows: 'admin',
  settings: 'admin',
  ai: 'admin',
  audit: 'audit',
};

/** The resource segment (first `:`-separated token) of a permission. */
export function permissionResource(permission: string): string {
  return permission.split(':', 1)[0] ?? permission;
}

/** The blueprint module a permission belongs to (falls back to its resource). */
export function permissionModule(permission: string): string {
  const resource = permissionResource(permission);
  return RESOURCE_MODULE[resource] ?? resource;
}

/**
 * Does a grant satisfy a required permission? Supports `*` wildcard segments,
 * so `assets:*` matches `assets:read` and `assets:cost:read`, `*` matches
 * anything, and a plain grant matches only itself. Non-trailing wildcards match
 * exactly one segment (`assets:*:read`).
 */
export function permissionMatches(grant: string, required: string): boolean {
  if (grant === required) return true;
  const g = grant.split(':');
  const r = required.split(':');
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '*') {
      // A trailing `*` covers one-or-more remaining segments; a middle `*`
      // matches exactly the one segment at this position.
      if (i === g.length - 1) return r.length > i;
      if (r[i] === undefined) return false;
      continue;
    }
    if (g[i] !== r[i]) return false;
  }
  return g.length === r.length;
}

/** True when any of the held grants (possibly wildcards) satisfies `required`. */
export function grantsSatisfy(grants: readonly string[], required: string): boolean {
  return grants.some((grant) => permissionMatches(grant, required));
}

/** A user's assignment of a role, with an optional per-assignment scope override. */
export interface RoleAssignment {
  readonly roleKey: string;
  /** Overrides the role's default scope for this user; null/undefined = use the default. */
  readonly scopeOverride?: DataScope | null;
}

/**
 * v2.1 Workstream C — effective scope honouring a per-assignment override.
 *
 * Each assignment resolves to `scopeOverride ?? ROLE_DEFAULT_SCOPE[role]` (unknown
 * roles fail closed to OWN); the widest across all of a user's assignments wins,
 * exactly like {@link resolveScope}. With no overrides this equals
 * `resolveScope` over the known roles, so it is a safe superset of v1 behaviour.
 */
export function resolveEffectiveScope(assignments: readonly RoleAssignment[]): DataScope {
  const precedence: readonly DataScope[] = ['OWN', 'DIRECT_REPORTS', 'DEPARTMENT', 'ALL'];
  let widest: DataScope = 'OWN';
  for (const a of assignments) {
    const roleDefault: DataScope = SYSTEM_ROLE_SET.has(a.roleKey)
      ? ROLE_DEFAULT_SCOPE[a.roleKey as SystemRole]
      : 'OWN';
    const effective = a.scopeOverride ?? roleDefault;
    if (precedence.indexOf(effective) > precedence.indexOf(widest)) widest = effective;
  }
  return widest;
}
