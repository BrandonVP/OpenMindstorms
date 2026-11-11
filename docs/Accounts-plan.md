# Plan: optional accounts so people can save their work

Status: proposal, 2026-11-11. Nothing built yet.

## Goal

A visitor can keep using every Workbench exactly as today with no account: programs
live in the browser's localStorage, and Open/Save to a file still works. Someone who
signs in additionally gets a **program library** stored on the server: saved by name,
per brick, available from any PC, with the current program autosaved while they work.

Signing in must never be required for connecting, compiling, uploading or running.

## What is saved today

Each Workbench keeps one draft per app in localStorage (`src`, `blocks`, `mode`,
`progName`) plus UI preferences (`tower`/`link`, `slot`, `view`). The draft survives a
reload on the same PC and browser, nothing else. Files can be opened and saved by hand
(`.nqc`/`.nxc` text, `.rcxblocks`/`.nxtblocks`/`.ev3blocks` JSON).

## Sign-in: the options

| | How it works | Good | Bad |
| --- | --- | --- | --- |
| **Google + GitHub sign-in (OAuth)** | "Sign in with Google/GitHub" button; the server exchanges a code for the person's id and name | No passwords to store, no e-mail to send, no reset flow; everyone has one of the two; two small app registrations | Needs the public HTTPS address for the callback (works through the Cloudflare tunnel, not on the LAN address); depends on two outside services |
| Passkeys (WebAuthn) | The browser/phone holds a key; Touch ID, Windows Hello or a phone | No outside service, no passwords, phishing-proof | Recovery: lose the device, lose the account unless a recovery code was saved; still new to many people |
| E-mail magic link | Type an e-mail, click the link we send | Familiar, no password | The NAS has to send mail that lands in inboxes (SPF/DKIM, a relay such as Resend or SES); spam folders; a bounce means a locked-out user |
| Username + password | Classic | Works everywhere, LAN too | We store password hashes; resets need e-mail anyway; weakest for kids reusing passwords |

**Recommendation: Google + GitHub sign-in first**, passkeys as a later addition for
people who want neither. Teachers and students tend to have Google accounts; makers
have GitHub. Nothing is stored beyond the provider's id, the display name and the
e-mail (used only to show "signed in as", never mailed).

Callback addresses to register: `https://www.openmindstorms.com/api/auth/callback/google`
and `.../callback/github`. On the LAN address (192.168.68.208) sign-in is unavailable
and the pages simply behave as today; for local development the service accepts a
`DEV_LOGIN=1` setting that signs in a fixed test user without any provider.

## Architecture

One more small container, `accounts`, in the same style as `stats`: Python standard
library plus SQLite, no dependencies, database on the openrcx dataset at
`/mnt/apps/configs/openrcx/accounts/accounts.db` (= `\\TRUENAS\openrcx\accounts`).
nginx proxies `/api/auth/` and `/api/programs/` to it. Secrets (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`)
go in the app YAML like `STATS_KEY` does.

Keeping it separate from `stats` means the usage counters never see who someone is,
and the counters can keep running with no key material near them.

### Sessions

A random 32-byte token in an `HttpOnly; Secure; SameSite=Lax` cookie, valid 90 days,
stored hashed. Mutating requests must carry an `X-Requested-With: OpenMindstorms`
header and an `Origin` that matches the site, which with the SameSite cookie rules out
cross-site requests. No JavaScript ever sees the token.

### Database

```
users     id, provider, provider_id, name, email, created, last_seen
sessions  token_hash, user_id, created, expires
programs  id, user_id, app (rcx|nxt|ev3), name, mode (blocks|text), blocks (JSON),
          src (text), size, created, updated
shares    token, program_id, created          (phase 3)
```

Limits: 500 programs per account, 512 KB per program, 60 writes per minute per
account. Anything over answers 413/429 with a message the page shows.

### API

```
GET  /api/auth/me                      {user: {name, provider}} or {user: null}
GET  /api/auth/login/google?back=/rcx/  redirect to the provider (state in a cookie)
GET  /api/auth/callback/google          verify state, exchange code, set cookie, redirect back
POST /api/auth/logout
DELETE /api/auth/me                     delete the account and every program (asks twice in the page)
GET  /api/auth/export                   everything as one JSON file (take your work with you)

GET  /api/programs?app=rcx             [{id, name, mode, size, updated}]
GET  /api/programs/<id>                 the full program
POST /api/programs                      create {app, name, mode, blocks, src}
PUT  /api/programs/<id>                 save (same body), 409 if `updated` is older than the server's copy
DELETE /api/programs/<id>
```

## What changes in the pages

A shared module `web/shared/account.js` plus a few CSS rules, used by all three
Workbenches so the behaviour is identical:

- **Top bar**: a "Sign in" pill. Click: a small popover with the Google and GitHub
  buttons and one line of privacy text. Signed in: the person's name, with "My
  programs", "Export", "Sign out" and "Delete account" in the popover.
- **Program view**: a "Library" strip above the editor: the open program's name,
  **Save**, **Save as**, **Open** (a list with name, mode, last saved, search, rename,
  delete), and a saved/unsaved dot. Ctrl+S saves. The existing file buttons stay.
- **Autosave**: once a program has been saved to the library, further edits save 5 s
  after the last keystroke or block change (the page already debounces the local
  draft the same way). Never autosaves a program that was not saved by name first, so
  nobody's library fills with "Untitled".
- **First sign-in with a local draft**: one prompt, "Save your current program to
  your library as …?" The local draft keeps working as before either way.
- **Signed out / offline / LAN**: the strip shows "Sign in to save programs online"
  and nothing else changes. If the accounts service is down the strip hides itself.
- **Examples** load into the editor as today; saving one makes a copy in the library.
- **Usage counters**: new events `sign_in`, `save`, `open`, `share`, so the dashboard
  can show how many people keep programs, with no link to who they are.

## Phases

1. **Service + sign-in + library in OpenRCX** (the `accounts` container, Google and
   GitHub registration, `account.js`, the Library strip in the RCX Program view).
   Verified with `DEV_LOGIN` locally and then through the tunnel with real sign-in.
2. **OpenNXT and OpenEV3** get the same strip (small: the module is shared, the hooks
   into each app's editor state are the only app-specific part).
3. **Share links**: a "Share" switch on a program gives `https://www.openmindstorms.com/rcx/?p=<token>`;
   opening it loads a read-only copy that the visitor can run and "Save as" into their
   own library. For teachers handing out starters and for forum posts.
4. **Passkeys** as a third sign-in method, with a one-time recovery code shown at
   setup.

Rough size: about 600 lines of Python for the service, 400 lines of JS/CSS in the
pages, plus README and privacy text. Phase 1 is the bulk of it.

## Things to decide before building

1. **Sign-in providers**: Google + GitHub (recommended), passkeys only, or e-mail
   links? (Decides whether two app registrations are needed and whether the NAS has
   to send mail.)
2. **Autosave** after the first named save (recommended) or explicit Save only?
3. **Share links** in scope (phase 3) or leave out?
4. **Backups**: the accounts database holds people's work, so it should be in
   whatever snapshot or replication the openrcx dataset gets. Is that already set up
   on TrueNAS?

## Privacy and housekeeping

- Footer and README state what an account stores (provider id, name, e-mail, the
  programs) and that the e-mail is never used for mail.
- Export and Delete account are there from phase 1, so nobody is locked in.
- Children: no ages are asked; the providers' own age rules apply. No ads, no
  tracking beyond the existing anonymous counters.
- Program contents are only ever sent to the server when the person presses Save
  (or autosave after a named save). Compiling and running do not involve the
  accounts service at all.
