-- Required infrastructure for scheduled Edge Function invocations.
-- pg_cron schedules database jobs; pg_net sends asynchronous HTTPS requests.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
