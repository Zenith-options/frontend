"use client";

import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useHistoryStore } from "../../lib/store/history";

export default function HistoryPage() {
  const records = useHistoryStore(s => s.records);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>
      <AppHeader>
        <div style={{marginLeft:"auto"}}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{maxWidth:1080,margin:"0 auto",padding:"32px 24px 64px"}}>
          <h1 style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,marginBottom:4}}>Trade History</h1>
          <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>
            {records.length} record{records.length===1?"":"s"}
          </p>

          {records.length===0 && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"80px 0",border:"1px solid var(--border-subtle)",background:"var(--bg-raised)",gap:12}}>
              <div style={{fontSize:14,color:"var(--text-mid)"}}>No trades yet</div>
              <Link href="/options" style={{fontSize:13,color:"var(--brand)",textDecoration:"none"}}>
                Open the options chain →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
