-- ==============================================================================
-- Migration: 20261022000000_harden_database_functions.sql
-- Description: Security hardening for database functions:
--              1. Set explicit search_path = '' on SECURITY DEFINER functions to
--                 prevent search-path hijacking and privilege escalation.
--              2. Schema-qualify all table, function, and operator references.
--              3. Revoke default execution privileges from PUBLIC, anon,
--                 and authenticated roles on sensitive functions.
--              4. Grant EXECUTE only to authorized server-side service_role.
-- ==============================================================================

-- 1. Harden public.is_admin(UUID)
-- Function checks if a given user_id exists in public.admin_users.
-- Intended authorization flow: Used by service_role (e.g. backend Edge Functions)
-- to verify administrative status.
-- Anonymous visitors and general authenticated users must NOT be able to invoke
-- this function via PostgREST RPC to probe or enumerate admin account status.

CREATE OR REPLACE FUNCTION public.is_admin(lookup_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = lookup_user_id
    );
$$;

-- Revoke all execution rights from untrusted roles
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM authenticated;

-- Grant execution strictly to service_role
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO service_role;

-- 2. Harden public.claim_next_ai_job(TEXT)
-- Function atomically claims the next pending job from public.ai_service_jobs
-- using FOR UPDATE SKIP LOCKED.
-- Intended execution flow: The background queue worker invokes this function
-- using the Supabase service-role client.
-- Anonymous visitors and authenticated non-admin users must NEVER be able to
-- claim jobs, lock queue items, or inspect job payloads.

CREATE OR REPLACE FUNCTION public.claim_next_ai_job(worker_id TEXT)
RETURNS SETOF public.ai_service_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.ai_service_jobs
    SET status = 'processing',
        locked_at = pg_catalog.now(),
        locked_by = worker_id,
        updated_at = pg_catalog.now()
    WHERE id = (
        SELECT id
        FROM public.ai_service_jobs
        WHERE (status = 'queued' OR (status = 'processing' AND locked_at < pg_catalog.now() - INTERVAL '5 minutes'))
          AND retry_count < max_retries
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$;

-- Revoke all execution rights from untrusted roles
REVOKE ALL ON FUNCTION public.claim_next_ai_job(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_ai_job(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_next_ai_job(TEXT) FROM authenticated;

-- Grant execution strictly to service_role
GRANT EXECUTE ON FUNCTION public.claim_next_ai_job(TEXT) TO service_role;

-- Documentation comments
COMMENT ON FUNCTION public.is_admin(UUID) IS 'Checks admin authorization against public.admin_users. Restricted to service_role with explicit search_path.';
COMMENT ON FUNCTION public.claim_next_ai_job(TEXT) IS 'Atomic job claiming mechanism with FOR UPDATE SKIP LOCKED. Restricted to service_role with explicit search_path.';
