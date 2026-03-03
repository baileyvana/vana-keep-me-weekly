import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discover Weekly Archive",
  description:
    "Save and browse your Spotify Discover Weekly playlists — never lose a recommendation again",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
