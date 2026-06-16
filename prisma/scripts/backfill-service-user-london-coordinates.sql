-- Backfill London-area latitude/longitude for service users missing coordinates.
-- Points are on a ~4.5 km grid (≈0.04054° lat, ≈0.06447° lng at 51.5°N).
-- Run from careadmin-backend:
--   Get-Content prisma/scripts/backfill-service-user-london-coordinates.sql | npx prisma db execute --stdin --schema prisma/schema.prisma

WITH candidates AS (
  SELECT
    su.id AS service_user_id,
    a.id AS address_id,
    ROW_NUMBER() OVER (ORDER BY su."createdAt", su.id) - 1 AS grid_idx
  FROM "service_users"."ServiceUser" su
  LEFT JOIN "service_users"."ServiceUserAddress" a
    ON a."serviceUserId" = su.id AND a."deletedAt" IS NULL
  WHERE su."deletedAt" IS NULL
    AND (
      a.id IS NULL
      OR a.latitude IS NULL
      OR a.longitude IS NULL
    )
),
coords AS (
  SELECT
    service_user_id,
    address_id,
    -- Trafalgar Square anchor, spread north/east in a 4.5 km grid
    ROUND(
      (
        51.507400
        + FLOOR(grid_idx / 5.0) * 0.040540
      )::numeric,
      7
    ) AS latitude,
    ROUND(
      (
        -0.127800
        + (MOD(grid_idx, 5)) * 0.064470
      )::numeric,
      7
    ) AS longitude
  FROM candidates
),
updated AS (
  UPDATE "service_users"."ServiceUserAddress" AS addr
  SET
    latitude = coords.latitude,
    longitude = coords.longitude,
    town = COALESCE(NULLIF(TRIM(addr.town), ''), 'London'),
    country = COALESCE(NULLIF(TRIM(addr.country), ''), 'United Kingdom'),
    "updatedAt" = NOW()
  FROM coords
  WHERE addr.id = coords.address_id
  RETURNING addr."serviceUserId"
)
INSERT INTO "service_users"."ServiceUserAddress" (
  id,
  "serviceUserId",
  town,
  country,
  latitude,
  longitude,
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  coords.service_user_id,
  'London',
  'United Kingdom',
  coords.latitude,
  coords.longitude,
  TRUE,
  NOW(),
  NOW()
FROM coords
WHERE coords.address_id IS NULL;
