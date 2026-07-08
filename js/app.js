import * as auth from './auth.js';
import * as api from './api.js';
import * as store from './store.js';
import * as lifetime from './lifetime.js';
import { renderBarList, renderColumnChart, renderAreaChart, redrawAll } from './charts.js';

const THEME_KEY = 'spotify_stats_theme';
const THEME_CYCLE = ['auto', 'light', 'dark'];

function applyTheme(mode) {
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  });
}

function initThemeToggle() {
  const stored = localStorage.getItem(THEME_KEY);
  let mode = THEME_CYCLE.includes(stored) ? stored : 'auto';
  applyTheme(mode);
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length];
      localStorage.setItem(THEME_KEY, mode);
      applyTheme(mode);
      redrawAll();
    });
  });
}

const TRACKING_INTERVAL_MS = 120_000;

const AUDIO_FEATURE_KEYS = [
  'danceability',
  'energy',
  'valence',
  'acousticness',
  'instrumentalness',
  'liveness',
  'speechiness',
];

const els = {
  errorBanner: document.getElementById('error-banner'),
  loginScreen: document.getElementById('login-screen'),
  appScreen: document.getElementById('app-screen'),
  clientIdInput: document.getElementById('client-id-input'),
  redirectUriDisplay: document.getElementById('redirect-uri-display'),
  copyRedirectUri: document.getElementById('copy-redirect-uri'),
  loginButton: document.getElementById('login-button'),
  logoutButton: document.getElementById('logout-button'),
  userAvatar: document.getElementById('user-avatar'),
  userName: document.getElementById('user-name'),
  loadingOverlay: document.getElementById('loading-overlay'),
  tabButtons: document.querySelectorAll('.tab-button'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  refreshRecent: document.getElementById('refresh-recent'),
  recentPeriodSelect: document.getElementById('recent-period-select'),
  recentSourceNote: document.getElementById('recent-source-note'),
  topTracksRange: document.getElementById('top-tracks-range'),
  topArtistsRange: document.getElementById('top-artists-range'),
  refreshPlaylists: document.getElementById('refresh-playlists'),
  playlistsScopeNote: document.getElementById('playlists-scope-note'),
  playlistsContent: document.getElementById('playlists-content'),
  genresSourceSelect: document.getElementById('genres-source-select'),
  genresHint: document.getElementById('genres-hint'),
  genresStatus: document.getElementById('genres-status'),
  importFileInput: document.getElementById('import-file-input'),
  importButton: document.getElementById('import-button'),
  importStatus: document.getElementById('import-status'),
  trackingToggle: document.getElementById('tracking-toggle'),
  trackingStatus: document.getElementById('tracking-status'),
  clearLifetimeButton: document.getElementById('clear-lifetime-button'),
  lifetimeEmpty: document.getElementById('lifetime-empty'),
  lifetimeContent: document.getElementById('lifetime-content'),
  lifetimeRangeSelect: document.getElementById('lifetime-range-select'),
  lifetimeCustomRange: document.getElementById('lifetime-custom-range'),
  lifetimeFilterFrom: document.getElementById('lifetime-filter-from'),
  lifetimeFilterTo: document.getElementById('lifetime-filter-to'),
  lifetimeFilterSummary: document.getElementById('lifetime-filter-summary'),
  lifetimeFilterEmpty: document.getElementById('lifetime-filter-empty'),
  lifetimeFilteredContent: document.getElementById('lifetime-filtered-content'),
};

const cache = {
  recent: null,
  topTracks: {},
  topArtists: {},
  playlists: null,
  audioFeatures: null,
  genres: null,
  lifetimeGenres: null,
};

// ------------------------------------------------------------ link helpers

function spotifySearchUrl(query) {
  return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

function spotifyUrlFromUri(uri) {
  // spotify:track:abc123 -> https://open.spotify.com/track/abc123
  const parts = (uri || '').split(':');
  if (parts.length === 3 && parts[0] === 'spotify') {
    return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
  }
  return '';
}

function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function linkHtml(text, url, className) {
  const inner = escapeHtml(text);
  if (!url) return `<span class="${className}" title="${escapeAttr(text)}">${inner}</span>`;
  return `<a class="${className} entity-link" title="${escapeAttr(text)}" href="${escapeAttr(url)}" target="_blank" rel="noopener">${inner}</a>`;
}

let trackingIntervalId = null;

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove('hidden');
}

function clearError() {
  els.errorBanner.classList.add('hidden');
  els.errorBanner.textContent = '';
}

function setLoading(isLoading) {
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

async function withLoading(fn) {
  setLoading(true);
  try {
    return await fn();
  } catch (err) {
    showError(err.message || String(err));
    throw err;
  } finally {
    setLoading(false);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function initLoginScreen() {
  els.clientIdInput.value = auth.getClientId();
  els.redirectUriDisplay.textContent = auth.getRedirectUri();

  els.clientIdInput.addEventListener('change', () => {
    auth.setClientId(els.clientIdInput.value);
  });

  els.copyRedirectUri.addEventListener('click', async () => {
    await navigator.clipboard.writeText(auth.getRedirectUri());
    els.copyRedirectUri.textContent = 'Copied!';
    setTimeout(() => {
      els.copyRedirectUri.textContent = 'Copy';
    }, 1500);
  });

  els.loginButton.addEventListener('click', () => {
    auth.setClientId(els.clientIdInput.value);
    withLoading(() => auth.redirectToSpotifyAuthorize()).catch(() => {});
  });
}

function showLoggedInScreen() {
  els.loginScreen.classList.add('hidden');
  els.appScreen.classList.remove('hidden');
}

function showLoggedOutScreen() {
  els.appScreen.classList.add('hidden');
  els.loginScreen.classList.remove('hidden');
}

function switchTab(tabName) {
  els.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  els.tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tabName}`));
  loadTabData(tabName);
}

function initTabs() {
  els.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function loadTabData(tabName) {
  clearError();
  if (tabName === 'lifetime') return refreshLifetimeUI();
  if (tabName === 'recent') return loadRecentlyPlayed();
  if (tabName === 'top-tracks') return loadTopTracks(els.topTracksRange.value);
  if (tabName === 'top-artists') return loadTopArtists(els.topArtistsRange.value);
  if (tabName === 'playlists') return loadPlaylists();
  if (tabName === 'audio-features') return loadAudioFeatures();
  if (tabName === 'genres') return loadGenres();
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- filters

const DAY_MS = 86_400_000;

function currentFilterBounds() {
  const mode = els.lifetimeRangeSelect.value;
  const now = Date.now();
  if (mode === 'all') return { from: null, to: null };
  if (mode.startsWith('last')) {
    return { from: now - Number(mode.slice(4)) * DAY_MS, to: null };
  }
  if (mode.startsWith('year:')) {
    const year = Number(mode.slice(5));
    return {
      from: new Date(year, 0, 1).getTime(),
      to: new Date(year + 1, 0, 1).getTime() - 1,
    };
  }
  if (mode === 'custom') {
    const from = els.lifetimeFilterFrom.value
      ? new Date(`${els.lifetimeFilterFrom.value}T00:00:00`).getTime()
      : null;
    const to = els.lifetimeFilterTo.value
      ? new Date(`${els.lifetimeFilterTo.value}T23:59:59.999`).getTime()
      : null;
    return { from, to };
  }
  return { from: null, to: null };
}

function syncYearOptions(plays) {
  const years = lifetime.distinctYears(plays);
  const select = els.lifetimeRangeSelect;
  const existing = new Set(
    [...select.options].filter((o) => o.value.startsWith('year:')).map((o) => o.value),
  );
  const wanted = years.map((y) => `year:${y}`);
  if (wanted.length === existing.size && wanted.every((v) => existing.has(v))) return;

  [...select.options].filter((o) => o.value.startsWith('year:')).forEach((o) => o.remove());
  const customOption = select.querySelector('option[value="custom"]');
  for (const year of years) {
    const option = document.createElement('option');
    option.value = `year:${year}`;
    option.textContent = String(year);
    select.insertBefore(option, customOption);
  }
  if (![...select.options].some((o) => o.value === select.value)) select.value = 'all';
}

async function refreshLifetimeUI() {
  const plays = await store.getPlays();

  if (!plays.length) {
    els.lifetimeEmpty.classList.remove('hidden');
    els.lifetimeContent.classList.add('hidden');
    return;
  }

  els.lifetimeEmpty.classList.add('hidden');
  els.lifetimeContent.classList.remove('hidden');

  syncYearOptions(plays);
  els.lifetimeCustomRange.classList.toggle('hidden', els.lifetimeRangeSelect.value !== 'custom');

  const { from, to } = currentFilterBounds();
  const filtered = lifetime.filterPlays(plays, from, to);
  const stats = lifetime.computeStats(filtered);

  els.lifetimeFilterSummary.textContent =
    filtered.length === plays.length
      ? `${plays.length.toLocaleString()} plays`
      : `${filtered.length.toLocaleString()} of ${plays.length.toLocaleString()} plays`;

  els.lifetimeFilterEmpty.classList.toggle('hidden', !!stats);
  els.lifetimeFilteredContent.classList.toggle('hidden', !stats);
  if (!stats) return;

  document.getElementById('lifetime-total-plays').textContent = stats.totalPlays.toLocaleString();
  document.getElementById('lifetime-total-hours').textContent = Math.round(stats.totalMs / 3_600_000).toLocaleString();
  document.getElementById('lifetime-distinct-tracks').textContent = stats.distinctTrackCount.toLocaleString();
  document.getElementById('lifetime-distinct-artists').textContent = stats.distinctArtistCount.toLocaleString();
  document.getElementById('lifetime-date-range').textContent = `${formatDate(stats.earliest)} – ${formatDate(stats.latest)}`;

  document.getElementById('lifetime-timeline-unit').textContent = `plays per ${stats.timelineUnit}`;
  renderAreaChart(document.getElementById('lifetime-month-chart'), stats.timeline, {
    categoryName: stats.timelineUnit[0].toUpperCase() + stats.timelineUnit.slice(1),
    valueName: 'Plays',
    ariaLabel: `Plays per ${stats.timelineUnit} over time`,
  });
  renderColumnChart(
    document.getElementById('lifetime-year-chart'),
    stats.byYear.map(([year, count]) => ({ label: String(year), value: count })),
    { categoryName: 'Year', valueName: 'Plays' },
  );
  renderColumnChart(document.getElementById('lifetime-hour-chart'), stats.byHour, {
    height: 160, categoryName: 'Hour', valueName: 'Plays',
  });
  renderColumnChart(document.getElementById('lifetime-dow-chart'), stats.byDow, {
    height: 160, categoryName: 'Day', valueName: 'Plays',
  });
  renderBarList(document.getElementById('lifetime-artist-chart'), stats.topArtists, {
    formatValue: (v) => `${v.toLocaleString()}m`,
    linkFor: (item) => spotifySearchUrl(item.label),
  });
  renderBarList(document.getElementById('lifetime-track-chart'), stats.topTracks, {
    linkFor: (item) => spotifySearchUrl(item.label.replace(' — ', ' ')),
  });
}

async function handleImport() {
  const files = els.importFileInput.files;
  if (!files || files.length === 0) {
    els.importStatus.textContent = 'Choose one or more .json files first.';
    return;
  }

  await withLoading(async () => {
    const { plays, fileCount, skippedFiles } = await lifetime.parseFiles(files);
    const { added, total } = await lifetime.mergeAndStore(plays);
    els.importStatus.textContent =
      `Imported ${added.toLocaleString()} new plays from ${fileCount} file(s)` +
      (skippedFiles ? ` (${skippedFiles} file(s) skipped — not valid export JSON)` : '') +
      `. ${total.toLocaleString()} total plays stored.`;
    els.importFileInput.value = '';
    await refreshLifetimeUI();
  }).catch(() => {});
}

async function updateTrackingStatusText() {
  const meta = await store.getMeta();
  els.trackingToggle.textContent = meta.trackingEnabled ? 'Disable tracking' : 'Enable tracking';
  if (meta.trackingEnabled) {
    els.trackingStatus.textContent = meta.lastSyncedAt
      ? `Tracking is on. Last synced ${new Date(meta.lastSyncedAt).toLocaleString()}.`
      : 'Tracking is on. Waiting for first sync...';
  } else {
    els.trackingStatus.textContent = 'Tracking is off. Turn it on to keep recording plays beyond Spotify\'s last-50 limit while this app is open.';
  }
}

async function syncLiveHistory() {
  try {
    await lifetime.fetchAndMergeLive();
  } catch (err) {
    els.trackingStatus.textContent = `Sync failed: ${err.message}`;
    return;
  }
  await updateTrackingStatusText();
  const activePanel = document.querySelector('.tab-panel.active');
  if (activePanel?.id === 'panel-lifetime') await refreshLifetimeUI();
}

function stopTracking() {
  if (trackingIntervalId) {
    clearInterval(trackingIntervalId);
    trackingIntervalId = null;
  }
}

function startTracking() {
  stopTracking();
  syncLiveHistory();
  trackingIntervalId = setInterval(() => {
    if (document.visibilityState === 'visible') syncLiveHistory();
  }, TRACKING_INTERVAL_MS);
}

async function toggleTracking() {
  const meta = await store.getMeta();
  const enabled = !meta.trackingEnabled;
  await store.setMeta({ ...meta, trackingEnabled: enabled });
  if (enabled) {
    startTracking();
  } else {
    stopTracking();
  }
  await updateTrackingStatusText();
}

async function clearLifetimeData() {
  if (!window.confirm('This will permanently delete all imported and tracked lifetime play data from this browser. Continue?')) {
    return;
  }
  stopTracking();
  await store.clearAll();
  await store.setMeta({ trackingEnabled: false, lastSyncedAt: null });
  els.importStatus.textContent = '';
  await updateTrackingStatusText();
  await refreshLifetimeUI();
}

async function initLifetimeTracking() {
  const meta = await store.getMeta();
  await updateTrackingStatusText();
  if (meta.trackingEnabled) startTracking();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      store.getMeta().then((m) => {
        if (m.trackingEnabled) syncLiveHistory();
      });
    }
  });
}

// Normalized play row for rendering: works for both the live API (rich
// objects with art + URLs) and the local lifetime store (name/uri only).
function normalizeLiveRow(item) {
  return {
    title: item.track.name,
    artists: item.track.artists.map((a) => a.name).join(', '),
    playedAt: item.played_at,
    art: item.track.album?.images?.[2]?.url || item.track.album?.images?.[0]?.url || '',
    url: item.track.external_urls?.spotify || spotifyUrlFromUri(item.track.uri),
  };
}

function normalizeStoredRow(play) {
  return {
    title: play.trackName,
    artists: play.artistName,
    playedAt: play.ts,
    art: '',
    url: spotifyUrlFromUri(play.trackUri) || spotifySearchUrl(`${play.trackName} ${play.artistName}`),
  };
}

async function loadRecentlyPlayed(force = false) {
  const mode = els.recentPeriodSelect.value;
  els.recentSourceNote.classList.toggle('hidden', mode === 'live');

  if (mode === 'live') {
    if (cache.recent && !force) return renderRecentlyPlayed(cache.recent.map(normalizeLiveRow));
    await withLoading(async () => {
      const data = await api.getRecentlyPlayed(50);
      cache.recent = data.items || [];
      renderRecentlyPlayed(cache.recent.map(normalizeLiveRow));
    }).catch(() => {});
    return;
  }

  const days = Number(mode);
  const cutoff = Date.now() - days * 86_400_000;
  const plays = (await store.getPlays())
    .filter((play) => {
      const time = new Date(play.ts).getTime();
      return !Number.isNaN(time) && time >= cutoff;
    })
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
  renderRecentlyPlayed(plays.map(normalizeStoredRow));
}

const RECENT_LIST_CAP = 300;

function renderRecentlyPlayed(rows) {
  document.getElementById('recent-count').textContent = rows.length.toLocaleString();

  const artistCounts = new Map();
  const hourCounts = new Array(24).fill(0);
  for (const row of rows) {
    const artistName = row.artists.split(',')[0].trim() || 'Unknown';
    artistCounts.set(artistName, (artistCounts.get(artistName) || 0) + 1);
    const hour = new Date(row.playedAt).getHours();
    hourCounts[hour] += 1;
  }

  const topArtist = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  document.getElementById('recent-top-artist').textContent = topArtist
    ? `${topArtist[0]} (${topArtist[1]})`
    : '–';

  if (rows.length > 0) {
    const oldest = new Date(rows[rows.length - 1].playedAt);
    const newest = new Date(rows[0].playedAt);
    const hours = Math.max(1, Math.round((newest - oldest) / 3_600_000));
    document.getElementById('recent-span').textContent =
      hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  } else {
    document.getElementById('recent-span').textContent = '–';
  }

  const hourItems = hourCounts.map((count, hour) => ({ label: `${hour}:00`, value: count }));
  renderColumnChart(document.getElementById('recent-hour-chart'), hourItems, {
    height: 160, categoryName: 'Hour', valueName: 'Plays',
  });

  const list = document.getElementById('recent-list');
  list.innerHTML = '';
  if (rows.length === 0) {
    list.innerHTML = '<li class="empty">No plays in this period. Longer periods draw on your imported/tracked history from the Lifetime tab.</li>';
    return;
  }
  for (const row of rows.slice(0, RECENT_LIST_CAP)) {
    const li = document.createElement('li');
    li.className = 'track-row';
    li.innerHTML = `
      ${row.art ? `<img class="track-art" src="${escapeAttr(row.art)}" alt="">` : '<div class="track-art placeholder"></div>'}
      <div class="track-meta">
        ${linkHtml(row.title, row.url, 'track-title')}
        ${linkHtml(row.artists, spotifySearchUrl(row.artists.split(',')[0].trim()), 'track-artist')}
      </div>
      <span class="track-time">${new Date(row.playedAt).toLocaleString()}</span>
    `;
    list.appendChild(li);
  }
  if (rows.length > RECENT_LIST_CAP) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `Showing the ${RECENT_LIST_CAP} most recent of ${rows.length.toLocaleString()} plays — the charts above cover all of them.`;
    list.appendChild(li);
  }
}

async function loadTopTracks(timeRange, force = false) {
  if (cache.topTracks[timeRange] && !force) return renderTopTracks(cache.topTracks[timeRange]);
  await withLoading(async () => {
    const data = await api.getTopTracks(timeRange, 50);
    cache.topTracks[timeRange] = data.items || [];
    renderTopTracks(cache.topTracks[timeRange]);
  }).catch(() => {});
}

function renderTopTracks(items) {
  const list = document.getElementById('top-tracks-list');
  list.innerHTML = '';
  items.forEach((track, index) => {
    const art = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '';
    const li = document.createElement('li');
    li.className = 'track-row';
    li.innerHTML = `
      <span class="rank">${index + 1}</span>
      ${art ? `<img class="track-art" src="${escapeAttr(art)}" alt="">` : '<div class="track-art placeholder"></div>'}
      <div class="track-meta">
        ${linkHtml(track.name, track.external_urls?.spotify, 'track-title')}
        ${linkHtml(
          track.artists.map((a) => a.name).join(', '),
          track.artists[0]?.external_urls?.spotify || spotifySearchUrl(track.artists[0]?.name || ''),
          'track-artist',
        )}
      </div>
      <span class="track-popularity" title="Popularity">${track.popularity}</span>
    `;
    list.appendChild(li);
  });
}

async function loadTopArtists(timeRange, force = false) {
  if (cache.topArtists[timeRange] && !force) return renderTopArtists(cache.topArtists[timeRange]);
  await withLoading(async () => {
    const data = await api.getTopArtists(timeRange, 50);
    cache.topArtists[timeRange] = data.items || [];
    renderTopArtists(cache.topArtists[timeRange]);
  }).catch(() => {});
}

function renderTopArtists(items) {
  const list = document.getElementById('top-artists-list');
  list.innerHTML = '';
  items.forEach((artist, index) => {
    const art = artist.images?.[2]?.url || artist.images?.[0]?.url || '';
    const li = document.createElement('li');
    li.className = 'artist-row';
    li.innerHTML = `
      <span class="rank">${index + 1}</span>
      ${art ? `<img class="artist-art" src="${escapeAttr(art)}" alt="">` : '<div class="artist-art placeholder"></div>'}
      <div class="artist-meta">
        ${linkHtml(artist.name, artist.external_urls?.spotify, 'artist-name')}
        <span class="artist-genres" title="${escapeAttr(artist.genres.join(', '))}">${escapeHtml(artist.genres.slice(0, 3).join(', '))}</span>
      </div>
      <span class="track-popularity" title="Popularity">${artist.popularity}</span>
    `;
    list.appendChild(li);
  });
}

// ------------------------------------------------------------- playlists

async function loadPlaylists(force = false) {
  if (cache.playlists && !force) return renderPlaylists(cache.playlists);
  await withLoading(async () => {
    try {
      const playlists = await api.getAllPlaylists();
      cache.playlists = playlists;
      els.playlistsScopeNote.classList.add('hidden');
      renderPlaylists(playlists);
    } catch (err) {
      if (String(err.message).includes('403')) {
        els.playlistsScopeNote.classList.remove('hidden');
        els.playlistsContent.classList.add('hidden');
      } else {
        throw err;
      }
    }
  }).catch(() => {});
}

function renderPlaylists(playlists) {
  els.playlistsContent.classList.remove('hidden');

  const totalTracks = playlists.reduce((sum, p) => sum + (p.tracks?.total || 0), 0);
  const owned = playlists.filter((p) => p.owner?.id && p.owner.id !== 'spotify' && p.collaborative === false).length;
  document.getElementById('playlists-count').textContent = playlists.length.toLocaleString();
  document.getElementById('playlists-track-count').textContent = totalTracks.toLocaleString();
  document.getElementById('playlists-owned-count').textContent = owned.toLocaleString();

  const byUrl = new Map(playlists.map((p) => [p.name, p.external_urls?.spotify || '']));
  const largest = [...playlists]
    .sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0))
    .slice(0, 15)
    .map((p) => ({ label: p.name, value: p.tracks?.total || 0 }));
  renderBarList(document.getElementById('playlists-chart'), largest, {
    linkFor: (item) => byUrl.get(item.label) || null,
  });

  const list = document.getElementById('playlists-list');
  list.innerHTML = '';
  for (const playlist of playlists) {
    const art = playlist.images?.[playlist.images.length - 1]?.url || '';
    const li = document.createElement('li');
    li.className = 'track-row';
    li.innerHTML = `
      ${art ? `<img class="track-art" src="${escapeAttr(art)}" alt="">` : '<div class="track-art placeholder"></div>'}
      <div class="track-meta">
        ${linkHtml(playlist.name, playlist.external_urls?.spotify, 'track-title')}
        <span class="track-artist">${escapeHtml(playlist.owner?.display_name || '')}${playlist.collaborative ? ' · collaborative' : ''}${playlist.public === false ? ' · private' : ''}</span>
      </div>
      <span class="track-time">${(playlist.tracks?.total || 0).toLocaleString()} tracks</span>
    `;
    list.appendChild(li);
  }
}

async function ensureMediumTermTopTracks() {
  if (!cache.topTracks.medium_term) {
    const data = await api.getTopTracks('medium_term', 50);
    cache.topTracks.medium_term = data.items || [];
  }
  return cache.topTracks.medium_term;
}

async function ensureMediumTermTopArtists() {
  if (!cache.topArtists.medium_term) {
    const data = await api.getTopArtists('medium_term', 50);
    cache.topArtists.medium_term = data.items || [];
  }
  return cache.topArtists.medium_term;
}

async function loadAudioFeatures(force = false) {
  if (cache.audioFeatures && !force) return renderAudioFeatures(cache.audioFeatures);
  await withLoading(async () => {
    const tracks = await ensureMediumTermTopTracks();
    try {
      const features = await api.getAudioFeaturesForTracks(tracks.map((t) => t.id));
      cache.audioFeatures = features;
      renderAudioFeatures(features);
    } catch (err) {
      if (String(err.message).includes('403')) {
        document.getElementById('audio-features-chart').innerHTML =
          '<p class="empty">Your Spotify app does not have access to the Audio Features endpoint. ' +
          'Spotify restricts this endpoint to apps with extended access for apps created after ' +
          'November 2024. See the README for details.</p>';
        document.getElementById('audio-features-extra').innerHTML = '';
      } else {
        throw err;
      }
    }
  }).catch(() => {});
}

function renderAudioFeatures(features) {
  const chartEl = document.getElementById('audio-features-chart');
  const extraEl = document.getElementById('audio-features-extra');

  if (!features.length) {
    chartEl.innerHTML = '<p class="empty">No audio feature data available.</p>';
    extraEl.innerHTML = '';
    return;
  }

  const averages = AUDIO_FEATURE_KEYS.map((key) => {
    const sum = features.reduce((acc, f) => acc + (f[key] || 0), 0);
    return { label: key, value: Math.round((sum / features.length) * 100) / 100 };
  });
  renderBarList(chartEl, averages, { formatValue: (v) => v.toFixed(2) });

  const avgTempo = features.reduce((acc, f) => acc + (f.tempo || 0), 0) / features.length;
  const avgLoudness = features.reduce((acc, f) => acc + (f.loudness || 0), 0) / features.length;
  extraEl.innerHTML = `
    <div class="stat-card"><span class="stat-value">${avgTempo.toFixed(0)}</span><span class="stat-label">Avg tempo (BPM)</span></div>
    <div class="stat-card"><span class="stat-value">${avgLoudness.toFixed(1)} dB</span><span class="stat-label">Avg loudness</span></div>
  `;
}

const GENRE_HINTS = {
  recent: 'Derived from the genres of your top artists (last 6 months). Value = how many of your top 50 artists carry the genre.',
  lifetime: 'Your all-time top artists (from imported/tracked history) matched to Spotify\'s genre data, weighted by minutes listened. Genre data comes from Spotify\'s artist records — your export file doesn\'t contain genres.',
};

function loadGenres(force = false) {
  const source = els.genresSourceSelect.value;
  els.genresHint.textContent = GENRE_HINTS[source];
  els.genresStatus.classList.add('hidden');
  if (source === 'lifetime') return loadLifetimeGenres(force);
  return loadRecentGenres(force);
}

async function loadRecentGenres(force = false) {
  if (cache.genres && !force) return renderGenres(cache.genres);
  await withLoading(async () => {
    const artists = await ensureMediumTermTopArtists();
    const counts = new Map();
    for (const artist of artists) {
      for (const genre of artist.genres || []) {
        counts.set(genre, (counts.get(genre) || 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    cache.genres = sorted;
    renderGenres(sorted);
  }).catch(() => {});
}

function renderGenres(sorted, formatValue) {
  const items = sorted.map(([genre, count]) => ({ label: genre, value: count }));
  renderBarList(document.getElementById('genres-chart'), items, {
    formatValue,
    linkFor: (item) => spotifySearchUrl(item.label),
  });
}

const LIFETIME_GENRE_ARTISTS = 50;

// The streaming-history export has no genre field, so genres for lifetime
// stats are resolved by looking up the top artists via Spotify's search API
// (cached in IndexedDB) and weighting each artist's genres by minutes played.
async function loadLifetimeGenres(force = false) {
  if (cache.lifetimeGenres && !force) {
    return renderGenres(cache.lifetimeGenres, (v) => `${v.toLocaleString()}m`);
  }

  const plays = await store.getPlays();
  if (!plays.length) {
    document.getElementById('genres-chart').innerHTML =
      '<p class="empty">No lifetime data yet — import your Extended Streaming History or enable tracking on the Lifetime tab first.</p>';
    return;
  }

  const topArtists = lifetime.artistTotals(plays).slice(0, LIFETIME_GENRE_ARTISTS);
  const genreCache = await store.getArtistGenreCache();
  const unresolved = topArtists.filter(({ name }) => !genreCache[name]);

  els.genresStatus.classList.remove('hidden');

  let resolvedCount = 0;
  let rateLimited = false;
  for (const { name } of unresolved) {
    els.genresStatus.textContent =
      `Matching your top artists to Spotify's genre data (${resolvedCount}/${unresolved.length})… this happens once and is then cached.`;
    try {
      const hit = await api.searchArtist(name);
      genreCache[name] = { genres: hit?.genres || [] };
      resolvedCount++;
    } catch (err) {
      if (String(err.message).includes('Rate limited')) {
        rateLimited = true;
        break;
      }
      genreCache[name] = { genres: [] };
    }
  }
  await store.setArtistGenreCache(genreCache);

  const minutesByGenre = new Map();
  for (const { name, ms } of topArtists) {
    for (const genre of genreCache[name]?.genres || []) {
      minutesByGenre.set(genre, (minutesByGenre.get(genre) || 0) + ms);
    }
  }
  const sorted = [...minutesByGenre.entries()]
    .map(([genre, ms]) => [genre, Math.round(ms / 60_000)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  els.genresStatus.textContent = rateLimited
    ? 'Spotify rate-limited the lookups — showing what resolved so far. Revisit this tab in a minute to finish (progress is cached).'
    : `Based on your top ${topArtists.length} all-time artists, weighted by minutes listened.`;

  if (!sorted.length) {
    document.getElementById('genres-chart').innerHTML =
      '<p class="empty">Couldn\'t resolve genre data for these artists yet.</p>';
    return;
  }

  if (!rateLimited) cache.lifetimeGenres = sorted;
  renderGenres(sorted, (v) => `${v.toLocaleString()}m`);
}

async function loadUserProfile() {
  try {
    const user = await api.getCurrentUser();
    els.userName.textContent = user.display_name || user.id;
    const avatarUrl = user.images?.[0]?.url;
    if (avatarUrl) {
      els.userAvatar.src = avatarUrl;
      els.userAvatar.classList.remove('hidden');
    }
  } catch (err) {
    showError(err.message);
  }
}

function initApp() {
  els.logoutButton.addEventListener('click', () => {
    auth.logout();
    showLoggedOutScreen();
  });

  els.refreshRecent.addEventListener('click', () => loadRecentlyPlayed(true));
  els.recentPeriodSelect.addEventListener('change', () => loadRecentlyPlayed(true));
  els.topTracksRange.addEventListener('change', () => loadTopTracks(els.topTracksRange.value));
  els.topArtistsRange.addEventListener('change', () => loadTopArtists(els.topArtistsRange.value));
  els.refreshPlaylists.addEventListener('click', () => loadPlaylists(true));
  els.genresSourceSelect.addEventListener('change', () => loadGenres());

  els.importButton.addEventListener('click', handleImport);
  els.trackingToggle.addEventListener('click', toggleTracking);
  els.clearLifetimeButton.addEventListener('click', clearLifetimeData);

  els.lifetimeRangeSelect.addEventListener('change', () => refreshLifetimeUI());
  els.lifetimeFilterFrom.addEventListener('change', () => refreshLifetimeUI());
  els.lifetimeFilterTo.addEventListener('change', () => refreshLifetimeUI());

  initTabs();
  initLifetimeTracking();
  loadUserProfile();
  loadTabData('lifetime');
}

async function main() {
  initThemeToggle();
  initLoginScreen();

  try {
    await withLoading(() => auth.handleRedirectCallback());
  } catch (err) {
    showError(err.message);
  }

  if (auth.isLoggedIn()) {
    showLoggedInScreen();
    initApp();
  } else {
    showLoggedOutScreen();
  }
}

main();
