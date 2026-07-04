import * as auth from './auth.js';
import * as api from './api.js';
import { renderBarChart } from './charts.js';

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
};

const cache = {
  recent: null,
  topTracks: {},
  topArtists: {},
  audioFeatures: null,
  genres: null,
};

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
  if (tabName === 'recent') return loadRecentlyPlayed();
  if (tabName === 'top-tracks') return loadTopTracks(els.topTracksRange.value);
  if (tabName === 'top-artists') return loadTopArtists(els.topArtistsRange.value);
  if (tabName === 'audio-features') return loadAudioFeatures();
  if (tabName === 'genres') return loadGenres();
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

  initTabs();
  loadUserProfile();
  loadTabData('recent');
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
