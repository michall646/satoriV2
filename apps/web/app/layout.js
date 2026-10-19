import './globals.css';

import { Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';

import CmdK from '../components/CmdK';
import StatusBanner from '../components/StatusBanner';
import Toast from '../components/ui/Toast';
import { ProfileLink, SearchBar } from '../components/NavControls';
import { NavLinks, MobileMenu, TopHint } from '../components/NavLinks';
import ContestTimer from '../components/ContestTimer';
import { InstallPrompt, OfflineIndicator, ServiceWorkerRegister } from '../components/PwaControls';
import { LangToggle, ThemeToggle } from '../components/ShellControls';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-jetbrains', display: 'swap' });

export const metadata = {
  title: { template: '%s | Satori V2', default: 'Satori V2' },
  description: 'API-first judge + contests',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' }],
    shortcut: '/icon-192.svg',
  },
  appleWebApp: { capable: true, title: 'Satori V2' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

const themeInit = `(function(){try{var s=localStorage.getItem('satori-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="pl" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <header className="sticky top-0 z-20 topbar" style={{ background: 'transparent', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', borderBottom: 'none', color: 'var(--fg)' }}>
          <div className="topbar-wide topbar-inner">
            <Link href="/" prefetch className="brand focus-ring" aria-label="Satori home">
              <span className="brand-word">Satori <span>V2</span></span>
            </Link>
            <nav className="hidden md:flex gap-0.5 items-center text-sm" aria-label="primary">
              <NavLinks />
            </nav>
            <ContestTimer />
            <MobileMenu />
            <TopHint />
            <span className="ml-auto flex gap-2 items-center">
              <SearchBar />
              <span aria-hidden="true" className="top-divider hidden sm:block" />
              <ProfileLink />
              <OfflineIndicator />
              <LangToggle />
              <ThemeToggle />
            </span>
          </div>
        </header>
        <div className="shell pt-2"><StatusBanner /></div>
        <main className="shell pt-6 pb-12">{children}</main>
        <InstallPrompt />
        <ServiceWorkerRegister />
        <Toast />
        <CmdK />
      </body>
    </html>
  );
}
