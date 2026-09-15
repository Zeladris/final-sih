-- ===========================================================================
-- Phase 0 / 0008 — private document storage (§29, §30)
--
-- Path shape: farmer-documents/<farmer-user-id>/<document-id>/<filename>
-- The first path segment is the owning user's id, which is what the policies
-- below key off. Identity numbers never appear in a path or a filename.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farmer-documents',
  'farmer-documents',
  false,                                              -- PRIVATE. Never flip this.
  10485760,                                           -- 10 MB, mirrors MAX_UPLOAD_BYTES
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are reachable only through short-lived signed URLs minted by the
-- API after it has checked role and scope. These policies are what make the
-- signing call itself safe: the API signs using the *caller's* token, so a
-- request for someone else's object fails in the database, not just in code.

create policy farmer_documents_objects_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy farmer_documents_objects_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy farmer_documents_objects_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy: documents are immutable once uploaded. Replacing one
-- means deleting the unreviewed original and uploading again, which leaves
-- an audit trail of both events.
