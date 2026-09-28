"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalletStore, SUPPORTED_WALLETS } from "../lib/store/wallet";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { ensureKitInitialised } from "../lib/store/wallet";
import type { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";

// Availability state per wallet id, populated asynchronously
type AvailMap = Record<string, boolean | "checking">;

export function WalletSelectModal() {
  const { showSelectModal, closeSelectModal, connectWallet, status } = useWalletStore();
  const [avail, setAvail] = useState<AvailMap>({});
  const [supported, setSupported] = useState<ISupportedWallet[]>([]);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    ensureKitInitialised();
    try {
      const wallets = await StellarWalletsKit.refreshSupportedWallets();
      setSupported(wallets);
      const map: AvailMap = {};
      for (const w of wallets) {
        map[w.id] = w.isAvailable;
      }
      setAvail(map);
    } catch {
      // If the SDK call fails, show all wallets as "install links"
    }
  }, []);

  useEffect(() => {
    if (showSelectModal) refresh();
  }, [showSelectModal, refresh]);

  useEffect(() => {
    if (!showSelectModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSelectModal(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSelectModal, closeSelectModal]);

  if (!showSelectModal) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select wallet"
      onClick={closeSelectModal}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360, background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)", padding: 0,
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px 14px", borderBottom: "1px solid var(--border-default)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)" }}>Connect Wallet</div>
            <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>
              Select a wallet to connect to Zenith
            </div>
          </div>
          <button
            onClick={closeSelectModal}
            aria-label="Close wallet selector"
            style={{
              background: "none", border: "none", color: "var(--text-lo)",
              fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>

        {/* Wallet list */}
        <div style={{ padding: "8px 0" }}>
          {SUPPORTED_WALLETS.map((wallet) => {
            const isAvailable = avail[wallet.id];
            const isConnecting = status === "connecting";
            const fromSdk = supported.find((s) => s.id === wallet.id);

            return (
              <WalletRow
                key={wallet.id}
                id={wallet.id}
                name={wallet.name}
                icon={fromSdk?.icon ?? wallet.icon}
                url={wallet.url}
                isAvailable={isAvailable === true}
                canSignMessages={wallet.canSignMessages}
                isConnecting={isConnecting}
                onConnect={() => connectWallet(wallet.id)}
              />
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px 14px", borderTop: "1px solid var(--border-default)",
          fontSize: 10, color: "var(--text-lo)", lineHeight: 1.5,
        }}>
          Installed wallets connect immediately. Unavailable wallets open the install page.
          Wallets without message signing support may require Freighter for backend sign-in.
        </div>
      </div>
    </div>
  );
}

interface WalletRowProps {
  id: string;
  name: string;
  icon: string;
  url: string;
  isAvailable: boolean;
  canSignMessages: boolean;
  isConnecting: boolean;
  onConnect: () => void;
}

function WalletRow({
  name, icon, url, isAvailable, canSignMessages, isConnecting, onConnect,
}: WalletRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 20px",
        background: hovered ? "var(--bg-overlay)" : "transparent",
        transition: "background 80ms",
        cursor: isConnecting ? "default" : "pointer",
      }}
      onClick={isConnecting ? undefined : isAvailable ? onConnect : undefined}
      role="button"
      aria-label={`${isAvailable ? "Connect" : "Install"} ${name}`}
    >
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 6, overflow: "hidden",
        background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={icon}
          alt={`${name} icon`}
          width={24}
          height={24}
          style={{ objectFit: "contain" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>{name}</span>
          {!canSignMessages && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: "1px 5px",
              background: "var(--bg-overlay)", color: "var(--text-lo)",
              border: "1px solid var(--border-subtle)", textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>
              TX signing only
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 1 }}>
          {isAvailable ? "Installed" : "Not installed"}
        </div>
      </div>

      {/* Action */}
      {isAvailable ? (
        <button
          onClick={(e) => { e.stopPropagation(); onConnect(); }}
          disabled={isConnecting}
          aria-label={`Connect ${name}`}
          style={{
            padding: "5px 12px", background: "var(--brand)", border: "none",
            color: "var(--bg)", fontSize: 11, fontWeight: 700, cursor: isConnecting ? "default" : "pointer",
            opacity: isConnecting ? 0.5 : 1, flexShrink: 0,
          }}
        >
          Connect
        </button>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Install ${name}`}
          style={{
            padding: "5px 12px", background: "transparent",
            border: "1px solid var(--border-strong)", color: "var(--text-mid)",
            fontSize: 11, fontWeight: 600, textDecoration: "none", flexShrink: 0,
            display: "inline-block",
          }}
        >
          Install
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Updated WalletConnect button (replaces the old one)
// ---------------------------------------------------------------------------

const truncate = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function WalletConnect() {
  const { status, address, openSelectModal, disconnect, checkConnection } = useWalletStore();

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  if (status === "connected" && address) {
    return (
      <button
        onClick={disconnect}
        title="Click to disconnect"
        aria-label={`Disconnect wallet ${address}`}
        style={{
          padding: "5px 12px", background: "var(--bg-elevated)", color: "var(--text-hi)",
          border: "1px solid var(--border-default)", borderRadius: 0, fontSize: 12,
          fontFamily: "var(--font-mono)", cursor: "pointer", display: "flex",
          alignItems: "center", gap: 6,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--call)" }} />
        {truncate(address)}
      </button>
    );
  }

  if (status === "connecting") {
    return (
      <button
        disabled
        style={{
          padding: "5px 12px", background: "var(--brand)", color: "var(--bg)",
          border: "none", borderRadius: 0, fontSize: 12, fontWeight: 700,
          cursor: "default", opacity: 0.6,
        }}
      >
        Connecting…
      </button>
    );
  }

  if (status === "error") {
    return (
      <button
        onClick={openSelectModal}
        style={{
          padding: "5px 12px", background: "var(--put)", color: "var(--bg)",
          border: "none", borderRadius: 0, fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}
      >
        Retry
      </button>
    );
  }

  return (
    <button
      onClick={openSelectModal}
      aria-label="Connect wallet"
      style={{
        padding: "5px 12px", background: "var(--brand)", color: "var(--bg)",
        border: "none", borderRadius: 0, fontSize: 12, fontWeight: 700, cursor: "pointer",
      }}
    >
      Connect
    </button>
  );
}
