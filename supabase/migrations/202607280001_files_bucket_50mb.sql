-- Raise the files bucket size backstop from 10MB to 50MB, mirroring
-- MAX_FILE_SIZE_BYTES in lib/dashboard/files.ts. The route check is the
-- boundary users see; this limit only stops an oversize object landing if
-- the route check is ever bypassed.
--
-- allowed_mime_types stays deliberately unset: as of this migration the
-- application accepts any file type (see
-- docs/superpowers/specs/2026-07-28-document-upload-expansion-design.md).
update storage.buckets
set file_size_limit = 52428800
where id = 'files';

-- Rollback guidance:
-- update storage.buckets set file_size_limit = 10485760 where id = 'files';
