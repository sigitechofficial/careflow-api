# Care app API (carer mobile app)

Generated from `src/employee-app` controllers and DTOs. Every route needs the carer's access token (`Authorization: Bearer …`) except login, refresh, forgot-password and reset-password. Paths are from the API host root (e.g. `https://<api-host>/employee-app/visits/:jobId/check-in`).

## Auth

### POST `/employee-app/auth/login`

Employee (carer) app login with email and password

Body: `EmployeeAppLoginDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | yes |  |
| `password` | `string` | yes |  |

### POST `/employee-app/auth/refresh`

Refresh employee app access token

Body: `EmployeeAppRefreshDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `refreshToken` | `string` | yes |  |

### POST `/employee-app/auth/forgot-password`

Care app: email a link to choose a new password

Body: `ForgotPasswordDto`

### POST `/employee-app/auth/reset-password`

Care app: choose a new password with the token from the emailed link

Body: `ResetPasswordDto`

### POST `/employee-app/auth/logout`

Logout employee app session

Body: `EmployeeAppLogoutDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` |  | FCM token to unregister on logout |

### GET `/employee-app/auth/me`

Current employee app session profile

## BodyMap

### GET `/employee-app/visits/:jobId/body-map/wizard`

Body map wizard bootstrap (mobile)

### POST `/employee-app/visits/:jobId/body-map/wizard/records`

Save body map record from mobile wizard (admin parity)

Body: `EmployeeAppBodyMapWizardSubmitDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `marker` | `EmployeeAppBodyMapMarkerDto` | yes |  |
| `marker.recordView` | `string` | yes |  |
| `marker.canvasView` | `string` | yes |  |
| `marker.x` | `number` | yes | 0–100 percent |
| `marker.y` | `number` | yes | 0–100 percent |
| `marker.bodyPart` | `string` | yes |  |
| `marker.side` | `string` |  |  |
| `marker.regionId` | `string` |  |  |
| `marker.summaryLabel` | `string` |  |  |
| `type` | `EmployeeAppBodyMapWizardTypeDto` | yes |  |
| `type.purpose` | `string` |  |  |
| `type.recordType` | `BodyMapRecordType` | yes |  |
| `type.subType` | `string` | yes |  |
| `type.firstNoticedAt` | `string` |  |  |
| `type.noticedDuring` | `string` |  |  |
| `location` | `EmployeeAppBodyMapWizardLocationDto` |  |  |
| `location.bodyPart` | `string` |  |  |
| `location.side` | `string` |  |  |
| `location.specificLocation` | `string` |  |  |
| `observation` | `EmployeeAppBodyMapWizardObservationDto` | yes |  |
| `observation.description` | `string` | yes |  |
| `observation.painLevel` | `number` |  |  |
| `observation.skinIntact` | `string` |  |  |
| `observation.riskLevel` | `BodyMapRiskLevel` |  |  |
| `observation.woundAssessment` | `BodyMapWoundAssessmentDto` |  |  |
| `observation.pressureAssessment` | `BodyMapPressureAssessmentDto` |  |  |
| `cause` | `EmployeeAppBodyMapWizardCauseDto` |  |  |
| `cause.causeKnown` | `string` |  |  |
| `cause.consistentWithInjury` | `string` |  |  |
| `cause.causeSummary` | `string` |  |  |
| `action` | `EmployeeAppBodyMapWizardActionDto` | yes |  |
| `action.managerInformed` | `string` |  |  |
| `action.reviewRequired` | `string` |  |  |
| `action.nextReviewAt` | `string` |  |  |
| `action.actionSummary` | `string` | yes |  |
| `safeguardingCheck` | `BodyMapSafeguardingCheckDto` |  |  |
| `medicationSite` | `BodyMapMedicationSiteDto` |  |  |
| `observationDetailsExtra` | `Record<string, unknown>` |  |  |
| `safeguardingTriggered` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |

### GET `/employee-app/visits/:jobId/body-map`

Body map bootstrap (legacy — prefer GET wizard)

### POST `/employee-app/visits/:jobId/body-map/records`

Create body map record (legacy flat DTO — prefer POST wizard/records)

Body: `EmployeeAppCreateBodyMapRecordDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  | Optional client-side draft id before server assigns record id |

### GET `/employee-app/visits/:jobId/body-map/patch-rotation-check`

Patch rotation warning for this visit’s client

Query: `bodyView` (string), `xRaw` (string), `yRaw` (string)

### POST `/employee-app/visits/:jobId/body-map/records/:recordId/reviews`

Carer visit update — better / same / worse + dressing

Body: `CreateBodyMapReviewDto`

### POST `/employee-app/visits/:jobId/body-map/videos`

Upload the video (max 60 s, 100 MB, 1 per record) for a body map record made on this visit

Upload: multipart form-data with a file.

Body: `{
      recordIdempotencyKey?: string;
      clientVideoId?: string;
      originalName?: string;
      durationMs?: string;
      source?: string;
    }`

### POST `/employee-app/visits/:jobId/body-map/records/:recordId/photos`

Upload a consented body-map photo on this visit

Upload: multipart form-data with a file.

Body: `{ consentStatus?: string; caption?: string }`

## Clients

### GET `/employee-app/clients`

Clients on the carer round

Query: `query` (EmployeeAppClientsQueryDto)

### GET `/employee-app/clients/:clientId`

Client profile overview

Query: `query` (EmployeeAppClientDateQueryDto)

### GET `/employee-app/clients/:clientId/alerts`

Service-user safety alerts (prioritised feed for visit details)

### GET `/employee-app/clients/:clientId/documents`

Client documents (offline-ready list)

### GET `/employee-app/clients/:clientId/medications`

Client medications + recent administration history

### GET `/employee-app/clients/:clientId/assessments`

Assessments & continuity of care

### GET `/employee-app/clients/:clientId/history-trends`

History & trends charts (BP, fluid, weight, mood)

### GET `/employee-app/clients/:clientId/consent-capacity`

Consent & mental capacity (LPA + decision-specific)

### GET `/employee-app/clients/:clientId/care-plan`

Published care plans for a client (list)

### POST `/employee-app/clients/:clientId/care-plan/:instanceId/acknowledge`

Acknowledge the current published version of a care plan (idempotent)

Body: `AcknowledgeCarePlanDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `publishedVersionId` | `string` | yes | The published version the carer has read (must be the current one). |

### GET `/employee-app/clients/:clientId/care-plan/:instanceId`

Latest published version of one care plan

## DeviceToken

### PUT `/employee-app/device-token`

Register or refresh this device FCM token

Body: `EmployeeAppDeviceTokenDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | yes |  |
| `platform` | `DevicePushPlatform` | yes |  |

### DELETE `/employee-app/device-token`

Remove this device FCM token

Body: `EmployeeAppDeleteDeviceTokenDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | yes |  |

## Home

### GET `/employee-app/home`

Today / home screen for the carer app

Query: `query` (EmployeeAppHomeQueryDto)

## Incidents

### GET `/employee-app/incidents/catalog`

Incident form catalog (types, severities, office-form lists)

### POST `/employee-app/incidents`

Report (or, before review, change) an incident that did not happen during a visit

Body: `EmployeeAppStandaloneIncidentDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `incidentType` | `string` | yes |  |
| `incidentTypeKey` | `string` |  |  |
| `subtypeKey` | `string` |  | Incident subtype id (belongs to the type/category) |
| `body` | `string` | yes |  |
| `severity` | `string` |  |  |
| `severityKey` | `string` |  |  |
| `title` | `string` |  |  |
| `incidentDate` | `string` |  |  |
| `incidentTime` | `string` |  |  |
| `location` | `string` |  |  |
| `injuryInfo` | `string` |  |  |
| `immediateAction` | `string` |  |  |
| `peopleInvolved` | `string` |  |  |
| `witnesses` | `string` |  |  |
| `contextBefore` | `string` |  | What happened immediately before |
| `contextAfter` | `string` |  | What happened afterwards |
| `affectedPersonKinds` | `string[]` |  | Kinds of person affected (SERVICE_USER/EMPLOYEE/FAMILY/VISITOR/HEALTHCARE_PROFESSIONAL/CONTRACTOR/OTHER) — multi-select |
| `affectedPersonName` | `string` |  | Name of the primary person affected when not a platform record |
| `emergencyServices` | `string` |  |  |
| `familyInformed` | `boolean` |  |  |
| `safeguardingConcern` | `boolean` |  |  |
| `followUpRequired` | `boolean` |  |  |
| `whoInformed` | `string[]` |  |  |
| `whoInformedKeys` | `string[]` |  |  |
| `notes` | `string` |  | Additional notes from the carer |
| `bodyMap` | `EmployeeAppIncidentBodyMapDto` |  |  |
| `bodyMap.regions` | `string[]` | yes |  |
| `bodyMap.marks` | `EmployeeAppIncidentBodyMapMarkDto[]` |  |  |
| `bodyMap.marks[].view` | `string` | yes |  |
| `bodyMap.marks[].x` | `number` | yes | 0–100 percent |
| `bodyMap.marks[].y` | `number` | yes | 0–100 percent |
| `bodyMap.marks[].part` | `string` | yes |  |
| `bodyMap.marks[].canvasView` | `string` |  |  |
| `bodyMap.marks[].recordView` | `string` |  |  |
| `bodyMap.notes` | `string` |  |  |
| `locationKey` | `string` |  | Where did it happen? |
| `locationDetail` | `string` |  | Where, when locationKey is OTHER |
| `immediateActionCodes` | `string[]` |  | What was done? |
| `ambulanceAttended` | `boolean | null` |  | Ambulance attended? null = not known |
| `takenToAe` | `boolean | null` |  | Taken to A&E? null = not known |
| `admittedToHospital` | `boolean | null` |  | Admitted to hospital? null = not known |
| `categoryDetails` | `Record<string, unknown>` |  | Category-specific answers (same keys as the office form; "not sure" = left out) |
| `affectedEmployeeId` | `string` |  | Staff member affected (a carer on this visit; default the reporter) |
| `involvedEmployeeIds` | `string[]` |  | Other carers on this visit who were involved |
| `injuries` | `EmployeeAppIncidentInjuryDto[]` |  |  |
| `injuries[].personKind` | `'SERVICE_USER' | 'EMPLOYEE' | 'OTHER'` | yes |  |
| `injuries[].personEmployeeId` | `string` |  | Staff member on this visit (personKind EMPLOYEE) |
| `injuries[].personName` | `string` |  | Name when personKind is OTHER |
| `injuries[].injuryType` | `string` | yes |  |
| `injuries[].injurySeverity` | `'MINOR' | 'MODERATE' | 'SERIOUS'` | yes |  |
| `injuries[].bodyRegion` | `string` |  |  |
| `injuries[].notes` | `string` |  |  |
| `injuries[].mark` | `EmployeeAppIncidentBodyMapMarkDto` |  | Body-map pin (service user only) |
| `isDraft` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |
| `serviceUserId` | `string` |  | Client involved (must be on the carer's round); omit for none |

### POST `/employee-app/incidents/:clientEntryId/attachments`

Attach a photo to an incident reported outside a visit

Upload: multipart form-data with a file.

Body: `string`

## Policies

### GET `/employee-app/policies`

Policies I must read and acknowledge

### GET `/employee-app/policies/:documentId`

Read a policy (current published version) and record that I opened it

### GET `/employee-app/policies/:documentId/document`

Download the uploaded document of the current published version

### POST `/employee-app/policies/:documentId/acknowledge`

Confirm I have read and understood the current version of the policy

## Profile

### GET `/employee-app/me/profile`

My full profile (read-only)

### GET `/employee-app/me/incidents`

Incidents I reported (read-only status)

### GET `/employee-app/me/documents/:documentId/download`

Download one of my HR documents

### GET `/employee-app/me/compliance-documents/:documentId/download`

Download one of my compliance evidence files

## Salary

### GET `/employee-app/me/salary`

My salary / earnings (read-only)

Query: `query` (EmployeeAppMySalaryQueryDto)

## Schedule

### GET `/employee-app/schedule`

Schedule screen for the carer app

Query: `query` (EmployeeAppScheduleQueryDto)

### GET `/employee-app/me/visits`

My visits history (read-only)

Query: `query` (EmployeeAppMyVisitsQueryDto)

## Visits

### GET `/employee-app/visits/:jobId`

Visit workspace shell + overview tab

### GET `/employee-app/visits/:jobId/details`

Complete visit details bootstrap

### GET `/employee-app/visits/:jobId/care-consent`

Visit-level consent to care (lead records)

### POST `/employee-app/visits/:jobId/care-consent`

Record consent to care for this visit

Body: `EmployeeAppCareConsentDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | `(typeof VISIT_CARE_CONSENT_STATUSES)[number]` | yes |  |
| `reason` | `string` |  | Required when status is DECLINED |
| `deviceRecordedAt` | `string` |  |  |
| `idempotencyKey` | `string` | yes |  |

### POST `/employee-app/visits/:jobId/area-presence`

Report mid-visit geofence presence

Body: `EmployeeAppAreaPresenceDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `latitude` | `number` |  |  |
| `longitude` | `number` |  |  |
| `outsideArea` | `boolean` |  | App/sim asserts the carer is outside the visit geofence |

### POST `/employee-app/visits/:jobId/sos`

Send a carer SOS alert with optional GPS and message

Body: `EmployeeAppSosDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `latitude` | `number` |  |  |
| `longitude` | `number` |  |  |
| `accuracyMeters` | `number` |  |  |
| `isMockedLocation` | `boolean` |  |  |
| `locationUnavailable` | `boolean` |  | True when the device could not capture GPS. SOS is still accepted. |
| `message` | `string` |  | Optional note from the carer |
| `deviceRecordedAt` | `string` |  |  |
| `idempotencyKey` | `string` |  | Same key within 30s returns the existing alert (double-tap guard). |

### POST `/employee-app/visits/:jobId/check-in-method-request`

Request office to enable Manual check-in for this visit

Body: `EmployeeAppCheckInMethodRequestDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `note` | `string` |  | Optional free-text note for the office |
| `latitude` | `number` |  |  |
| `longitude` | `number` |  |  |
| `accuracyMeters` | `number` |  |  |
| `isMockedLocation` | `boolean` |  |  |
| `locationUnavailable` | `boolean` |  | True when the device could not capture GPS. Request is still accepted. |

### POST `/employee-app/visits/:jobId/check-in`

Check in to visit (GPS + identity confirmation)

Body: `EmployeeAppVisitCheckInDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientEventId` | `string` |  | Client event id for offline idempotency (alias) |
| `idempotencyKey` | `string` |  | Idempotency key (contract) |
| `deviceCapturedAt` | `string` |  |  |
| `deviceRecordedAt` | `string` |  |  |
| `locationCapturedAt` | `string` |  |  |
| `latitude` | `number` |  |  |
| `longitude` | `number` |  |  |
| `accuracyMeters` | `number` |  |  |
| `isMockLocation` | `boolean` |  |  |
| `isMockedLocation` | `boolean` |  |  |
| `identityConfirmed` | `boolean` |  | Carer confirmed client identity at check-in |
| `method` | `string` |  |  |
| `nfcTagUid` | `string` |  | Required when method is NFC: UID read from the tag (hex; separators allowed). |
| `withinArea` | `boolean` |  |  |
| `distanceMeters` | `number` |  |  |
| `timingStatus` | `string` |  |  |
| `timingExceptionReasonCode` | `string` |  | selected arrival-reason label (catalog has no codes) |
| `timingExceptionNotes` | `string` |  |  |
| `manualOverrideReasonCode` | `string` |  |  |
| `manualOverrideNotes` | `string` |  |  |
| `welfareOutcomeId` | `string` |  |  |
| `personSeen` | `boolean` |  |  |
| `accessViaKeySafe` | `boolean` |  |  |
| `requiresManagerReview` | `boolean` |  |  |
| `outsideGeofenceReason` | `string` |  |  |

### POST `/employee-app/visits/:jobId/nfc-tag-mismatch`

Report a wrong NFC tag scanned at clock-in

Body: `EmployeeAppNfcTagMismatchDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `nfcTagUid` | `string` | yes |  |
| `deviceRecordedAt` | `string` |  | When the carer scanned it (device time, ISO). |

### POST `/employee-app/visits/:jobId/unable-to-start`

Report unable to start visit (post check-in, API-10)

Body: `EmployeeAppUnableToStartDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `reasonCode` | `string` | yes | Must match a code from GET details → data.unableToStart.reasons (care-not-delivered catalogue) |
| `notes` | `string` | yes | Required for all unable-to-start reasons |
| `attemptedAt` | `string` | yes |  |
| `contactAttemptCount` | `number` |  | Optional legacy field — ignored (location already validated at check-in) |
| `latitude` | `number` |  | Optional legacy field — not required (location already validated at check-in) |
| `longitude` | `number` |  |  |
| `accuracyMeters` | `number` |  |  |
| `idempotencyKey` | `string` | yes |  |

### POST `/employee-app/visits/:jobId/co-carers/:employeeId/presence`

Mark co-carer arrived / left (double-up presence sync)

Body: `EmployeeAppCoCarerPresenceDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `present` | `boolean` | yes | true = partner marked arrived / on site; false = marked left |
| `at` | `string` | yes | Device ISO-8601 timestamp for the presence change |
| `idempotencyKey` | `string` | yes | Offline-safe replay key |
| `notes` | `string` |  |  |

### GET `/employee-app/visits/:jobId/tasks`

Visit tasks tab (required + optional)

### PATCH `/employee-app/visits/:jobId/tasks`

Save visit task completions (bulk)

Body: `SaveVisitJobTasksDto`

### PUT `/employee-app/visits/:jobId/tasks/:taskId`

Save a single task outcome (API-11)

Body: `EmployeeAppSaveTaskDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `taskId` | `string` |  |  |
| `taskKey` | `string` |  |  |
| `outcome` | `string` | yes |  |
| `outcomeReasonCode` | `string` |  |  |
| `notes` | `string` |  |  |
| `recordedValue` | `string` |  | Recorded measurement for value-input tasks (e.g. blood glucose). |
| `value` | `string | number` |  | Alias for recordedValue (mobile may send `value`). |
| `checklist` | `EmployeeAppTaskChecklistItemDto[]` |  |  |
| `checklist[].itemId` | `string` | yes |  |
| `checklist[].checked` | `boolean` | yes |  |
| `checklist[].label` | `string` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `taskVersion` | `number` |  |  |

### GET `/employee-app/visits/:jobId/medication`

Visit MAR tab (scheduled + PRN medicines)

### POST `/employee-app/visits/:jobId/medication/:medicationKey/administrations`

Record MAR administration (API-12)

Body: `EmployeeAppMedicationAdminDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `medicationKey` | `string` |  |  |
| `outcomeCode` | `string` | yes |  |
| `outcomeLabel` | `string` |  |  |
| `supportLevel` | `string` |  |  |
| `reasonCode` | `string` |  |  |
| `notes` | `string` |  |  |
| `timeGiven` | `string` |  | Clock-face time given (HH:mm) |
| `prnIndication` | `string` |  |  |
| `prnEffectiveness` | `string` |  |  |
| `allergyAcknowledged` | `boolean` |  |  |
| `witnessPresent` | `boolean` |  | Controlled-drug witness. false = No. true = Yes (name + relation required). Omitted = not asked. |
| `witnessName` | `string` |  |  |
| `witnessRelationCode` | `string` |  | CO_CARER / RELATIVE / OTHER |
| `witnessRelationDetail` | `string` |  | Required when relation is RELATIVE (son, daughter, …) |
| `witnessNotes` | `string` |  |  |
| `witnessEmployeeId` | `string` |  | Co-carer witness: employee id of another carer allocated to this visit |
| `witnessAbsentReasonCode` | `string` |  | Required when a controlled drug is given with no witness |
| `identityConfirmed` | `boolean` | yes |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |

### GET `/employee-app/visits/:jobId/observations`

Visit observations tab

### POST `/employee-app/visits/:jobId/observations`

Record an observation during this visit (API-13)

Body: `EmployeeAppObservationWriteDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `definitionId` | `string` |  |  |
| `typeCode` | `string` |  |  |
| `outcome` | `string` |  |  |
| `value` | `string | number` |  |  |
| `secondaryValue` | `string | number` |  |  |
| `unit` | `string` |  |  |
| `notes` | `string` |  |  |
| `unableReasonCode` | `string` |  |  |
| `abnormal` | `boolean` |  |  |
| `critical` | `boolean` |  |  |
| `escalationAction` | `string` |  |  |
| `emergencyProtocolOpened` | `boolean` |  |  |
| `deviceRecordedAt` | `string` |  |  |
| `idempotencyKey` | `string` |  |  |
| `correctionReason` | `string` |  |  |
| `observationTypeCode` | `string` |  | Legacy admin DTO fields (accepted without 400). |
| `recordedAt` | `string` |  |  |
| `numericValue` | `number` |  |  |
| `payload` | `Record<string, unknown>` |  |  |
| `shareTargetCodes` | `string[]` |  |  |

### PATCH `/employee-app/visits/:jobId/observations/:observationId`

Update / correct an observation (API-14)

Body: `EmployeeAppObservationWriteDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `definitionId` | `string` |  |  |
| `typeCode` | `string` |  |  |
| `outcome` | `string` |  |  |
| `value` | `string | number` |  |  |
| `secondaryValue` | `string | number` |  |  |
| `unit` | `string` |  |  |
| `notes` | `string` |  |  |
| `unableReasonCode` | `string` |  |  |
| `abnormal` | `boolean` |  |  |
| `critical` | `boolean` |  |  |
| `escalationAction` | `string` |  |  |
| `emergencyProtocolOpened` | `boolean` |  |  |
| `deviceRecordedAt` | `string` |  |  |
| `idempotencyKey` | `string` |  |  |
| `correctionReason` | `string` |  |  |
| `observationTypeCode` | `string` |  | Legacy admin DTO fields (accepted without 400). |
| `recordedAt` | `string` |  |  |
| `numericValue` | `number` |  |  |
| `payload` | `Record<string, unknown>` |  |  |
| `shareTargetCodes` | `string[]` |  |  |

### POST `/employee-app/visits/:jobId/observations/:observationId/photos`

Attach a consented clinical photo to a visit observation

Upload: multipart form-data with a file.

Body: `{
      idempotencyKey?: string;
      clientPhotoId?: string;
      consentStatus?: string;
      caption?: string;
      capturedAt?: string;
    }`

### GET `/employee-app/visits/:jobId/log`

Visit log tab (timeline + handover note)

### GET `/employee-app/visits/:jobId/voice-notes`

Voice notes on this visit (every carer), grouped by the record they belong to

### GET `/employee-app/visits/:jobId/voice-notes/:voiceNoteId/file`

Stream a voice note on this visit (allocated carers only)

### POST `/employee-app/visits/:jobId/log/notes`

Add visit log note (API-15)

Body: `EmployeeAppLogNoteDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `body` | `string` | yes |  |
| `title` | `string` |  |  |
| `isDraft` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |
| `voiceNoteId` | `string` |  | Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty. |
| `voiceNoteIds` | `string[]` |  | Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty. |
| `voiceNoteDurationMs` | `number` |  | Total length in ms of the voice notes (timeline label for voice-only entries) |

### POST `/employee-app/visits/:jobId/log/handover`

Save handover note (API-16)

Body: `EmployeeAppLogHandoverDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `body` | `string` | yes |  |
| `priority` | `string` |  |  |
| `outstandingAction` | `string` |  |  |
| `isDraft` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |
| `voiceNoteId` | `string` |  | Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty. |
| `voiceNoteIds` | `string[]` |  | Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty. |
| `voiceNoteDurationMs` | `number` |  | Total length in ms of the voice notes (timeline label for voice-only entries) |

### POST `/employee-app/visits/:jobId/log/concerns`

Raise concern (API-17)

Body: `EmployeeAppLogConcernDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `body` | `string` | yes |  |
| `concernType` | `string` |  |  |
| `severity` | `string` |  |  |
| `escalationAction` | `string` |  |  |
| `officeContactPlanned` | `boolean` |  |  |
| `isDraft` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |
| `voiceNoteId` | `string` |  | Legacy single voice note id (clientVoiceNoteId). Prefer `voiceNoteIds`. When set, `body` may be empty. |
| `voiceNoteIds` | `string[]` |  | Voice notes (clientVoiceNoteId) on this entry, in recording order — max 3. When set, `body` may be empty. |
| `voiceNoteDurationMs` | `number` |  | Total length in ms of the voice notes (timeline label for voice-only entries) |

### POST `/employee-app/visits/:jobId/log/voice-notes`

Upload a voice note (AAC/M4A, max 5 min) for a visit note, handover or concern

Upload: multipart form-data with a file.

Body: `{
      idempotencyKey?: string;
      clientVoiceNoteId?: string;
      logEntryId?: string;
      entryType?: string;
      durationMs?: string;
      recordedAt?: string;
    }`

### PUT `/employee-app/visits/:jobId/voice-notes/links`

Link a record (task, MAR, observation, incident, clock out, SOS …) to its voice notes

Body: `EmployeeAppVoiceNoteLinkDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `entryType` | `string` | yes |  |
| `entryId` | `string` | yes | Carer-app id of the record (task key, incident clientEntryId, …) |
| `writeIdempotencyKey` | `string` |  | Idempotency key of the record save the voice notes belong to (matches its timeline event). |
| `voiceNoteIds` | `string[]` | yes | clientVoiceNoteIds in recording order (max 3; empty clears) |
| `deviceRecordedAt` | `string` |  |  |

### POST `/employee-app/visits/:jobId/incidents`

Report incident (API-18)

Body: `EmployeeAppIncidentDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `incidentType` | `string` | yes |  |
| `incidentTypeKey` | `string` |  |  |
| `subtypeKey` | `string` |  | Incident subtype id (belongs to the type/category) |
| `body` | `string` | yes |  |
| `severity` | `string` |  |  |
| `severityKey` | `string` |  |  |
| `title` | `string` |  |  |
| `incidentDate` | `string` |  |  |
| `incidentTime` | `string` |  |  |
| `location` | `string` |  |  |
| `injuryInfo` | `string` |  |  |
| `immediateAction` | `string` |  |  |
| `peopleInvolved` | `string` |  |  |
| `witnesses` | `string` |  |  |
| `contextBefore` | `string` |  | What happened immediately before |
| `contextAfter` | `string` |  | What happened afterwards |
| `affectedPersonKinds` | `string[]` |  | Kinds of person affected (SERVICE_USER/EMPLOYEE/FAMILY/VISITOR/HEALTHCARE_PROFESSIONAL/CONTRACTOR/OTHER) — multi-select |
| `affectedPersonName` | `string` |  | Name of the primary person affected when not a platform record |
| `emergencyServices` | `string` |  |  |
| `familyInformed` | `boolean` |  |  |
| `safeguardingConcern` | `boolean` |  |  |
| `followUpRequired` | `boolean` |  |  |
| `whoInformed` | `string[]` |  |  |
| `whoInformedKeys` | `string[]` |  |  |
| `notes` | `string` |  | Additional notes from the carer |
| `bodyMap` | `EmployeeAppIncidentBodyMapDto` |  |  |
| `bodyMap.regions` | `string[]` | yes |  |
| `bodyMap.marks` | `EmployeeAppIncidentBodyMapMarkDto[]` |  |  |
| `bodyMap.marks[].view` | `string` | yes |  |
| `bodyMap.marks[].x` | `number` | yes | 0–100 percent |
| `bodyMap.marks[].y` | `number` | yes | 0–100 percent |
| `bodyMap.marks[].part` | `string` | yes |  |
| `bodyMap.marks[].canvasView` | `string` |  |  |
| `bodyMap.marks[].recordView` | `string` |  |  |
| `bodyMap.notes` | `string` |  |  |
| `locationKey` | `string` |  | Where did it happen? |
| `locationDetail` | `string` |  | Where, when locationKey is OTHER |
| `immediateActionCodes` | `string[]` |  | What was done? |
| `ambulanceAttended` | `boolean | null` |  | Ambulance attended? null = not known |
| `takenToAe` | `boolean | null` |  | Taken to A&E? null = not known |
| `admittedToHospital` | `boolean | null` |  | Admitted to hospital? null = not known |
| `categoryDetails` | `Record<string, unknown>` |  | Category-specific answers (same keys as the office form; "not sure" = left out) |
| `affectedEmployeeId` | `string` |  | Staff member affected (a carer on this visit; default the reporter) |
| `involvedEmployeeIds` | `string[]` |  | Other carers on this visit who were involved |
| `injuries` | `EmployeeAppIncidentInjuryDto[]` |  |  |
| `injuries[].personKind` | `'SERVICE_USER' | 'EMPLOYEE' | 'OTHER'` | yes |  |
| `injuries[].personEmployeeId` | `string` |  | Staff member on this visit (personKind EMPLOYEE) |
| `injuries[].personName` | `string` |  | Name when personKind is OTHER |
| `injuries[].injuryType` | `string` | yes |  |
| `injuries[].injurySeverity` | `'MINOR' | 'MODERATE' | 'SERIOUS'` | yes |  |
| `injuries[].bodyRegion` | `string` |  |  |
| `injuries[].notes` | `string` |  |  |
| `injuries[].mark` | `EmployeeAppIncidentBodyMapMarkDto` |  | Body-map pin (service user only) |
| `isDraft` | `boolean` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |
| `clientEntryId` | `string` |  |  |

### POST `/employee-app/visits/:jobId/incidents/:incidentId/attachments`

Attach incident photo (API-19)

Upload: multipart form-data with a file.

Body: `{
      idempotencyKey?: string;
      clientAttachmentId?: string;
      capturedAt?: string;
      caption?: string;
    }`

### POST `/employee-app/visits/:jobId/identity`

Identity confirmation audit (API-20)

Body: `EmployeeAppIdentityDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `result` | `string` | yes |  |
| `method` | `string` |  |  |
| `notes` | `string` |  |  |
| `deviceRecordedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |

### POST `/employee-app/visits/:jobId/handover/acknowledge`

Acknowledge last handover (API-21)

Body: `EmployeeAppHandoverAcknowledgeDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `acknowledgedAt` | `string` | yes |  |
| `idempotencyKey` | `string` | yes |  |

### GET `/employee-app/visits/:jobId/completion-options`

Visit completion options (outcomes + checklist + timing reasons)

### POST `/employee-app/visits/:jobId/complete`

Complete / partially complete / miss visit

Body: `EmployeeAppVisitCompleteDto`

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | `ScheduledVisitStatus` |  | Visit outcome (defaults to COMPLETED). Cancel/call-off are not allowed on the carer app. |
| `visitOutcome` | `string` |  | Contract visit outcome alias |
| `notes` | `string` |  |  |
| `handoverNote` | `string` |  |  |
| `deliveredCarePlanFormIds` | `string[]` |  |  |
| `deliveredCarePlanDetails` | `DeliveredCarePlanDetailDto[]` |  |  |
| `extraCareNotes` | `string` |  |  |
| `actualStartDateTime` | `string` |  |  |
| `actualEndDateTime` | `string` |  |  |
| `overrunReason` | `string` |  |  |
| `timingExceptionReasonCode` | `string` |  | Required when clock-out is early or late vs planned end. Value is the admin catalog label (or a legacy reason code). |
| `timingExceptionNotes` | `string` |  | Free-text notes for the timing exception (required when reason is OTHER) |
| `leavingSafeChecks` | `EmployeeAppLeavingSafeChecksDto` |  |  |
| `leavingSafeChecks.requiredTasksComplete` | `boolean` |  |  |
| `leavingSafeChecks.medicationRecorded` | `boolean` |  |  |
| `leavingSafeChecks.personSafeComfortable` | `boolean` |  |  |
| `leavingSafeChecks.homeSecure` | `boolean` |  |  |
| `deviceRecordedAt` | `string` |  |  |
| `idempotencyKey` | `string` |  |  |
| `latitude` | `number` |  |  |
| `longitude` | `number` |  |  |
| `accuracyMeters` | `number` |  |  |
| `isMockLocation` | `boolean` |  |  |
| `isMockedLocation` | `boolean` |  |  |
| `withinArea` | `boolean` |  |  |
| `distanceMeters` | `number` |  |  |
