import type { NotificationType } from '@prisma/client';

/**
 * Default email templates (v2.18). A company row in email_templates overrides
 * these; absent both, the email falls back to the event's in-app title/body.
 * Subjects and bodies accept {{variable}} placeholders - see VARIABLE_HELP.
 */

export interface EmailTemplateDefinition {
  subject: string;
  heading: string;
  /** Paragraphs separated by blank lines; each supports variables. */
  body: string;
  ctaLabel?: string;
}

export const DEFAULT_EMAIL_TEMPLATES: Partial<Record<NotificationType, EmailTemplateDefinition>> = {
  WARRANTY_EXPIRATION: {
    subject:
      'Action required: warranty expiring in {{warranty.days_remaining}} days — {{asset.asset_tag}}',
    heading: 'Warranty expiring in {{warranty.days_remaining}} days',
    body: '{{asset.name}} ({{asset.asset_tag}}) is approaching the end of its warranty on {{warranty.expiry_date}}.\n\nPlease review the asset and determine whether it should be renewed, replaced, or retired before coverage ends.',
    ctaLabel: 'View asset',
  },
  ASSET_ASSIGNED: {
    subject: 'Asset assigned to you — {{asset.name}} ({{asset.asset_tag}})',
    heading: 'An asset has been assigned to you',
    body: '{{asset.name}} has been assigned to you. Please confirm receipt in PioAssets so the handover is complete.',
    ctaLabel: 'View asset',
  },
  ASSET_RETURNED: {
    subject: 'Asset returned — {{asset.name}} ({{asset.asset_tag}})',
    heading: 'An asset was returned to stock',
    body: '{{asset.name}} has been returned and is back in stock. Review its condition and accessories before reissuing.',
    ctaLabel: 'View asset',
  },
  ASSET_TRANSFERRED: {
    subject: 'Asset transfer — {{asset.name}} ({{asset.asset_tag}})',
    heading: 'An asset is being transferred',
    body: '{{asset.name}} is moving. Review the transfer details and confirm arrival at the destination.',
    ctaLabel: 'View asset',
  },
  ASSET_MISSING: {
    subject: 'URGENT: asset reported missing — {{asset.asset_tag}}',
    heading: 'An asset has been reported missing',
    body: '{{asset.name}} ({{asset.asset_tag}}) has been marked as lost or missing. Please investigate promptly and update the record with the outcome.',
    ctaLabel: 'View asset',
  },
  USER_CREATED: {
    subject: 'New employee added — {{subject.name}}',
    heading: 'A new person joined PioAssets',
    body: '{{subject.name}} has been added. Review their profile, assign a role if needed, and prepare any equipment they require.',
    ctaLabel: 'View profile',
  },
  USER_DEACTIVATED: {
    subject: 'Employee offboarding — action required — {{subject.name}}',
    heading: 'An account has been deactivated',
    body: "{{subject.name}}'s account has been deactivated.\n\nThe assets still assigned to this person require return before offboarding can be completed. Review the outstanding list and arrange collection.",
    ctaLabel: 'View profile',
  },
  WEEKLY_SUMMARY: {
    subject: 'PioAssets Monday summary — {{notification.date}}',
    heading: 'Your week in PioAssets',
    body: 'Here is what is waiting on people at the start of the week, and what happened last week.',
    ctaLabel: 'Open PioAssets dashboard',
  },
  DAILY_DIGEST: {
    subject: 'PioAssets daily summary — {{notification.date}}',
    heading: 'Your daily asset management summary',
    body: 'Here is what needs attention across the fleet today.',
    ctaLabel: 'Open PioAssets dashboard',
  },
  USER_INVITED: {
    subject: "You're invited to PioAssets — complete your account setup",
    heading: 'Welcome to PioAssets, {{user.first_name}}',
    body: "You've been invited by {{invited_by.name}} to join {{company.name}}'s PioAssets workspace — the place where the company's equipment, requests and approvals live.\n\nAccept the invitation to set your password and activate your account. The link is personal, works once, and expires on {{invitation.expiry_date}}.\n\nIf the button does not work, copy this link into your browser:\n{{invitation.accept_url}}\n\nAfter setup, sign in any time at {{system.url}}/login",
    ctaLabel: 'Accept Invitation & Set Up Account',
  },
  INVITE_REMINDER: {
    subject: 'Reminder: your PioAssets invitation is waiting',
    heading: 'Your PioAssets account is still waiting',
    body: 'The invitation {{invited_by.name}} sent you has not been used yet. Accept it to set your password and activate your account.\n\nThis fresh link replaces the earlier one and expires on {{invitation.expiry_date}}.\n\nIf the button does not work, copy this link into your browser:\n{{invitation.accept_url}}',
    ctaLabel: 'Accept Invitation',
  },
  INVITE_EXPIRED: {
    subject: 'Your PioAssets invitation has expired',
    heading: 'That invitation is no longer valid',
    body: 'The invitation link sent to you has expired and can no longer be used.\n\nPlease contact your PioAssets administrator to request a new invitation.',
    ctaLabel: 'Open PioAssets',
  },
  USER_WELCOME: {
    subject: 'Welcome to PioAssets, {{user.first_name}}!',
    heading: 'Your account is active',
    body: 'Your PioAssets account at {{company.name}} is set up and ready.\n\nSign in any time at {{system.url}}/login with your email address {{user.email}} and the password you just created. If you ever forget it, use "Forgot password" on that page to set a new one.\n\nDepending on your role you can view the equipment assigned to you, raise requests, report issues, and confirm handovers from your phone.',
    ctaLabel: 'Sign In to PioAssets',
  },
  USER_ACTIVATED: {
    subject: 'User account activated — {{subject.name}}',
    heading: 'An invited user just activated their account',
    body: '{{subject.name}} accepted their invitation and completed account setup.',
    ctaLabel: 'View user',
  },
  USER_REACTIVATED: {
    subject: 'Your PioAssets account has been reactivated',
    heading: 'Welcome back',
    body: 'Your PioAssets account at {{company.name}} is active again. Sign in with your usual email address.',
    ctaLabel: 'Sign In to PioAssets',
  },
  ROLE_CHANGED: {
    subject: 'Your PioAssets access has been updated',
    heading: 'Your access has changed',
    body: 'An administrator updated your role in PioAssets. The details of what changed are listed below; if anything looks wrong, contact your administrator.',
    ctaLabel: 'Review My Access',
  },
  PASSWORD_RESET: {
    subject: 'Reset your PioAssets password',
    heading: 'Password reset requested',
    body: 'Someone asked to reset the password for this PioAssets account. If that was you, use the button below — the link works once and expires shortly.\n\nIf you did not request this, you can ignore this email; your password remains unchanged.',
    ctaLabel: 'Reset Password',
  },
  RETURN_OVERDUE: {
    subject: 'Overdue return — {{asset.name}} ({{asset.asset_tag}})',
    heading: 'An asset return is overdue',
    body: 'The expected return date for {{asset.name}} has passed. Please follow up with the holder and update the record.',
    ctaLabel: 'View asset',
  },
  DAMAGE_REPORTED: {
    subject: 'Damage reported — {{asset.asset_tag}}',
    heading: 'An asset has been reported damaged',
    body: 'A damage report was filed for {{asset.name}}. Review the report and schedule an inspection or repair.',
    ctaLabel: 'View request',
  },
};

/** Variable reference shown in the template editor. */
export const VARIABLE_HELP: { group: string; vars: string[] }[] = [
  { group: 'Recipient', vars: ['{{user.name}}', '{{user.email}}'] },
  {
    group: 'Person concerned',
    vars: ['{{subject.name}}', '{{subject.email}}', '{{subject.department}}'],
  },
  {
    group: 'Asset',
    vars: [
      '{{asset.name}}',
      '{{asset.asset_tag}}',
      '{{asset.serial_number}}',
      '{{asset.category}}',
      '{{asset.manufacturer}}',
      '{{asset.model}}',
      '{{asset.status}}',
      '{{asset.location}}',
      '{{asset.assigned_to}}',
      '{{asset.purchase_date}}',
    ],
  },
  {
    group: 'Warranty',
    vars: ['{{warranty.expiry_date}}', '{{warranty.days_remaining}}', '{{warranty.provider}}'],
  },
  {
    group: 'Onboarding',
    vars: [
      '{{user.first_name}}',
      '{{invited_by.name}}',
      '{{invitation.expiry_date}}',
      '{{invitation.accept_url}}',
    ],
  },
  {
    group: 'Company & system',
    vars: ['{{company.name}}', '{{system.url}}', '{{notification.date}}', '{{notification.time}}'],
  },
];
