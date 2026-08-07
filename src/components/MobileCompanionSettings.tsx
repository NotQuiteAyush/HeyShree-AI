import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Globe2, Link2, LoaderCircle, QrCode, ShieldCheck, Smartphone, Trash2, Wifi, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { ShreeSettings } from "../settingsTypes";

interface Pairing {
  id: string;
  device_id: string;
  requested_name?: string;
  status: "created" | "pending" | "approved" | "denied" | "expired";
  expires_at: string;
}
interface Device {
  id: string;
  name: string;
  platform: string;
  paired_at: string;
  last_seen_at?: string;
  revoked: number;
  connected: boolean;
}

export function MobileCompanionSettings({
  notify,
  values,
  persist,
}: {
  notify(message: string): void;
  values: ShreeSettings;
  persist<K extends keyof ShreeSettings>(key: K, value: ShreeSettings[K]): Promise<void>;
}) {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [firewall, setFirewall] = useState<{ supported: boolean; allowed: boolean; port: number } | null>(null);

  const refresh = async () => {
    const [nextPairings, nextDevices] = await Promise.all([
      apiFetch<Pairing[]>("/api/mobile/pairings"),
      apiFetch<Device[]>("/api/mobile/devices"),
    ]);
    setPairings(nextPairings);
    setDevices(nextDevices);
  };

  useEffect(() => {
    void refresh();
    void window.shreeDesktop?.getMobileFirewallStatus().then(setFirewall);
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const allowPhoneAccess = async () => {
    setBusy(true);
    try {
      if (!window.shreeDesktop) throw new Error("Phone access can only be configured in the SHREE desktop app.");
      const status = await window.shreeDesktop.allowMobileFirewall();
      setFirewall(status);
      notify(status.allowed ? "Windows now allows SHREE Companion on your local Wi-Fi." : "Windows did not enable local phone access.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not configure Windows Firewall");
    } finally { setBusy(false); }
  };

  const begin = async () => {
    setBusy(true);
    try {
      const result = await apiFetch<{ qr_payload: string }>("/api/mobile/pairing/start", { method: "POST" });
      setQr(await QRCode.toDataURL(result.qr_payload, { width: 440, margin: 3, errorCorrectionLevel: "L", color: { dark: "#090a20", light: "#ffffff" } }));
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not begin pairing"); }
    finally { setBusy(false); }
  };

  const decide = async (pairingId: string, approved: boolean) => {
    await apiFetch(`/api/mobile/pairings/${encodeURIComponent(pairingId)}/decision`, { method: "POST", body: JSON.stringify({ approved }) });
    if (approved) { setQr(""); notify("Android phone paired securely."); }
    await refresh();
  };

  const revoke = async (deviceId: string) => {
    await apiFetch(`/api/mobile/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    notify("Phone access revoked."); await refresh();
  };

  const pending = pairings.find((item) => item.status === "pending");
  const activeDevices = devices.filter((device) => !device.revoked);
  return <div className="space-y-4">
    <section className="settings-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Globe2 size={15}/><span>Connect from anywhere</span></div>
      <div className="settings-row">
        <div><div className="text-sm text-white">Worldwide remote link</div><div className="text-[10px] text-slate-500">Uses an outbound end-to-end encrypted relay; no shared Wi-Fi or router changes.</div></div>
        <button
          role="switch"
          aria-checked={values.mobile_remote_access_enabled}
          onClick={() => void persist("mobile_remote_access_enabled", !values.mobile_remote_access_enabled)}
          className={`h-6 w-11 rounded-full p-0.5 transition ${values.mobile_remote_access_enabled ? "bg-cyan-500" : "bg-slate-700"}`}
        ><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${values.mobile_remote_access_enabled ? "translate-x-5" : ""}`}/></button>
      </div>
      {values.mobile_remote_access_enabled && <label className="mt-3 block text-[10px] text-slate-400">
        SHREE relay HTTPS URL
        <input
          value={values.mobile_relay_url}
          onChange={(event) => void persist("mobile_relay_url", event.target.value.trim())}
          placeholder="https://shree-e2e-relay.your-domain.workers.dev"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/40"
        />
      </label>}
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">The PC must remain on with SHREE running. Relay traffic is opaque AES-GCM ciphertext and dangerous actions still require their normal confirmations.</p>
    </section>
    <section className="settings-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><QrCode size={15}/><span>Pair Android phone</span></div>
      <p className="mb-4 text-[11px] leading-relaxed text-slate-500">{values.mobile_remote_access_enabled ? "The phone may use any internet connection worldwide." : "Connect the PC to the phone's hotspot or put both devices on the same Wi-Fi."} The QR secret expires after five minutes, and the phone cannot connect until you approve it here.</p>
      {!values.mobile_remote_access_enabled && firewall?.supported && !firewall.allowed && <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-200"><Wifi size={14}/><span>Windows is blocking phone connections</span></div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Allow only the SHREE backend to receive connections from devices on your local Wi-Fi. Windows will ask for administrator approval.</p>
        <button className="settings-button tone-cyan mt-3" disabled={busy} onClick={allowPhoneAccess}><ShieldCheck size={14}/> Allow phone connection</button>
      </div>}
      {!values.mobile_remote_access_enabled && firewall?.allowed && <div className="mb-4 flex items-center gap-2 text-[10px] text-emerald-300"><ShieldCheck size={13}/> Local phone access is enabled on port {firewall.port}.</div>}
      {!qr && <button className="settings-button tone-cyan" disabled={busy} onClick={begin}>
        {busy ? <LoaderCircle className="animate-spin" size={14}/> : <QrCode size={14}/>} Create pairing QR
      </button>}
      {qr && <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-cyan-500/15 bg-black/20 p-5">
        <img src={qr} alt="SHREE Companion pairing QR code" className="h-80 w-80 max-w-full rounded-xl bg-white p-2 [image-rendering:pixelated]"/>
        <span className="text-[10px] text-slate-400">Open SHREE Companion on Android and scan this code.</span>
      </div>}
    </section>
    {pending && <section className="settings-card border-amber-400/30">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Smartphone size={15}/><span>Phone requests approval</span></div>
      <p className="mb-4 text-[11px] leading-relaxed text-slate-500">Confirm that the phone in your hand is <strong className="text-white">{pending.requested_name}</strong>. Approval replaces any previously paired phone.</p>
      <div className="flex gap-2">
        <button className="settings-button tone-cyan" onClick={() => decide(pending.id, true)}><Check size={14}/> Approve</button>
        <button className="settings-button tone-rose" onClick={() => decide(pending.id, false)}><X size={14}/> Deny</button>
      </div>
    </section>}
    <section className="settings-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Link2 size={15}/><span>Paired phone</span></div>
      {activeDevices.length === 0 ? <p className="text-[11px] text-slate-500">No Android phone is paired.</p> : activeDevices.map((device) => <div key={device.id} className="settings-row">
        <div><div className="text-sm text-white">{device.name}</div><div className="text-[10px] text-slate-500">{device.connected ? "Connected securely" : "Offline"} · paired {new Date(device.paired_at).toLocaleString()}</div></div>
        <button aria-label="Revoke phone" className="settings-button tone-rose" onClick={() => revoke(device.id)}><Trash2 size={14}/></button>
      </div>)}
    </section>
    <section className="settings-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Smartphone size={15}/><span>Phone capabilities</span></div>
      <p className="text-[11px] leading-relaxed text-slate-500">Voice conversation, PC control, phone media and volume, apps and links, clipboard, notifications, calls and messages. Calls, messages, typing sensitive content, deletion, installs, and account changes always require approval on the phone.</p>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Optional Accessibility access enables visible taps and typing when Android has no official API. It never bypasses Android permissions or lock-screen security.</p>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Local mode uses Wi-Fi or hotspot. Worldwide mode uses SHREE's authenticated encrypted relay and never exposes the local Windows-control port directly to the internet.</p>
    </section>
  </div>;
}
