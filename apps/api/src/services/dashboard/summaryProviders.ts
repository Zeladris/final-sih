import { SECTION_STATUSES } from '@kisansetu/shared';
import type { BookingSummary, Language, NotificationSummary } from '@kisansetu/shared';

/**
 * Dashboard section providers (§12, §13, §31).
 *
 * Booking and notifications belong to later phases. Rather than leave holes in
 * the dashboard or invent data to fill them, each section has a provider
 * interface with a deliberately empty implementation that reports
 * NOT_AVAILABLE.
 *
 * That distinction is the point: "you have no bookings" and "bookings do not
 * exist yet" are different claims, and only one of them is currently true
 * (§37). When Phase 4 lands, it supplies a real provider here and nothing else
 * on the dashboard changes.
 */

export interface BookingSummaryProvider {
  readonly name: string;
  forFarmer(farmerUserId: string): Promise<BookingSummary>;
}

export interface NotificationSummaryProvider {
  readonly name: string;
  forFarmer(farmerUserId: string, language: Language): Promise<NotificationSummary>;
}

/** Phase 4 replaces this. It queries nothing and invents nothing. */
export class UnimplementedBookingProvider implements BookingSummaryProvider {
  readonly name = 'UnimplementedBookingProvider';

  async forFarmer(): Promise<BookingSummary> {
    return {
      status: SECTION_STATUSES.NOT_AVAILABLE,
      upcoming: null,
      active: null,
      mostRecentCompleted: null,
    };
  }
}

/** Phase 11 replaces this. */
export class UnimplementedNotificationProvider implements NotificationSummaryProvider {
  readonly name = 'UnimplementedNotificationProvider';

  async forFarmer(_farmerUserId: string, _language: Language): Promise<NotificationSummary> {
    return {
      status: SECTION_STATUSES.NOT_AVAILABLE,
      unreadCount: 0,
      recent: [],
    };
  }
}

let bookingProvider: BookingSummaryProvider = new UnimplementedBookingProvider();
let notificationProvider: NotificationSummaryProvider = new UnimplementedNotificationProvider();

/** Registration seams, so a later phase swaps a provider without editing the service. */
export function setBookingSummaryProvider(provider: BookingSummaryProvider): void {
  bookingProvider = provider;
}

export function setNotificationSummaryProvider(provider: NotificationSummaryProvider): void {
  notificationProvider = provider;
}

export function activeBookingProvider(): BookingSummaryProvider {
  return bookingProvider;
}

export function activeNotificationProvider(): NotificationSummaryProvider {
  return notificationProvider;
}
