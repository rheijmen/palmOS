# PalmOS Agenda sync server

Keeps your agenda in step across your phone, laptop and tablet. It is a single
[PocketBase](https://pocketbase.io) program (one file, one database) that you run
on your own server, so your data stays with you.

- Built for "me and a few people": you create the accounts, nobody can sign up.
- Everyone only ever sees their own agenda.
- HTTPS certificate is arranged automatically (Let's Encrypt).
- Nightly backup at 03:00, the last 14 are kept.
- The app keeps working offline and catches up when it is back online.

## What you need

- A small Linux server (VPS) in the EU. The smallest plan of any provider is plenty,
  for example Hetzner (Germany or Finland) or Hostinger with an EU location. Choose
  **Ubuntu 24.04**. If the provider offers an image with Docker already installed,
  pick that one.
- A domain name you control, for example `yourname.nl`. The server will get its own
  address such as `sync.yourname.nl`.

## Set it up (about 20 minutes)

**1. Point a name at the server.** At your domain provider, add a DNS record:

| Type | Name   | Value                     |
| ---- | ------ | ------------------------- |
| A    | `sync` | the IP address of the VPS |

It can take a few minutes before this works.

**2. Log in to the server.** On a Mac open Terminal, on Windows open PowerShell:

```sh
ssh root@THE-IP-ADDRESS
```

**3. Install Docker** (skip if your server image already has it):

```sh
curl -fsSL https://get.docker.com | sh
```

**4. Get the server files and fill in your settings:**

```sh
git clone https://github.com/rheijmen/palmOS.git
cd palmOS/server
cp .env.example .env
nano .env
```

Set `DOMAIN` to your sync address (`sync.yourname.nl`). Leave `ALLOWED_ORIGINS` as
it is unless the app runs somewhere else than `https://rheijmen.github.io`. Save
with Ctrl+O, Enter, then Ctrl+X.

**5. Start it:**

```sh
docker compose up -d --build
```

Open `https://sync.yourname.nl/api/health` in your browser. You should see
`API is healthy`. The first visit can take a few seconds while the certificate is
fetched.

**6. Create your admin login** (for the dashboard, not for the app):

```sh
docker compose exec pocketbase /pb/pocketbase superuser upsert you@example.com 'a-long-password' --dir=/pb/pb_data
```

**7. Create the accounts.** Open `https://sync.yourname.nl/_/` and log in with the
admin login. Go to **Collections > users > New record**, fill in an email address
and a password, switch on **verified** and save. Do this for yourself and for each
person you invite.

**8. Connect the app.** In PalmOS Agenda open **Preferences > Sync**, fill in
`https://sync.yourname.nl`, your email and password, and tap **Sign in**. Whatever
is already on the device is merged into your account. Do the same on your other
devices.

Tip: put your server address in `js/config.js` (`DEFAULT_SYNC_URL`) and push it to
GitHub. Then the people you invite only need their email and password.

## Day to day

- **Forgot a password?** Change it in the dashboard (`/_/` > users). Password
  reset by email only works after you set up an email server under Settings > Mail
  settings, which is optional.
- **Backups** run every night. Download one or make one now under Settings >
  Backups in the dashboard. For extra safety you can store them at an S3-compatible
  provider in the same screen.
- **Update** to newer server files: `cd palmOS/server && git pull && docker compose up -d --build`
- **Logs** when something seems off: `docker compose logs --tail 50`
- **Firewall:** only ports 22 (SSH), 80 and 443 need to be open.

All data lives in `server/pb_data` on the VPS. That folder is the whole database;
it is kept when you update or restart.

## How sync works

Every appointment, task, contact, memo and category is one row in the `records`
collection, plus one row with the preferences that follow you between devices
(week start, day hours, assistant name and the like). Your look and language stay
per device. Each device uploads what changed since it last synced and downloads
what changed elsewhere; changes from other devices arrive within seconds while the
app is open. When the same item was changed on two devices, the most recent edit
wins.

Note that the data is stored as-is on your server: anyone with the admin login
can read it in the dashboard. Traffic between the app and the server is encrypted.
