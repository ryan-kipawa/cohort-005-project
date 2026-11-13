# Existing events that could raise a Notification

Research for [#2](https://github.com/ryan-kipawa/cohort-005-project/issues/2), part of the in-app Notifications map [#1](https://github.com/ryan-kipawa/cohort-005-project/issues/1). This is an inventory only; it does not decide which events become Notifications.

**Question:** which events in Cadence today concern a person other than the actor (or the actor later), where do they happen, who do they concern, and does the mailer already email about them?

## Source

Read on 2026-11-13 from the **working tree of the main checkout**, not from committed `main`. Committed `main` (`b741ddd`) does not yet contain the Refunds work: `app/lib/mailer.server.ts`, `app/lib/refunds.server.ts`, `app/lib/refund-rules.ts`, `app/lib/enrollments.ts`, `app/routes/admin.refunds.tsx`, the `refunds` changes in `app/db/schema.ts`, and `GLOSSARY.md` exist only as uncommitted changes. All `file:line` references below are to that working tree; they will shift once it is committed.

Roles use `GLOSSARY.md` terms. Code-level roles: `users.role` is `student | instructor | admin` (`app/db/schema.ts:11`), where `admin` is a Platform Admin; a Team Admin is a `team_members` row with role `admin` (`app/db/schema.ts:40`).

## How email works today

- `app/lib/mailer.server.ts:67` `sendEmail(email)`: one function, no templates or event types. Postmark when `POSTMARK_SERVER_TOKEN` is set, otherwise a JSON file in `.outbox/` (`:62-65`).
- The emails themselves are built inside `app/lib/refunds.server.ts` and returned to the route as an `email` field on the result (`RaiseResult`, `DecisionResult`), which the route then sends. That "domain function returns the message, route delivers it" shape is the only prior art for producing a message from an event.
- `sendEmail` is called in exactly two places: `app/routes/courses.$slug.refund.ts:75` and `app/routes/admin.refunds.tsx:130`. Every email goes to the **buyer**. Nothing ever emails a Platform Admin, Instructor or Team Admin.
- `enrollUser` in `app/routes/courses.$slug.purchase.tsx:173-175` has a dead `if (sendEmail) { // Would send welcome email here }`; the only caller passes `false` (`:371`).

## Inventory

"Mailer" column: **Yes** = an email is sent today; **No** = nothing is sent.

### Refunds

| # | Event | Where | Actor | Concerns | Mailer |
|---|-------|-------|-------|----------|--------|
| R1 | Refund Request raised (Individual Purchase or Team Licence) | `app/lib/refunds.server.ts:357` `raiseRefundRequest`; route `app/routes/courses.$slug.refund.ts:63` | Buyer (Student or Team Admin) | **Platform Admin** (has a new request to decide); the buyer later (confirmation) | Yes, to the buyer only: "Refund requested — {course}" (`refunds.server.ts:394-407`, sent `courses.$slug.refund.ts:75`). Platform Admins are not told. |
| R2 | Refund Request approved | `app/lib/refunds.server.ts:614` `approveRefundRequest`; route `app/routes/admin.refunds.tsx:111` | Platform Admin | Buyer; **Instructor** of the course (Student becomes Lapsed on their roster) | Yes, to the buyer: "Refund approved — {course}" (`refunds.server.ts:736-781`, sent `admin.refunds.tsx:130`) |
| R3 | Enrollment ended by approval (Individual Purchase, no Claimed Seat for the course) | `app/lib/refunds.server.ts:657-666` (deletes the `enrollments` row) | Platform Admin | Buyer (Student, now Lapsed); Instructor | Implicitly, inside the R2 email ("is on its way back"); the email does not say access ended |
| R4 | Unclaimed Seats of a Team Licence refunded (can never be claimed) | `app/lib/refunds.server.ts:628-643` (sets `coupons.refunded_at`) | Platform Admin | Team Admin; anyone holding an unclaimed code (not a known user) | Implicitly via R2 email to the Team Admin |
| R5 | Refund Request declined (note required) | `app/lib/refunds.server.ts:692` `declineRefundRequest`; route `app/routes/admin.refunds.tsx:118` | Platform Admin | Buyer (Student or Team Admin) | Yes, to the buyer: "Refund declined — {course}" with the note (`refunds.server.ts:736-781`) |
| R6 | Team Licence's Unclaimed Seats go on hold while a Refund Request is open | Derived, not written: `app/lib/refunds.server.ts:111-121` `getSeatAvailability`; enforced at `app/routes/redeem.$code.tsx:60-66` | Team Admin (by raising R1) | Students trying to claim a Seat (unknown until they try) | No |
| R7 | Second Platform Admin tries to decide an already-decided request | `app/lib/refunds.server.ts:587-595` (409) | Platform Admin | The actor only | No (not an event for others) |

**Pending / Issued / Failed Refund do not exist in code.** `RefundStatus` is only `open | approved | declined` (`app/db/schema.ts:34-38`); the `refunds` table has `amount_refunded` set on approval (`refunds.server.ts:672`) but no column or state for money being sent or failing. There is no payment provider integration at all: a Purchase is just a row insert (`courses.$slug.purchase.tsx:181-191`). The glossary terms and ADR 0002 describe Refund issuing as "handled separately", but no such code exists. So "Refund issued" and "Refund failed" are **not** existing events today.

### Purchases, Seats and Enrollments

| # | Event | Where | Actor | Concerns | Mailer |
|---|-------|-------|-------|----------|--------|
| P1 | Individual Purchase made, Enrollment created | `app/routes/courses.$slug.purchase.tsx:366-373` (`createPurchase` `:180`, `enrollUser` `:145`, insert `:167-171`) | Student | **Instructor** (new Student on their course); the Student later (receipt/welcome) | No (welcome email stubbed out, `:173-175`) |
| P2 | Team Licence bought, Seats generated; Team created on first purchase | `app/routes/courses.$slug.purchase.tsx:376-378` (`createTeamPurchase` `:245`, `getOrCreateTeamForUser` `:210`, `generateCoupons` `:222`) | Team Admin | Team Admin later (receipt, codes to hand out); Instructor (sale) | No |
| P3 | Seat claimed, Enrollment created | `app/routes/redeem.$code.tsx:47` `redeemCoupon`; update `:98-104`, enrollment insert `:106-110`; action `:201` | Student | **Team Admin** (a Seat is used, and their Team Licence can no longer be refunded, ADR 0003); **Instructor** (new Student) | No |

Not present: Enrollment revocation other than R3, Team member invitations (Seats are bare codes; the Team Admin does not know who will claim until it happens), course completion (`enrollments.completed_at` exists, `app/db/schema.ts:134`, and is read by dashboard and roster, but **nothing ever writes it**).

### Comments and questions

Comments are per lesson, top-level or one level of replies (`app/db/schema.ts:329-361`). A "question" is a top-level comment by a non-staff author with no live staff reply (`app/routes/instructor.questions.tsx:42-70`).

| # | Event | Where | Actor | Concerns | Mailer |
|---|-------|-------|-------|----------|--------|
| C1 | Top-level comment posted on a lesson (an unanswered question) | `app/routes/courses.$slug.lessons.$lessonId.tsx:404` `createComment` with `parentId = null`, called `:903` | Student (or anyone with content access) | **Instructor** of the course and **Platform Admins** (it enters their Unanswered Questions queue, `instructor.questions.tsx:172-186`) | No |
| C2 | Reply posted to a comment | Same `createComment` with a `parentId`, `:903` | Any participant | Author of the parent comment; arguably other repliers in the thread | No |
| C3 | Staff answer to a question from the Unanswered Questions page | `app/routes/instructor.questions.tsx:118` `createComment`, called `:211` (requires `requireStaff`, `:208`) | Instructor or Platform Admin | **Student** who asked | No |
| C4 | Comment deleted by staff (someone else's) | `app/routes/courses.$slug.lessons.$lessonId.tsx:459` `deleteComment`, `isStaff` branch `:464`; called `:935` | Instructor or Platform Admin | Comment's author | No |
| C5 | Comment edited | `:437` `updateComment` (own comments only) | Author | Readers/repliers, weakly | No |

### Learning activity

| # | Event | Where | Actor | Concerns | Mailer |
|---|-------|-------|-------|----------|--------|
| L1 | Lesson marked complete | `app/routes/courses.$slug.lessons.$lessonId.tsx:218` `markLessonComplete`, called `:947-950` | Student | Student only (Instructor sees it on analytics/roster, pulled not pushed) | No |
| L2 | Quiz submitted and scored (pass = score > 0.7) | `app/routes/courses.$slug.lessons.$lessonId.tsx:531` `computeResult`, insert `:602-611`, called `:970` | Student | Student only; result is shown immediately in the response | No |
| L3 | Video watched (Watched time, approaches the Watch Limit) | `app/routes/api.video-tracking.ts:30` | Student | Student later (crossing the Watch Limit silently ends refund eligibility, `refunds.server.ts:246-248`); the 14-day window closing is likewise silent (`refund-rules.ts:5`) | No |
| L4 | Course rated (create or update) | `app/routes/courses.$slug.tsx:330` `rateCourse`, called `:478` | Student | **Instructor** | No |

L3's two items are time/threshold crossings, not writes: nothing in the code detects the moment they happen, and there is no scheduler or background job anywhere in the app.

### Course and account administration

| # | Event | Where | Actor | Concerns | Mailer |
|---|-------|-------|-------|----------|--------|
| A1 | Course status changed (draft / published / archived) by its Instructor | `app/routes/instructor.$courseId.tsx:154` `updateCourseStatus`, intent `:695-698` | Instructor (or Platform Admin) | Enrolled Students (archived); Instructor when a Platform Admin does it | No |
| A2 | Course status changed by a Platform Admin from the admin list | `app/routes/admin.courses.tsx:76` `updateCourseStatus`, intent `:141-144` | Platform Admin | **Instructor** who owns the course; enrolled Students | No |
| A3 | Course content changed: lessons/modules added, deleted, moved; price, title, sales copy | `app/routes/instructor.$courseId.tsx` intents `:685-849` (e.g. `add-lesson` `:753`, `delete-lesson` `:827`, `update-price` `:700`); lesson body `app/routes/instructor.$courseId.lessons.$lessonId.tsx:86`; quiz edits `instructor.$courseId.lessons.$lessonId.quiz.tsx:174-260` (deleting a quiz deletes Students' attempts, `:214-217`) | Instructor (or Platform Admin) | Enrolled Students (new content; lost quiz attempts); Instructor when a Platform Admin edits | No |
| A4 | User's role changed | `app/routes/admin.users.tsx:60` `updateUserRole`, intent `:126-130` | Platform Admin | That person | No |
| A5 | User's name/email changed by a Platform Admin | `app/routes/admin.users.tsx:46` `updateUser`, intent `:119-124` | Platform Admin | That person | No |
| A6 | Signup | `app/routes/signup.tsx:78` | New user | Actor only | No |

## What this adds up to

- **Emailed today: three events, all to the buyer, all about Refund Requests** (R1 raised, R2 approved, R5 declined). Everything else in the inventory is silent.
- Events that concern someone **other than the actor** and have a recipient Cadence can identify: R1 (Platform Admins), R2/R3/R4/R5 (buyer, Instructor), P1/P3 (Instructor; Team Admin for P3), C1 (Instructor, Platform Admins), C2 (parent author), C3 (asker), C4 (author), L4 (Instructor), A2/A3 (Instructor, enrolled Students), A4/A5 (the user).
- Events that only concern **the actor later**: R1 confirmation, P1/P2 receipts, L1/L2 results, L3 threshold crossings.
- **Team Admins currently receive nothing** except the refund emails as a buyer; P3 (Seat claimed) is the only event specific to them.

## Gaps against the map's examples

The issue named some events that do not exist in code:

- **Refund issued / Refund failed**: glossary terms only (Pending, Issued, Failed Refund); no state, column, or code path.
- **Course completed**: `enrollments.completed_at` is never written.
- **Welcome / enrollment email**: stubbed, never sent.
- **Watch Limit reached / refund window closing**: rule checks exist, but nothing fires when the line is crossed.
