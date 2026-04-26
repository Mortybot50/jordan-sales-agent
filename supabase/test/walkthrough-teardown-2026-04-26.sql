-- Teardown for [WALK-26APR] dummy data seeded during the
-- click-through walkthrough audit on 2026-04-26.
--
-- Org: Purezza AU (5557189e-5c2d-4990-afad-6aa1861826cd).
--
-- Safe to re-run; all DELETEs are bounded by deterministic IDs or by
-- the [WALK-26APR] tag prefix. Run inside a transaction so a partial
-- failure rolls back rather than leaving dangling rows.

BEGIN;

-- 1. Activities tied to the dummy contacts/deals (defensive — none seeded
--    in this run, but pipeline drag/drop or manual logging during live QA
--    may have created some).
DELETE FROM activities
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND (
    contact_id IN (
      '22222222-aaaa-bbbb-cccc-100000000001',
      '22222222-aaaa-bbbb-cccc-100000000002'
    )
    OR deal_id IN (
      '33333333-aaaa-bbbb-cccc-100000000001',
      '33333333-aaaa-bbbb-cccc-100000000002',
      '33333333-aaaa-bbbb-cccc-100000000003',
      '33333333-aaaa-bbbb-cccc-100000000004',
      '33333333-aaaa-bbbb-cccc-100000000005',
      '33333333-aaaa-bbbb-cccc-100000000006',
      '33333333-aaaa-bbbb-cccc-100000000007',
      '33333333-aaaa-bbbb-cccc-100000000008'
    )
  );

-- 2. Drafts tied to dummy contacts (defensive).
DELETE FROM drafts
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND contact_id IN (
    '22222222-aaaa-bbbb-cccc-100000000001',
    '22222222-aaaa-bbbb-cccc-100000000002'
  );

-- 3. Tasks tied to dummy contacts/deals (defensive).
DELETE FROM tasks
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND (
    contact_id IN (
      '22222222-aaaa-bbbb-cccc-100000000001',
      '22222222-aaaa-bbbb-cccc-100000000002'
    )
    OR deal_id IN (
      '33333333-aaaa-bbbb-cccc-100000000001',
      '33333333-aaaa-bbbb-cccc-100000000002',
      '33333333-aaaa-bbbb-cccc-100000000003',
      '33333333-aaaa-bbbb-cccc-100000000004',
      '33333333-aaaa-bbbb-cccc-100000000005',
      '33333333-aaaa-bbbb-cccc-100000000006',
      '33333333-aaaa-bbbb-cccc-100000000007',
      '33333333-aaaa-bbbb-cccc-100000000008'
    )
  );

-- 4. Deals (8 rows from the seed).
DELETE FROM deals
WHERE id IN (
  '33333333-aaaa-bbbb-cccc-100000000001',
  '33333333-aaaa-bbbb-cccc-100000000002',
  '33333333-aaaa-bbbb-cccc-100000000003',
  '33333333-aaaa-bbbb-cccc-100000000004',
  '33333333-aaaa-bbbb-cccc-100000000005',
  '33333333-aaaa-bbbb-cccc-100000000006',
  '33333333-aaaa-bbbb-cccc-100000000007',
  '33333333-aaaa-bbbb-cccc-100000000008'
);

-- 5. Contacts (2 rows from the seed).
DELETE FROM contacts
WHERE id IN (
  '22222222-aaaa-bbbb-cccc-100000000001',
  '22222222-aaaa-bbbb-cccc-100000000002'
);

-- 6. Venues (2 rows from the seed).
DELETE FROM venues
WHERE id IN (
  '11111111-aaaa-bbbb-cccc-100000000001',
  '11111111-aaaa-bbbb-cccc-100000000002'
);

-- 7. Belt-and-braces: tag-based catch-all in case any row was created
--    during live click-through with the [WALK-26APR] prefix and a
--    non-deterministic UUID.
DELETE FROM deals
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND title LIKE '[WALK-26APR]%';

DELETE FROM contacts
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND full_name LIKE '[WALK-26APR]%';

DELETE FROM venues
WHERE org_id = '5557189e-5c2d-4990-afad-6aa1861826cd'
  AND name LIKE '[WALK-26APR]%';

-- Sanity check (returns zero rows when teardown is complete).
SELECT 'remaining venues' AS what, count(*) AS n
  FROM venues  WHERE name      LIKE '[WALK-26APR]%'
UNION ALL
SELECT 'remaining contacts', count(*)
  FROM contacts WHERE full_name LIKE '[WALK-26APR]%'
UNION ALL
SELECT 'remaining deals', count(*)
  FROM deals    WHERE title     LIKE '[WALK-26APR]%';

COMMIT;
