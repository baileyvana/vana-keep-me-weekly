"use client";

// useVanaData() manages the full connect → poll → fetch-data lifecycle.
// initConnect() starts a session, the hook polls until approved, then
// fetchData() calls /api/data with the grant to retrieve user data.

import type { ConnectionStatus } from "@opendatalabs/connect/core";
import { useVanaData } from "@opendatalabs/connect/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────

interface SpotifyTrack {
  name: string;
  uri?: string;
  duration_ms?: number;
  artists?: { name: string }[];
  album?: { name: string; images?: { url: string }[] };
  added_at?: string;
}

interface SpotifyPlaylist {
  name: string;
  description?: string;
  uri?: string;
  images?: { url: string }[];
  tracks?: SpotifyTrack[];
}

interface ArchivedWeek {
  id: string;
  savedAt: string; // ISO date string — when we captured this snapshot
  weekLabel: string; // e.g. "Week of Feb 24, 2026"
  tracks: SpotifyTrack[];
}

// ── Helpers ────────────────────────────────────────────────

const STORAGE_KEY = "dw-archive";

function loadArchive(): ArchivedWeek[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArchivedWeek[]) : [];
  } catch {
    return [];
  }
}

function saveArchive(archive: ArchivedWeek[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
}

function weekLabel(date: Date): string {
  return `Week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function fingerprint(tracks: SpotifyTrack[]): string {
  return tracks.map((t) => t.name).sort().join("|");
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function spotifyLink(uri?: string): string | undefined {
  if (!uri) return undefined;
  // spotify:track:123 → https://open.spotify.com/track/123
  const parts = uri.split(":");
  if (parts.length === 3) return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
  return undefined;
}

// ── Status display ─────────────────────────────────────────

const STATUS_DISPLAY: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  idle: { label: "Idle", className: "status-default" },
  connecting: { label: "Connecting...", className: "status-default" },
  waiting: { label: "Waiting for approval", className: "status-waiting" },
  approved: { label: "Connected", className: "status-approved" },
  denied: { label: "Denied", className: "status-denied" },
  expired: { label: "Expired", className: "status-expired" },
  error: { label: "Error", className: "status-error" },
};

// ── Sub-components ─────────────────────────────────────────

function TrackRow({
  track,
  index,
}: {
  track: SpotifyTrack;
  index: number;
}) {
  const artistNames = track.artists?.map((a) => a.name).join(", ") ?? "Unknown";
  const albumArt = track.album?.images?.[0]?.url;
  const href = spotifyLink(track.uri);
  const duration = track.duration_ms ? formatDuration(track.duration_ms) : "";

  const inner = (
    <>
      <span className="track-number">{index + 1}</span>
      <span className="track-art">
        {albumArt && <img src={albumArt} alt="" loading="lazy" />}
      </span>
      <span className="track-info">
        <span className="track-name">{track.name}</span>
        <span className="track-artist">{artistNames}</span>
      </span>
      {duration && <span className="track-duration">{duration}</span>}
    </>
  );

  return (
    <li className="track-item">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="track-link" style={{ display: "contents" }}>
          {inner}
        </a>
      ) : (
        inner
      )}
    </li>
  );
}

function CurrentWeek({ tracks, date }: { tracks: SpotifyTrack[]; date: string }) {
  return (
    <div className="current-week">
      <div className="current-week-header">
        <span className="current-week-badge">Current Week</span>
      </div>
      <h2>Discover Weekly</h2>
      <p className="current-week-date">{date}</p>
      <ul className="track-list">
        {tracks.map((track, i) => (
          <TrackRow key={`${track.name}-${i}`} track={track} index={i} />
        ))}
      </ul>
    </div>
  );
}

function ArchiveCard({
  week,
  onClick,
}: {
  week: ArchivedWeek;
  onClick: () => void;
}) {
  const preview = week.tracks.slice(0, 4);
  const remaining = week.tracks.length - preview.length;

  return (
    <div className="archive-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <div className="archive-card-date">{week.weekLabel}</div>
      <div className="archive-card-count">{week.tracks.length} tracks</div>
      <ul className="archive-card-tracks">
        {preview.map((t, i) => (
          <li key={i}>
            {t.name} — {t.artists?.map((a) => a.name).join(", ") ?? "Unknown"}
          </li>
        ))}
        {remaining > 0 && <li className="more">+{remaining} more</li>}
      </ul>
    </div>
  );
}

function ArchiveDetail({
  week,
  onClose,
}: {
  week: ArchivedWeek;
  onClose: () => void;
}) {
  return (
    <div className="archive-detail-overlay" onClick={onClose}>
      <div className="archive-detail" onClick={(e) => e.stopPropagation()}>
        <button className="archive-detail-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <h3>Discover Weekly</h3>
        <p className="archive-detail-date">{week.weekLabel}</p>
        <ul className="track-list">
          {week.tracks.map((track, i) => (
            <TrackRow key={`${track.name}-${i}`} track={track} index={i} />
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export default function ConnectFlow() {
  const {
    status,
    data,
    error,
    connectUrl,
    initConnect,
    fetchData,
    isLoading,
  } = useVanaData();

  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      void initConnect();
    }
  }, [initConnect]);

  // Archive state
  const [archive, setArchive] = useState<ArchivedWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<ArchivedWeek | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Load archive from localStorage on mount
  useEffect(() => {
    setArchive(loadArchive());
  }, []);

  // Extract Discover Weekly from fetched data
  const discoverWeekly = useMemo<SpotifyPlaylist | null>(() => {
    if (!data) return null;
    try {
      // data shape: { data: { "spotify.playlists": { data: { playlists: [...] } } } }
      const envelope = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
      if (!envelope) return null;
      const scopeData = envelope["spotify.playlists"] as Record<string, unknown> | undefined;
      if (!scopeData) return null;
      const inner = scopeData.data as Record<string, unknown> | undefined;
      if (!inner) return null;
      const playlists = inner.playlists as SpotifyPlaylist[] | undefined;
      if (!playlists) return null;
      return playlists.find(
        (p) => p.name?.toLowerCase().includes("discover weekly"),
      ) ?? null;
    } catch {
      return null;
    }
  }, [data]);

  // Auto-archive when we get new Discover Weekly data
  useEffect(() => {
    if (!discoverWeekly?.tracks?.length) return;
    const tracks = discoverWeekly.tracks;
    const fp = fingerprint(tracks);
    const existing = loadArchive();
    const alreadySaved = existing.some((w) => fingerprint(w.tracks) === fp);
    if (!alreadySaved) {
      const now = new Date();
      const newWeek: ArchivedWeek = {
        id: `dw-${now.getTime()}`,
        savedAt: now.toISOString(),
        weekLabel: weekLabel(now),
        tracks,
      };
      const updated = [newWeek, ...existing];
      saveArchive(updated);
      setArchive(updated);
    }
  }, [discoverWeekly]);

  // Auto-fetch data when approved
  const autoFetchRef = useRef(false);
  useEffect(() => {
    if (status === "approved" && !autoFetchRef.current && !data) {
      autoFetchRef.current = true;
      void fetchData();
    }
  }, [status, data, fetchData]);

  // Filtered archive for search
  const filteredArchive = useMemo(() => {
    if (!searchQuery.trim()) return archive;
    const q = searchQuery.toLowerCase();
    return archive.filter((week) => {
      if (week.weekLabel.toLowerCase().includes(q)) return true;
      return week.tracks.some(
        (t) =>
          t.name?.toLowerCase().includes(q) ||
          t.artists?.some((a) => a.name?.toLowerCase().includes(q)),
      );
    });
  }, [archive, searchQuery]);

  const handleReset = useCallback(() => window.location.reload(), []);

  const display = STATUS_DISPLAY[status];
  const sessionReady = !!connectUrl;
  const hasConnectFailure = !sessionReady && !!error;

  // ── Pre-connect / connect screen ──────────────────────────

  if (status !== "approved") {
    return (
      <div>
        <div className="card connect-card">
          <div className="connect-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#000" strokeWidth="1.5" />
              <path d="M8 6.82v10.36a.75.75 0 001.14.64l8.57-5.18a.75.75 0 000-1.28L9.14 6.18A.75.75 0 008 6.82z" fill="#000" />
            </svg>
          </div>
          <h2>Discover Weekly Archive</h2>
          <p>
            Connect your Spotify data to save and browse your Discover Weekly
            playlists. Never lose a recommendation again.
          </p>

          <div className="status-pill">
            <span className={display.className}>{display.label}</span>
          </div>

          <div>
            {sessionReady ? (
              <a
                href={connectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                style={{
                  display: "inline-block",
                  textDecoration: "none",
                  textAlign: "center",
                  minWidth: 200,
                }}
              >
                Connect with Vana
              </a>
            ) : (
              <button
                type="button"
                onClick={() => void initConnect()}
                disabled={isLoading}
                className="btn-primary"
                style={{ minWidth: 200 }}
              >
                {isLoading ? (
                  <>
                    <span className="spinner" /> Connecting...
                  </>
                ) : hasConnectFailure ? (
                  "Retry"
                ) : (
                  "Get Started"
                )}
              </button>
            )}
          </div>
        </div>

        {/* Show existing archive even before connecting */}
        {archive.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <ArchiveSection
              archive={archive}
              filteredArchive={filteredArchive}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={setSelectedWeek}
            />
          </div>
        )}

        {selectedWeek && (
          <ArchiveDetail week={selectedWeek} onClose={() => setSelectedWeek(null)} />
        )}

        {error && (
          <div className="card card-error" style={{ maxWidth: 440, margin: "16px auto 0" }}>
            <p className="text-error" style={{ margin: 0 }}>{error}</p>
          </div>
        )}

        {status !== "idle" && status !== "connecting" && (
          <div className="footer-actions">
            <button type="button" onClick={handleReset} className="btn-ghost">
              Reset
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Post-connect: data view ───────────────────────────────

  const currentTracks = discoverWeekly?.tracks ?? [];
  const hasData = data != null;
  const showLoading = isLoading && !hasData;

  return (
    <div>
      {showLoading && (
        <div className="empty-state">
          <span className="spinner" style={{ marginRight: 8 }} />
          Fetching your playlists...
        </div>
      )}

      {hasData && !discoverWeekly && (
        <div className="empty-state">
          No Discover Weekly playlist found in your data. Make sure Spotify has
          generated one for you this week.
        </div>
      )}

      {currentTracks.length > 0 && (
        <CurrentWeek
          tracks={currentTracks}
          date={weekLabel(new Date())}
        />
      )}

      {archive.length > 0 && (
        <ArchiveSection
          archive={archive}
          filteredArchive={filteredArchive}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={setSelectedWeek}
        />
      )}

      {selectedWeek && (
        <ArchiveDetail week={selectedWeek} onClose={() => setSelectedWeek(null)} />
      )}

      {error && (
        <div className="card card-error">
          <p className="text-error" style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="footer-actions">
        <button type="button" onClick={() => void fetchData()} disabled={isLoading} className="btn-ghost">
          {isLoading ? "Refreshing..." : "Refresh Data"}
        </button>
        <button type="button" onClick={handleReset} className="btn-ghost">
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Archive section sub-component ──────────────────────────

function ArchiveSection({
  archive,
  filteredArchive,
  searchQuery,
  onSearchChange,
  onSelect,
}: {
  archive: ArchivedWeek[];
  filteredArchive: ArchivedWeek[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (w: ArchivedWeek) => void;
}) {
  return (
    <div className="archive-section">
      <div className="archive-header">
        <h3>Past Discover Weeklies ({archive.length})</h3>
        <input
          type="text"
          className="search-input"
          placeholder="Search by track, artist, or date..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {filteredArchive.length > 0 ? (
        <div className="archive-grid">
          {filteredArchive.map((week) => (
            <ArchiveCard key={week.id} week={week} onClick={() => onSelect(week)} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          {searchQuery ? "No playlists match your search." : "No archived playlists yet."}
        </div>
      )}
    </div>
  );
}
