import * as auth from './auth.js';
import * as api from './api.js';
import * as store from './store.js';
import * as lifetime from './lifetime.js';
import { renderBarChart } from './charts.js';

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
  topTracksRange: document.getElementById('top-tracks-range'),
  topArtistsRange: document.getElementById('top-artists-range'),
  importFileInput: document.getElementById('import-file-input'),
  importButton: document.getElementById('import-button'),
  importStatus: document.getElementById('import-status'),
  trackingToggle: document.getElementById('tracking-toggle'),
  trackingStatus: document.getElementById('tracking-status'),
  clearLifetimeButton: document.getElementById('clear-lifetime-button'),
  lifetimeEmpty: document.getElementById('lifetime-empty'),
  lifetimeContent: document.getElementById('lifetime-content'),
};

const cache = {
  recent: null,
  topTracks: {},
  topArtists: {},
  audioFeatures: null,
  genres: null,
};

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
  if (tabName === 'audio-features') return loadAudioFeatures();
  if (tabName === 'genres') return loadGenres();
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function refreshLifetimeUI() {
  const plays = await store.getPlays();
  const stats = lifetime.computeStats(plays);

  if (!stats) {
    els.lifetimeEmpty.classList.remove('hidden');
    els.lifetimeContent.classList.add('hidden');
    return;
  }

  els.lifetimeEmpty.classList.add('hidden');
  els.lifetimeContent.classList.remove('hidden');

  document.getElementById('lifetime-total-plays').textContent = stats.totalPlays.toLocaleString();
  document.getElementById('lifetime-total-hours').textContent = Math.round(stats.totalMs / 3_600_000).toLocaleString();
  document.getElementById('lifetime-distinct-tracks').textContent = stats.distinctTrackCount.toLocaleString();
  document.getElementById('lifetime-distinct-artists').textContent = stats.distinctArtistCount.toLocaleString();
  document.getElementById('lifetime-date-range').textContent = `${formatDate(stats.earliest)} – ${formatDate(stats.latest)}`;

  renderBarChart(
    document.getElementById('lifetime-year-chart'),
    stats.byYear.map(([year, count]) => ({ label: String(year), value: count })),
  );
  renderBarChart(document.getElementById('lifetime-artist-chart'), stats.topArtists, {
    valueFormatter: (v) => `${v.toLocaleString()}m`,
  });
  renderBarChart(document.getElementById('lifetime-track-chart'), stats.topTracks);
  renderBarChart(document.getElementById('lifetime-hour-chart'), stats.byHour);
  renderBarChart(document.getElementById('lifetime-dow-chart'), stats.byDow);
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

async function loadRecentlyPlayed(force = false) {
  if (cache.recent && !force) return renderRecentlyPlayed(cache.recent);
  await withLoading(async () => {
    const data = await api.getRecentlyPlayed(50);
    cache.recent = data.items || [];
    renderRecentlyPlayed(cache.recent);
  }).catch(() => {});
}

function renderRecentlyPlayed(items) {
  document.getElementById('recent-count').textContent = items.length;

  const artistCounts = new Map();
  const hourCounts = new Array(24).fill(0);
  for (const item of items) {
    const artistName = item.track.artists[0]?.name || 'Unknown';
    artistCounts.set(artistName, (artistCounts.get(artistName) || 0) + 1);
    const hour = new Date(item.played_at).getHours();
    hourCounts[hour] += 1;
  }

  const topArtist = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  document.getElementById('recent-top-artist').textContent = topArtist
    ? `${topArtist[0]} (${topArtist[1]})`
    : '–';

  if (items.length > 0) {
    const oldest = new Date(items[items.length - 1].played_at);
    const newest = new Date(items[0].played_at);
    const hours = Math.max(1, Math.round((newest - oldest) / 3_600_000));
    document.getElementById('recent-span').textContent =
      hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  } else {
    document.getElementById('recent-span').textContent = '–';
  }

  const hourItems = hourCounts.map((count, hour) => ({ label: `${hour}:00`, value: count }));
  renderBarChart(document.getElementById('recent-hour-chart'), hourItems);

  const list = document.getElementById('recent-list');
  list.innerHTML = '';
  for (const item of items) {
    const art = item.track.album?.images?.[2]?.url || item.track.album?.images?.[0]?.url || '';
    const li = document.createElement('li');
    li.className = 'track-row';
    li.innerHTML = `
      ${art ? `<img class="track-art" src="${art}" alt="">` : '<div class="track-art placeholder"></div>'}
      <div class="track-meta">
        <span class="track-title">${escapeHtml(item.track.name)}</span>
        <span class="track-artist">${escapeHtml(item.track.artists.map((a) => a.name).join(', '))}</span>
      </div>
      <span class="track-time">${new Date(item.played_at).toLocaleString()}</span>
    `;
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
      ${art ? `<img class="track-art" src="${art}" alt="">` : '<div class="track-art placeholder"></div>'}
      <div class="track-meta">
        <span class="track-title">${escapeHtml(track.name)}</span>
        <span class="track-artist">${escapeHtml(track.artists.map((a) => a.name).join(', '))}</span>
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
      ${art ? `<img class="artist-art" src="${art}" alt="">` : '<div class="artist-art placeholder"></div>'}
      <div class="artist-meta">
        <span class="artist-name">${escapeHtml(artist.name)}</span>
        <span class="artist-genres">${escapeHtml(artist.genres.slice(0, 3).join(', '))}</span>
      </div>
      <span class="track-popularity" title="Popularity">${artist.popularity}</span>
    `;
    list.appendChild(li);
  });
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
  renderBarChart(chartEl, averages, { valueFormatter: (v) => v.toFixed(2) });

  const avgTempo = features.reduce((acc, f) => acc + (f.tempo || 0), 0) / features.length;
  const avgLoudness = features.reduce((acc, f) => acc + (f.loudness || 0), 0) / features.length;
  extraEl.innerHTML = `
    <div class="stat-card"><span class="stat-value">${avgTempo.toFixed(0)}</span><span class="stat-label">Avg tempo (BPM)</span></div>
    <div class="stat-card"><span class="stat-value">${avgLoudness.toFixed(1)} dB</span><span class="stat-label">Avg loudness</span></div>
  `;
}

async function loadGenres(force = false) {
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

function renderGenres(sorted) {
  const items = sorted.map(([genre, count]) => ({ label: genre, value: count }));
  renderBarChart(document.getElementById('genres-chart'), items);
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
  els.topTracksRange.addEventListener('change', () => loadTopTracks(els.topTracksRange.value));
  els.topArtistsRange.addEventListener('change', () => loadTopArtists(els.topArtistsRange.value));

  els.importButton.addEventListener('click', handleImport);
  els.trackingToggle.addEventListener('click', toggleTracking);
  els.clearLifetimeButton.addEventListener('click', clearLifetimeData);

  initTabs();
  initLifetimeTracking();
  loadUserProfile();
  loadTabData('lifetime');
}

async function main() {
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
