# Store a Notification's facts, and render its text on the server when it is read

A Notification row stores what happened, not what it says. Its `data` has the same activity shape for every kind of Notification: `{ actor, object, target?, excerpt?, change? }`. Each reference in it is `{ type, id, label }`, and the label is captured when the Notification is raised so it survives a deleted reply or a renamed course. The title and body are rendered lazily on the server by the catalogue entry for the Notification's `kind`. That one renderer is shared by the in-app inbox and, later, the web push relay. Only the link path is stored when the Notification is raised, because it is a fact about where the thing lives, not wording.

## Considered Options

- **Store rendered title and body when the Notification is raised.** Rejected: a change of wording would never reach existing Notifications, and grouped text such as "3 new Students on X" can't be built from finished strings.
- **Render in the browser.** Rejected: a web push arrives while no page is open, so the server has to be able to produce the text. Two renderers would drift apart.
- **A different `data` structure for each kind.** Rejected: every new kind would add one-off fields. When two cases need different wording, they become two kinds, never a flag in `data`.

## Consequences

Changing a renderer changes the text of every existing Notification of that kind, so renderers must cope with any `data` ever written for their kind. A slug rename leaves old Notifications linking to the old path.
