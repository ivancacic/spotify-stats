# Spotify Play History Stats

A static, dependency-free web app that connects to your Spotify account and shows
statistics on your listening habits: recently played tracks, top tracks, top
artists, audio feature averages, and top genres.

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
   (`user-read-recently-played`, `user-top-read`, `user-read-private`).
3. You'll be redirected back and the dashboard will load.

Tokens are stored in `localStorage` in your browser only — nothing is sent
anywhere except directly to Spotify's API.

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

If you want true multi-year "lifetime" stats (like stats.fm), Spotify doesn't
expose that via a live API call — see the main conversation/README notes on
how services like that actually source the data (GDPR data export + continuous
polling over time).

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
    app.js         App wiring: tabs, data loading, rendering
```
