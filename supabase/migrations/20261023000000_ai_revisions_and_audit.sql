-- ==============================================================================
-- Migration: 20261023000000_ai_revisions_and_audit.sql
-- Description: End-to-end AI automation schema additions:
--              1. Revision tracking and immutable approved snapshot on ai_service_jobs
--              2. Immutable ai_job_revisions history table
--              3. Immutable ai_review_decisions audit table
--              4. Atomic submit_lead_with_job stored procedure
--              5. Atomic approve_and_lock_revision stored procedure
--              6. RLS security hardening and service-role execution grants
-- ==============================================================================

-- 1. Add revision tracking columns to public.ai_service_jobs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'ai_service_jobs' AND column_name = 'revision_count'
    ) THEN
        ALTER TABLE public.ai_service_jobs 
            ADD COLUMN revision_count INT NOT NULL DEFAULT 1 CHECK (revision_count >= 1),
            ADD COLUMN max_revisions INT NOT NULL DEFAULT 5,
            ADD COLUMN approved_revision INT,
            ADD COLUMN approved_snapshot JSONB,
            ADD COLUMN refined_instructions TEXT;
    END IF;
END $$;

-- 2. Immutable AI Job Revisions Table
-- Records every AI generation attempt, prompt, model, draft, and validation result
CREATE TABLE IF NOT EXISTS public.ai_job_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.ai_service_jobs(id) ON DELETE CASCADE,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'gemini',
    complexity TEXT NOT NULL DEFAULT 'routine' CHECK (complexity IN ('routine', 'complex')),
    prompt_snapshot TEXT,
    refined_instructions TEXT,
    draft JSONB NOT NULL,
    validation_results JSONB,
    critique_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_job_revision UNIQUE (job_id, revision_number)
);

CREATE INDEX IF NOT EXISTS ai_job_revisions_job_id_idx 
    ON public.ai_job_revisions(job_id, revision_number DESC);

-- 3. Immutable AI Review Decisions Table
-- Records every administrator action: approval, revision request with mandatory feedback,
-- draft edit, or permanent rejection.
CREATE TABLE IF NOT EXISTS public.ai_review_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.ai_service_jobs(id) ON DELETE CASCADE,
    revision_number INT NOT NULL CHECK (revision_number >= 1),
    action TEXT NOT NULL CHECK (action IN ('approve', 'request_revision', 'edit_draft', 'reject_permanently')),
    feedback TEXT,
    reviewed_by UUID NOT NULL,
    reviewed_by_email TEXT NOT NULL,
    draft_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS ai_review_decisions_job_id_idx 
    ON public.ai_review_decisions(job_id, created_at DESC);

-- 4. Atomic Lead and Queue Job Creation Function
-- Inserts the customer lead and initial AI queue job in a single ACID transaction
CREATE OR REPLACE FUNCTION public.submit_lead_with_job(
    p_name TEXT,
    p_email TEXT,
    p_service TEXT,
    p_project_overview TEXT,
    p_ip_hash TEXT
)
RETURNS TABLE (
    lead_id UUID,
    job_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_lead_id UUID;
    v_job_id UUID;
BEGIN
    INSERT INTO public.leads (
        name,
        email,
        service,
        project_overview,
        ip_hash,
        notification_status
    )
    VALUES (
        p_name,
        p_email,
        p_service,
        p_project_overview,
        p_ip_hash,
        'pending'
    )
    RETURNING id INTO v_lead_id;

    INSERT INTO public.ai_service_jobs (
        lead_id,
        service,
        status,
        delivery_status,
        revision_count
    )
    VALUES (
        v_lead_id,
        p_service,
        'queued',
        'not_started',
        1
    )
    RETURNING id INTO v_job_id;

    RETURN QUERY SELECT v_lead_id, v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_lead_with_job(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_lead_with_job(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.submit_lead_with_job(TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lead_with_job(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 5. Atomic Approve and Lock Revision Function
-- Ensures approval is bound to an exact revision while in 'review_pending' state
CREATE OR REPLACE FUNCTION public.approve_and_lock_revision(
    p_job_id UUID,
    p_revision_number INT,
    p_approved_snapshot JSONB,
    p_admin_user_id UUID,
    p_admin_email TEXT,
    p_review_notes TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows_updated INT;
BEGIN
    -- Atomically update job status only if still awaiting review
    UPDATE public.ai_service_jobs
    SET status = 'approved',
        delivery_status = 'pending',
        approved_revision = p_revision_number,
        approved_snapshot = p_approved_snapshot,
        reviewed_by = p_admin_user_id,
        reviewed_at = pg_catalog.now(),
        review_notes = p_review_notes,
        updated_at = pg_catalog.now()
    WHERE id = p_job_id
      AND status = 'review_pending'
      AND (delivery_status IS NULL OR delivery_status != 'sent');

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        RETURN FALSE;
    END IF;

    -- Record immutable review decision audit record
    INSERT INTO public.ai_review_decisions (
        job_id,
        revision_number,
        action,
        feedback,
        reviewed_by,
        reviewed_by_email,
        draft_snapshot
    )
    VALUES (
        p_job_id,
        p_revision_number,
        'approve',
        p_review_notes,
        p_admin_user_id,
        p_admin_email,
        p_approved_snapshot
    );

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INT, JSONB, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INT, JSONB, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INT, JSONB, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_lock_revision(UUID, INT, JSONB, UUID, TEXT, TEXT) TO service_role;

-- 6. Row Level Security Configuration
ALTER TABLE public.ai_job_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_review_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_job_revisions FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_review_decisions FROM anon, authenticated;

GRANT ALL ON TABLE public.ai_job_revisions TO service_role;
GRANT ALL ON TABLE public.ai_review_decisions TO service_role;

DROP POLICY IF EXISTS "Service role full access on ai_job_revisions" ON public.ai_job_revisions;
CREATE POLICY "Service role full access on ai_job_revisions"
    ON public.ai_job_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ai_review_decisions" ON public.ai_review_decisions;
CREATE POLICY "Service role full access on ai_review_decisions"
    ON public.ai_review_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. Documentation & Scheduler Guidance
COMMENT ON TABLE public.ai_job_revisions IS 'Immutable history of AI generation runs, prompts, and drafts per revision.';
COMMENT ON TABLE public.ai_review_decisions IS 'Immutable audit log of all administrator review actions (approvals, revisions, edits, rejections).';
COMMENT ON FUNCTION public.submit_lead_with_job(TEXT, TEXT, TEXT, TEXT, TEXT) IS 'Transactional atomic creation of customer lead and queued AI service job.';
COMMENT ON FUNCTION public.approve_and_lock_revision(UUID, INT, JSONB, UUID, TEXT, TEXT) IS 'Atomic approval lock binding an immutable snapshot and revision number.';
