-- Keep the maintenance-only SECURITY DEFINER function out of the public RPC surface.
-- Event triggers continue to invoke their function as the event-trigger owner.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;
