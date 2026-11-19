# Visit journey test: one visit, start to finish, through the Care app API

Run on the local system on 18/11/2026. Office actions used the office's own API code; every carer step went
through the real Care app endpoints over HTTP. The endpoint list with every field is in
[care-app-api.md](care-app-api.md).

**Visit:** Amelia Testjourney, "Morning (extra)", 18/11/2026 08:40–09:25, carer Dan Wells (test).

## Setting up (office)

| Step | What happened |
|---|---|
| Welfare outcomes (Settings) | The list was **empty**, so the Care app had no "how did you find them" options. Added: Well and comfortable, Unwell or in pain, Found on the floor, No answer at the door. |
| Add extra visit | Took Amelia over her weekly hours, so it went to a manager for approval. |
| Manager approves | Refused at first: Dan had **no contracted weekly hours**. Set 30 h/week, approved; the visit was created and allocated. |
| Home address | Amelia had **no home address or map position**. Set 1 Maswell Park Road, Hounslow TW3 2DL, key-safe access. |

## The visit (carer app, step by step)

| # | Endpoint | Sent | Result |
|---|---|---|---|
| 1 | `POST /employee-app/auth/login` | email, password | Signed in |
| 2 | `GET /employee-app/schedule` | none | Visit listed |
| 3 | `GET /employee-app/visits/:jobId/details` | none | Shell, overview, tasks (none), medication (none), welfare options, clock-in/out settings |
| 4 | `POST …/check-in` | GPS 320 m away + reason | **Refused**: outside the allowed area (setting blocks it even with a reason). Nothing saved. |
| 5 | `POST …/check-in` | GPS 40 m away, welfare "Found on the floor", person seen, key safe, needs manager review | Clocked in 08:37 |
| 6 | `POST …/care-consent` | GRANTED | Saved |
| 7 | `POST …/log/concerns` | Bruise on left hip | Saved |
| 8 | `POST …/log/handover` | High priority + outstanding action | Saved |
| 9 | `POST …/observations` | temp 37.9 (`outcome: recorded` is required) | Saved |
| 10 | `POST …/area-presence` | 600 m away, outsideArea | **Visit locked** |
| 11 | `POST …/log/notes` | while locked | **Refused**: OPERATIONS_LOCKED |
| 12 | Office: Allow to continue | Reason "Pharmacy / collecting medication" | Unlocked |
| 13 | `POST …/area-presence` | back home | Within area |
| 14 | `POST …/log/notes` | after allow | Saved |
| 15 | `POST …/complete` | early, no reason | **Refused**: "Write why you clocked out early" |
| 16 | `POST …/complete` | reason OTHER + notes, leaving-safe checks, handover, **mock location** | Completed 08:38 |

## What was saved against the visit

| Record | Saved |
|---|---|
| Visit | COMPLETED, 08:37 → 08:38 |
| Clock-in answers (visit record) | GPS, 40 m, not mock, welfare "found-on-the-floor", seen, key safe, needs manager review |
| Clock-out (visit record) | mock location: yes, outcome fully delivered, all leaving-safe checks ticked |
| Attendance | Clock-in GPS 40 m; clock-out GPS 11 m **mock** |
| Area lock | 600 m away, allowed by Super Admin, "Pharmacy / collecting medication" |
| ECM | Location confidence **Rejected** (mock location); exceptions: Short visit, Mock location, Left visit area (action taken) |

## Where office staff see it

| Screen | What shows |
|---|---|
| Visit window › Overview › **On arrival and on site** (new) | On arrival: Found on the floor (red) with seen / key safe / manager review; left the area; allowed by; mock location |
| Visit window › **Log** | Every step in order: clocked in, on arrival, concern, temperature, left area (locked), allowed by, note, clocked out, handover, mock location |
| Care app › Log | The same rows |
| ECM › visit detail | Clock-in/out with distance and "Mock location flagged"; no arrival answers |
| ECM › exception queue | Left visit area (allowed by Super Admin), Mock location, Short visit |
| Home › Handover report | The handover and visit note with their text |

## Found and fixed during the run

1. **Clock-out handover replaced the one saved during the visit**, losing its high priority and outstanding action. Now kept, and the clock-out words are added as "Handover (at clock-out)" and to the next carer's handover.
2. **Visit window Log cut the "On arrival" row to its first line.** Only the carer's own "Clocked in" row is shortened now.
3. **Idle/travel hover on the rota repeated the times.** Now: title, time range, length, "Before …".

## Welfare alert (added after the run)

A worrying arrival now raises an ECM exception **Welfare concern on arrival**: a welfare outcome marked amber or red
in Settings, the person not seen, or the carer asking for a manager review. It is time-critical for "red" answers and
for a person not seen; it sits at the top of the ECM exception queue (never hidden by the page limit), is never
auto-cleared, shows as a red "Welfare" chip and banner on the rota board and a "Welfare" count on the queue tab, and
sends the office an in-app alert with sound. Tested end to end: a second visit at 09:30, clock-in with "Found on the
floor" raised the exception, put it first in the queue, and notified 5 office users.

## Needs a decision

1. **Welfare outcomes list is empty by default.** Until it's filled in (Settings), carers can't record how they found the person.
2. **No home position means "within area".** Without a home address the area check passes every clock-in instead of saying it couldn't check.
3. **Refused out-of-area clock-ins leave no trace.** The office never sees that a carer tried to clock in 320 m away.
4. **Early/late clock-out reasons are empty locally**, but an early clock-out requires one; the app must fall back to "Other".
5. **One visit note per visit.** A second note replaces the first (by design: the app edits the same note).
