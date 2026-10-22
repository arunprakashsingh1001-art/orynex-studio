-- ==============================================================================
-- Migration: 20261016000000_create_leads_table.sql
-- Description: Create leads table for Orynex Studio with strict RLS and validation.
--
-- How to apply:
-- 1. In Supabase Dashboard: Navigate to Project > SQL Editor > New query, paste this script and click Run.
-- 2. Or using Supabase CLI: Run `supabase db push` or `supabase migration up`.
-- ==============================================================================

-- 1. Create table with strict constraints
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 100),
    email TEXT NOT NULL CHECK (
        char_length(email) <= 255 AND 
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9]+([.-][A-Za-z0-9]+)*\.[A-Za-z]{2,}$'
    ),
    service TEXT NOT NULL CHECK (
        service IN (
            'Digital Product Design',
            'Technology Architecture',
            'Custom Engineering',
            'Performance & Optimization'
        )
    ),
    project_overview TEXT CHECK (
        project_overview IS NULL OR 
        char_length(project_overview) <= 2000
    ),
    notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        notification_status IN ('pending', 'sent', 'failed')
    ),
    notification_error TEXT,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Indexes for rate-limiting, queries, and monitoring
CREATE INDEX IF NOT EXISTS leads_created_at_idx 
    ON public.leads(created_at DESC);

CREATE INDEX IF NOT EXISTS leads_email_created_at_idx 
    ON public.leads(email, created_at DESC);

CREATE INDEX IF NOT EXISTS leads_notification_status_idx 
    ON public.leads(notification_status);

-- 3. Row Level Security (RLS) Configuration
-- Enable RLS to prevent unauthorized access
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Deny all direct operations to public anonymous visitors and authenticated users
REVOKE ALL ON TABLE public.leads FROM anon, authenticated;

-- Allow only the server-side service_role (used by Supabase Edge Functions)
GRANT ALL ON TABLE public.leads TO service_role;

-- Service role policy
DROP POLICY IF EXISTS "Service role has full access to leads" ON public.leads;
CREATE POLICY "Service role has full access to leads"
    ON public.leads
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4. Helpful table and column documentation
COMMENT ON TABLE public.leads IS 'Stores inbound contact and consultation inquiries for Orynex Studio.';
COMMENT ON COLUMN public.leads.notification_status IS 'Tracks delivery status of admin notification emails (pending, sent, failed).';
COMMENT ON COLUMN public.leads.ip_hash IS 'Pseudonymized SHA-256 hash of client IP used strictly for anti-spam rate limiting.';
