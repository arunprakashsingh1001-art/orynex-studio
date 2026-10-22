-- Align audit fields and delivery states with the maintained Edge Functions.
ALTER TABLE public.ai_job_revisions
  ADD COLUMN IF NOT EXISTS complexity TEXT NOT NULL DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS validation_results JSONB,
  ADD COLUMN IF NOT EXISTS critique_notes TEXT;

DO $revision_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_job_revisions'::regclass
      AND conname = 'ai_job_revisions_complexity_check'
  ) THEN
    ALTER TABLE public.ai_job_revisions
      ADD CONSTRAINT ai_job_revisions_complexity_check
      CHECK (complexity IN ('routine', 'complex'));
  END IF;
END
$revision_checks$;

ALTER TABLE public.ai_review_decisions
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS feedback TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by_email TEXT;

ALTER TABLE public.ai_review_decisions
  ALTER COLUMN decision DROP NOT NULL,
  ALTER COLUMN admin_email DROP NOT NULL;

DO $decision_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_review_decisions'::regclass
      AND conname = 'ai_review_decisions_action_check'
  ) THEN
    ALTER TABLE public.ai_review_decisions
      ADD CONSTRAINT ai_review_decisions_action_check
      CHECK (
        action IS NULL OR
        action IN ('approve', 'request_revision', 'edit_draft', 'reject_permanently')
      );
  END IF;
END
$decision_checks$;

-- A simulated delivery is not a real successful customer email.
DO $delivery_checks$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_delivery_logs'::regclass
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.ai_delivery_logs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$delivery_checks$;
ALTER TABLE public.ai_delivery_logs
  ADD CONSTRAINT ai_delivery_logs_status_check
  CHECK (status IN ('success', 'failed', 'simulated'));

-- Match the maintained admin Edge Function and avoid overloaded RPC ambiguity.
DROP FUNCTION IF EXISTS public.approve_and_lock_revision(UUID, UUID, TEXT, INTEGER, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.approve_and_lock_revision(
  p_job_id UUID,
  p_revision_number INTEGER,
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
  admin_email_db TEXT;
  stable_key TEXT;
  existing_decision public.ai_review_decisions%ROWTYPE;
  rows_updated INTEGER;
BEGIN
  SELECT lower(email)
    INTO admin_email_db
  FROM public.admin_users
  WHERE user_id = p_admin_user_id
    AND role IN ('admin', 'superadmin');

  IF admin_email_db IS NULL OR admin_email_db <> lower(p_admin_email) THEN
    RAISE EXCEPTION 'Administrator authorization failed'
      USING ERRCODE = '42501';
  END IF;

  IF p_approved_snapshot IS NULL OR p_revision_number IS NULL OR p_revision_number < 1 THEN
    RAISE EXCEPTION 'Approved snapshot and revision number are required'
      USING ERRCODE = '22023';
  END IF;

  stable_key := p_job_id::text || ':' || p_revision_number::text;

  SELECT * INTO existing_decision
  FROM public.ai_review_decisions
  WHERE idempotency_key = stable_key
  LIMIT 1;

  IF FOUND THEN
    IF existing_decision.job_id <> p_job_id OR existing_decision.decision <> 'approve' THEN
      RAISE EXCEPTION 'Approval idempotency key conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN TRUE;
  END IF;

  UPDATE public.ai_service_jobs
  SET status = 'approved',
      delivery_status = 'pending',
      approved_revision = p_revision_number,
      approved_snapshot = p_approved_snapshot,
      delivery_idempotency_key = stable_key,
      reviewed_by = p_admin_user_id,
      reviewed_at = pg_catalog.now(),
      review_notes = p_review_notes,
      updated_at = pg_catalog.now()
  WHERE id = p_job_id
    AND status = 'review_pending'
    AND delivery_status IS DISTINCT FROM 'sent';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  IF rows_updated = 0 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.ai_review_decisions (
    job_id, lead_id, admin_user_id, admin_email,
    decision, revision_number, notes, draft_snapshot, idempotency_key,
    action, feedback, reviewed_by, reviewed_by_email
  )
  SELECT
    p_job_id, j.lead_id, p_admin_user_id, admin_email_db,
    'approve', p_revision_number, p_review_notes, p_approved_snapshot, stable_key,
    'approve', p_review_notes, p_admin_user_id, admin_email_db
  FROM public.ai_service_jobs j
  WHERE j.id = p_job_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INTEGER, JSONB, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INTEGER, JSONB, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.approve_and_lock_revision(UUID, INTEGER, JSONB, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_lock_revision(UUID, INTEGER, JSONB, UUID, TEXT, TEXT) TO service_role;

COMMENT ON COLUMN public.ai_review_decisions.action IS 'Application-facing review action.';
COMMENT ON COLUMN public.ai_review_decisions.feedback IS 'Administrator notes or mandatory refinement feedback.';
COMMENT ON FUNCTION public.approve_and_lock_revision(UUID, INTEGER, JSONB, UUID, TEXT, TEXT) IS 'Atomically records an authorized approval and locks the exact approved snapshot. Delivery is separately controlled by the admin Edge Function.';
