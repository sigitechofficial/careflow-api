# Security and hosting statement (draft)

Draft for organisations using CareFlow, their Data Protection Officers and commissioners (roadmap 3.5, "Data security
assurance"). It says what CareFlow does today, from the code, and marks with **To confirm** every point that depends on
how a particular organisation's CareFlow is hosted and run. Nothing marked **To confirm** may be published as fact
until the organisation (or CareFlow as the host) has checked it.

Last reviewed: November 2026 (Phase 2 part 7).

## 1. Who is responsible for what

| Role | Who | Notes |
|---|---|---|
| Data controller | The care organisation | It decides why and how people's information is used (privacy notices on every ready-made survey say so). |
| Data processor | The host of the organisation's CareFlow | **To confirm**: the hosting company named in the organisation's contract, with a data processing agreement (UK GDPR Article 28). |
| Sub-processors | Microsoft Azure (hosting, Azure Communication Services for email); a text-message provider only if one is switched on | **To confirm** per hosting. The text-message channel runs in "log" mode (nothing sent) until a provider is named. |

## 2. Data Security and Protection Toolkit (DSPT)

- CQC-registered providers must complete the DSPT each year. CareFlow helps an organisation meet it (access control,
  audit trail, encryption, retention), but each organisation submits its own.
- **To confirm**: the host's own DSPT status (organisation code, standard met / approaching / exceeded, date of the
  latest submission). Publish the status and date only once confirmed on the DSPT website.
- **To confirm**: Cyber Essentials (or Cyber Essentials Plus) certificate of the host, with its number and expiry.

## 3. Where the information is kept

- The CareFlow platform (API, database and file storage) is built for Microsoft Azure. The platform's cost tools price
  it in the **UK South** region (docs/AZURE_PRICING.md).
- **To confirm** per hosting: that the database, file storage, backups and logs are all in UK regions (UK South / UK
  West), and that no copy is kept outside the UK. The admin web app may be served from a global content network; it
  holds no personal information.
- Email goes through Azure Communication Services. **To confirm**: the data location set for that service.

## 4. Encryption

- In transit: every connection to the API and admin app uses HTTPS (TLS). **To confirm**: TLS 1.2 or higher enforced at
  the host's front door, and HSTS.
- At rest: **To confirm**: Azure Database for PostgreSQL and Azure Storage encryption at rest (on by default in Azure;
  confirm with customer-managed keys if the organisation's policy requires them).
- Extra field encryption: sensitive fields (for example secure fields in initial assessments and payroll gateway
  credentials) are encrypted again by CareFlow itself with AES-256-GCM before they are stored
  (src/common/utils/field-encryption.util.ts). The key is required in production and never stored with the data.
- Passwords are stored only as bcrypt hashes (cost 12). Staff never see or set another person's password; independent
  reviewers and new users choose their own from an emailed link.

## 5. Who can see what

- Every user has roles with permissions, and branch scope (staff in one branch see only that branch's people and
  records).
- Surveys add their own controls: who may see each survey's figures and individual responses, a reporting threshold
  (no figures until enough people answered), anonymous surveys whose answers are never linked to anyone in the
  database, and the protections listed in docs/SURVEY_ROADMAP.md (section A7), each with the test that proves it.
- Survey insight (trends, branch comparison, themes, 360 report, packs) keeps the same rules, with small groups
  combined or left out so nobody can be worked out from the totals.
- Written survey answers are read only inside CareFlow (themes, safeguarding words); no answer text is sent to any
  outside service, AI model or log.

## 6. Audit trail

- Sign-ins (and failed sign-ins), changes to records, exports and downloads are recorded with who, what and when.
- Survey audit rows never hold answers, links or (for anonymous answers) times; answers linked to no one are counted
  per day instead of recorded one by one.
- **To confirm**: how long the audit log is kept on this hosting, and who at the host can read it.

## 7. Keeping and deleting information

- Survey answers: deleted automatically once a survey (or each period) has been closed for its retention period: the
  survey's own setting, else the ready-made survey's privacy notice (for example 1 year, or 3 years). Totals kept as
  CQC evidence, who a survey was sent to, and follow-ups (without the answers they quoted) are kept. Whole surveys can
  still be deleted.
- Other records follow the organisation's Records Management and Retention Policy. **To confirm**: retention of
  backups (how long a deleted record stays in backups).

## 8. Availability and recovery

- **To confirm**: backup frequency, point-in-time restore window, the recovery time and recovery point the host
  commits to, and when a restore was last tested.
- **To confirm**: how the organisation is told about planned maintenance and incidents.

## 9. Incidents and breaches

- **To confirm**: the host's incident contact and how fast it tells the organisation of a personal data breach (so the
  organisation can report to the ICO within 72 hours where required, and record it on the DSPT incident tool).

## 10. Testing and development

- Development and test copies use made-up data; real email is redirected to test inboxes outside production.
- **To confirm**: the date of the latest independent penetration test and how its findings were closed.

## 11. Accessibility

See docs/ACCESSIBILITY_STATEMENT.md (draft).
