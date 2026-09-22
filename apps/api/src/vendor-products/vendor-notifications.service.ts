import { Injectable, Logger } from '@nestjs/common';
import { formatInr } from '@techpioasset/domain';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Telling a supplier what happened to its listings (v2.50).
 *
 * A supplier is not a colleague with the app open in a tab. They are somebody
 * else's employee who logs in when there is a reason to, so an in-app bell
 * nobody sees is not a notification - every one of these goes out by email too.
 *
 * Every method here swallows its own failures. A notification is a courtesy
 * attached to something that has already happened: an offer that was approved
 * stays approved whether or not the mail server was reachable, and letting a
 * dead SMTP host roll back an approval would be the tail wagging the dog.
 */
@Injectable()
export class VendorNotificationsService {
  private readonly logger = new Logger(VendorNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The people to tell: every active account linked to this vendor.
   *
   * A supplier may have several logins - a sales contact and someone who keeps
   * the listings current - and which of them pressed the button last is not a
   * reason to leave the others uninformed.
   */
  private async accountsFor(companyId: string, vendorId: string): Promise<string[]> {
    const users = await this.prisma.client.user.findMany({
      where: { companyId, vendorId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
      take: 25,
    });
    return users.map((u) => u.id);
  }

  private async tell(
    companyId: string,
    vendorId: string,
    input: Parameters<NotificationsService['notifyMany']>[1],
  ) {
    try {
      const userIds = await this.accountsFor(companyId, vendorId);
      if (userIds.length === 0) return;
      await this.notifications.notifyMany(userIds, input);
    } catch (error) {
      this.logger.warn(
        `Could not notify vendor ${vendorId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * A buyer asked this supplier for a quote (v2.78).
   *
   * What they are asked for and by when - and nothing else. Never a price
   * (not our estimate, not anyone's quote) and never who else was asked: the
   * supplier sees its own request exactly as if it were the only one. There
   * is no quote screen in the supplier portal yet, so the message says who to
   * answer rather than linking to a page that does not exist.
   */
  async quoteRequested(input: {
    companyId: string;
    vendorId: string;
    rfqId: string;
    rfqNumber: string;
    companyName: string;
    dueDate: Date | null;
    lines: { description: string; quantity: number }[];
    buyer: { name: string; email: string } | null;
  }): Promise<void> {
    const items = input.lines.map((l) => `${l.quantity} × ${l.description}`);
    const shown =
      items.slice(0, 3).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');
    const due = input.dueDate
      ? ` by ${input.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      : '';
    const answer = input.buyer
      ? ` Reply${due} to ${input.buyer.name} (${input.buyer.email}).`
      : due
        ? ` Please reply${due}.`
        : '';
    await this.tell(input.companyId, input.vendorId, {
      companyId: input.companyId,
      type: 'RFQ_REQUESTED',
      title: `Quote requested: ${input.rfqNumber}`,
      body: `${input.companyName} asks you to quote for ${shown}.${answer}`,
      entityType: 'QuoteRequest',
      entityId: input.rfqId,
      emailRows: [
        ['Reference', input.rfqNumber],
        ...input.lines.map((l, i): [string, string] => [
          `Item ${i + 1}`,
          `${l.quantity} × ${l.description}`,
        ]),
        ...(input.dueDate ? ([['Reply by', due.replace(/^ by /, '')]] as [string, string][]) : []),
        ...(input.buyer
          ? ([['Contact', `${input.buyer.name} — ${input.buyer.email}`]] as [string, string][])
          : []),
      ],
    });
  }

  /** Somebody internal approved the offer, and buyers can see it now. */
  async approved(product: {
    companyId: string;
    vendorId: string;
    id: string;
    name: string;
  }): Promise<void> {
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_PRODUCT_APPROVED',
      title: 'Product approved',
      body: `"${product.name}" has been approved and buyers can see it now.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
    });
  }

  /** Turned down, or sent back for changes. The reason is the whole message. */
  async rejected(
    product: { companyId: string; vendorId: string; id: string; name: string },
    reason: string | null,
  ): Promise<void> {
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_PRODUCT_REJECTED',
      title: 'Product needs changes',
      // Without the reason this is just bad news, and the supplier has to ask
      // what to fix - which is a second round trip nobody needed.
      body: reason
        ? `"${product.name}" was not approved: ${reason}`
        : `"${product.name}" was not approved.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
      ...(reason ? { emailRows: [['Reason', reason]] as [string, string][] } : {}),
    });
  }

  /** A buyer chose this offer. The one they will want fastest. */
  async selected(
    product: { companyId: string; vendorId: string; id: string },
    detail: { productName: string; quantity: number; totalCost: unknown },
  ): Promise<void> {
    const total = formatInr(Number(detail.totalCost));
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_OFFER_SELECTED',
      title: 'Your offer was chosen',
      body: `"${detail.productName}" was selected — ${detail.quantity} unit${detail.quantity === 1 ? '' : 's'}, ${total}.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
      emailRows: [
        ['Quantity', String(detail.quantity)],
        ['Total', total],
      ],
    });
  }

  /** Its end date is close, and buyers stop seeing it after that. */
  async expiring(
    product: { companyId: string; vendorId: string; id: string; name: string },
    daysLeft: number,
  ): Promise<void> {
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_PRODUCT_EXPIRING',
      title: 'Offer about to come off sale',
      body:
        daysLeft > 0
          ? `"${product.name}" comes off sale in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Buyers stop seeing it after that.`
          : `"${product.name}" has come off sale. Buyers can no longer see it.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
    });
  }

  /** Running down past the line the supplier drew for itself. */
  async lowStock(
    product: { companyId: string; vendorId: string; id: string; name: string },
    sellable: number,
  ): Promise<void> {
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_PRODUCT_LOW_STOCK',
      title: 'Offer running low',
      body: `"${product.name}" is down to ${sellable} unit${sellable === 1 ? '' : 's'} available, which is at or below the level you asked to be told about.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
    });
  }

  /** Approved and in date, but nothing left to sell - so invisible to buyers. */
  async outOfStock(product: {
    companyId: string;
    vendorId: string;
    id: string;
    name: string;
  }): Promise<void> {
    await this.tell(product.companyId, product.vendorId, {
      companyId: product.companyId,
      type: 'VENDOR_PRODUCT_OUT_OF_STOCK',
      title: 'Offer out of stock',
      body: `"${product.name}" shows no units available, so buyers cannot choose it. Set a quantity to put it back in front of them.`,
      linkPath: `/catalogue/${product.id}`,
      entityType: 'VendorProduct',
      entityId: product.id,
    });
  }
}
