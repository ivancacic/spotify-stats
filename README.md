# 🎧 ListenLedger

**Your play history, accounted for.**

ListenLedger (for Spotify) is a static, dependency-free web app that connects
to your Spotify account and shows statistics on your listening habits:
lifetime history with filters and cross-filtering charts, recently played
tracks, top tracks and artists, playlists, audio feature averages, and top
genres.

> Naming note: per Spotify's [developer policy](https://developer.spotify.com/policy)
> and branding guidelines, "Spotify" is only used descriptively ("for
> Spotify") and is not part of the product name.

**Live app:** https://ivancacic.github.io/spotify-stats/index.html
(each user connects with their own Spotify app Client ID — see below).

It runs entirely in the browser — no backend server, no client secret, no
build step. Authentication uses Spotify's **Authorization Code with PKCE**
flow, which is designed for public clients like this one.

## Setup

### 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**.
3. Fill in a name/description (anything you like).
4. For **Redirect URI**, add the exact URL you'll serve this app from, for example:
   - `http://127.0.0.1:8080/index.html` (local testing — Spotify requires the
     loopback IP `127.0.0.1`, not `localhost`)
   - `https://your-username.github.io/tab-tidier/spotify-stats/index.html` (GitHub Pages)
5. Under **APIs used**, select **Web API**.
6. Save, then copy the **Client ID** from the app's settings page.

### 2. Run the app

This is a static site — any static file server works:

```bash
cd spotify-stats
python3 -m http.server 8080
# open http://127.0.0.1:8080/index.html
```

Or deploy the `spotify-stats/` folder to GitHub Pages, Netlify, Vercel, etc.

The redirect URI shown on the app's login screen must match **exactly** what
you registered in the Spotify dashboard (including trailing slashes/paths).

### 3. Log in

1. Paste your Client ID into the app.
2. Click **Connect with Spotify** and authorize the requested scopes
   (`user-read-recently-played`, `user-top-read`, `user-read-private`,
   `playlist-read-private`, `playlist-read-collaborative`).
3. You'll be redirected back and the dashboard will load.

If you logged in before the Playlists tab existed, log out and reconnect
once so your token picks up the playlist scopes.

Tokens are stored in `localStorage` in your browser only — nothing is sent
anywhere except directly to Spotify's API.

## Lifetime stats

The **Lifetime** tab works around the 50-track API cap the same way services
like stats.fm do — by combining two local, browser-only data sources instead
of a single live API call:

1. **Import your Extended Streaming History.** Request it from
   [Spotify's privacy page](https://www.spotify.com/account/privacy/)
   ("Extended streaming history" — this can take Spotify days to prepare).
   You'll receive a `.zip` of JSON files; drop them all into the file picker
   on the Lifetime tab and click **Import**. Both the modern export format
   (`ts` / `ms_played` / `master_metadata_*`) and the legacy
   `StreamingHistory*.json` format (`endTime` / `trackName` / `msPlayed`) are
   supported. Podcast episodes are skipped; only music tracks are counted.
2. **Background tracking.** Click **Enable tracking** to poll
   `/me/player/recently-played` every 2 minutes while this tab is open and
   append any new plays it hasn't seen yet. This only accumulates history
   from the moment you turn it on — it does not retroactively fill gaps if
   the app was closed for a while (Spotify's endpoint still only returns the
   last 50 plays per request).

All imported and tracked play data is stored in **IndexedDB in your browser
only** — it is never sent anywhere except directly to Spotify's own API.
Use **Clear stored lifetime data** to wipe it.

## Limitations (Spotify API constraints)

- **Recently played** only returns your **last 50** played tracks — Spotify's
  API does not expose full historical play history.
- **Top tracks/artists** are Spotify-computed over three fixed windows:
  ~4 weeks, ~6 months, and "all time" (long_term, which Spotify computes from
  several years of data, not literally forever).
- **Audio Features** (`/v1/audio-features`) is restricted by Spotify to apps
  granted **Extended Quota Mode**; apps created after November 2024 default to
  a mode that returns `403` for this endpoint. If you see an error on that
  tab, your app doesn't have access — this is a Spotify-side restriction, not
  a bug in this app.

## Going public — what "publishing" means for a Spotify-API app

The site itself is public (GitHub Pages), but Spotify gates who can *log in*:

- **Development Mode (the default).** A newly created Spotify app only
  accepts logins from users you explicitly allowlist in the dashboard under
  **User Management** (name + Spotify email, up to 25 users). Anyone else
  gets a 403 at login.
- **Extended Quota Mode** lifts that limit, but since May 2025 Spotify only
  grants it to established businesses (their stated bar is 250k+ MAU), so
  it's effectively out of reach for hobby projects.
- **The practical public model — bring your own Client ID.** ListenLedger is
  built for this: every visitor creates their own free Spotify app (2
  minutes, see Setup above), pastes their own Client ID, and uses the app
  under their own quota. No allowlist, no server, and their tokens/data stay
  in their own browser.

So "publishing" ListenLedger = sharing the URL + the Setup instructions, and
optionally allowlisting close friends on *your* Client ID so they can skip
the setup.

## Releasing changes (cache busting)

GitHub Pages and browsers cache the JS/CSS aggressively, and ES-module
imports cache independently of the page. Every asset reference therefore
carries a `?v=N` version query — the `<link>`/`<script>` tags in
`index.html`, **every** `import ... from './x.js?v=N'` across the JS files,
and the `v8`-style badge in the header. When editing any JS or CSS, bump
them all in one go before pushing:

```bash
sed -i 's/?v=8/?v=9/g; s/>v8</>v9</' index.html js/*.js
```

Keep the version identical everywhere — two different queries for the same
module would load it twice and split its state.

## Project structure

```
spotify-stats/
  index.html       Markup for the login screen and dashboard
  style.css        Styling (light/dark aware)
  js/
    pkce.js        PKCE code verifier/challenge helpers
    auth.js        Login, token exchange/refresh, logout
    api.js         Spotify Web API request wrapper
    charts.js      Minimal dependency-free bar chart renderer
    store.js       IndexedDB key-value helper for lifetime play data
    lifetime.js    Extended Streaming History parsing, merging, stats
    app.js         App wiring: tabs, data loading, rendering
```

## License

MIT — see [LICENSE](LICENSE).
