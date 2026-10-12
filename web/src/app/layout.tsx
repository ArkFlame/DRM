import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'ArkFlame DRM — Command Center', template: '%s | ArkFlame DRM' }, description: 'Private ArkFlame licensing operations', robots: { index: false, follow: false } };
export default function Root({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" data-theme="dark"><body>{children}</body></html>; }
