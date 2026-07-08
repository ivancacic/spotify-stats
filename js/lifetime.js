import * as store from './store.js?v=8';
import * as api from './api.js?v=8';

function toIso(dateStr) {
  if (dateStr.includes('T')) return dateStr;
  return `${dateStr.replace(' ', 'T')}:00Z`;
}

// Handles both the modern "Extended Streaming History" export format
// (ts / ms_played / master_metadata_*) and the older StreamingHistory*.json
// format (endTime / trackName / artistName / msPlayed).
function normalizeImportRecord(raw) {
  if ('master_metadata_track_name' in raw || 'ms_played' in raw) {
    if (!raw.master_metadata_track_name) return null; // podcast episode or empty
    return {
      ts: raw.ts,
      msPlayed: raw.ms_played || 0,
      trackName: raw.master_metadata_track_name,
      artistName: raw.master_metadata_album_artist_name || 'Unknown artist',
      albumName: raw.master_metadata_album_album_name || '',
      trackUri: raw.spotify_track_uri || '',
      source: 'import',
    };
  }

  if ('trackName' in raw && 'endTime' in raw) {
    return {
      ts: toIso(raw.endTime),
      msPlayed: raw.msPlayed || 0,
      trackName: raw.trackName,
      artistName: raw.artistName || 'Unknown artist',
      albumName: '',
      trackUri: '',
      source: 'import',
    };
  }

  return null;
}

function normalizeLiveItem(item) {
  return {
    ts: item.played_at,
    msPlayed: item.track?.duration_ms || 0,
    trackName: item.track?.name || 'Unknown track',
    artistName: item.track?.artists?.[0]?.name || 'Unknown artist',
    albumName: item.track?.album?.name || '',
    trackUri: item.track?.uri || '',
    artUrl: item.track?.album?.images?.[2]?.url || item.track?.album?.images?.[0]?.url || '',
    source: 'live',
  };
}

function dedupeKey(play) {
  return play.trackUri ? `${play.trackUri}|${play.ts}` : `${play.trackName}|${play.artistName}|${play.ts}`;
}

export async function parseFiles(fileList) {
  const plays = [];
  let fileCount = 0;
  let skippedFiles = 0;

  for (const file of fileList) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      skippedFiles++;
      continue;
    }
    if (!Array.isArray(data)) {
      skippedFiles++;
      continue;
    }
    fileCount++;
    for (const raw of data) {
      const normalized = normalizeImportRecord(raw);
      if (normalized) plays.push(normalized);
    }
  }

  return { plays, fileCount, skippedFiles };
}

export async function mergeAndStore(newPlays) {
  const existing = await store.getPlays();
  const seen = new Set(existing.map(dedupeKey));
  let added = 0;

  for (const play of newPlays) {
    const key = dedupeKey(play);
    if (!seen.has(key)) {
      seen.add(key);
      existing.push(play);
      added++;
    }
  }

  existing.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  await store.setPlays(existing);
  return { added, total: existing.length };
}

export async function fetchAndMergeLive() {
  const data = await api.getRecentlyPlayed(50);
  const plays = (data.items || []).map(normalizeLiveItem);
  const result = await mergeAndStore(plays);
  await store.setMeta({ ...(await store.getMeta()), lastSyncedAt: new Date().toISOString() });
  return result;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

export function filterPlays(plays, fromTs, toTs) {
  if (fromTs == null && toTs == null) return plays;
  return plays.filter((play) => {
    const time = new Date(play.ts).getTime();
    if (Number.isNaN(time)) return false;
    if (fromTs != null && time < fromTs) return false;
    if (toTs != null && time > toTs) return false;
    return true;
  });
}

// All artists in the stored history, sorted by listening time.
export function artistTotals(plays) {
  const totals = new Map();
  for (const play of plays) {
    totals.set(play.artistName, (totals.get(play.artistName) || 0) + (play.msPlayed || 0));
  }
  return [...totals.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms);
}

export function distinctYears(plays) {
  const years = new Set();
  for (const play of plays) {
    const year = new Date(play.ts).getFullYear();
    if (!Number.isNaN(year)) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

// Contiguous time buckets from the earliest to the latest play (gaps = 0),
// so the timeline chart has an honest, evenly spaced x-axis. Granularity
// adapts to the span: days up to ~3 months, weeks up to ~2 years, months
// beyond that.
function timelineSeries(times, minTime, maxTime) {
  const spanDays = (maxTime - minTime) / DAY_MS;
  const unit = spanDays <= 92 ? 'day' : spanDays <= 750 ? 'week' : 'month';

  const bucketStart = (time) => {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    if (unit === 'week') d.setDate(d.getDate() - d.getDay());
    if (unit === 'month') d.setDate(1);
    return d.getTime();
  };
  const nextBucket = (time) => {
    const d = new Date(time);
    if (unit === 'day') d.setDate(d.getDate() + 1);
    if (unit === 'week') d.setDate(d.getDate() + 7);
    if (unit === 'month') d.setMonth(d.getMonth() + 1);
    return d.getTime();
  };
  const labelFor = (time) => {
    const d = new Date(time);
    if (unit === 'month') return `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
  };

  const counts = new Map();
  for (const time of times) {
    const key = bucketStart(time);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const points = [];
  const last = bucketStart(maxTime);
  for (let t = bucketStart(minTime); t <= last && points.length < 1500; t = nextBucket(t)) {
    points.push({ label: labelFor(t), value: counts.get(t) || 0 });
  }
  return { points, unit };
}

export function computeStats(plays) {
  if (!plays.length) return null;

  const byYear = new Map();
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const artistMs = new Map();
  const trackCounts = new Map();
  const distinctArtists = new Set();
  const distinctTracks = new Set();
  const validTimes = [];
  let totalMs = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const play of plays) {
    const time = new Date(play.ts).getTime();
    if (Number.isNaN(time)) continue;
    validTimes.push(time);
    minTime = Math.min(minTime, time);
    maxTime = Math.max(maxTime, time);

    const date = new Date(time);
    totalMs += play.msPlayed || 0;
    byYear.set(date.getFullYear(), (byYear.get(date.getFullYear()) || 0) + 1);
    byHour[date.getHours()] += 1;
    byDow[date.getDay()] += 1;

    distinctArtists.add(play.artistName);
    const trackKey = play.trackUri || `${play.trackName}|${play.artistName}`;
    distinctTracks.add(trackKey);

    artistMs.set(play.artistName, (artistMs.get(play.artistName) || 0) + (play.msPlayed || 0));

    const existingTrack = trackCounts.get(trackKey);
    trackCounts.set(trackKey, {
      label: `${play.trackName} — ${play.artistName}`,
      count: (existingTrack?.count || 0) + 1,
    });
  }

  if (validTimes.length === 0) return null;

  const { points: timeline, unit: timelineUnit } = timelineSeries(validTimes, minTime, maxTime);

  return {
    totalPlays: plays.length,
    totalMs,
    distinctArtistCount: distinctArtists.size,
    distinctTrackCount: distinctTracks.size,
    earliest: new Date(minTime),
    latest: new Date(maxTime),
    byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]),
    timeline,
    timelineUnit,
    byHour: byHour.map((count, hour) => ({ label: `${hour}:00`, value: count })),
    byDow: byDow.map((count, dow) => ({ label: DAY_LABELS[dow], value: count })),
    topArtists: [...artistMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([label, ms]) => ({ label, value: Math.round(ms / 60000) })),
    topTracks: [...trackCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map(({ label, count }) => ({ label, value: count })),
  };
}
