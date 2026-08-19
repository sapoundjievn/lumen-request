import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lumen Request",
  description: "Request a ride — KenNick Technologies LLC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#FAF7F2", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
