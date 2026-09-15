-- ===========================================================================
-- Language & Accessibility Rework — five languages (§76, §110, §111, §112)
--
-- Widens the language constraint the profiles table already had (it
-- anticipated 'hi' but the frontend never wired it) to all five supported
-- languages, and extends the two free-text-prose tables — notifications and
-- farmer_messages — with kn/hi/ml columns alongside the existing en/ta ones.
-- One row per event/message still; never five duplicate rows for one thing.
-- ===========================================================================

alter table public.profiles drop constraint if exists profiles_language_supported;
alter table public.profiles
  add constraint profiles_language_supported check (preferred_language in ('en', 'ta', 'kn', 'hi', 'ml'));

alter table public.notifications
  add column if not exists title_kn text,
  add column if not exists title_hi text,
  add column if not exists title_ml text,
  add column if not exists body_kn text,
  add column if not exists body_hi text,
  add column if not exists body_ml text;

alter table public.farmer_messages
  add column if not exists title_kn text,
  add column if not exists title_hi text,
  add column if not exists title_ml text,
  add column if not exists body_kn text,
  add column if not exists body_hi text,
  add column if not exists body_ml text;

-- The bulk-insert in farmerMessageService.ts carries all five language
-- variants across from farmer_messages to notifications, so a message
-- authored in Kannada is not silently dropped for a Kannada-reading farmer.
comment on column public.notifications.title_kn is
  'Free-text prose, populated only for category = GOVERNMENT_MESSAGE, mirroring title_en/title_ta (Phase: Language Rework §112).';
