import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Agora Video Call Recorder",
  description: "Video calls with Agora RTC and Cloud Recording",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
