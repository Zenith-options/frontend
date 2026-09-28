import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { StoreHydrator } from "../components/StoreHydrator";
import { ModeScopedProviders } from "../components/AppProviders";
import { EnvironmentProvider } from "../lib/context/EnvironmentContext";
import { EnvironmentBanner } from "../components/env/EnvironmentBanner";
import { ModeSwitchDialogLoader as ModeSwitchDialog } from "../components/env/ModeSwitchDialogLoader";
import { OnboardingRoot } from "../features/onboarding/OnboardingRoot";

const fraunces = Fraunces({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-fraunces", display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-plex-sans", display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-jetbrains-mono", display: "swap",
});

export const metadata: Metadata = {
  title: "Zenith | On-chain Options on Stellar",
  description:
    "Buy and write European put and call options on XLM, BTC, ETH, and SOL. The first decentralized options protocol on Stellar Soroban.",
  keywords: ["options", "calls", "puts", "derivatives", "stellar", "soroban", "defi", "black-scholes"],
};

// viewport-fit=cover so env(safe-area-inset-*) resolves on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14130F",
};

// Runs before first paint: picks up the persisted environment mode so the
// env frame/banner are the right color immediately, not after hydration.
const ENV_BOOT_SCRIPT = `(function(){var m="paper";try{var r=localStorage.getItem("zenith:mode");var v=r&&JSON.parse(r).state.mode;if(v==="paper"||v==="testnet"||v==="mainnet")m=v;}catch(e){}document.documentElement.setAttribute("data-env",m);})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-env="paper"
      suppressHydrationWarning
      className={`${fraunces.variable} ${plexSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENV_BOOT_SCRIPT }} />
      </head>
      <body>
        <StoreHydrator />
        <EnvironmentProvider>
          <EnvironmentBanner />
          <ModeScopedProviders>
            {children}
            <OnboardingRoot />
          </ModeScopedProviders>
          <ModeSwitchDialog />
        </EnvironmentProvider>
      </body>
    </html>
  );
}
