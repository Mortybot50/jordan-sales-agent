-- Default commission % on user profile, used to pre-fill new deals.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS default_commission_pct numeric(5,2);
