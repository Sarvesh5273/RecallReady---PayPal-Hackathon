import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "RecallReady · Merchant workbench",
  description:
    "Evidence-backed recall triage and independently approved courtesy refunds.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
