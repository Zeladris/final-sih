import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackCategory, FeedbackView, Language } from '@kisansetu/shared';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';

/**
 * Feedback (§4, §5) — a snapshot of the moment, never mandatory anywhere it
 * is offered, never editable once given (the table is append-only at the
 * database — see the support migration).
 */

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  rating?: number | null;
  message?: string | null;
  bookingId?: string | null;
  procurementId?: string | null;
  centreId?: string | null;
}

interface FeedbackRow {
  id: string;
  category: FeedbackCategory;
  rating: number | null;
  message: string | null;
  created_at: string;
}

export async function submitFeedback(
  db: SupabaseClient,
  farmerUserId: string,
  language: Language,
  input: SubmitFeedbackInput,
): Promise<FeedbackView> {
  // The centre a farmer is giving feedback about is only ever resolved from
  // their own booking, never accepted as a bare id (§39) — a centreId with
  // no matching booking of the caller's own is silently dropped rather than
  // trusted.
  let centreId = input.centreId ?? null;
  if (input.bookingId) {
    const booking = unwrapMaybe<{ centre_id: string; farmer_user_id: string }>(
      await db
        .from('bookings')
        .select('centre_id, farmer_user_id')
        .eq('id', input.bookingId)
        .maybeSingle(),
      'bookings.forFeedback',
    );
    centreId = booking?.farmer_user_id === farmerUserId ? booking.centre_id : null;
  }

  const row = unwrapMaybe<FeedbackRow>(
    await db
      .from('feedback')
      .insert({
        farmer_user_id: farmerUserId,
        booking_id: input.bookingId ?? null,
        procurement_id: input.procurementId ?? null,
        centre_id: centreId,
        category: input.category,
        rating: input.rating ?? null,
        message: input.message?.trim() || null,
        language_code: language,
      })
      .select('id, category, rating, message, created_at')
      .single(),
    'feedback.insert',
  );

  if (!row) throw new Error('Could not record feedback.');

  return {
    id: row.id,
    category: row.category,
    rating: row.rating,
    message: row.message,
    createdAt: row.created_at,
  };
}

export async function listOwnFeedback(db: SupabaseClient, farmerUserId: string): Promise<FeedbackView[]> {
  const rows = unwrap<FeedbackRow[]>(
    await db
      .from('feedback')
      .select('id, category, rating, message, created_at')
      .eq('farmer_user_id', farmerUserId)
      .order('created_at', { ascending: false })
      .limit(50),
    'feedback.listOwn',
  );

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    rating: row.rating,
    message: row.message,
    createdAt: row.created_at,
  }));
}
