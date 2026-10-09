# Contributing to Agendus Web

Thanks for stopping by. Agendus Web brings back the Palm OS organizer that a lot of us
lived in around 2005, rebuilt as a modern web app: works offline, lives on your home
screen, no account needed. Help of any size is welcome, from a typo fix to a whole new
feature.

## Ways to help

- **Try it and tell us what feels off.** The demo is one tap away:
  https://rheijmen.github.io/palmOS/?demo#/agenda
  Open an issue with what you did, what you expected and what happened (a screenshot helps).
- **Pick an idea from the wish list** below, or bring your own.
- **Translate it.** The app speaks English and Dutch. All text lives in `js/strings.js`;
  adding a language means adding one block there.
- **Remember how Agendus did it?** Screenshots, manuals and memories of the original are
  gold. They help us get the details right.

## Wish list

Good first steps:
- More languages (German, French and Spanish would be great starts)
- Accessibility pass: screen reader labels, focus order, contrast in every look
- More appointment icons in the Agendus style

Bigger pieces:
- Calendar subscriptions (read-only `.ics` URLs) and CalDAV sync
- End-to-end encryption for the optional sync server, so the server only ever sees scrambled data
- A wide "Palm Desktop" layout for tablets and computers
- Handwriting input in the spirit of Graffiti

If you want to take one on, open an issue first so we can agree on the approach and nobody
does the same work twice.

## Working on the code

It's plain HTML, CSS and JavaScript modules. No framework and no build step.

```bash
npm start      # serves the app at http://localhost:8080
npm install    # once, for the tests
npm test       # end-to-end, gesture and assistant checks in a headless phone-sized browser
```

The sync check needs the PocketBase program; see the Tests section in the README.

A few house rules keep the app small and fast:
- No new runtime dependencies without a good reason. If a library is needed, it gets
  vendored into `js/vendor/` with its license.
- Every user-facing text goes through `t()` and gets both an English and a Dutch entry.
- Mobile first: check your change on a 360px wide screen, and in the three looks
  (Agendus 2007, Modern, Classic Palm).
- Add or update a check in `tests/` for behaviour you change.
- Bump `VERSION` in `sw.js` when you change files the app loads, so installed apps update.

## Pull requests

1. Fork the repo and create a branch.
2. Make your change and run `npm test`.
3. Open a pull request describing what changed and why. Screenshots for visual changes, please.

Keep pull requests focused: one feature or fix per request is easiest to review.

## Privacy and keys

Never commit personal data, API keys or server addresses with credentials. The app keeps
everything on the user's device; the optional AI assistant uses the user's own API key,
stored only in their browser. Contributions must keep it that way: no analytics, no
tracking, no data leaving the device unless the user set that up themselves.

## Be kind

Be patient and respectful with everyone here. Assume good intent, explain instead of
dismiss, and remember that many contributors are doing this in their spare time.

By contributing you agree that your work is published under the project's MIT license.
