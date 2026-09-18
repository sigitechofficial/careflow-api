-- Add fall, severe bleeding, and severe breathlessness to the org catalog.
-- Create-if-missing only — do not overwrite admin edits.

INSERT INTO "scheduling"."EmergencyProtocolCatalog"
  ("id", "code", "title", "subtitle", "version", "iconKey", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('c0e10000-0000-4000-8000-000000000009', 'fall', 'Fall', 'Do not rush to get them up', 'v1.0', 'foot', 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-00000000000a', 'bleeding', 'Severe bleeding', 'Pressure + 999', 'v1.0', 'alert', 100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-00000000000b', 'breathlessness', 'Severe breathlessness', 'Sit upright + 999 if severe', 'v1.0', 'wind', 110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "scheduling"."EmergencyProtocolStep"
  ("id", "protocolId", "action", "detail", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", v."action", v."detail", v."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "scheduling"."EmergencyProtocolCatalog" c
JOIN (
  VALUES
    ('fall', 'Stay with them — do not rush to get them up', 'Make the scene safe. Ask if they have pain. Do not hoist, pull or walk them until you have checked for injury.', 10),
    ('fall', 'Check for red flags', 'Head hit, new confusion, vomiting, severe pain, suspected hip/neck/back injury, they cannot get up, chest pain, or they are on blood thinners and hit their head.', 20),
    ('fall', 'Call 999 if any red flag', 'Keep them still and warm. Do not move them if you suspect a fracture or spinal injury. Put the phone on speaker and stay with them.', 30),
    ('fall', 'If there are no red flags and they can get up', 'Follow the care plan and your moving-and-handling training. Use prescribed equipment. Recheck pain and skin once they are up.', 40),
    ('fall', 'Document and inform', 'Record time, witnessed or not, what you found, 999/office, and how they got up. Report the incident when it is safe.', 50),
    ('bleeding', 'Call 999 for severe bleeding', 'Blood that spurts, soaks through cloth, will not stop, or is from the chest, abdomen or a large wound is an emergency. Put the phone on speaker.', 10),
    ('bleeding', 'Apply firm direct pressure', 'Use a clean cloth or dressing and press continuously. Do not keep lifting it to look. Add another cloth on top if it soaks through.', 20),
    ('bleeding', 'Do not remove an embedded object', 'Leave it in place and press around it. Lie them down and keep them warm. Do not give food or drink.', 30),
    ('bleeding', 'If they become unresponsive', 'Follow the collapse protocol: airway, breathing, and CPR if indicated. Stay on the line with 999.', 40),
    ('bleeding', 'Document and handover', 'Record where they were bleeding, what you used, times, and what 999 advised. Report the incident when safe.', 50),
    ('breathlessness', 'Call 999 if this is severe', 'Cannot finish a sentence, blue lips, sudden tightness, silent chest, collapse, or they are struggling to breathe — do not wait.', 10),
    ('breathlessness', 'Sit them upright and stay with them', 'Loosen tight clothing. Open a window if it helps. Do not leave them alone. Keep them sitting unless they become unresponsive.', 20),
    ('breathlessness', 'Use only prescribed inhaler or oxygen', 'Follow the care plan. Help them take their own prescribed reliever inhaler if they can. Do not start oxygen unless it is prescribed for them and you are trained.', 30),
    ('breathlessness', 'If this looks like anaphylaxis', 'Swelling of the tongue/throat, widespread rash, or known allergen — switch to the anaphylaxis protocol.', 40),
    ('breathlessness', 'Document and handover', 'Record onset, what you saw, inhaler/oxygen used, 999/office, and response. Report the incident when safe.', 50)
) AS v("code", "action", "detail", "sortOrder")
  ON v."code" = c."code"
WHERE c."code" IN ('fall', 'bleeding', 'breathlessness')
  AND NOT EXISTS (
    SELECT 1
    FROM "scheduling"."EmergencyProtocolStep" s
    WHERE s."protocolId" = c."id"
  );
