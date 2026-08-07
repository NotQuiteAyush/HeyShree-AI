import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  KeyRound,
  LoaderCircle,
  Mic2,
  MonitorCog,
  Plus,
  PlugZap,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Smartphone,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import {
  applyAppearance,
  defaultSettings,
  type Decision,
  type Importance,
  type SetupStatus,
  type ShreeSettings,
} from "../settingsTypes";
import type { Memory } from "../types";
import type { UpdateState, UpdateChannel } from "../updateTypes";
import shreeMark from "../assets/branding/shree-mark.png";
import { MobileCompanionSettings } from "./MobileCompanionSettings";

interface Props {
  onClose(): void;
  forceSetup?: boolean;
  onReady?(settings: ShreeSettings): void;
}
interface Plugin {
  id: string;
  name: string;
  version?: string;
  status: string;
  permissions?: string[];
  enabled?: boolean;
  error?: string;
}
interface McpServer {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  connected: boolean;
}
interface Diagnostics {
  [key: string]: unknown;
}
interface AuditEntry {
  id: number;
  action: string;
  risk: string;
  approved: number;
  details: string;
  created_at: string;
}
type Category =
  | "general"
  | "updates"
  | "floating"
  | "mobile"
  | "api"
  | "wake"
  | "ai"
  | "memory"
  | "desktop"
  | "notifications"
  | "privacy"
  | "plugins"
  | "performance"
  | "developer";

const categories: Array<{
  id: Category;
  label: string;
  icon: typeof Settings;
  keywords: string;
}> = [
  {
    id: "general",
    label: "General",
    icon: Settings,
    keywords: "startup tray theme language updates window animation",
  },
  {
    id: "updates",
    label: "Updates",
    icon: Download,
    keywords: "update version release channel automatic download install restart history",
  },
  {
    id: "floating",
    label: "Floating Companion",
    icon: Sparkles,
    keywords: "avatar companion always top fullscreen opacity subtitles lip sync awareness snap shortcut",
  },
  {
    id: "mobile",
    label: "Android Companion",
    icon: Smartphone,
    keywords: "phone android mobile pairing qr wifi remote voice control",
  },
  {
    id: "api",
    label: "API Keys",
    icon: KeyRound,
    keywords: "gemini credential key validate provider",
  },
  {
    id: "wake",
    label: "Wake Word",
    icon: Mic2,
    keywords: "hello hi hey namaste background listening phrase",
  },
  {
    id: "ai",
    label: "AI & Tools",
    icon: Sparkles,
    keywords: "reasoning tools code screen desktop",
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    keywords: "remember stored edit import export importance preference",
  },
  {
    id: "desktop",
    label: "Desktop Control",
    icon: MonitorCog,
    keywords:
      "keyboard mouse files ocr clipboard screenshot permission emergency",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    keywords: "sound reminder update error quiet hours",
  },
  {
    id: "privacy",
    label: "Privacy & Security",
    icon: ShieldCheck,
    keywords: "local encryption clear history logs cache permissions security",
  },
  {
    id: "plugins",
    label: "Plugins & MCP",
    icon: Puzzle,
    keywords: "install remove server connection manifest permissions",
  },
  {
    id: "performance",
    label: "Performance",
    icon: Gauge,
    keywords: "hardware gpu cpu memory cache monitor",
  },
  {
    id: "developer",
    label: "Developer",
    icon: Code2,
    keywords: "debug tool api logs console diagnostics modules reload",
  },
];

const electronKeys = new Set<keyof ShreeSettings>([
  "minimize_to_tray",
  "start_minimized",
  "remember_window_position",
  "check_updates_automatically",
  "automatic_download_updates",
  "automatic_install_updates",
  "update_channel",
  "notifications_enabled",
  "hardware_acceleration",
  "background_cpu_limit",
  "memory_usage_limit_mb",
  "cache_size_mb",
  "quiet_hours_enabled",
  "quiet_hours_start",
  "quiet_hours_end",
  "floating_mode_enabled",
  "start_in_floating_mode",
  "floating_always_on_top",
  "floating_auto_hide_fullscreen",
  "floating_avatar_size",
  "floating_opacity",
  "floating_click_through_idle",
  "floating_show_subtitles",
  "floating_show_speech_bubble",
  "floating_idle_animations",
  "floating_lip_sync",
  "floating_desktop_awareness",
  "floating_proactive_suggestions",
  "floating_voice_volume",
  "floating_edge_snapping",
  "floating_animation_quality",
  "floating_activation_shortcut",
]);

function Card({
  title,
  description,
  children,
  icon: Icon,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  icon?: typeof Settings;
}) {
  return (
    <section className="settings-card">
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <span className="settings-card-icon">
            <Icon size={16} />
          </span>
        )}
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {description && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
function Row({
  title,
  description,
  children,
}: {
  key?: string | number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="min-w-0 pr-4">
        <p className="text-xs font-medium text-slate-200">{title}</p>
        {description && (
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
function Toggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`settings-toggle ${value ? "is-on" : ""}`}
      aria-pressed={value}
    >
      <span />
    </button>
  );
}
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange(value: string): void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="settings-select"
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}
function Field({
  value,
  onChange,
  type = "text",
  placeholder = "",
}: {
  value: string | number;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="settings-input"
    />
  );
}
function Button({
  children,
  onClick,
  tone = "cyan",
  disabled = false,
}: {
  children: ReactNode;
  onClick(): void;
  tone?: "cyan" | "rose" | "slate";
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`settings-button tone-${tone}`}
    >
      {children}
    </button>
  );
}

export function DesktopSettings({
  onClose,
  forceSetup = false,
  onReady,
}: Props) {
  const [active, setActive] = useState<Category>(
    forceSetup ? "api" : "general",
  );
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<ShreeSettings>(defaultSettings);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [wizardStep, setWizardStep] = useState(forceSetup ? 0 : -1);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Decision>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [moduleTest, setModuleTest] = useState<Diagnostics | null>(null);
  const [folder, setFolder] = useState("");
  const [wakePhrase, setWakePhrase] = useState("");
  const [mcp, setMcp] = useState({ name: "", command: "", args: "" });
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    run: () => Promise<void>;
  } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [
        settingsResponse,
        status,
        control,
        loadedMemories,
        loadedPlugins,
        servers,
        loadedAudit,
        startup,
      ] = await Promise.all([
        apiFetch<{ values: ShreeSettings }>("/api/settings"),
        apiFetch<SetupStatus>("/api/setup/status"),
        apiFetch<{ permissions: Record<string, Decision> }>(
          "/api/desktop-control/settings",
        ),
        apiFetch<Memory[]>("/api/memories"),
        apiFetch<Plugin[]>("/api/plugins"),
        apiFetch<McpServer[]>("/api/mcp/servers"),
        apiFetch<AuditEntry[]>("/api/audit?limit=50"),
        window.shreeDesktop?.getLaunchAtLogin() ?? Promise.resolve(false),
      ]);
      const merged = { ...defaultSettings, ...settingsResponse.values };
      setValues(merged);
      applyAppearance(merged);
      if (window.shreeDesktop) await window.shreeDesktop.updatePreferences(merged);
      setSetup(status);
      setPermissions(control.permissions);
      setMemories(loadedMemories);
      setPlugins(loadedPlugins);
      setMcpServers(servers);
      setAudit(loadedAudit);
      setLaunchAtLogin(Boolean(startup));
      if (status.requires_setup) setWizardStep((step) => (step < 0 ? 0 : step));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    let disposed = false;
    window.shreeDesktop?.getUpdateState().then((state) => { if (!disposed) setUpdateState(state); });
    const remove = window.shreeDesktop?.onUpdateState(setUpdateState);
    return () => { disposed = true; remove?.(); };
  }, []);
  useEffect(() => {
    const remove = window.shreeDesktop?.onOpenSettings((payload) =>
      setActive(payload?.section === "updates" ? "updates" : "general"),
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && setup?.ready) onClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById("settings-search")?.focus();
      }
    };
    addEventListener("keydown", key);
    return () => {
      remove?.();
      removeEventListener("keydown", key);
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, [onClose, setup?.ready]);

  function notify(text: string) {
    setMessage(text);
    setTimeout(
      () => setMessage((current) => (current === text ? "" : current)),
      4500,
    );
  }
  async function persist<K extends keyof ShreeSettings>(
    key: K,
    value: ShreeSettings[K],
  ) {
    const next = { ...valuesRef.current, [key]: value };
    setValues(next);
    valuesRef.current = next;
    if (key === "theme" || key === "accent_color" || key === "animation_speed")
      applyAppearance(next);
    clearTimeout(timers.current[String(key)]);
    timers.current[String(key)] = setTimeout(async () => {
      try {
        await apiFetch(`/api/settings/${String(key)}`, {
          method: "PUT",
          body: JSON.stringify({ value }),
        });
        if (electronKeys.has(key) && window.shreeDesktop) {
          const result = await window.shreeDesktop.updatePreferences({
            [key]: value,
          });
          if (result.restart_required) setRestartRequired(true);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error));
        load();
      }
    }, 250);
  }
  async function saveKey() {
    if (!apiKey.trim()) return;
    setKeyBusy(true);
    try {
      await apiFetch("/api/secrets/gemini", {
        method: "PUT",
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      setApiKey("");
      const status = await apiFetch<SetupStatus>("/api/setup/status");
      setSetup(status);
      notify("Gemini key validated and secured in Windows Credential Manager.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setKeyBusy(false);
    }
  }
  async function testKey() {
    setKeyBusy(true);
    try {
      await apiFetch("/api/secrets/gemini/test", { method: "POST" });
      setSetup(await apiFetch("/api/setup/status"));
      notify("Gemini connection test passed.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setKeyBusy(false);
    }
  }
  async function enumerateAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }
  async function finishSetup() {
    try {
      await apiFetch("/api/setup/complete", {
        method: "POST",
        body: JSON.stringify({ completed: true }),
      });
      const status = await apiFetch<SetupStatus>("/api/setup/status");
      setSetup(status);
      setWizardStep(-1);
      const next = { ...valuesRef.current, setup_completed: true };
      setValues(next);
      if (window.shreeDesktop) {
        const desktopValues = Object.fromEntries(
          [...electronKeys].map((key) => [key, next[key]]),
        );
        await window.shreeDesktop.updatePreferences(desktopValues);
      }
      onReady?.(next);
      notify("Setup complete. Shree Mark 12 is ready.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      setWizardStep(1);
    }
  }
  function download(name: string, data: unknown) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function importJson(file: File, endpoint: string) {
    try {
      const parsed = JSON.parse(await file.text());
      await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(
          endpoint.includes("memories")
            ? { memories: parsed.memories || parsed }
            : { values: parsed.values || parsed },
        ),
      });
      await load();
      notify("Import completed and validated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }
  async function updateMemory(memory: Memory) {
    try {
      await apiFetch(`/api/memories/${memory.id}`, {
        method: "PUT",
        body: JSON.stringify({
          category: memory.category,
          content: memory.content,
          importance: memory.importance,
          pinned: memory.pinned,
        }),
      });
      setMemories(await apiFetch("/api/memories"));
      notify("Memory updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }
  async function deleteMemoryConfirmed(arguments_: Record<string, unknown>) {
    const requested = await apiFetch<any>("/api/tools/execute", {
      method: "POST",
      body: JSON.stringify({ action: "delete_memory", arguments: arguments_ }),
    });
    if (
      requested.status !== "confirmation_required" ||
      !requested.confirmation?.token
    )
      throw new Error(
        requested.human_response ||
          "Memory deletion confirmation could not be created.",
      );
    const result = await apiFetch<any>(
      `/api/tools/confirm/${requested.confirmation.token}`,
      { method: "POST", body: JSON.stringify({ approved: true }) },
    );
    if (result.status !== "completed")
      throw new Error(
        result.human_response || "Memory deletion was not completed.",
      );
    setMemories(await apiFetch("/api/memories"));
  }
  async function refreshPlugins() {
    setPlugins(await apiFetch("/api/plugins"));
    setMcpServers(await apiFetch("/api/mcp/servers"));
  }
  async function connectMcp() {
    await apiFetch("/api/mcp/connect", {
      method: "POST",
      body: JSON.stringify({
        name: mcp.name,
        command: mcp.command,
        args: mcp.args.split(/\s+/).filter(Boolean),
        env: {},
      }),
    });
    setMcp({ name: "", command: "", args: "" });
    await refreshPlugins();
  }

  const visibleCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? categories.filter((item) =>
          (item.label + " " + item.keywords).toLowerCase().includes(query),
        )
      : categories;
  }, [search]);
  const audioInputs = devices.filter((device) => device.kind === "audioinput"),
    audioOutputs = devices.filter((device) => device.kind === "audiooutput");

  const general = (
    <>
      <Card title="Windows & startup" icon={Settings}>
        <Row title="Launch on Windows startup">
          <Toggle
            value={launchAtLogin}
            onChange={async (enabled) => {
              if (window.shreeDesktop) {
                setLaunchAtLogin(
                  await window.shreeDesktop.setLaunchAtLogin(enabled),
                );
              }
            }}
          />
        </Row>
        <Row title="Minimize to system tray">
          <Toggle
            value={values.minimize_to_tray}
            onChange={(value) => persist("minimize_to_tray", value)}
          />
        </Row>
        <Row title="Start minimized">
          <Toggle
            value={values.start_minimized}
            onChange={(value) => persist("start_minimized", value)}
          />
        </Row>
        <Row title="Remember last window position">
          <Toggle
            value={values.remember_window_position}
            onChange={(value) => persist("remember_window_position", value)}
          />
        </Row>
      </Card>
      <Card title="Appearance" icon={Sparkles}>
        <Row title="Language">
          <Select
            value={values.language}
            options={["Auto", "English", "Hindi"]}
            onChange={(value) =>
              persist("language", value as ShreeSettings["language"])
            }
          />
        </Row>
        <Row title="Theme">
          <Select
            value={values.theme}
            options={["Dark", "Light", "Auto"]}
            onChange={(value) =>
              persist("theme", value as ShreeSettings["theme"])
            }
          />
        </Row>
        <Row title="Accent color">
          <input
            type="color"
            value={values.accent_color}
            onChange={(e) => persist("accent_color", e.target.value)}
            className="h-8 w-12 rounded border border-white/10 bg-transparent"
          />
        </Row>
        <Row title="Animation speed">
          <Select
            value={values.animation_speed}
            options={["Reduced", "Normal", "Fast"]}
            onChange={(value) =>
              persist(
                "animation_speed",
                value as ShreeSettings["animation_speed"],
              )
            }
          />
        </Row>
      </Card>
      <Card title="Settings portability">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () =>
              download(
                "shree-settings.json",
                await apiFetch("/api/settings/export"),
              )
            }
          >
            <Download size={13} /> Export
          </Button>
          <label className="settings-button tone-slate cursor-pointer">
            <Upload size={13} /> Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] &&
                importJson(e.target.files[0], "/api/settings/import")
              }
            />
          </label>
          <Button
            tone="rose"
            onClick={() =>
              setConfirm({
                title: "Reset settings?",
                body: "All preferences will return to defaults. Your API key stays in Credential Manager.",
                run: async () => {
                  await apiFetch("/api/settings/reset", { method: "POST" });
                  await load();
                },
              })
            }
          >
            <RotateCcw size={13} /> Reset
          </Button>
        </div>
      </Card>
    </>
  );

  const floating = (
    <>
      <Card
        title="Floating Companion"
        description="Keep Shree quietly available above your work while the live conversation remains connected."
        icon={Sparkles}
      >
        <Row title="Enable Floating Mode" description="Use the companion as Shree's normal desktop interface.">
          <Toggle value={values.floating_mode_enabled} onChange={(value) => persist("floating_mode_enabled", value)} />
        </Row>
        <Row title="Start SHREE in Floating Mode" description="When disabled, SHREE always opens in the full application window.">
          <Toggle value={values.start_in_floating_mode} disabled={!values.floating_mode_enabled} onChange={(value) => persist("start_in_floating_mode", value)} />
        </Row>
        <Row title="Always on top">
          <Toggle value={values.floating_always_on_top} disabled={!values.floating_mode_enabled} onChange={(value) => persist("floating_always_on_top", value)} />
        </Row>
        <Row title="Auto-hide in fullscreen" description="Hides Shree over fullscreen apps and games, then restores her afterward.">
          <Toggle value={values.floating_auto_hide_fullscreen} disabled={!values.floating_mode_enabled} onChange={(value) => persist("floating_auto_hide_fullscreen", value)} />
        </Row>
        <Row title="Avatar size">
          <Select value={values.floating_avatar_size} options={["Small", "Medium", "Large"]} onChange={(value) => persist("floating_avatar_size", value as ShreeSettings["floating_avatar_size"])} />
        </Row>
        <Row title={`Avatar opacity · ${values.floating_opacity}%`}>
          <input aria-label="Floating avatar opacity" type="range" min="35" max="100" value={values.floating_opacity} onChange={(event) => persist("floating_opacity", Number(event.target.value))} className="w-36 accent-cyan-400" />
        </Row>
        <Row title="Click-through when idle" description="Pointer input passes through Shree while controls are hidden. Hovering the edge or using the shortcut restores interaction.">
          <Toggle value={values.floating_click_through_idle} disabled={!values.floating_mode_enabled} onChange={(value) => persist("floating_click_through_idle", value)} />
        </Row>
        <Row title="Edge snapping">
          <Toggle value={values.floating_edge_snapping} disabled={!values.floating_mode_enabled} onChange={(value) => persist("floating_edge_snapping", value)} />
        </Row>
      </Card>
      <Card title="Conversation & animation" icon={Mic2}>
        <Row title="Show subtitles"><Toggle value={values.floating_show_subtitles} onChange={(value) => persist("floating_show_subtitles", value)} /></Row>
        <Row title="Show speech bubble"><Toggle value={values.floating_show_speech_bubble} onChange={(value) => persist("floating_show_speech_bubble", value)} /></Row>
        <Row title="Idle animations"><Toggle value={values.floating_idle_animations} onChange={(value) => persist("floating_idle_animations", value)} /></Row>
        <Row title="Audio-reactive lip sync"><Toggle value={values.floating_lip_sync} onChange={(value) => persist("floating_lip_sync", value)} /></Row>
        <Row title={`Companion voice volume · ${values.floating_voice_volume}%`}>
          <input aria-label="Companion voice volume" type="range" min="0" max="100" value={values.floating_voice_volume} onChange={(event) => persist("floating_voice_volume", Number(event.target.value))} className="w-36 accent-fuchsia-400" />
        </Row>
        <Row title="Animation quality">
          <Select value={values.floating_animation_quality} options={["Low", "Balanced", "High"]} onChange={(value) => persist("floating_animation_quality", value as ShreeSettings["floating_animation_quality"])} />
        </Row>
      </Card>
      <Card title="Awareness & activation" icon={Eye}>
        <Row title="Desktop awareness" description="Reads only the active app name and window title; it does not capture the screen.">
          <Toggle value={values.floating_desktop_awareness} onChange={(value) => persist("floating_desktop_awareness", value)} />
        </Row>
        <Row title="Proactive suggestions" description="Off by default. When enabled, Shree may show a quiet suggestion after the active app changes.">
          <Toggle value={values.floating_proactive_suggestions} disabled={!values.floating_desktop_awareness} onChange={(value) => persist("floating_proactive_suggestions", value)} />
        </Row>
        <Row title="Activation shortcut" description="Shows Shree and starts listening without opening the full window.">
          <Field value={values.floating_activation_shortcut} onChange={(value) => persist("floating_activation_shortcut", value)} placeholder="CommandOrControl+Alt+Space" />
        </Row>
      </Card>
    </>
  );

  const api = (
    <Card
      title="API key manager"
      description="Required secrets never enter the React settings database. They are validated first, then stored for the current Windows user in Credential Manager."
      icon={KeyRound}
    >
      <div
        className={`mb-4 rounded-xl border p-3 ${setup?.providers.gemini.validated ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
      >
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-white/5 p-2">
            <Sparkles size={17} className="text-cyan-300" />
          </span>
          <div>
            <p className="text-xs font-semibold text-white">
              Google Gemini Live
            </p>
            <p className="text-[10px] text-slate-500">
              Required AI provider ·{" "}
              {setup?.providers.gemini.validated
                ? "Validated"
                : "Setup required"}
            </p>
          </div>
          {setup?.providers.gemini.validated && (
            <CheckCircle2 className="ml-auto text-emerald-400" size={17} />
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? "text" : "password"}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              setup?.providers.gemini.configured
                ? "Enter a replacement key"
                : "Enter your Gemini API key"
            }
            className="settings-input w-full pr-10"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-2.5 text-slate-500"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <Button disabled={keyBusy || !apiKey.trim()} onClick={saveKey}>
          {keyBusy ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}{" "}
          Validate & save
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          tone="slate"
          disabled={keyBusy || !setup?.providers.gemini.configured}
          onClick={testKey}
        >
          <PlugZap size={13} /> Test connection
        </Button>
        <Button
          tone="rose"
          disabled={!setup?.providers.gemini.configured}
          onClick={() =>
            setConfirm({
              title: "Delete Gemini key?",
              body: "SHREE AI and voice services will stop until another valid key is added.",
              run: async () => {
                await apiFetch("/api/secrets/gemini", { method: "DELETE" });
                setSetup(await apiFetch("/api/setup/status"));
                setWizardStep(1);
              },
            })
          }
        >
          <Trash2 size={13} /> Delete key
        </Button>
      </div>
    </Card>
  );

  const wake = (
    <>
      <Card
        title="Wake-word detection"
        description="Wake phrases are enforced by the active Gemini Live session. Background listening automatically opens a voice session after setup."
        icon={Mic2}
      >
        <Row title="Enable wake word">
          <Toggle
            value={values.wake_word_enabled}
            onChange={(value) => persist("wake_word_enabled", value)}
          />
        </Row>
        <Row
          title="Background listening"
          description="Starts microphone streaming when SHREE opens. Windows will request microphone permission."
        >
          <Toggle
            value={values.background_listening}
            disabled={!values.wake_word_enabled}
            onChange={(value) => persist("background_listening", value)}
          />
        </Row>
      </Card>
      <Card title="Wake phrases">
        <div className="flex gap-2">
          <Field
            value={wakePhrase}
            onChange={setWakePhrase}
            placeholder="Add a custom wake phrase"
          />
          <Button
            disabled={!wakePhrase.trim()}
            onClick={() => {
              persist("wake_phrases", [
                ...values.wake_phrases,
                wakePhrase.trim(),
              ]);
              setWakePhrase("");
            }}
          >
            <Plus size={13} /> Add
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {values.wake_phrases.map((phrase) => (
            <button
              key={phrase}
              onClick={() =>
                persist(
                  "wake_phrases",
                  values.wake_phrases.filter((item) => item !== phrase),
                )
              }
              className="rounded-full border border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5 text-[10px] text-cyan-200"
            >
              {phrase} <span className="ml-1 text-slate-500">×</span>
            </button>
          ))}
        </div>
      </Card>
    </>
  );

  const ai = (
    <Card
      title="AI capabilities"
      description="Disabled capabilities are removed from Gemini's available tools and rejected by the backend."
      icon={Sparkles}
    >
      {(
        [
          [
            "reasoning_enabled",
            "Reasoning",
            "Use deliberate planning for multi-step goals",
          ],
          [
            "tool_use_enabled",
            "Tool use",
            "Expose verified SHREE tools to Gemini",
          ],
          [
            "web_search_enabled",
            "Current web search",
            "Let Shree ground current facts and news with Google Search",
          ],
          [
            "memory_enabled",
            "Memory",
            "Load and search approved long-term memory",
          ],
          [
            "screen_understanding_enabled",
            "Screen understanding",
            "Expose capture, accessibility, and OCR tools",
          ],
          [
            "desktop_control_enabled",
            "Desktop control",
            "Allow Windows action tools",
          ],
        ] as Array<[keyof ShreeSettings, string, string]>
      ).map(([key, title, description]) => (
        <Row key={key} title={title} description={description}>
          <Toggle
            value={Boolean(values[key])}
            onChange={(value) => persist(key, value as never)}
          />
        </Row>
      ))}
      <Row
        title="Shree's voice"
        description="Aoede restores the natural feminine voice from the 1.1.20 Talk-only build. Voice changes apply on the next conversation."
      >
        <Select
          value={values.assistant_voice}
          options={["Achernar", "Vindemiatrix", "Leda", "Aoede", "Kore"]}
          onChange={(value) =>
            persist("assistant_voice", value as ShreeSettings["assistant_voice"])
          }
        />
      </Row>
      <Row
        title="Code execution"
        description="Unavailable until a sandboxed code runner is installed; SHREE will not run unrestricted AI-generated commands."
      >
        <Toggle
          value={values.code_execution_enabled}
          disabled
          onChange={() => {}}
        />
      </Row>
    </Card>
  );

  const memory = (
    <>
      <Card
        title="Memory behavior"
        description="SHREE automatically saves stable preferences and useful long-term information without asking for a second confirmation."
        icon={Brain}
      >
        <Row title="Enable memory">
          <Toggle
            value={values.memory_enabled}
            onChange={(value) => persist("memory_enabled", value)}
          />
        </Row>
        <Row title="Default importance">
          <Select
            value={values.memory_importance_level}
            options={["Critical", "High", "Medium", "Low"]}
            onChange={(value) =>
              persist("memory_importance_level", value as Importance)
            }
          />
        </Row>
      </Card>
      <Card
        title={`Stored memories · ${memories.length}`}
        description="Edit and pin stored memories. Changes are reflected in the next Live session."
      >
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {memories.map((memory, index) => (
            <div
              key={memory.id}
              className="rounded-xl border border-white/5 bg-black/20 p-3"
            >
              <div className="flex gap-2">
                <select
                  value={memory.category}
                  onChange={(e) =>
                    setMemories((items) =>
                      items.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              category: e.target.value as Memory["category"],
                            }
                          : item,
                      ),
                    )
                  }
                  className="settings-select"
                >
                  <option>Identity</option>
                  <option>Preferences</option>
                  <option>Personality</option>
                  <option>Projects</option>
                  <option>Goals</option>
                  <option>Relationships</option>
                  <option>Schedule</option>
                  <option>Habits</option>
                  <option>Emotional</option>
                  <option>Semantic</option>
                </select>
                <select
                  value={memory.importance}
                  onChange={(e) =>
                    setMemories((items) =>
                      items.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              importance: e.target.value as Importance,
                            }
                          : item,
                      ),
                    )
                  }
                  className="settings-select"
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
                <button
                  onClick={() =>
                    setMemories((items) =>
                      items.map((item, i) =>
                        i === index ? { ...item, pinned: !item.pinned } : item,
                      ),
                    )
                  }
                  className={`rounded px-2 text-[10px] ${memory.pinned ? "bg-cyan-500/15 text-cyan-200" : "bg-white/5 text-slate-500"}`}
                >
                  Pinned
                </button>
              </div>
              <textarea
                value={memory.content}
                onChange={(e) =>
                  setMemories((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, content: e.target.value } : item,
                    ),
                  )
                }
                className="settings-textarea mt-2 h-16"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button tone="slate" onClick={() => updateMemory(memory)}>
                  <Save size={12} /> Save
                </Button>
                <Button
                  tone="rose"
                  onClick={() =>
                    setConfirm({
                      title: "Delete memory?",
                      body: memory.content,
                      run: async () =>
                        deleteMemoryConfirmed({ memory_id: memory.id }),
                    })
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={async () =>
              download(
                "shree-memories.json",
                await apiFetch("/api/memories/export"),
              )
            }
          >
            <Download size={13} /> Export
          </Button>
          <label className="settings-button tone-slate cursor-pointer">
            <Upload size={13} /> Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] &&
                importJson(e.target.files[0], "/api/memories/import")
              }
            />
          </label>
          <Button
            tone="rose"
            onClick={() =>
              setConfirm({
                title: "Clear all memories?",
                body: "This permanently removes every stored long-term memory from this computer.",
                run: async () => deleteMemoryConfirmed({ all: true }),
              })
            }
          >
            <Trash2 size={13} /> Clear all
          </Button>
        </div>
      </Card>
    </>
  );

  const desktop = (
    <>
      <Card
        title="Automation controls"
        description="Each switch is enforced before a desktop tool executes."
        icon={MonitorCog}
      >
        {(
          [
            ["desktop_control_enabled", "Desktop control"],
            ["keyboard_automation_enabled", "Keyboard automation"],
            ["mouse_automation_enabled", "Mouse automation"],
            ["file_management_enabled", "File management"],
            ["ocr_enabled", "OCR"],
            ["clipboard_access_enabled", "Clipboard access"],
            ["screen_capture_enabled", "Screen capture"],
            ["exact_volume_enabled", "Exact volume control"],
          ] as Array<[keyof ShreeSettings, string]>
        ).map(([key, title]) => (
          <Row key={key} title={title}>
            <Toggle
              value={Boolean(values[key])}
              onChange={(value) => persist(key, value as never)}
            />
          </Row>
        ))}
        <Row
          title="Power & session controls"
          description="One switch for shutdown, restart, lock, sign out, switch user, sleep, and hibernate. Every action still requires separate explicit confirmation."
        >
          <Toggle
            value={values.power_controls_enabled}
            onChange={(value) => persist("power_controls_enabled", value)}
          />
        </Row>
      </Card>
      <Card title="Emergency stop">
        <div className="flex gap-2">
          <Field
            value={values.emergency_stop_shortcut}
            onChange={(value) =>
              setValues((current) => ({
                ...current,
                emergency_stop_shortcut: value,
              }))
            }
          />
          <Button
            onClick={async () => {
              await window.shreeDesktop?.setEmergencyShortcut(
                values.emergency_stop_shortcut,
              );
              await persist(
                "emergency_stop_shortcut",
                values.emergency_stop_shortcut,
              );
              notify("Emergency shortcut registered.");
            }}
          >
            <Save size={13} /> Apply
          </Button>
        </div>
      </Card>
      <Card title="Allowed file folders">
        <div className="flex gap-2">
          <Field
            value={folder}
            onChange={setFolder}
            placeholder="C:\Users\You\Documents"
          />
          <Button
            disabled={!folder.trim()}
            onClick={() => {
              persist("file_access_folders", [
                ...values.file_access_folders,
                folder.trim(),
              ]);
              setFolder("");
            }}
          >
            <Plus size={13} />
          </Button>
        </div>
        {values.file_access_folders.map((item) => (
          <button
            key={item}
            onClick={() =>
              persist(
                "file_access_folders",
                values.file_access_folders.filter((folder) => folder !== item),
              )
            }
            className="mt-2 block w-full truncate rounded-lg bg-black/20 px-3 py-2 text-left text-[10px] text-slate-400"
          >
            × {item}
          </button>
        ))}
      </Card>
      <Card title="Permission manager" icon={ShieldCheck}>
        {[
          "desktop_control",
          "file_access",
          "clipboard",
          "screen_reading",
          "keyboard_mouse",
          "media_control",
          "power_control",
        ].map((capability) => (
          <Row key={capability} title={capability.replaceAll("_", " ")}>
            <Select
              value={permissions[capability] || "ask"}
              options={["ask", "allow_always", "deny"]}
              onChange={async (decision) => {
                await apiFetch(
                  `/api/desktop-control/permissions/${capability}`,
                  { method: "PUT", body: JSON.stringify({ decision }) },
                );
                setPermissions((current) => ({
                  ...current,
                  [capability]: decision as Decision,
                }));
              }}
            />
          </Row>
        ))}
        <Button
          tone="rose"
          onClick={() =>
            setConfirm({
              title: "Reset all permissions?",
              body: "Capability decisions return to Ask. Destructive actions will still always require confirmation.",
              run: async () => {
                await apiFetch("/api/desktop-control/permissions", {
                  method: "DELETE",
                });
                setPermissions({});
              },
            })
          }
        >
          <RotateCcw size={13} /> Reset permissions
        </Button>
      </Card>
    </>
  );

  const notifications = (
    <Card title="Notification channels" icon={Bell}>
      {(
        [
          ["notifications_enabled", "Enable notifications"],
          ["desktop_notifications", "Desktop notifications"],
          ["sound_notifications", "Sound notifications"],
          ["reminder_notifications", "Reminder notifications"],
          ["update_notifications", "Update notifications"],
          ["error_notifications", "Error notifications"],
          ["quiet_hours_enabled", "Quiet hours"],
        ] as Array<[keyof ShreeSettings, string]>
      ).map(([key, title]) => (
        <Row key={key} title={title}>
          <Toggle
            value={Boolean(values[key])}
            onChange={(value) => persist(key, value as never)}
          />
        </Row>
      ))}
      {values.quiet_hours_enabled && (
        <div className="grid grid-cols-2 gap-3 pt-4">
          <label className="text-[10px] text-slate-500">
            From
            <Field
              type="time"
              value={values.quiet_hours_start}
              onChange={(value) => persist("quiet_hours_start", value)}
            />
          </label>
          <label className="text-[10px] text-slate-500">
            Until
            <Field
              type="time"
              value={values.quiet_hours_end}
              onChange={(value) => persist("quiet_hours_end", value)}
            />
          </label>
        </div>
      )}
    </Card>
  );

  const privacy = (
    <>
      <Card title="Privacy controls" icon={ShieldCheck}>
        <Row
          title="Local-only mode"
          description="Blocks Gemini Live because Gemini is a cloud service. Local desktop tools remain available through the Settings tester and API."
        >
          <Toggle
            value={values.local_only_mode}
            onChange={(value) => persist("local_only_mode", value)}
          />
        </Row>
        <Row
          title="Encrypt saved preferences"
          description="Protects non-secret settings with Windows DPAPI. API keys always stay in Credential Manager."
        >
          <Toggle
            value={values.encrypt_saved_settings}
            onChange={(value) => persist("encrypt_saved_settings", value)}
          />
        </Row>
        <Row title="Clipboard history">
          <Toggle
            value={values.clipboard_history_enabled}
            onChange={(value) => persist("clipboard_history_enabled", value)}
          />
        </Row>
      </Card>
      <Card title="Local data cleanup">
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            tone="rose"
            onClick={() =>
              setConfirm({
                title: "Clear chat history?",
                body: "All locally stored conversations and messages will be removed.",
                run: async () => {
                  await apiFetch("/api/conversations", { method: "DELETE" });
                },
              })
            }
          >
            <Trash2 size={13} /> Clear chat history
          </Button>
          <Button
            tone="rose"
            onClick={() =>
              setConfirm({
                title: "Clear logs?",
                body: "Current and rotated SHREE backend logs will be cleared.",
                run: async () => {
                  await apiFetch("/api/logs", { method: "DELETE" });
                  setLogs([]);
                },
              })
            }
          >
            <Trash2 size={13} /> Clear logs
          </Button>
          <Button
            tone="rose"
            onClick={() =>
              setConfirm({
                title: "Clear cache?",
                body: "SHREE backend and Chromium caches will be cleared.",
                run: async () => {
                  await apiFetch("/api/cache", { method: "DELETE" });
                  await window.shreeDesktop?.clearCache();
                },
              })
            }
          >
            <Trash2 size={13} /> Clear cache
          </Button>
          <Button
            tone="slate"
            onClick={async () => {
              setAudit(await apiFetch("/api/audit?limit=200"));
              setActive("developer");
            }}
          >
            <ShieldCheck size={13} /> Security logs
          </Button>
        </div>
      </Card>
    </>
  );

  const pluginPanel = (
    <>
      <Card
        title="Plugin manager"
        description="ZIP packages are path-safety checked and their manifest, entrypoint, and permissions are validated before installation."
        icon={Puzzle}
      >
        <Row title="Enable plugins">
          <Toggle
            value={values.plugins_enabled}
            onChange={(value) => persist("plugins_enabled", value)}
          />
        </Row>
        <label className="settings-button tone-cyan mt-3 cursor-pointer">
          <Upload size={13} /> Install plugin ZIP
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const data = new FormData();
              data.append("file", file);
              try {
                await apiFetch("/api/plugins/install", {
                  method: "POST",
                  body: data,
                });
                await refreshPlugins();
                notify("Plugin installed after validation.");
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </label>
        <div className="mt-3 space-y-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-xl border border-white/5 bg-black/20 p-3"
            >
              <div className="flex items-center gap-2">
                <div>
                  <p className="text-xs text-white">
                    {plugin.name}{" "}
                    <span className="text-slate-600">{plugin.version}</span>
                  </p>
                  <p className="mt-1 text-[9px] text-slate-500">
                    {plugin.permissions?.join(" · ") || plugin.error}
                  </p>
                </div>
                <Toggle
                  value={plugin.enabled !== false}
                  onChange={(value) => {
                    const states = {
                      ...values.plugin_states,
                      [plugin.id]: value,
                    };
                    persist("plugin_states", states);
                    setPlugins((items) =>
                      items.map((item) =>
                        item.id === plugin.id
                          ? { ...item, enabled: value }
                          : item,
                      ),
                    );
                  }}
                />
                <Button
                  tone="slate"
                  onClick={async () => {
                    await apiFetch(`/api/plugins/${plugin.id}/test`, {
                      method: "POST",
                    });
                    notify(`${plugin.name} manifest and entrypoint are valid.`);
                  }}
                >
                  <Check size={12} />
                </Button>
                <Button
                  tone="rose"
                  onClick={() =>
                    setConfirm({
                      title: `Remove ${plugin.name}?`,
                      body: "The local plugin directory will be deleted.",
                      run: async () => {
                        await apiFetch(`/api/plugins/${plugin.id}`, {
                          method: "DELETE",
                        });
                        await refreshPlugins();
                      },
                    })
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card
        title="MCP server manager"
        description="Commands are started directly without a shell. Environment secrets are stored in Credential Manager."
        icon={PlugZap}
      >
        <div className="grid gap-2 md:grid-cols-3">
          <Field
            value={mcp.name}
            placeholder="Server name"
            onChange={(value) => setMcp({ ...mcp, name: value })}
          />
          <Field
            value={mcp.command}
            placeholder="Executable command"
            onChange={(value) => setMcp({ ...mcp, command: value })}
          />
          <Field
            value={mcp.args}
            placeholder="Arguments separated by spaces"
            onChange={(value) => setMcp({ ...mcp, args: value })}
          />
        </div>
        <Button
          disabled={!mcp.name || !mcp.command}
          onClick={() =>
            setConfirm({
              title: `Connect MCP server ${mcp.name}?`,
              body: `SHREE will start this local executable without a shell: ${mcp.command} ${mcp.args}. Only continue if you trust it.`,
              run: connectMcp,
            })
          }
        >
          <Plus size={13} /> Add & connect
        </Button>
        <div className="mt-3 space-y-2">
          {mcpServers.map((server) => (
            <div key={server.name} className="settings-row">
              <div>
                <p className="text-xs text-white">{server.name}</p>
                <p className="text-[9px] text-slate-500">
                  {server.command} {server.args.join(" ")} ·{" "}
                  {server.connected ? "Connected" : "Offline"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  tone="slate"
                  onClick={async () => {
                    await apiFetch(`/api/mcp/${server.name}/test`, {
                      method: "POST",
                    });
                    await refreshPlugins();
                    notify(`${server.name} connection passed.`);
                  }}
                >
                  <PlugZap size={12} />
                </Button>
                <Button
                  tone="rose"
                  onClick={() =>
                    setConfirm({
                      title: `Remove ${server.name}?`,
                      body: "The MCP process will stop and its saved environment will be removed.",
                      run: async () => {
                        await apiFetch(`/api/mcp/${server.name}`, {
                          method: "DELETE",
                        });
                        await refreshPlugins();
                      },
                    })
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );

  const performance = (
    <>
      <Card
        title="Resource controls"
        description="GPU, V8 memory, and Chromium disk-cache changes apply after restart. Background throttling applies to the renderer."
        icon={Gauge}
      >
        <Row title="Hardware acceleration">
          <Toggle
            value={values.hardware_acceleration}
            onChange={(value) => persist("hardware_acceleration", value)}
          />
        </Row>
        <Row title={`Background CPU target · ${values.background_cpu_limit}%`}>
          <input
            type="range"
            min="10"
            max="100"
            value={values.background_cpu_limit}
            onChange={(e) =>
              persist("background_cpu_limit", Number(e.target.value))
            }
            className="w-40 accent-cyan-400"
          />
        </Row>
        <Row
          title={`Renderer memory limit · ${values.memory_usage_limit_mb} MB`}
        >
          <input
            type="range"
            min="256"
            max="8192"
            step="256"
            value={values.memory_usage_limit_mb}
            onChange={(e) =>
              persist("memory_usage_limit_mb", Number(e.target.value))
            }
            className="w-40 accent-cyan-400"
          />
        </Row>
        <Row title={`Cache size · ${values.cache_size_mb} MB`}>
          <input
            type="range"
            min="32"
            max="4096"
            step="32"
            value={values.cache_size_mb}
            onChange={(e) => persist("cache_size_mb", Number(e.target.value))}
            className="w-40 accent-cyan-400"
          />
        </Row>
        {restartRequired && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200">
            <span>
              Restart required to apply low-level performance changes.
            </span>
            <Button onClick={() => window.shreeDesktop?.restart()}>
              <RefreshCw size={13} /> Restart
            </Button>
          </div>
        )}
      </Card>
      <Card title="Performance monitor">
        <Button
          onClick={async () =>
            setDiagnostics(await apiFetch("/api/diagnostics"))
          }
        >
          <Gauge size={13} /> Refresh monitor
        </Button>
        {diagnostics && (
          <pre className="settings-console mt-3">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        )}
      </Card>
    </>
  );

  const developer = (
    <>
      <Card title="Developer mode" icon={Code2}>
        <Row title="Enable Developer Mode">
          <Toggle
            value={values.developer_mode}
            onChange={(value) => persist("developer_mode", value)}
          />
        </Row>
        <Row title="Debug logs">
          <Toggle
            value={values.debug_logs}
            onChange={(value) => persist("debug_logs", value)}
          />
        </Row>
        <Row title="Tool execution logs">
          <Toggle
            value={values.tool_execution_logs}
            onChange={(value) => persist("tool_execution_logs", value)}
          />
        </Row>
        <Row
          title="API request logs"
          description="Logs method, path, and status only—never request bodies or API keys."
        >
          <Toggle
            value={values.api_request_logs}
            onChange={(value) => persist("api_request_logs", value)}
          />
        </Row>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={async () =>
              setLogs(
                (await apiFetch<{ lines: string[] }>("/api/logs?limit=300"))
                  .lines,
              )
            }
          >
            <SquareTerminal size={13} /> Console
          </Button>
          <Button
            onClick={async () =>
              setDiagnostics(await apiFetch("/api/diagnostics"))
            }
          >
            <Gauge size={13} /> Diagnostics
          </Button>
          <Button
            onClick={async () =>
              setModuleTest(
                await apiFetch("/api/diagnostics/test", { method: "POST" }),
              )
            }
          >
            <CheckCircle2 size={13} /> Test all modules
          </Button>
          <Button
            tone="slate"
            onClick={async () => {
              await apiFetch("/api/settings/reload", { method: "POST" });
              await load();
              notify("Configuration reloaded from local storage.");
            }}
          >
            <RefreshCw size={13} /> Reload configuration
          </Button>
        </div>
        {(logs.length > 0 || diagnostics || moduleTest) && (
          <pre className="settings-console mt-3">
            {logs.length
              ? logs.join("\n")
              : JSON.stringify(moduleTest || diagnostics, null, 2)}
          </pre>
        )}
      </Card>
      <Card title={`Security & tool audit · ${audit.length}`}>
        <div className="max-h-72 overflow-y-auto">
          {audit.map((entry) => (
            <div
              key={entry.id}
              className="border-b border-white/5 py-2 text-[9px]"
            >
              <span
                className={
                  entry.approved ? "text-emerald-400" : "text-rose-400"
                }
              >
                {entry.action}
              </span>
              <span className="ml-2 text-slate-600">
                {entry.risk} · {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );

  const dataDisclosure = (
    <Card title="How Shree handles data" icon={ShieldCheck}>
      <p className="text-[11px] leading-relaxed text-slate-400">
        Voice audio, conversation context, enabled memories, and necessary tool
        results are sent to Google Gemini only during an active Live session.
        Memories, reminders, settings, logs, and desktop actions remain local.
        Shree includes no advertising or product-analytics telemetry.
      </p>
    </Card>
  );
  const updates = (
    <>
      <Card title="Shree updates" description="Signed updates are downloaded over HTTPS and installed without removing your memories, settings, API credentials, reminders, or conversations." icon={Download}>
        <Row title="Installed version"><span className="text-xs text-cyan-300">{updateState?.currentVersion || "—"}</span></Row>
        <Row title="Available version"><span className="text-xs text-slate-300">{updateState?.availableVersion || "No newer version found"}</span></Row>
        <Row title="Status"><span className="text-xs text-slate-400">{(updateState?.status || "idle").replaceAll("_", " ")}</span></Row>
        <Row title="Last checked"><span className="text-xs text-slate-400">{updateState?.lastCheckedAt ? new Date(updateState.lastCheckedAt).toLocaleString() : "Not checked yet"}</span></Row>
        {updateState?.progress && (
          <div className="my-3">
            <div className="mb-1 flex justify-between text-[10px] text-slate-400"><span>Downloading</span><span>{updateState.progress.percent.toFixed(1)}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-cyan-400 transition-[width]" style={{width:`${updateState.progress.percent}%`}} /></div>
          </div>
        )}
        {updateState?.error && <p className="my-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-300">{updateState.error}</p>}
        {updateState?.releaseNotes && <div className="my-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-[11px] leading-relaxed text-slate-400">{updateState.releaseNotes}</div>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={async()=>setUpdateState((await window.shreeDesktop?.checkForUpdates()) as UpdateState)}> <RefreshCw size={13}/> Check now</Button>
          {(["update_available","error","download_cancelled"].includes(updateState?.status || "")) && <Button onClick={async()=>setUpdateState(await window.shreeDesktop!.downloadUpdate(false))}><Download size={13}/> Download</Button>}
          {updateState?.status==="downloading" && <Button tone="slate" onClick={async()=>{await window.shreeDesktop?.cancelUpdateDownload();}}><X size={13}/> Cancel</Button>}
          {updateState?.status==="downloaded" && <Button onClick={async()=>setUpdateState(await window.shreeDesktop!.installUpdate())}><RefreshCw size={13}/> Install & restart</Button>}
        </div>
      </Card>
      <Card title="Update preferences" icon={Settings}>
        <Row title="Check automatically"><Toggle value={values.check_updates_automatically} onChange={(value)=>persist("check_updates_automatically",value)}/></Row>
        <Row title="Download automatically"><Toggle value={values.automatic_download_updates} onChange={(value)=>persist("automatic_download_updates",value)}/></Row>
        <Row title="Install automatically when safe"><Toggle value={values.automatic_install_updates} onChange={(value)=>persist("automatic_install_updates",value)}/></Row>
        <Row title="Release channel">
          <Select value={values.update_channel} options={["stable","beta","alpha"]} onChange={(value)=>{
            const channel=value as UpdateChannel;
            setConfirm({title:"Change update channel?",body: channel==="stable"?"Stable receives tested public releases.":`${channel} builds may contain unfinished features or bugs.`,run:async()=>{await persist("update_channel",channel);setUpdateState(await window.shreeDesktop!.setUpdateChannel(channel));}});
          }}/>
        </Row>
      </Card>
      {!!updateState?.history.length && <Card title="Update history"><div className="space-y-2">{updateState.history.slice().reverse().map((entry)=><div key={`${entry.version}-${entry.completedAt}`} className="flex justify-between text-[11px] text-slate-400"><span>Shree {entry.version}</span><span>{new Date(entry.completedAt).toLocaleString()}</span></div>)}</div></Card>}
    </>
  );
  const panels: Record<Category, ReactNode> = {
    general,
    updates,
    floating,
    mobile: <MobileCompanionSettings notify={setMessage} values={values} persist={persist} />,
    api,
    wake,
    ai,
    memory,
    desktop,
    notifications,
    privacy: (
      <>
        {dataDisclosure}
        {privacy}
      </>
    ),
    plugins: pluginPanel,
    performance,
    developer,
  };
  const wizardTitles = [
    "Welcome to Shree — Mark 12",
    "Configure Gemini",
    "Choose microphone",
    "Choose speakers",
    "Configure wake word",
    "Choose your theme",
    "Finish setup",
  ];
  const wizardContent = [
    <div className="wizard-center">
      <img
        src={shreeMark}
        alt="Shree Mark 12"
        className="mb-3 h-24 w-24 object-contain drop-shadow-[0_0_24px_rgba(217,70,239,.35)]"
      />
      <h2>Welcome to Shree</h2>
      <p>
        Before using Shree Mark 12, configure the required API key and your
        voice experience. AI services remain off until setup is complete.
      </p>
    </div>,
    api,
    <div>
      <h3 className="wizard-heading">Select your microphone</h3>
      <p className="wizard-copy">
        Shree uses this device for Gemini Live conversations.
      </p>
      <Button onClick={enumerateAudio}>
        <Mic2 size={13} /> Detect audio devices
      </Button>
      <div className="mt-4">
        <Select
          value={values.audio_input_device_id}
          options={["default", ...audioInputs.map((device) => device.deviceId)]}
          onChange={(value) => persist("audio_input_device_id", value)}
        />
        {audioInputs.length > 0 && (
          <p className="mt-2 text-[10px] text-slate-500">
            {audioInputs.find(
              (device) => device.deviceId === values.audio_input_device_id,
            )?.label || "Windows default microphone"}
          </p>
        )}
      </div>
    </div>,
    <div>
      <h3 className="wizard-heading">Select your speakers</h3>
      <p className="wizard-copy">
        Gemini voice audio is routed to this output when Chromium supports
        device selection.
      </p>
      <Button onClick={enumerateAudio}>
        <Volume2 size={13} /> Detect speakers
      </Button>
      <div className="mt-4">
        <Select
          value={values.audio_output_device_id}
          options={[
            "default",
            ...audioOutputs.map((device) => device.deviceId),
          ]}
          onChange={(value) => persist("audio_output_device_id", value)}
        />
        {audioOutputs.length > 0 && (
          <p className="mt-2 text-[10px] text-slate-500">
            {audioOutputs.find(
              (device) => device.deviceId === values.audio_output_device_id,
            )?.label || "Windows default speakers"}
          </p>
        )}
      </div>
    </div>,
    wake,
    general,
    <div className="wizard-center">
      <img
        src={shreeMark}
        alt="Shree Mark 12"
        className="mb-3 h-20 w-20 object-contain"
      />
      <CheckCircle2
        size={42}
        className={
          setup?.providers.gemini.validated
            ? "text-emerald-400"
            : "text-amber-400"
        }
      />
      <h2>
        {setup?.providers.gemini.validated
          ? "Shree is ready"
          : "One step remains"}
      </h2>
      <p>
        {setup?.providers.gemini.validated
          ? "Your key is validated and preferences are saved locally. Finish setup to enable AI services."
          : "Return to the API step and validate the required Gemini key."}
      </p>
    </div>,
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-[#02030a]/85 p-3 backdrop-blur-xl sm:p-6"
    >
      <motion.div
        initial={{ scale: 0.97, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        className="mx-auto flex h-full max-w-[1450px] overflow-hidden rounded-[28px] border border-cyan-500/15 bg-[#070913]/95 shadow-[0_30px_100px_rgba(0,0,0,.65),0_0_80px_rgba(34,211,238,.04)]"
      >
        <aside className="settings-sidebar">
          <div className="p-5">
            <div className="flex justify-center">
              <img
                src={shreeMark}
                alt="Shree Mark 12"
                className="h-20 w-20 object-contain drop-shadow-[0_0_20px_rgba(217,70,239,.3)]"
              />
            </div>
            <div className="relative mt-4">
              <Search
                className="absolute left-3 top-2.5 text-slate-600"
                size={13}
              />
              <input
                id="settings-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings  Ctrl+F"
                className="w-full rounded-xl border border-white/5 bg-black/25 py-2 pl-9 pr-3 text-[11px] text-white outline-none focus:border-cyan-500/25"
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-5">
            {visibleCategories.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`settings-nav ${active === id ? "is-active" : ""}`}
              >
                <Icon size={15} />
                <span>{label}</span>
                {id === "api" && setup?.requires_setup && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            ))}
          </nav>
          <div className="border-t border-white/5 p-4 text-[9px] text-slate-600">
            Shree Mark 12 · Auto-save enabled · Secrets stay local
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-white/5 px-4 py-4 sm:px-6">
            <div>
              <p className="text-[9px] uppercase tracking-[.24em] text-cyan-400/60">
                Configuration
              </p>
              <h2 className="mt-1 hidden text-lg font-semibold text-white sm:block">
                {categories.find((item) => item.id === active)?.label}
              </h2>
              <select
                value={active}
                onChange={(e) => setActive(e.target.value as Category)}
                className="settings-select mt-1 md:hidden"
              >
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {message && (
                <span className="hidden max-w-md truncate rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 text-[10px] text-cyan-100 md:block">
                  {message}
                </span>
              )}
              <button
                disabled={!setup?.ready}
                onClick={onClose}
                className="rounded-xl border border-white/5 bg-white/[.03] p-2 text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X size={17} />
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 sm:p-7">
            {loading ? (
              <div className="grid h-full place-items-center">
                <LoaderCircle className="animate-spin text-cyan-400" />
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="mx-auto max-w-4xl space-y-4"
                >
                  {panels[active]}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </main>
      </motion.div>
      <AnimatePresence>
        {wizardStep >= 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 grid place-items-center bg-[#02030a]/90 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-3xl overflow-hidden rounded-[26px] border border-cyan-500/20 bg-[#090c18] shadow-2xl"
            >
              <div className="h-1 bg-white/5">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 transition-all"
                  style={{ width: `${((wizardStep + 1) / 7) * 100}%` }}
                />
              </div>
              <div className="border-b border-white/5 px-7 py-5">
                <p className="text-[9px] uppercase tracking-[.25em] text-cyan-400">
                  Setup {wizardStep + 1} of 7
                </p>
                <h2 className="mt-1 text-lg text-white">
                  {wizardTitles[wizardStep]}
                </h2>
              </div>
              <div className="max-h-[65vh] overflow-y-auto p-7">
                {wizardContent[wizardStep]}
              </div>
              <div className="flex items-center justify-between border-t border-white/5 px-7 py-5">
                <Button
                  tone="slate"
                  disabled={wizardStep === 0}
                  onClick={() => setWizardStep(Math.max(0, wizardStep - 1))}
                >
                  Back
                </Button>
                {wizardStep < 6 ? (
                  <Button onClick={() => setWizardStep(wizardStep + 1)}>
                    Continue
                  </Button>
                ) : (
                  <Button
                    disabled={!setup?.providers.gemini.validated}
                    onClick={finishSetup}
                  >
                    <CheckCircle2 size={13} /> Finish setup
                  </Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-[#0b0d17] p-6"
            >
              <AlertTriangle className="text-rose-400" />
              <h3 className="mt-4 text-base font-semibold text-white">
                {confirm.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {confirm.body}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button tone="slate" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  tone="rose"
                  onClick={async () => {
                    const action = confirm;
                    setConfirm(null);
                    try {
                      await action.run();
                      notify("Action completed.");
                    } catch (error) {
                      notify(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  }}
                >
                  Confirm
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
