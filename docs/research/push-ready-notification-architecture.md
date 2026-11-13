# Research: a push-ready notification architecture for React Router + SQLite

Answers [#4](https://github.com/ryan-kipawa/cohort-005-project/issues/4), part of the In-app Notifications map [#1](https://github.com/ryan-kipawa/cohort-005-project/issues/1).

**Question.** What does browser Web Push need, which patterns let in-app be the first channel with push added later, and what does future web push require of today's data model and producer API?

**Scope.** Browser Web Push only. Native mobile push and email are out of scope. This note sets out options and trade-offs. It does not pick a design; a later ticket does that.

**Repo context, checked on `main` at b741ddd.** React Router **8.3.0** in framework mode (`package.json`), served by `react-router-serve`. The database is one SQLite file, `data.db`, opened through better-sqlite3 + Drizzle with WAL mode on (`app/db/index.ts`). There is no background job runner or queue. Note that `docs/adr/`, `GLOSSARY.md` and `app/lib/mailer.server.ts`, all referenced by the map, **do not exist on `main`**.

---

## 1. What Web Push requires

### 1.1 Moving parts

- **Push and notification are separate technologies.** Push delivers a message to the browser. The Notifications API displays it. "Your server doesn't actually send the push message directly to a client. A push service does that." The browser picks the push service, and the site cannot. ([web.dev, Push notifications overview](https://web.dev/articles/push-notifications-overview))
- **Flow:**
  1. After a user gesture, the page asks for permission and calls `PushManager.subscribe()`.
  2. The page POSTs the `PushSubscription` to our server, which stores it.
  3. Later, the server sends an encrypted, VAPID-signed request to the subscription's endpoint.
  4. The browser wakes the service worker with a `push` event, and the worker calls `showNotification()`.

  (web.dev overview above; [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))
- **Secure context and service worker.** `PushManager` and `PushSubscription` are `[SecureContext]`. `subscribe()` rejects with `NotAllowedError` on a non-https scope. ([W3C Push API §7](https://www.w3.org/TR/push-api/)) Imperative push needs an active service worker. ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))
- **Exception, Declarative Web Push.** Here the payload is JSON with `"web_push": 8030` and a `notification` object, which requires `title` and `navigate`. The user agent can display it **without a service worker**. If the payload is marked `mutable`, a service worker may still modify it. ([W3C Push API §3.3](https://www.w3.org/TR/push-api/))
  - WebKit shipped this for iOS/iPadOS 18.4 and macOS 15.5. It also exposes `window.pushManager`.
  - It is backwards compatible: older browsers handle the same JSON through a service worker `push` handler.
  - Source: [WebKit, Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).

### 1.2 Subscriptions

- **`toJSON()` shape:** `{ endpoint, expirationTime, keys: { p256dh, auth } }`. Both keys are unpadded base64url. Subscription options are not serialized. ([W3C Push API §8](https://www.w3.org/TR/push-api/))
  - `p256dh` is the per-subscription P-256 ECDH public key.
  - `auth` is a 16-octet authentication secret. ([RFC 8291 §3.1–3.2](https://www.rfc-editor.org/rfc/rfc8291))
- **The endpoint is a capability URL.** "Knowledge of the endpoint is all that is necessary to send a message to your application," so it must be kept secret. Subscribe endpoints must also be protected against CSRF. ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))
- **A subscription is per browser profile, not per user.** One person can have several subscriptions, one per device or browser. They need a one-to-many table.
- **Subscriptions expire or change.**
  - `expirationTime` is a millisecond epoch or `null`.
  - `pushsubscriptionchange` fires in the service worker when a subscription is refreshed, revoked or lost. It carries `oldSubscription` and `newSubscription`, and either may be `null`.
  - Source: [W3C Push API §3.4, §8, §10.4](https://www.w3.org/TR/push-api/)
- **Dead subscriptions return an error when sent to.**
  - RFC 8030 returns **404** for an expired subscription ([RFC 8030 §7.3](https://www.rfc-editor.org/rfc/rfc8030)).
  - web.dev treats **404 and 410** as "the subscription has expired or is no longer valid" and deletes the row. ([web.dev, Sending messages with web push libraries](https://web.dev/articles/sending-messages-with-web-push-libraries))
- **Subscription options cannot change.** Calling `subscribe()` with a different `applicationServerKey` while a subscription exists rejects with `InvalidStateError`. The page must unsubscribe first. ([W3C Push API §7.3](https://www.w3.org/TR/push-api/))

### 1.3 VAPID (RFC 8292)

- **Token.** The server signs a JWT with **ES256 (ECDSA P-256)** and sends it as `Authorization: vapid t=<jwt>, k=<public key>`. ([RFC 8292 §2, §3](https://www.rfc-editor.org/rfc/rfc8292))
  - `aud` is the push resource's origin.
  - `exp` must be **at most 24 hours** after the request.
  - `sub` is a contact `mailto:` or `https:` URI.
- **A subscription is bound to one key.** When the browser subscribes with an `applicationServerKey`, every push to that subscription must be signed by the matching private key. ([RFC 8292 §4](https://www.rfc-editor.org/rfc/rfc8292); [MDN `subscribe()`](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe))
  - A mismatch returns **403**. A missing token returns **401**.
  - **Rotating the key means getting new subscriptions.** The server must "keep track of which key each subscription used."
- **Generate the key pair once and keep it.** `web-push`'s `generateVAPIDKeys()` returns base64url strings, and the docs say to generate once and reuse. ([web-push-libs/web-push](https://github.com/web-push-libs/web-push))
  - The `subject` must be a real `mailto:` or `https:` URI. Apple's push service may return `403 BadJwtToken` for a placeholder.

### 1.4 Payload and delivery semantics

- **Encryption.** Payloads use `Content-Encoding: aes128gcm` as a single record. ([RFC 8291 §4](https://www.rfc-editor.org/rfc/rfc8291))
- **Size limit.** Push services must accept bodies of **4096 bytes or less** without a 413 ([RFC 8030 §7.2](https://www.rfc-editor.org/rfc/rfc8030)). After encryption overhead, that leaves at most **3993 octets of plaintext** ([RFC 8291 §4](https://www.rfc-editor.org/rfc/rfc8291)). In practice, send a small payload such as title, body, URL and IDs, not rich content.
- **`TTL` header.** Required. Omitting it is a 400. A TTL of 0 means deliver now or drop. The push service may shorten the TTL. ([RFC 8030 §5.2](https://www.rfc-editor.org/rfc/rfc8030)) `web-push` defaults to 4 weeks. ([web-push](https://github.com/web-push-libs/web-push))
- **`Urgency` header.** Values are `very-low`, `low`, `normal` (the default) and `high`. ([RFC 8030 §5.3](https://www.rfc-editor.org/rfc/rfc8030))
- **`Topic` header.** At most 32 base64url characters. "A push message with a topic replaces any outstanding push message with an identical topic," so it coalesces undelivered messages. ([RFC 8030 §5.4](https://www.rfc-editor.org/rfc/rfc8030))
- **Acceptance is not delivery.** **201** means accepted, not delivered. Delivery receipts need `Prefer: respond-async`. ([RFC 8030 §5, §5.1](https://www.rfc-editor.org/rfc/rfc8030))
- **Client-side coalescing.** `showNotification({ tag, renotify, data, ... })`: a `tag` lets a new notification replace an old one, `data` is any structured-cloneable value, and `renotify` requires `tag`. ([MDN `showNotification`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification))
- **Click handling.** A `notificationclick` handler closes the notification. It then focuses an open window with `clients.matchAll()`/`client.focus()` or opens one with `clients.openWindow(url)`. ([MDN notificationclick](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event)) In declarative push, the `navigate` field plays this role.

### 1.5 Permission UX and platform reach

- **Ask from a user gesture.**
  - MDN: `subscribe()` "should be done in response to a user gesture." Firefox has enforced this since 72. ([MDN `subscribe()`](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe))
  - On iOS, permission must follow direct interaction such as tapping a button. ([WebKit, Web Push for iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
- **Don't prompt on page load.**
  - Ask when the benefit is obvious.
  - Use a "double permission" step: an in-app explainer first, then the real browser prompt.
  - "If the user blocks the permission request, your web app can't ask for permission again."
  - Explain how to opt out.
  - Source: [web.dev, Permission UX](https://web.dev/articles/push-notifications-permissions-ux)
- **iOS/iPadOS (16.4+) needs a Home Screen web app.** This requires a manifest with `display: standalone` or `fullscreen`. No Apple Developer account is needed. Allow `*.push.apple.com` if you filter outbound endpoints. ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) Cadence has no manifest today, so this is a future prerequisite.
- **Chrome and Edge require `userVisibleOnly: true`.** ([MDN `subscribe()`](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)) **Firefox** applies a quota to silent pushes, but pushes that show a notification are exempt. ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)) So every push must show something.

### 1.6 Where this lands in React Router

- **The service worker script.** It must be served from the origin, ideally at root scope. A static file in `public/` is simplest. A [resource route](https://reactrouter.com/how-to/resource-routes) could also serve it: a module with a loader and no default export, returning a `Response`.
- **Subscribe, unsubscribe and click-through endpoints.** These fit as resource route actions. Plain `fetch()` to a resource route does not revalidate UI loaders, while `<Form>`/`useFetcher` do. ([React Router, Resource routes](https://reactrouter.com/how-to/resource-routes))
- **In-app freshness without push.** `useRevalidator()` re-runs page loaders "for reasons outside of normal data mutations like Window focus or polling on an interval." ([React Router, useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)) That is enough for an in-app bell with no websocket or SSE.

---

## 2. Multi-channel patterns

### 2.1 Persist the Notification once, deliver per channel

The common shape keeps "what happened, for whom" separate from "how we told them":

- **`notifications`**: one row per recipient per event. It is the in-app inbox and the source of truth. It holds recipient, type/kind, a structured payload or references, the target URL, `created_at` and `read_at`. The in-app channel **is** this table, so no separate delivery is needed.
- **`push_subscriptions`**: one row per browser subscription. It holds `user_id`, `endpoint` (unique), `p256dh`, `auth`, `expiration_time`, the VAPID key ID used, `created_at`, and optionally `user_agent` and `last_success_at`. These columns come straight from the spec facts in 1.2–1.3.
- **`notification_deliveries`** (optional): one row per notification × channel, or per notification × subscription. It holds status (`pending`/`sent`/`failed`/`gone`), `attempts`, `last_error`, and `next_attempt_at`. It is needed for retries, auditing, and not re-sending.

**Trade-off.** The deliveries table is unnecessary while in-app is the only channel. The `notifications` row is the delivery. You can add the table when push lands, as long as nothing today assumes in-app is the only consumer.

### 2.2 Outbox and fan-out

- **The pattern.** The Transactional Outbox stores "the message in the database as part of the transaction that updates the business entities." A separate relay forwards it. ([microservices.io, Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html))
  - **Benefit:** "Messages are guaranteed to be sent if and only if the database transaction commits."
  - **Consequence:** at-least-once delivery, so "a message consumer must be idempotent."
- **Fit with Cadence.** With one SQLite file and synchronous better-sqlite3, the outbox is cheap. Write the business row, the `notifications` rows, and any pending delivery rows in one `db.transaction`. A relay in the same Node process, or a separate script, polls the pending rows and calls the push service. This keeps HTTP calls to push services out of the request transaction, where they would hold SQLite's single write lock and slow down request handling.

### 2.3 Options and trade-offs (for the design ticket)

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| A. In-app only, rows written in the action | The producer inserts `notifications` rows in the same transaction. The bell reads them. Push later adds a relay that scans for new notifications. | Simplest. Atomic. Nothing to run in the background today. | Push later needs a cursor such as "last pushed id" or a deliveries table. Retrofitting is easy but must be idempotent. |
| B. Notifications + deliveries outbox from day one | Same as A, plus `notification_deliveries` rows (`channel='in_app'` delivered immediately). A future relay processes `channel='web_push'`. | Push slots in with no schema changes. Retries and audit come built in. | Extra table and code with only one channel. Speculative generality. |
| C. Domain event outbox | Producers write an `events` row such as "purchase.created". A fan-out worker decides recipients and creates notifications for each channel. | Decouples producers from the recipient logic. One event feeds many consumers, and email could come back later. | Needs a background worker now. In-app inboxes lag behind the action. Most complexity of the three. |
| D. Send push inline in the action (anti-pattern) | `await webpush.sendNotification()` inside the request. | No infrastructure. | Couples request latency to third-party push services. Not atomic with the DB write. Holds the write transaction open, or loses messages if done after commit. Avoid. |

The design ticket also has to decide **fan-out timing** (expanding to N recipients at write time or at read time) and the **relay host**. Fan-out at write time is the natural fit for the "persist once per recipient" shape. For the relay, `react-router-serve` has no job runner, so the choices are a `setInterval` in the server process, a separate `tsx` script, or a cron job.

---

## 3. Constraints future web push puts on today's design

These follow directly from the spec facts above. Each one is cheap to honour now and expensive to retrofit.

1. **Each Notification must render without the app.** A push is shown by a service worker, or directly by the browser in declarative push, with no React tree and no loader. Store or derive a **title, body and target URL** for every Notification on the server, not only in a JSX component. Rendering by `type` in a shared server-side function serves both channels.
2. **Each Notification needs a stable absolute target URL.** This feeds `navigate` in declarative push and `clients.openWindow()` in the service worker.
3. **Keep the payload small.** Plaintext is at most 3993 octets. Send IDs plus short strings, and fetch details on click. Don't make the in-app model rely on embedding large content.
4. **Notifications are per recipient, and push is per device.** The data model must allow one user to have many subscriptions. Never key anything push-related on the user alone.
5. **Use a stable ID per Notification, plus an optional coalescing key.** RFC 8030's `Topic` header (32 base64url characters max) and `showNotification`'s `tag` both replace earlier messages. A deterministic key such as `comment-thread:123` gives that for free, and the in-app bell can use it to group too.
6. **The producer API should be channel-agnostic.** Something like `notify({ recipientIds, type, data })` decides nothing about channels. Producers in actions should not know whether push exists. Channel selection, and later user preferences or muting (still "not yet specified" in #1), live behind that call.
7. **Producers must run inside the business transaction and do no network I/O.** Writing within the same `db.transaction` gives outbox atomicity. Sending happens elsewhere, so producers stay synchronous and better-sqlite3-friendly.
8. **Sending must be idempotent and tolerate duplicates.** Outbox relays are at-least-once. Push services return 201 for accepted, not delivered. Record per-delivery status so a retry doesn't double-notify.
9. **Expect subscription lifecycle churn.**
   - On 404/410, delete the subscription.
   - Handle `pushsubscriptionchange` by POSTing the new subscription to the server.
   - Store the VAPID key ID with each subscription so keys can be rotated.
   - Keep the VAPID private key in server env or config, never in the client bundle.
10. **Read state stays in-app.** The push channel cannot tell whether the user read something; at most a click handler can report back. Keep `read_at` on `notifications`. A push click can mark it read through a resource route.
11. **Permission is a one-shot, user-gesture event.** The future UI needs a settings toggle or contextual opt-in, not a prompt on load. That is a UX constraint, not a schema one, but it suggests the "Preferences / muting" work should leave room for a per-user push opt-in.

---

## Sources

- W3C, Push API (Working Draft): https://www.w3.org/TR/push-api/
- IETF RFC 8030, Generic Event Delivery Using HTTP Push: https://www.rfc-editor.org/rfc/rfc8030
- IETF RFC 8291, Message Encryption for Web Push: https://www.rfc-editor.org/rfc/rfc8291
- IETF RFC 8292, VAPID: https://www.rfc-editor.org/rfc/rfc8292
- MDN, Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- MDN, PushManager.subscribe(): https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- MDN, ServiceWorkerRegistration.showNotification(): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- MDN, notificationclick event: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event
- web.dev, Push notifications overview: https://web.dev/articles/push-notifications-overview
- web.dev, Sending messages with web push libraries: https://web.dev/articles/sending-messages-with-web-push-libraries
- web.dev, Permission UX: https://web.dev/articles/push-notifications-permissions-ux
- WebKit, Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
- web-push (Node library): https://github.com/web-push-libs/web-push
- React Router, Resource routes: https://reactrouter.com/how-to/resource-routes
- React Router, useRevalidator: https://reactrouter.com/api/hooks/useRevalidator
- microservices.io, Transactional outbox: https://microservices.io/patterns/data/transactional-outbox.html
