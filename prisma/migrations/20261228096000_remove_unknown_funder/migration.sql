-- A funding line is someone you can invoice, so the placeholder "Unknown" funder is removed; undecided funding
-- is recorded as the expected funding route in Personal Details. "Prefer not to say" is not a funding route.
-- Only removed where nothing uses them.
DELETE FROM service_users."Funder" f
WHERE f.code = 'UNKNOWN_FUNDER'
  AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUserFunding" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM billing."InvoiceRunLine" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM billing."Payment" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM billing."InvoiceTemplate" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM billing."EmployeeFunderPayAssignment" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUserReferral" x WHERE x."funderId" = f.id)
  AND NOT EXISTS (SELECT 1 FROM service_users."EnquiryQuotationFunding" x WHERE x."funderId" = f.id);

DELETE FROM service_users."ServiceUserFundingType" r
WHERE r.code = 'PREFER_NOT_TO_SAY'
  AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUser" x WHERE x."fundingTypeId" = r.id)
  AND NOT EXISTS (SELECT 1 FROM service_users."ServiceUserFunding" x WHERE x."fundingRouteId" = r.id);
