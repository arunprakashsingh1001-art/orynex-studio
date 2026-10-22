-- ==============================================================================
-- Migration: 20261020000000_create_ai_service_jobs.sql
-- Description: Durable AI service workflow, queue orchestration, admin authorization,
--              and delivery tracking for Orynex Studio.
-- ==============================================================================

-- 1. Admin Users Table (Server-verified authorization)
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index on user_id for fast auth token lookup
CREATE INDEX IF NOT EXISTS admin_users_user_id_idx ON public.admin_users(user_id);

-- Helper function to check admin role
CREATE OR REPLACE FUNCTION public.is_admin(lookup_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = lookup_user_id
    );
$$;

-- 2. AI Service Jobs Table (Durable Queue & Review State)
CREATE TABLE IF NOT EXISTS public.ai_service_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    service TEXT NOT NULL CHECK (
        service IN (
            'Digital Product Design',
            'Technology Architecture',
            'Custom Engineering',
            'Performance & Optimization'
        )
    ),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN (
            'queued',
            'processing',
            'review_pending',
            'approved',
            'rejected',
            'failed',
            'delivered'
        )
    ),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INT NOT NULL DEFAULT 3,
    model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    prompt_snapshot TEXT,
    generated_draft JSONB,
    edited_draft JSONB,
    validation_results JSONB,
    review_notes TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    delivery_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        delivery_status IN ('not_started', 'pending', 'sent', 'failed')
    ),
    delivery_error TEXT,
    delivered_at TIMESTAMPTZ,
    delivery_attempts INT NOT NULL DEFAULT 0,
    delivery_resend_id TEXT,
    error_message TEXT,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Idempotency constraint: exactly one active job per lead
    CONSTRAINT unique_lead_job UNIQUE (lead_id)
);

-- Indexes for efficient queue polling, review filtering, and metrics
CREATE INDEX IF NOT EXISTS ai_service_jobs_status_idx 
    ON public.ai_service_jobs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS ai_service_jobs_lead_id_idx 
    ON public.ai_service_jobs(lead_id);

CREATE INDEX IF NOT EXISTS ai_service_jobs_delivery_status_idx 
    ON public.ai_service_jobs(delivery_status);

-- 3. AI Delivery Logs (Audit Trail for client communications)
CREATE TABLE IF NOT EXISTS public.ai_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.ai_service_jobs(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    resend_id TEXT,
    error TEXT,
    payload_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS ai_delivery_logs_job_id_idx 
    ON public.ai_delivery_logs(job_id);

-- 4. Durable Queue Claim RPC (Concurrency-safe via FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_ai_job(worker_id TEXT)
RETURNS SETOF public.ai_service_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.ai_service_jobs
    SET status = 'processing',
        locked_at = now(),
        locked_by = worker_id,
        updated_at = now()
    WHERE id = (
        SELECT id
        FROM public.ai_service_jobs
        WHERE (status = 'queued' OR (status = 'processing' AND locked_at < now() - INTERVAL '5 minutes'))
          AND retry_count < max_retries
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$;

-- 5. Row Level Security (RLS) Configuration
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_service_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Deny all direct access to public anonymous visitors
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_service_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_delivery_logs FROM anon, authenticated;

-- Service role has full administrative access (Edge Functions)
GRANT ALL ON TABLE public.admin_users TO service_role;
GRANT ALL ON TABLE public.ai_service_jobs TO service_role;
GRANT ALL ON TABLE public.ai_delivery_logs TO service_role;

DROP POLICY IF EXISTS "Service role full access on admin_users" ON public.admin_users;
CREATE POLICY "Service role full access on admin_users"
    ON public.admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ai_service_jobs" ON public.ai_service_jobs;
CREATE POLICY "Service role full access on ai_service_jobs"
    ON public.ai_service_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ai_delivery_logs" ON public.ai_delivery_logs;
CREATE POLICY "Service role full access on ai_delivery_logs"
    ON public.ai_delivery_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Documentation
COMMENT ON TABLE public.admin_users IS 'Authoritative registry of administrator accounts with review privileges.';
COMMENT ON TABLE public.ai_service_jobs IS 'Orchestration state and drafts for AI-generated client service proposals.';
COMMENT ON TABLE public.ai_delivery_logs IS 'Immutable delivery log of client emails dispatched via Resend.';
COMMENT ON FUNCTION public.claim_next_ai_job(TEXT) IS 'Atomic job claiming mechanism with FOR UPDATE SKIP LOCKED to prevent duplicate processing.';
