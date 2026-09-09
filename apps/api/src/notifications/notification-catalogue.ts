import type { NotificationType } from '@prisma/client';

/**
 * Notification catalogue (spec section 19).
 *
 * `mandatory` marks the ones a user may not switch off. Spec section 19: "Allow
 * users to configure notification preferences while preserving mandatory
 * security and workflow notifications." A user who has muted approval requests
 * silently stalls everyone else's work, and muting a security alert defeats the
 * alert, so those are not preferences.
 */
export interface NotificationDefinition {
  type: NotificationType;
  title: string;
  mandatory: boolean;
  /** Channels this type may use, subject to preference. */
  channels: readonly ('IN_APP' | 'EMAIL' | 'PUSH')[];
}

export const NOTIFICATION_CATALOGUE: Readonly<Record<NotificationType, NotificationDefinition>> = {
  NEW_REQUEST: {
    type: 'NEW_REQUEST',
    title: 'New request',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  APPROVAL_REQUIRED: {
    type: 'APPROVAL_REQUIRED',
    title: 'Approval required',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  // v2.2 Workstream D — an approval step past its SLA, escalated to the manager.
  APPROVAL_ESCALATED: {
    type: 'APPROVAL_ESCALATED',
    title: 'Approval overdue',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  REQUEST_APPROVED: {
    type: 'REQUEST_APPROVED',
    title: 'Request approved',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  USER_INVITED: {
    type: 'USER_INVITED',
    title: 'Account invitation',
    mandatory: true,
    channels: ['EMAIL'],
  },
  INVITE_REMINDER: {
    type: 'INVITE_REMINDER',
    title: 'Invitation reminder',
    mandatory: false,
    channels: ['EMAIL'],
  },
  INVITE_EXPIRED: {
    type: 'INVITE_EXPIRED',
    title: 'Invitation expired',
    mandatory: false,
    channels: ['EMAIL'],
  },
  USER_WELCOME: {
    type: 'USER_WELCOME',
    title: 'Welcome after activation',
    mandatory: false,
    channels: ['EMAIL'],
  },
  USER_ACTIVATED: {
    type: 'USER_ACTIVATED',
    title: 'User account activated',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  USER_REACTIVATED: {
    type: 'USER_REACTIVATED',
    title: 'Account reactivated',
    mandatory: false,
    channels: ['EMAIL'],
  },
  ROLE_CHANGED: {
    type: 'ROLE_CHANGED',
    title: 'Access updated',
    mandatory: false,
    channels: ['EMAIL'],
  },
  PASSWORD_RESET: {
    type: 'PASSWORD_RESET',
    title: 'Password reset',
    mandatory: true,
    channels: ['EMAIL'],
  },
  ASSET_RETURNED: {
    type: 'ASSET_RETURNED',
    title: 'Asset returned',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  ASSET_TRANSFERRED: {
    type: 'ASSET_TRANSFERRED',
    title: 'Asset transferred',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  ASSET_MISSING: {
    type: 'ASSET_MISSING',
    title: 'Asset missing',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  USER_CREATED: {
    type: 'USER_CREATED',
    title: 'New employee added',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  USER_DEACTIVATED: {
    type: 'USER_DEACTIVATED',
    title: 'Employee offboarding',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  DAILY_DIGEST: {
    type: 'DAILY_DIGEST',
    title: 'Daily summary',
    mandatory: false,
    channels: ['EMAIL'],
  },
  REQUEST_COMMENT: {
    type: 'REQUEST_COMMENT',
    title: 'Reply on a request',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  REQUEST_REJECTED: {
    type: 'REQUEST_REJECTED',
    title: 'Request rejected',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  ASSET_ORDERED: {
    type: 'ASSET_ORDERED',
    title: 'Asset ordered',
    mandatory: false,
    channels: ['IN_APP'],
  },
  ASSET_RECEIVED: {
    type: 'ASSET_RECEIVED',
    title: 'Asset received',
    mandatory: false,
    channels: ['IN_APP'],
  },
  ASSET_READY: {
    type: 'ASSET_READY',
    title: 'Asset ready for collection',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  ASSET_ASSIGNED: {
    type: 'ASSET_ASSIGNED',
    title: 'Asset assigned to you',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RECEIPT_CONFIRMATION: {
    type: 'RECEIPT_CONFIRMATION',
    title: 'Confirm receipt',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RETURN_REQUIRED: {
    type: 'RETURN_REQUIRED',
    title: 'Return required',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  },
  RETURN_OVERDUE: {
    type: 'RETURN_OVERDUE',
    title: 'Return overdue',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  DAMAGE_REPORTED: {
    type: 'DAMAGE_REPORTED',
    title: 'Damage reported',
    mandatory: false,
    channels: ['IN_APP'],
  },
  INVOICE_UPLOADED: {
    type: 'INVOICE_UPLOADED',
    title: 'Invoice uploaded',
    mandatory: false,
    channels: ['IN_APP'],
  },
  AI_PROCESSING_COMPLETED: {
    type: 'AI_PROCESSING_COMPLETED',
    title: 'AI processing completed',
    mandatory: false,
    channels: ['IN_APP'],
  },
  AI_PROCESSING_FAILED: {
    type: 'AI_PROCESSING_FAILED',
    title: 'AI processing failed',
    mandatory: false,
    channels: ['IN_APP'],
  },
  INVOICE_MISMATCH: {
    type: 'INVOICE_MISMATCH',
    title: 'Invoice mismatch',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  WARRANTY_EXPIRATION: {
    type: 'WARRANTY_EXPIRATION',
    title: 'Warranty expiring',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  MAINTENANCE_DUE: {
    type: 'MAINTENANCE_DUE',
    title: 'Maintenance due',
    mandatory: false,
    channels: ['IN_APP'],
  },
  LOW_STOCK: { type: 'LOW_STOCK', title: 'Low stock', mandatory: false, channels: ['IN_APP'] },
  // v2.9 C4: email as well as in-app, because stock going off is a deadline
  // rather than a state - nobody discovers it by opening the app in time.
  STOCK_EXPIRING: {
    type: 'STOCK_EXPIRING',
    title: 'Stock expiring',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  REPLACEMENT_DUE: {
    type: 'REPLACEMENT_DUE',
    title: 'Replacement due',
    mandatory: false,
    channels: ['IN_APP'],
  },
  // v2.3 licenses — renewals to plan; a refused seat must never pass silently.
  LICENSE_EXPIRING: {
    type: 'LICENSE_EXPIRING',
    title: 'License expiring',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  SEAT_LIMIT_REACHED: {
    type: 'SEAT_LIMIT_REACHED',
    title: 'License limit reached',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  SECURITY_ALERT: {
    type: 'SECURITY_ALERT',
    title: 'Security alert',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  // v2.5 work orders — the technician must know, and an overdue SLA must not
  // pass silently.
  WORK_ORDER_ASSIGNED: {
    type: 'WORK_ORDER_ASSIGNED',
    title: 'Work order assigned',
    mandatory: false,
    channels: ['IN_APP'],
  },
  WORK_ORDER_ESCALATED: {
    type: 'WORK_ORDER_ESCALATED',
    title: 'Work order overdue',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  // v2.6 scheduled reports - the owner always learns the outcome, especially
  // failure: a report that silently stopped arriving is a lie by omission.
  REPORT_DELIVERED: {
    type: 'REPORT_DELIVERED',
    title: 'Scheduled report delivered',
    mandatory: false,
    channels: ['IN_APP'],
  },
  REPORT_FAILED: {
    type: 'REPORT_FAILED',
    title: 'Scheduled report failed',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  // ── v2.50 the supplier catalogue ──────────────────────────────────────────
  //
  // Email on all of them. A supplier is not a colleague with the app open in a
  // tab; they are somebody else's employee who logs in when there is a reason
  // to, and an in-app bell nobody sees is not a notification.
  VENDOR_PRODUCT_SUBMITTED: {
    type: 'VENDOR_PRODUCT_SUBMITTED',
    title: 'Product submitted for review',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_PRODUCT_APPROVED: {
    type: 'VENDOR_PRODUCT_APPROVED',
    title: 'Product approved',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_PRODUCT_REJECTED: {
    // Mandatory: a rejection is the one message the supplier must act on, and
    // an offer sitting rejected and unread helps nobody on either side.
    type: 'VENDOR_PRODUCT_REJECTED',
    title: 'Product needs changes',
    mandatory: true,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_PRODUCT_EXPIRING: {
    type: 'VENDOR_PRODUCT_EXPIRING',
    title: 'Offer about to come off sale',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_PRODUCT_LOW_STOCK: {
    // Only fires where the supplier set a threshold, so it is a line they drew
    // themselves rather than a number we guessed for them.
    type: 'VENDOR_PRODUCT_LOW_STOCK',
    title: 'Offer running low',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_PRODUCT_OUT_OF_STOCK: {
    type: 'VENDOR_PRODUCT_OUT_OF_STOCK',
    title: 'Offer out of stock',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
  VENDOR_OFFER_SELECTED: {
    // The good news, and the one they will want fastest.
    type: 'VENDOR_OFFER_SELECTED',
    title: 'Your offer was chosen',
    mandatory: false,
    channels: ['IN_APP', 'EMAIL'],
  },
};

export function isMandatory(type: NotificationType): boolean {
  return NOTIFICATION_CATALOGUE[type].mandatory;
}
