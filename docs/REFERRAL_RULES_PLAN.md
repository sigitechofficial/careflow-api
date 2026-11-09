# Referral rules: what CareFlow takes, refuses or hands to a manager

Status: built 10 Nov 2026. Where to change them: Referral inbox → Settings → **Rules**.

## Why

Before this, the care CareFlow would not decide on its own was fixed in code: live-in, 24-hour, clinical tasks and
children always went to a manager, nothing could be refused, and every email that was not a referral was treated
the same way. Each care company takes different work, so these are now settings, each with its own outcome.

## What the research says (UK home care)

- **Visit length.** NICE says home care visits should normally be at least 30 minutes; shorter ones only for
  agreed, specific tasks (NICE NG21, quality standard QS123 statement 4). → "Visits shorter than 30 minutes" defaults to *manager decides*.
- **Children.** Personal care for under-18s at home is a CQC regulated activity, and a provider needs the right
  registration and specialism (CQC / Ofsted joint registration guidance). → "Younger than 18" defaults to *manager decides*.
- **Delegated healthcare tasks.** Insulin, PEG feeding, catheter and stoma care, oxygen and wound care may be done by
  care workers only when a nurse or therapist delegates them, with training, a competency check and supervision
  (Skills for Care, delegated healthcare activities guiding principles, 2023, revised 2024). → *manager decides*.
  Tracheostomy, suction, ventilation and IV lines are kept separate as "complex clinical care".
- **NHS continuing healthcare.** CHC referrals are usually reviewed by the provider's senior clinician before they are accepted. → noted.
- **Why providers turn work down.** Councils report rural and isolated packages, travel time, short or unprofitable
  call times, very early or late visits, and staff shortages as the main reasons (Surrey CC Social Care Services Board 2017;
  Lancashire homecare specification; Rural England; Homecare Association). Lancashire requires a reason whenever a referral is declined.
  → visit time windows, minimum and maximum hours, visits a day, and double-handed visits are all rules.
- **Assessment before care starts.** Under CQC regulation 9, needs must be assessed with the person; new people normally
  need a face-to-face assessment. → every "Yes" stays "subject to our assessment" (unchanged).

## Kinds of email

Claude now says what kind of email it is. Each kind has an action: **Handle automatically** (checks, enquiry,
reply), **Staff handle it** (recorded and checked, no automatic reply) or **Ignore** (kept, nothing done).

| Kind | Default |
| --- | --- |
| New referral from a professional | Handle automatically |
| Package offered to several providers (brokerage) | Handle automatically |
| Enquiry from the person or family | Handle automatically |
| Price question only | Handle automatically |
| Other question about our care | Handle automatically |
| More information about a referral we already have | Staff handle it |
| Referral withdrawn or placed elsewhere | Staff handle it (noted on the open enquiry) |
| About someone we already care for | Staff handle it |
| Complaint | Staff handle it |
| Safeguarding concern | Staff handle it |
| Job application | Ignore |
| Supplier, advert or newsletter | Ignore |
| Anything else | Ignore |

Only the first five kinds can create a new enquiry.

## The rules

Each rule has an outcome: **Off**, **Note** (shown to staff, changes nothing), **Manager decides** (the reply waits
for a manager; the decision is at most "Possibly") or **Decline** (the decision is "Can't take it"; a decline is
never sent automatically). Any rule can be set differently for one branch.

- **Type of care:** live-in, sleeping nights, waking nights, 24-hour care, respite, reablement, end of life / fast track,
  domestic help only, companionship only, escorting.
- **Health and tasks:** delegated healthcare tasks, complex clinical care, giving medicines (not just prompting),
  time-critical medicines, hoist, two carers at a visit, bariatric care, dementia, serious mental illness,
  learning disability or autism, behaviour that challenges, alcohol or drug use.
- **Person:** younger than an age (18), older than an age (off), no way for carers to get in.
- **Safety:** open safeguarding concern, risks to staff at the home, infection needing extra precautions.
- **Visits:** shorter than X minutes (30), starting before a time (07:00), finishing after a time (22:00),
  fewer than X hours a week (off), more than X hours a week (off), more than X visits a day (off).
- **Timing:** care needed today or tomorrow, hospital discharge.
- **Funding:** council, NHS (continuing healthcare), direct payments, private, not known (all off = all accepted).

The facts come from Claude's reading of the email (new "care flags"), the visit list, and the date of birth.
Emails read before this change have no flags; for them the old wording checks are used (live-in, 24-hour,
clinical, child).

## Your own rules

Written in plain English, e.g. "We don't take double-handed calls in Sutton until we've recruited". Claude reads
each email against them and lists the ones it breaks, with the reason. **A written rule can only be Note or
Manager decides, never Decline**: Claude can misread a rule or an email, so a firm "no" only comes from the fixed
rules. Rules are applied when an email is read; press "Read again" to apply changed rules to an older email.

## How Claude reports the facts

The reading schema is at the Claude API's size limit ("compiled grammar is too large"): an object of 28 yes/no
fields, or any extra enum, made every read fail. So Claude returns one list of tags (`careTags`: "liveIn",
"delegatedHealthcare: insulin", "age: 9"…) and the written-rule matches as "r1: reason" lines; CareFlow turns them
into fields (`careFlagsFromTags`, `houseRuleMatchesFrom`). `emailKind` is plain text checked against the list.
Adding any field to the main read needs the same size test (a 16-token call with the schema).

## Emails that are not new care

Follow-ups, withdrawals, complaints, safeguarding concerns and news about our own clients get no referral checks,
decision, enquiry or reply. They show a red or blue note in the inbox saying what to do (e.g. "follow the
safeguarding procedure today"). A follow-up or withdrawal is added to the history of the open enquiry it
matches; nothing is closed automatically.

## Tested (10 Nov 2026)

- 15 rule tests (outcomes, branch overrides, visit limits, age, old emails, funding, written rules, kinds, tags).
- In the app: rules saved and reloaded; live-in set to Decline → the Brent live-in referral became "Can't take it"
  with "Live-in care asked for (we don't take this)" and dementia as a note; a complaint and a safeguarding concern
  were tagged, given the staff note, no enquiry and no reply; the Croydon discharge matched the written rule
  "Hospital discharges need the discharge summary…" (manager decides, with Claude's reason). Test rules were
  then reset to the defaults.

## Safety

- Rules come from settings (staff with crm.manage); email text is never read as a rule.
- Declines are never sent automatically (unchanged). "Manager decides" also stops the automatic reply.
- The reply to the referrer is still written only from the check results.
