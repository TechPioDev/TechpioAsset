/**
 * Retention policy per model (spec section 22).
 *
 * Kept free of Nest and Prisma imports so it can be asserted against
 * schema.prisma directly in a unit test - the lists and the schema drifting apart
 * is exactly the failure that would silently disable a soft-delete filter.
 */

/** Models carrying `deletedAt`; reads exclude soft-deleted rows by default. */
export const SOFT_DELETABLE_MODELS = new Set<string>([
  'Company',
  'User',
  'Role',
  'Office',
  'Building',
  'Floor',
  'Room',
  'Department',
  'Category',
  'Subcategory',
  'Asset',
  'InventoryItem',
  'Vendor',
  // v2.42 - a withdrawn offer stays readable: a purchase approved against it
  // must still be explainable months later.
  'CategorySpecField',
  'VendorProduct',
  'PurchaseOrder',
  'Invoice',
  'InvoiceDocument',
  'AssetRequest',
  'RequestComment',
  'MaintenanceRecord',
  'SoftwareLicense',
  'PurchaseRequest',
  'StockLocation',
  // v2.6 A3: webhook subscriptions soft-delete so delivery history survives.
  'WebhookSubscription',
  'Attachment',
  'WorkflowDefinition',
  'OnboardingTemplate',
  'SavedFilter',
  'ScheduledReport',
  // v2.9 C2: a retired cost centre still has to explain last year's spend, so
  // both soft-delete rather than vanish from the history that references them.
  'CostCentre',
  'Budget',
  // v2.9 C3: an abandoned RFQ still explains why an order went where it did.
  'QuoteRequest',
]);

/**
 * Models with no delete path at all. Financial records, assignment history and
 * audit rows are retained; removing one is a data-integrity incident, not a
 * routine operation, so the ORM refuses rather than relying on reviewer vigilance.
 */
export const UNDELETABLE_MODELS = new Set<string>([
  'AuditLog',
  'AssetAssignment',
  'AssetReturn',
  'AssetTransfer',
  'AssetConditionLog',
  'InventoryTransaction',
  'InvoiceExtraction',
  'InvoiceVerification',
  'DisposalRecord',
  'AIUsageRecord',
]);

export class UndeletableModelError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only and cannot be ${operation}d. ` +
        'Financial, assignment and audit history are retained (spec section 22).',
    );
    this.name = 'UndeletableModelError';
  }
}
