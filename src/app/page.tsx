import ConnectFlow from "@/components/ConnectFlow";

export default function Home() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Discover Weekly Archive</h1>
        <p>
          Save and browse your Spotify Discover Weekly playlists — never lose a
          recommendation again.
        </p>
      </header>
      <ConnectFlow />
    </main>
  );
}
