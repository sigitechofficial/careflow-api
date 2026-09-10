-- Org emergency protocol catalog for the carer-app runner.
-- Managed in admin Settings → Emergency protocols; served on visit details.

CREATE TABLE "scheduling"."EmergencyProtocolCatalog" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "iconKey" VARCHAR(32) NOT NULL DEFAULT 'alert',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyProtocolCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmergencyProtocolCatalog_code_key"
  ON "scheduling"."EmergencyProtocolCatalog"("code");

CREATE INDEX "EmergencyProtocolCatalog_isActive_idx"
  ON "scheduling"."EmergencyProtocolCatalog"("isActive");

CREATE INDEX "EmergencyProtocolCatalog_sortOrder_idx"
  ON "scheduling"."EmergencyProtocolCatalog"("sortOrder");

CREATE TABLE "scheduling"."EmergencyProtocolStep" (
    "id" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyProtocolStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmergencyProtocolStep_protocolId_sortOrder_idx"
  ON "scheduling"."EmergencyProtocolStep"("protocolId", "sortOrder");

ALTER TABLE "scheduling"."EmergencyProtocolStep"
  ADD CONSTRAINT "EmergencyProtocolStep_protocolId_fkey"
  FOREIGN KEY ("protocolId") REFERENCES "scheduling"."EmergencyProtocolCatalog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed UK domiciliary v1 (8 protocols). Fixed ids so the insert is stable.

INSERT INTO "scheduling"."EmergencyProtocolCatalog"
  ("id", "code", "title", "subtitle", "version", "iconKey", "sortOrder", "isActive", "createdAt", "updatedAt")
VALUES
  ('c0e10000-0000-4000-8000-000000000001', 'collapse', 'Unresponsive / collapse', 'ABC', 'v2.0', 'heart', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000002', 'choking', 'Choking', 'Adult', 'v1.2', 'wind', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000003', 'stroke', 'Suspected stroke', 'FAST', 'v1.1', 'smile', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000004', 'chest-pain', 'Chest pain / suspected heart attack', 'Call 999', 'v1.0', 'pulse', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000005', 'anaphylaxis', 'Anaphylaxis', 'Adrenaline if prescribed', 'v1.3', 'alert', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000006', 'hypo', 'Hypoglycaemia', 'Blood glucose <4', 'v1.4', 'droplet', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000007', 'sepsis', 'Deterioration / sepsis', 'RESTORE2', 'v2.1', 'activity', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0e10000-0000-4000-8000-000000000008', 'seizure', 'Seizure', 'Timed + care plan', 'v1.0', 'brain', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "scheduling"."EmergencyProtocolStep"
  ("id", "protocolId", "action", "detail", "sortOrder", "createdAt", "updatedAt")
VALUES
  -- collapse
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'Check for danger', 'Make the scene safe for you and the person before approaching.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'Check response and open airway', 'Speak and gently shake the shoulders. Tilt the head and lift the chin. Look, listen and feel for breathing for up to 10 seconds.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'Call 999 if unresponsive or not breathing normally', 'Put the phone on speaker. Follow the call handler. Check DNACPR / ReSPECT on the care plan before starting CPR.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'If not breathing normally and CPR is indicated', 'Start chest compressions 30:2 (or continuous compressions if you cannot give rescue breaths). Use an AED if available.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'If breathing, place in the recovery position', 'Keep the airway open, stay with them, and re-check breathing until help arrives.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000001', 'Document and handover', 'Record times, what you found, DNACPR status, and what you did. Handover to ambulance / office.', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- choking
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000002', 'Ask “are you choking?”', 'If they can cough or speak, encourage coughing. Do not slap the back while they can still cough effectively.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000002', 'If they cannot cough, speak or breathe — call 999', 'Stand behind them. Give up to 5 back blows between the shoulder blades, checking after each blow.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000002', 'Give up to 5 abdominal thrusts', 'If back blows fail, give up to 5 abdominal thrusts. Repeat back blows and thrusts until the obstruction clears or they become unresponsive.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000002', 'If they become unresponsive', 'Support them to the floor, start CPR, and continue until help arrives. Check the mouth for obvious obstruction before rescue breaths.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000002', 'Even if the obstruction clears', 'Anyone who received abdominal thrusts or became unresponsive must be assessed by a clinician. Inform office and document.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- stroke
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000003', 'Face', 'Ask them to smile. Look for a droop on one side of the face.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000003', 'Arms', 'Ask them to raise both arms. Look for one arm drifting down or inability to lift.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000003', 'Speech', 'Ask them to repeat a simple sentence. Listen for slurring or inability to speak.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000003', 'Time — call 999 immediately if any FAST sign is present', 'Note the time symptoms started (or when last seen well). Do not give food, drink or medication unless directed.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000003', 'Stay with them until help arrives', 'Keep them comfortable, sitting or lying with the head slightly raised if conscious. Document FAST findings and handover.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- chest-pain
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000004', 'Call 999 without delay', 'Chest pain, tightness, pain into the arm/jaw, sweating or sudden breathlessness is an emergency.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000004', 'Sit them in a comfortable position', 'Usually sitting upright and supported. Loosen tight clothing. Do not leave them alone.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000004', 'Check the care plan for GTN / aspirin instructions', 'Only give medication that is prescribed for them and that they can take themselves. Do not give aspirin if they are allergic or it is contraindicated.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000004', 'If they become unresponsive', 'Follow the collapse protocol: airway, breathing, 999 still on the line, CPR if indicated and not DNACPR.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000004', 'Document and handover', 'Record onset time, symptoms, medication given, and what 999 advised.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- anaphylaxis
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000005', 'Call 999 and say anaphylaxis', 'Look for sudden breathing difficulty, swelling of the tongue/throat, widespread rash, collapse, or known allergen exposure.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000005', 'Use their prescribed adrenaline auto-injector if available', 'Inject into the outer mid-thigh, through clothing if needed. Note the time. A second dose may be needed after 5 minutes if no improvement and a second device is available.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000005', 'Lie them down and raise the legs if they feel faint', 'If breathing is difficult, sit them up. If they are pregnant, lie on the left side. Do not make them stand or walk.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000005', 'If they become unresponsive', 'Open the airway, check breathing, and start CPR if indicated. Stay on the line with 999.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000005', 'Document and handover', 'Record allergen if known, time of injection(s), response, and remaining devices used.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- hypo
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Check blood glucose', 'Confirm BM < 4.0 mmol/L and the person is conscious and can swallow.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Give 15–20 g fast-acting glucose', 'e.g. 4–5 glucose tablets, 150 ml fruit juice, or 5 jelly babies. If unable to swallow safely, do NOT give oral glucose — go to the next step.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Wait 10–15 minutes and re-check BM', 'If still below 4.0 mmol/L, repeat fast-acting glucose once.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Give longer-acting carbohydrate', 'Once BM ≥ 4.0, offer a snack such as toast or biscuits.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Document and inform', 'Record readings, treatment given, and notify office / family as needed.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000006', 'Escalate if no improvement', 'If unresponsive, seizing, or BM not rising — call 999.', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- sepsis
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'If this is an obvious emergency, call 999 first', 'Chest pain, suspected stroke, severe breathing difficulty, or collapse — do not delay 999 for a full RESTORE2.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'Look for soft signs of deterioration', 'Off legs, new confusion, fever, change in urine, breathlessness, not eating/drinking, or “just not right”.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'Take observations if you are trained and equipment is available', 'Pulse, breathing rate, temperature, oxygen saturations, blood pressure, alertness. Calculate NEWS2 if used by your service.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'Escalate using SBARD', 'Situation, Background, Assessment, Recommendation, Decision — to 111, GP, or 999 depending on severity and the care plan.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'Follow the care plan / ReSPECT', 'Check escalation ceilings, DNACPR, and who to call out of hours. Stay with the person until advice is given.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000007', 'Document', 'Record soft signs, observations, who you called, advice given, and the agreed plan.', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- seizure
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000008', 'Protect from injury — do not restrain', 'Cushion the head, move hazards, loosen tight clothing around the neck. Do not put anything in the mouth.', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000008', 'Time the seizure', 'Note the start time. Follow their epilepsy / seizure care plan for rescue medication and when to call 999.', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000008', 'Call 999 if any red flag', 'First seizure, lasts 5 minutes or longer (or longer than their usual), repeated seizures, injury, pregnancy, diabetes, breathing difficulty, or they do not recover as usual.', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000008', 'When the jerking stops', 'Check airway and breathing. Place in the recovery position if they are unresponsive but breathing. Stay with them during recovery.', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'c0e10000-0000-4000-8000-000000000008', 'Document and inform', 'Record duration, what you saw, rescue medication given, 999/office informed, and recovery.', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
