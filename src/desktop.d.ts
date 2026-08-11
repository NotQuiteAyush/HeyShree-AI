export {};

declare global {
  interface Window {
    shreeDesktop?: {
      platform: string;
      backendToken: string;
      version(): Promise<string>;
      setLaunchAtLogin(enabled: boolean): Promise<boolean>;
      getLaunchAtLogin(): Promise<boolean>;
      showNotification(title: string, body: string): Promise<boolean>;
      bringToForegroundOnWake(): Promise<boolean>;
      minimizeToTray(): Promise<boolean>;
      openExternal(url: string): Promise<boolean>;
      setEmergencyShortcut(accelerator: string): Promise<string>;
      setCompanionShortcut(accelerator: string): Promise<string>;
      openMain(section?: "chat" | "settings" | "updates" | "memory" | "reminders"): Promise<boolean>;
      showCompanion(): Promise<boolean>;
      showCompanionContextMenu(): Promise<boolean>;
      setCompanionClickThrough(enabled: boolean): Promise<boolean>;
      toggleCompanionSession(): Promise<boolean>;
      getCompanionSessionState(): Promise<{state:"idle"|"connecting"|"listening"|"thinking"|"speaking"|"working"|"success"|"error"|"reminder";audioLevel:number;muted:boolean;caption:string;captionRole:"user"|"model"|null}>;
      reportCompanionSessionState(state: {state:string;audioLevel:number;muted:boolean;caption?:string;captionRole?:"user"|"model"|null}): Promise<boolean>;
      startCompanionDrag(): Promise<boolean>;
      endCompanionDrag(): Promise<boolean>;
      getPreferences(): Promise<Record<string, unknown>>;
      updatePreferences(values: Record<string, unknown>): Promise<{ preferences: Record<string, unknown>; restart_required: boolean }>;
      clearCache(): Promise<boolean>;
      getUpdateState(): Promise<import("./updateTypes").UpdateState | null>;
      checkForUpdates(): Promise<unknown>;
      downloadUpdate(background?: boolean): Promise<import("./updateTypes").UpdateState>;
      cancelUpdateDownload(): Promise<boolean>;
      installUpdate(): Promise<import("./updateTypes").UpdateState>;
      remindUpdateLater(): Promise<import("./updateTypes").UpdateState>;
      skipUpdateVersion(): Promise<import("./updateTypes").UpdateState>;
      setUpdateChannel(channel: "stable" | "beta" | "alpha"): Promise<import("./updateTypes").UpdateState>;
      restart(): Promise<boolean>;
      getMobileFirewallStatus(): Promise<{ supported: boolean; allowed: boolean; port: number }>;
      allowMobileFirewall(): Promise<{ supported: boolean; allowed: boolean; port: number }>;
      onOpenSettings(listener: (payload?: {section?: "settings"|"updates"}) => void): () => void;
      onOpenMemory(listener: () => void): () => void;
      onOpenReminders(listener: () => void): () => void;
      onCompanionToggleSession(listener: () => void): () => void;
      onCompanionSessionState(listener: (state: {state:"idle"|"connecting"|"listening"|"thinking"|"speaking"|"working"|"success"|"error"|"reminder";audioLevel:number;muted:boolean;caption:string;captionRole:"user"|"model"|null}) => void): () => void;
      onCompanionPreferences(listener: (preferences: Record<string,unknown>) => void): () => void;
      onEmergencyStop(listener: () => void): () => void;
      onReminderDue(listener: (payload: { reminder: { id: string; text: string; due_at: string; recurrence?: string | null; urgent: boolean; completed: boolean }; announce: boolean; language: "Auto" | "English" | "Hindi" }) => void): () => void;
      onBackendState(listener: (state: { online: boolean; code?: number }) => void): () => void;
      onUpdateState(listener: (state: import("./updateTypes").UpdateState) => void): () => void;
      onPrepareUpdate(listener: (payload: { version: string | null }) => void): () => void;
    };
  }
}
