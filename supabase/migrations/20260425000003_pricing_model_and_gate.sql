-- Pricing model + monthly gate
-- Adds: products catalogue (global), monthly_gates (per user/month),
-- deal financial columns (acv/tcv/commission), install lifecycle timestamps,
-- compute_deal_financials() trigger, recompute_monthly_gate() trigger,
-- new pipeline stages ("Hold for Next Month", "Pending Install", "Installed"),
-- daily pg_cron forfeit job.

BEGIN;

-- ============================================================
-- 1. PRODUCTS — global sales-package catalogue (no org_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('purezza','culligan','zip','other')),
  sku text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL,
  weekly_price_aud numeric(10,2) NOT NULL,
  default_term_months int NOT NULL CHECK (default_term_months IN (12,24,36,48,60)),
  default_commission_pct numeric(5,2) NOT NULL DEFAULT 7.00,
  water_types text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_read_all ON products;
CREATE POLICY products_read_all ON products
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policy — only service-role bypasses RLS.

-- Seed all 19 packages
INSERT INTO products (brand, sku, label, category, weekly_price_aud, default_term_months, default_commission_pct, water_types, notes) VALUES
  -- Purezza (default 48mo)
  ('purezza','pz-estetica','Estetica','countertop',49.95,48,7.00,'{still,sparkling}','80L Frizzante, 24 bottles, 1× annual service'),
  ('purezza','pz-cento','Cento','underbench',58.90,48,7.00,'{still,sparkling}','100L Frizzante, 24 bottles, 1× annual service'),
  ('purezza','pz-black','Black','underbench',66.90,48,7.00,'{still,sparkling}','160L Frizzante, 48 bottles, recirculation pump, 2× annual service'),
  ('purezza','pz-event','Event','underbench',79.90,48,7.00,'{still,sparkling}','280L Frizzante, 72 bottles, 2× annual service'),
  ('purezza','pz-veloce','Veloce','portable',89.90,48,7.00,'{still,sparkling}','Portable, 72 bottles, ozone sanitisation'),
  -- Culligan (default 60mo)
  ('culligan','cul-plus','Plus','dispenser',14.90,60,7.00,'{ambient,cold}',NULL),
  ('culligan','cul-essential','Essential','dispenser',18.30,60,7.00,'{hot,cold}',NULL),
  ('culligan','cul-bubbler','Bubbler','bubbler',18.90,60,7.00,'{cold}',NULL),
  ('culligan','cul-core','Core','dispenser',19.90,60,7.00,'{cold}',NULL),
  ('culligan','cul-signature','Signature','dispenser',25.80,60,7.00,'{hot,cold,sparkling}',NULL),
  ('culligan','cul-corporate','Corporate','underbench',46.40,60,7.00,'{cold,sparkling}',NULL),
  ('culligan','cul-executive','Executive','underbench',48.40,60,7.00,'{hot,cold,sparkling}',NULL),
  ('culligan','cul-performance','Performance','underbench',49.90,60,7.00,'{still,sparkling}',NULL),
  ('culligan','cul-classe','Classe','underbench',59.90,60,7.00,'{still,sparkling}',NULL),
  -- Zip HydroTap (default 60mo)
  ('zip','zip-z2','Z2 (Econoboil 5L)','wall-mount',19.90,60,7.00,'{boiling}',NULL),
  ('zip','zip-z1','Z1 (Autoboil 15L)','wall-mount',29.80,60,7.00,'{boiling}',NULL),
  ('zip','zip-aquaboil','Aquaboil (BA60)','tap',34.40,60,7.00,'{boiling,ambient}',NULL),
  ('zip','zip-summit','Summit (C100)','tap',38.80,60,7.00,'{chilled}',NULL),
  ('zip','zip-nexus','Nexus (BC20)','tap',44.40,60,7.00,'{boiling,chilled}',NULL),
  ('zip','zip-pinnacle','Pinnacle (BCS20)','tap',52.60,60,7.00,'{boiling,chilled,sparkling}',NULL)
ON CONFLICT (sku) DO NOTHING;

-- ============================================================
-- 2. DEALS — add pricing/lifecycle columns
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS weekly_price_override numeric(10,2),
  ADD COLUMN IF NOT EXISTS term_months int CHECK (term_months IN (12,24,36,48,60)),
  ADD COLUMN IF NOT EXISTS acv numeric(10,2),
  ADD COLUMN IF NOT EXISTS tcv numeric(10,2),
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS commission_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS close_won_at timestamptz,
  ADD COLUMN IF NOT EXISTS install_scheduled_for date,
  ADD COLUMN IF NOT EXISTS install_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS install_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_deals_close_won_at
  ON deals(org_id, close_won_at) WHERE close_won_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner_user
  ON deals(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_pending_install
  ON deals(org_id) WHERE install_completed_at IS NULL AND close_won_at IS NOT NULL;

-- ============================================================
-- 3. MONTHLY_GATES
-- ============================================================
CREATE TABLE IF NOT EXISTS monthly_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month date NOT NULL,
  target_acv numeric(10,2) NOT NULL DEFAULT 24750.00,
  achieved_acv numeric(10,2) NOT NULL DEFAULT 0,
  hit_gate boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  forfeited_at timestamptz,
  prior_month_commission_amount numeric(10,2),
  prior_month_commission_status text CHECK (prior_month_commission_status IN ('pending','unlocked','forfeited')) DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_gates_lookup
  ON monthly_gates(org_id, user_id, month DESC);

ALTER TABLE monthly_gates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_gates_select ON monthly_gates;
CREATE POLICY monthly_gates_select ON monthly_gates
  FOR SELECT TO authenticated
  USING (org_id = auth_org_id());

DROP POLICY IF EXISTS monthly_gates_insert ON monthly_gates;
CREATE POLICY monthly_gates_insert ON monthly_gates
  FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_org_id());

DROP POLICY IF EXISTS monthly_gates_update ON monthly_gates;
CREATE POLICY monthly_gates_update ON monthly_gates
  FOR UPDATE TO authenticated
  USING (org_id = auth_org_id())
  WITH CHECK (org_id = auth_org_id());

-- ============================================================
-- 4. compute_deal_financials() — trigger to auto-compute ACV/TCV/commission
-- ============================================================
CREATE OR REPLACE FUNCTION compute_deal_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_weekly numeric(10,2);
  v_term int;
  v_pct numeric(5,2);
  v_default_pct numeric(5,2);
  v_default_weekly numeric(10,2);
  v_default_term int;
BEGIN
  IF NEW.product_id IS NULL THEN
    NEW.acv := NULL;
    NEW.tcv := NULL;
    NEW.commission_amount := NULL;
    RETURN NEW;
  END IF;

  SELECT weekly_price_aud, default_term_months, default_commission_pct
    INTO v_default_weekly, v_default_term, v_default_pct
    FROM products WHERE id = NEW.product_id;

  v_weekly := COALESCE(NEW.weekly_price_override, v_default_weekly);
  v_term   := COALESCE(NEW.term_months, v_default_term);
  v_pct    := COALESCE(NEW.commission_pct, v_default_pct);

  -- If commission_pct missing, default it.
  IF NEW.commission_pct IS NULL THEN
    NEW.commission_pct := v_pct;
  END IF;
  IF NEW.term_months IS NULL THEN
    NEW.term_months := v_term;
  END IF;

  NEW.acv := round(v_weekly * 52, 2);
  NEW.tcv := round((v_weekly * 52) * v_term / 12.0, 2);
  NEW.commission_amount := round(NEW.tcv * v_pct / 100.0, 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_deal_financials ON deals;
CREATE TRIGGER trg_compute_deal_financials
  BEFORE INSERT OR UPDATE OF product_id, weekly_price_override, term_months, commission_pct
  ON deals
  FOR EACH ROW
  EXECUTE FUNCTION compute_deal_financials();

-- ============================================================
-- 5. Auto-set close_won_at when stage moves to "Close Won"/"Closed Won"
-- ============================================================
CREATE OR REPLACE FUNCTION sync_close_won_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage_name text;
BEGIN
  IF NEW.stage_id IS NOT NULL THEN
    SELECT name INTO v_stage_name FROM pipeline_stages WHERE id = NEW.stage_id;
    IF v_stage_name ILIKE '%won%' AND v_stage_name NOT ILIKE '%lost%' THEN
      IF NEW.close_won_at IS NULL THEN
        NEW.close_won_at := now();
      END IF;
    ELSE
      -- stage moved away from a won state — clear close_won_at
      NEW.close_won_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_close_won_at ON deals;
CREATE TRIGGER trg_sync_close_won_at
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW
  EXECUTE FUNCTION sync_close_won_at();

-- ============================================================
-- 6. recompute_monthly_gate(p_org_id, p_user_id, p_month)
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_monthly_gate(
  p_org_id uuid,
  p_user_id uuid,
  p_month date
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_achieved numeric(10,2);
  v_target numeric(10,2);
  v_already_hit boolean;
  v_prior_month date;
BEGIN
  -- Calendar month boundary in Australia/Melbourne
  v_month_start := (p_month::timestamp AT TIME ZONE 'Australia/Melbourne');
  v_month_end := ((p_month + interval '1 month')::timestamp AT TIME ZONE 'Australia/Melbourne');

  -- Sum acv of close-won deals in this month, excluding "Hold for Next Month" stage
  SELECT COALESCE(SUM(d.acv), 0) INTO v_achieved
    FROM deals d
    LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
    WHERE d.org_id = p_org_id
      AND d.close_won_at IS NOT NULL
      AND d.close_won_at >= v_month_start
      AND d.close_won_at < v_month_end
      AND COALESCE(ps.name, '') NOT IN ('Hold for Next Month', 'Closed Lost', 'Lost');

  -- Upsert the gate row
  INSERT INTO monthly_gates (org_id, user_id, month, achieved_acv)
    VALUES (p_org_id, p_user_id, p_month, v_achieved)
  ON CONFLICT (org_id, user_id, month) DO UPDATE
    SET achieved_acv = EXCLUDED.achieved_acv,
        updated_at = now()
  RETURNING hit_gate, target_acv INTO v_already_hit, v_target;

  -- If we just crossed the threshold this run, lock it + unlock prior month commission
  IF v_achieved >= v_target AND NOT v_already_hit THEN
    UPDATE monthly_gates
       SET hit_gate = true,
           locked_at = now(),
           updated_at = now()
     WHERE org_id = p_org_id AND user_id = p_user_id AND month = p_month;

    v_prior_month := (p_month - interval '1 month')::date;
    UPDATE monthly_gates
       SET prior_month_commission_status = 'unlocked',
           updated_at = now()
     WHERE org_id = p_org_id AND user_id = p_user_id AND month = v_prior_month
       AND prior_month_commission_status = 'pending';
  END IF;
END;
$$;

-- ============================================================
-- 7. Trigger fires recompute_monthly_gate on deals close_won/acv changes
-- ============================================================
CREATE OR REPLACE FUNCTION trg_deals_recompute_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_old_month date;
  v_new_month date;
BEGIN
  -- Resolve user (deal.owner_user_id, falling back to first user in org)
  v_user := COALESCE(
    NEW.owner_user_id,
    (SELECT id FROM users WHERE org_id = NEW.org_id ORDER BY created_at LIMIT 1)
  );
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine months affected
  IF TG_OP = 'UPDATE' THEN
    IF OLD.close_won_at IS NOT NULL THEN
      v_old_month := date_trunc('month', OLD.close_won_at AT TIME ZONE 'Australia/Melbourne')::date;
    END IF;
  END IF;
  IF NEW.close_won_at IS NOT NULL THEN
    v_new_month := date_trunc('month', NEW.close_won_at AT TIME ZONE 'Australia/Melbourne')::date;
  END IF;

  IF v_old_month IS NOT NULL AND v_old_month IS DISTINCT FROM v_new_month THEN
    PERFORM recompute_monthly_gate(NEW.org_id, v_user, v_old_month);
  END IF;
  IF v_new_month IS NOT NULL THEN
    PERFORM recompute_monthly_gate(NEW.org_id, v_user, v_new_month);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_recompute_gate ON deals;
CREATE TRIGGER trg_deals_recompute_gate
  AFTER INSERT OR UPDATE OF close_won_at, acv, stage_id, owner_user_id
  ON deals
  FOR EACH ROW
  EXECUTE FUNCTION trg_deals_recompute_gate();

-- ============================================================
-- 8. New pipeline stages for existing orgs + new-user trigger update
-- ============================================================
DO $$
DECLARE
  r_org uuid;
BEGIN
  FOR r_org IN SELECT id FROM orgs LOOP
    -- "Hold for Next Month" between Negotiation (5) and Closed Won (6)
    INSERT INTO pipeline_stages (org_id, name, position, is_closed, color)
      SELECT r_org, 'Hold for Next Month', 5.5, false, '#94a3b8'
       WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE org_id = r_org AND name = 'Hold for Next Month');

    -- "Pending Install" between Closed Won (6) and Closed Lost (7)
    INSERT INTO pipeline_stages (org_id, name, position, is_closed, color)
      SELECT r_org, 'Pending Install', 6.3, true, '#22c55e'
       WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE org_id = r_org AND name = 'Pending Install');

    -- "Installed"
    INSERT INTO pipeline_stages (org_id, name, position, is_closed, color)
      SELECT r_org, 'Installed', 6.6, true, '#16a34a'
       WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE org_id = r_org AND name = 'Installed');
  END LOOP;
END $$;

-- ============================================================
-- 9. pg_cron daily forfeit job
--   Runs at 00:30 AEST (= 14:30 UTC) daily.
--   For any monthly_gates row where the month ended yesterday and gate not hit:
--   set forfeited_at + cascade prior_month commission status.
-- ============================================================
CREATE OR REPLACE FUNCTION run_monthly_gate_forfeits()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_yesterday date;
  v_finished_month date;
BEGIN
  v_yesterday := (now() AT TIME ZONE 'Australia/Melbourne')::date - interval '1 day';
  v_finished_month := date_trunc('month', v_yesterday)::date;

  -- Only consider months that ended (last day of month was yesterday)
  IF (v_finished_month + interval '1 month')::date - interval '1 day' = v_yesterday THEN
    -- Forfeit the just-finished month if gate not hit
    UPDATE monthly_gates
       SET forfeited_at = now(),
           updated_at = now()
     WHERE month = v_finished_month
       AND hit_gate = false
       AND forfeited_at IS NULL;

    -- Cascade: prior_month_commission_status = 'forfeited' on the FOLLOWING month's row
    -- (logic: this month's outcome unlocks/forfeits prior-month commission)
    UPDATE monthly_gates mg
       SET prior_month_commission_status = 'forfeited',
           updated_at = now()
      FROM monthly_gates prior
     WHERE mg.month = v_finished_month
       AND prior.month = (v_finished_month - interval '1 month')::date
       AND mg.org_id = prior.org_id
       AND mg.user_id = prior.user_id
       AND mg.hit_gate = false
       AND mg.prior_month_commission_status = 'pending';
  END IF;
END;
$$;

-- Schedule (idempotent — unschedule if already exists, then schedule fresh)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly_gate_forfeits') THEN
    PERFORM cron.unschedule('monthly_gate_forfeits');
  END IF;
  PERFORM cron.schedule(
    'monthly_gate_forfeits',
    '30 14 * * *',
    $cron$ SELECT public.run_monthly_gate_forfeits(); $cron$
  );
END $$;

COMMIT;
