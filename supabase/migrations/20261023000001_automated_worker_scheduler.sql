-- ==============================================================================
-- Migration: 20261023000001_automated_worker_scheduler.sql
-- Description: Automated background queue worker invocation setup for Supabase.
-- Note: As per safety constraints, this local migration provides the exact
--       production-ready SQL definitions for automated invocation via pg_cron + pg_net,
--       or alternatively via Database Webhook triggers.
--       DO NOT execute on remote database until authorized.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Option 1: pg_cron + pg_net Automated Invocations (Every 1 minute)
-- ------------------------------------------------------------------------------
-- Prerequisite in Supabase Dashboard: Enable 'pg_cron' and 'pg_net' extensions
-- in Database -> Extensions.

/*
-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Store Service Role Key safely in Supabase Vault (never hardcode in plain SQL)
-- In SQL Editor or Dashboard Vault:
-- SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'edge_worker_service_key');

-- 3. Stored Procedure to invoke Edge Function securely
CREATE OR REPLACE FUNCTION public.invoke_ai_queue_worker()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_service_key TEXT;
    v_project_ref TEXT := 'muhdoorruednnlkgdkly';
    v_endpoint TEXT;
BEGIN
    -- Only invoke if there are active queued jobs or stale locks (> 5 mins)
    IF EXISTS (
        SELECT 1 FROM public.ai_service_jobs
        WHERE status = 'queued'
           OR (status = 'processing' AND locked_at < pg_catalog.now() - INTERVAL '5 minutes')
    ) THEN
        -- Retrieve service-role key securely from Supabase Vault
        SELECT decrypted_secret INTO v_service_key
        FROM vault.decrypted_secrets
        WHERE name = 'edge_worker_service_key'
        LIMIT 1;

        IF v_service_key IS NOT NULL THEN
            v_endpoint := 'https://' || v_project_ref || '.supabase.co/functions/v1/process-ai-workflow';

            PERFORM net.http_post(
                url := v_endpoint,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                ),
                body := '{}'::jsonb,
                timeout_milliseconds := 60000
            );
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_ai_queue_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_ai_queue_worker() TO service_role;

-- 4. Schedule cron job to run every minute
-- SELECT cron.schedule(
--     'process-ai-queue-worker',
--     '* * * * *',
--     'SELECT public.invoke_ai_queue_worker()'
-- );
*/

-- ------------------------------------------------------------------------------
-- Option 2: Database Webhook Trigger on ai_service_jobs (Event-driven invocation)
-- ------------------------------------------------------------------------------
-- Automatically triggers process-ai-workflow when a job is inserted as 'queued'
-- or re-queued after revision request.

/*
CREATE OR REPLACE FUNCTION public.trigger_ai_job_worker_on_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_service_key TEXT;
    v_project_ref TEXT := 'muhdoorruednnlkgdkly';
    v_endpoint TEXT;
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.status = 'queued') OR
       (TG_OP = 'UPDATE' AND NEW.status = 'queued' AND OLD.status != 'queued') THEN

        SELECT decrypted_secret INTO v_service_key
        FROM vault.decrypted_secrets
        WHERE name = 'edge_worker_service_key'
        LIMIT 1;

        IF v_service_key IS NOT NULL THEN
            v_endpoint := 'https://' || v_project_ref || '.supabase.co/functions/v1/process-ai-workflow';

            PERFORM net.http_post(
                url := v_endpoint,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                ),
                body := jsonb_build_object('job_id', NEW.id),
                timeout_milliseconds := 60000
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_ai_service_jobs_queued ON public.ai_service_jobs;
CREATE TRIGGER trigger_ai_service_jobs_queued
    AFTER INSERT OR UPDATE ON public.ai_service_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_ai_job_worker_on_queue();
*/
