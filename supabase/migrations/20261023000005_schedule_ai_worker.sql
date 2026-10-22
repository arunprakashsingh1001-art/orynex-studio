-- Schedule the Orynex AI queue worker after Vault credentials and extensions are ready.
-- The HTTP bearer token is read from Vault at runtime and is never stored in this migration.
-- The worker itself accepts only a verified service_role JWT.
DO $schedule$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'ai_worker_url'
      AND decrypted_secret = 'https://muhdoorruednnlkgdkly.supabase.co/functions/v1/process-ai-workflow'
  ) THEN
    RAISE EXCEPTION 'Required Vault secret ai_worker_url is missing or does not match the Orynex AI worker endpoint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'ai_worker_service_key'
      AND decrypted_secret IS NOT NULL
      AND length(decrypted_secret) > 100
  ) THEN
    RAISE EXCEPTION 'Required Vault secret ai_worker_service_key is missing or empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orynex-ai-worker-every-minute'
  ) THEN
    PERFORM cron.schedule(
      'orynex-ai-worker-every-minute',
      '* * * * *',
      $cron$
        SELECT net.http_post(
          url := (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'ai_worker_url'
          ),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret
              FROM vault.decrypted_secrets
              WHERE name = 'ai_worker_service_key'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        );
      $cron$
    );
  END IF;
END
$schedule$;
