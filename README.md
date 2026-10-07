# Agendus Web

A mobile-first web version of **Agendus**, the classic Palm OS organizer by Iambic. Appointments, tasks, contacts and memos in one place, with the Agenda screen that made Agendus famous: everything you need for today on one page.

It's a Progressive Web App. Open it in a browser, add it to your home screen, and it works offline. No account, no server: your data stays on your device.

## Features

**Agenda (today screen)**
- Week strip with busy dots, today's appointments, tasks (including overdue), birthdays, and the people you're dealing with today, with one-tap call / text / email
- "Now / Next" indicator and a look ahead at the coming days

**Calendar views**
- Day: time grid with overlapping appointments side by side, a "now" line, tap an empty hour to add
- Week: 7-column time grid with icons, weekend shading, all-day row
- Month: icons and titles per day, with the selected day's agenda below the grid
- Year: 12 mini months with Saturday/Sunday shading and busy days highlighted (like the Agendus year view)
- List: chronological list of everything coming up
- Swipe left/right to move through dates, tap the title tab to jump to any date

**Appointments**
- Icons (47 colour icons, Agendus style), categories with colours, location, notes
- All-day and multi-day appointments
- Repeating: daily, weekly (pick days), monthly by date or by weekday ("last Friday"), yearly, every N, until a date
- Edit or delete just one occurrence, this and future ones, or all
- Link contacts, duplicate, create a follow-up

**Alarms**
- Agendus-style reminder with Snooze and Follow-up (task tomorrow, task next week, appointment next week)
- System notifications (when allowed), plus a short Palm-style chirp

**To Do**
- Priorities 1-5, due dates, categories, icons, linked contacts, notes, reminder time
- Quick add, filters (Open, Due, Upcoming, No date, Completed)
- Repeating tasks roll on to their next date when you check them off

**Contacts**
- Multiple phone numbers and emails, address, birthday (with or without year), company, website
- Contact history: every appointment and task linked to that person
- Birthdays show up in the agenda and calendar automatically

**Memos**
- Memo Pad notes, first line is the title, saved automatically

**Everything else**
- Global search across appointments, tasks, contacts and memos
- Category filter on every screen
- Undo after deleting or completing
- English and Dutch (follows your device language, or set it in Preferences)
- Themes: Light, Dark, Automatic, and **Classic Palm**
- Import/export: `.ics` (Google, Apple, Outlook calendars), `.vcf` (contacts), and full JSON backups
- Keyboard shortcuts on desktop: `a` agenda, `d` `w` `m` `y` `l` views, `t` today, arrows to move, `n` new, `/` search

## Run it locally

Any static web server works. With Node installed:

```bash
npm start
```

Then open http://localhost:8080. (Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`.)

## Put it online

It's plain static files, so any static host works:

- **GitHub Pages**: Settings > Pages > deploy from the `main` branch, root folder.
- **Vercel / Netlify / Render (static site)**: point it at this repo, no build command, publish directory `.`.

HTTPS is needed for the offline mode and notifications (all of the hosts above provide it).

After deploying an update, bump `VERSION` in `sw.js` so installed apps pick up the new files.

## Good to know

- **Where is my data?** In your browser's local storage on that device. Use *Preferences > Back up* now and then, and *Restore* to move to another device. Sync between devices would need a backend, which this version deliberately doesn't have.
- **Alarms** ring while the app is open or running in the background. Browsers don't let a closed web app wake up at an exact time, so an alarm that was missed while the app was fully closed shows up the next time you open it (up to 6 hours late).

## Tests

```bash
npm install
npm test
```

Runs an end-to-end check in a headless phone-sized browser: creating and editing appointments (including a single occurrence of a repeating one), undo, tasks and repeating tasks, contacts and birthdays, search, the back button, date navigation, memo autosave, `.ics`/`.vcf` round trips, the recurrence rules, and a no-horizontal-scroll check on a 360px screen.

## Project structure

```
index.html            App shell
css/app.css           All styles and themes
js/app.js             Routing, title bar, toolbar, global actions
js/store.js           Data, persistence, undo, sample data
js/query.js           Occurrences, filters, search
js/recur.js           Repeat rules
js/editors.js         Detail and edit sheets, pickers, follow-ups
js/reminders.js       Alarms, snooze, notifications
js/interop.js         .ics and .vcf import/export
js/i18n.js            Translation and date formatting
js/strings.js         English and Dutch strings
js/views/*.js         Agenda, calendar views, tasks, contacts, memos, preferences
sw.js                 Offline cache
```

Agendus was a product of Iambic Inc. This project is an independent tribute and is not affiliated with Iambic.
