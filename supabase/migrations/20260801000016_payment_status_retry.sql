-- ===========================================================================
-- Phase 8 / 0016 — the RETRY_PENDING payment status
--
-- On its own because a new enum value cannot be used in the same transaction
-- that adds it; 0017 uses it.
-- ===========================================================================

alter type public.payment_status add value if not exists 'RETRY_PENDING';
