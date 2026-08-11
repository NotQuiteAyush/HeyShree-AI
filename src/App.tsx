import { useState, useEffect, useRef } from "react";
import { AssistantState, TranscriptLine, Memory } from "./types";
import { AudioStreamer } from "./lib/AudioStreamer";
import { AudioPlayer } from "./lib/AudioPlayer";
import { WaveformVisualizer } from "./components/WaveformVisualizer";
import { HologramAvatar } from "./components/HologramAvatar";
import { MemoryBrain } from "./components/MemoryBrain";
import { DesktopSettings } from "./components/DesktopSettings";
import { UpdatePrompt } from "./components/UpdatePrompt";
import type { UpdateState } from "./updateTypes";
import { apiFetch, liveWebSocketUrl } from "./lib/api";
import { mergeTranscriptFragments } from "./lib/transcript";
import { toLatinDisplayText } from "./lib/latinText";
import { VoiceConversationController, type VoiceConversationPhase } from "./lib/VoiceConversationController";
import { applyAppearance, defaultSettings, type SetupStatus, type ShreeSettings } from "./settingsTypes";
import shreeMark from "./assets/branding/shree-mark.png";
import {
  Mic,
  Power,
  Volume2,
  Sparkles,
  AlertTriangle,
  History,
  X,
  Cpu,
  Brain,
  CloudMoon,
  CloudSun,
  Settings,
  Wrench,
  Plus,
  Check,
  Trash2,
  Circle,
  List,
  OctagonX,
  SendHorizontal,
  PictureInPicture2,
} from "lucide-react";

// Inline styled sound-reactive, animated neon-pink waveform helper
const DecorativeWaveform = () => (
  <div className="flex items-center gap-[3px] h-8 my-2 select-none">
    {Array.from({ length: 32 }).map((_, i) => {
      const height = 4 + Math.sin(i * 0.45) * 22 * (0.4 + Math.random() * 0.6);
      return (
        <div 
          key={i} 
          className="w-[2px] bg-gradient-to-t from-fuchsia-500 to-pink-400 rounded-full opacity-80 animate-pulse" 
          style={{ 
            height: `${height}px`,
            animationDelay: `${i * 25}ms`,
            animationDuration: `${0.5 + (i % 3) * 0.25}s`
          }} 
        />
      );
    })}
  </div>
);

type ReminderRecurrence = "daily" | "weekly" | "monthly" | "yearly" | "weekdays";
interface ReminderRecord {
  id: string;
  text: string;
  urgent: boolean;
  completed: boolean;
  due_at?: string | null;
  recurrence?: ReminderRecurrence | null;
  notified_at?: string | null;
  timestamp: string;
}

const withReminderTimestamp = (item: Omit<ReminderRecord, "timestamp"> | ReminderRecord): ReminderRecord => ({
  ...item,
  timestamp: item.due_at ? `@ ${new Date(item.due_at).toLocaleString()}` : "Unscheduled",
});

const defaultReminderDateTime = () => {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

// High-fidelity keyframe-animated multi-layered SVG neural wave graph helper
const MemoryStatusGraph = () => {
  return (
    <div className="relative w-full h-24 bg-[#030611]/45 border border-white/5 rounded-xl overflow-hidden p-2 select-none">
      <style>{`
        @keyframes wave-slow {
          0%, 100% { d: path("M 0 50 C 50 30, 100 70, 150 45 C 200 20, 250 65, 300 45 L 300 80 L 0 80 Z"); }
          50% { d: path("M 0 45 C 60 50, 110 35, 160 55 C 210 75, 260 40, 300 50 L 300 80 L 0 80 Z"); }
        }
        @keyframes wave-medium {
          0%, 100% { d: path("M 0 55 C 60 70, 120 30, 180 55 C 240 80, 270 40, 300 60 L 300 80 L 0 80 Z"); }
          50% { d: path("M 0 65 C 50 40, 110 60, 170 40 C 230 20, 260 65, 300 50 L 300 80 L 0 80 Z"); }
        }
        @keyframes wave-fast {
          0%, 100% { d: path("M 0 60 C 40 40, 90 55, 140 40 C 190 25, 240 60, 300 50 L 300 80 L 0 80 Z"); }
          50% { d: path("M 0 50 C 50 60, 100 40, 150 55 C 200 70, 250 45, 300 55 L 300 80 L 0 80 Z"); }
        }
      `}</style>

      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:12px_12px] opacity-70 pointer-events-none" />
      
      {/* Wave SVG */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 80" preserveAspectRatio="none">
        {/* Wave 1: Cyan */}
        <path
          d="M 0 50 C 50 30, 100 70, 150 45 C 200 20, 250 65, 300 45 L 300 80 L 0 80 Z"
          fill="url(#gradient-cyan)"
          opacity="0.3"
          style={{ animation: "wave-slow 8s infinite ease-in-out" }}
        />
        {/* Wave 2: Pink/Magenta */}
        <path
          d="M 0 55 C 60 70, 120 30, 180 55 C 240 80, 270 40, 300 60 L 300 80 L 0 80 Z"
          fill="url(#gradient-pink)"
          opacity="0.25"
          style={{ animation: "wave-medium 6s infinite ease-in-out" }}
        />
        {/* Wave 3: Emerald */}
        <path
          d="M 0 60 C 40 40, 90 55, 140 40 C 190 25, 240 60, 300 50 L 300 80 L 0 80 Z"
          fill="url(#gradient-emerald)"
          opacity="0.2"
          style={{ animation: "wave-fast 4s infinite ease-in-out" }}
        />

        {/* Line 1: Cyan Border */}
        <path
          d="M 0 50 C 50 30, 100 70, 150 45 C 200 20, 250 65, 300 45"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.2"
          style={{ animation: "wave-slow 8s infinite ease-in-out" }}
          className="filter drop-shadow-[0_0_2px_rgba(34,211,238,0.4)]"
        />
        {/* Line 2: Pink Border */}
        <path
          d="M 0 55 C 60 70, 120 30, 180 55 C 240 80, 270 40, 300 60"
          fill="none"
          stroke="#f472b6"
          strokeWidth="1.2"
          style={{ animation: "wave-medium 6s infinite ease-in-out" }}
          className="filter drop-shadow-[0_0_2px_rgba(244,114,182,0.4)]"
        />

        {/* Gradients */}
        <defs>
          <linearGradient id="gradient-cyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gradient-pink" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d946ef" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#d946ef" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gradient-emerald" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

export default function App() {
  const [assistantState, setAssistantState] = useState<AssistantState>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Transcriptions & captions
  const [currentCaption, setCurrentCaption] = useState<string>("");
  const [captionRole, setCaptionRole] = useState<"user" | "model" | null>(null);
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptLine[]>([
    {
      id: "init-1",
      role: "model",
      text: "Hey! I'm here. What's on your mind?",
      timestamp: new Date()
    }
  ]);

  // Interactive reminders checklist interface & state
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Array<Omit<ReminderRecord,"timestamp">>>("/api/reminders")
      .then(items => setReminders(items.map(withReminderTimestamp)))
      .catch(error => console.error("Failed to load reminders", error));
  }, []);

  const [newReminderText, setNewReminderText] = useState("");
  const [newReminderDueAt, setNewReminderDueAt] = useState("");
  const [newReminderRecurrence, setNewReminderRecurrence] = useState<"none" | ReminderRecurrence>("none");
  const [isUrgent, setIsUrgent] = useState(false);
  const [showNewReminderInput, setShowNewReminderInput] = useState(false);

  const addReminder = async () => {
    if (!newReminderText.trim()) return;
    if (!newReminderDueAt) { setErrorMessage("Choose a date and time for the reminder."); return; }
    const dueAt = new Date(newReminderDueAt);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() < Date.now() - 5_000) { setErrorMessage("Choose a valid future reminder time."); return; }
    const isUrgentWord = isUrgent || newReminderText.toLowerCase().includes("urgent") || newReminderText.toLowerCase().includes("milk");
    const created = await apiFetch<Omit<ReminderRecord,"timestamp">>("/api/reminders", {method:"POST", body: JSON.stringify({text:newReminderText, due_at:dueAt.toISOString(), recurrence:newReminderRecurrence === "none" ? null : newReminderRecurrence, urgent:isUrgentWord})});
    setReminders(current => [...current, withReminderTimestamp(created)]);
    setNewReminderText("");
    setNewReminderDueAt("");
    setNewReminderRecurrence("none");
    setIsUrgent(false);
    setShowNewReminderInput(false);
    setErrorMessage(null);
  };

  const toggleReminder = async (id: string) => {
    const current = reminders.find(r => r.id === id);
    if (!current) return;
    const updated = await apiFetch<ReminderRecord>(`/api/reminders/${id}`, {method:"PATCH", body:JSON.stringify({completed:!current.completed})});
    setReminders(items => items.map(r => r.id === id ? {...r, completed:updated.completed} : r));
  };

  const deleteReminder = async (id: string) => {
    if (deletingReminderId) return;
    setDeletingReminderId(id);
    try {
      await apiFetch(`/api/reminders/${id}`, {method:"DELETE"});
      setReminders(items => items.filter(r => r.id !== id));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(`Reminder could not be deleted: ${error instanceof Error ? error.message : String(error)}`);
      apiFetch<Array<Omit<ReminderRecord,"timestamp">>>("/api/reminders")
        .then(items => setReminders(items.map(withReminderTimestamp)))
        .catch(() => undefined);
    } finally {
      setDeletingReminderId(null);
    }
  };
  
  // UI Panels
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [setupReady, setSetupReady] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<ShreeSettings>(defaultSettings);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const dialogueScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stream = dialogueScrollRef.current;
      if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [transcriptHistory, currentCaption, assistantState]);

  useEffect(() => {
    Promise.all([apiFetch<{values:ShreeSettings}>("/api/settings"), apiFetch<SetupStatus>("/api/setup/status")])
      .then(([response, status]) => {
        const loaded = {...defaultSettings, ...response.values};
        setRuntimeSettings(loaded); applyAppearance(loaded); setSetupReady(status.ready);
        if (status.requires_setup) setShowSettingsPanel(true);
      })
      .catch(error => { setErrorMessage(error instanceof Error ? error.message : String(error)); setShowSettingsPanel(true); });
    return window.shreeDesktop?.onOpenSettings(() => setShowSettingsPanel(true));
  }, []);

  useEffect(() => window.shreeDesktop?.onOpenMemory(() => {
    setShowHistoryPanel(false);
    setShowMemoryPanel(true);
  }), []);

  useEffect(() => window.shreeDesktop?.onOpenReminders(() => {
    setShowNewReminderInput(true);
    setNewReminderDueAt((current) => current || defaultReminderDateTime());
    setTimeout(() => document.getElementById("shree-reminders")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }), []);

  const closeSettings = async () => {
    const [response,status] = await Promise.all([apiFetch<{values:ShreeSettings}>("/api/settings"),apiFetch<SetupStatus>("/api/setup/status")]);
    const loaded={...defaultSettings,...response.values}; setRuntimeSettings(loaded);applyAppearance(loaded);setSetupReady(status.ready);setShowSettingsPanel(false);
  };

  useEffect(() => window.shreeDesktop?.onEmergencyStop(() => {
    cleanupSession();
    setAssistantState("disconnected");
    setErrorMessage("Emergency stop activated. Active desktop automation was cancelled.");
  }), []);

  useEffect(() => {
    window.shreeDesktop?.getUpdateState().then(setUpdateState);
    const removeState=window.shreeDesktop?.onUpdateState(setUpdateState);
    const removePrepare=window.shreeDesktop?.onPrepareUpdate(()=>{
      cleanupSession();
      setAssistantState("disconnected");
    });
    return()=>{removeState?.();removePrepare?.();};
  }, []);

  const emergencyStop = async () => {
    try {
      await apiFetch("/api/tools/emergency-stop", { method: "POST" });
      cleanupSession();
      setAssistantState("disconnected");
      setErrorMessage("Emergency stop activated. Active desktop automation was cancelled.");
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)); }
  };

  // Stored memories
  const [memories, setMemories] = useState<Memory[]>([]);

  // Load memories on initial page mount
  useEffect(() => {
    apiFetch<Memory[]>("/api/memories")
      .then((data) => setMemories(data))
      .catch((err) => console.error("Error loading memories on mount:", err));
  }, []);

  // Handle forgetting a memory
  const handleForgetMemory = async (category: Memory["category"], content: string) => {
    const requested = await apiFetch<any>("/api/tools/execute", {method:"POST", body:JSON.stringify({action:"delete_memory",arguments:{category,content}})});
    if (requested.status !== "confirmation_required" || !requested.confirmation?.token) {
      throw new Error(requested.human_response || "Memory deletion did not produce a confirmation request.");
    }
    const result = await apiFetch<any>(`/api/tools/confirm/${requested.confirmation.token}`, {method:"POST",body:JSON.stringify({approved:true})});
    if (result.status !== "completed") throw new Error(result.human_response || "Memory deletion was not completed.");
    setMemories(await apiFetch<Memory[]>("/api/memories"));
  };

  const handleRememberMemory = async (
    category: Memory["category"], content: string, importance: Memory["importance"], pinned: boolean,
  ) => {
    await apiFetch<Memory>("/api/memories", {
      method: "POST",
      body: JSON.stringify({ category, content, importance, pinned }),
    });
    setMemories(await apiFetch<Memory[]>("/api/memories"));
  };

  // Audio Analysers for the Waveform Canvas
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  // Sound-reactive audio volume driver for custom waveforms
  const [audioVolume, setAudioVolume] = useState<number>(0);

  useEffect(() => {
    const analyser = assistantState === "listening" ? inputAnalyser : assistantState === "speaking" ? outputAnalyser : null;
    if (!analyser) {
      setAudioVolume(0);
      return;
    }

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let active = true;
    
    const update = () => {
      if (!active) return;
      analyser.getByteTimeDomainData(buffer);
      let maxDeviation = 0;
      for (let i = 0; i < buffer.length; i++) {
        const dev = Math.abs(buffer[i] - 128);
        if (dev > maxDeviation) maxDeviation = dev;
      }
      const normalized = Math.min(1, maxDeviation / 64);
      setAudioVolume(normalized);
      requestAnimationFrame(update);
    };

    update();
    return () => {
      active = false;
    };
  }, [assistantState, inputAnalyser, outputAnalyser]);

  // Refs for managing callbacks and live instances without stale closure bugs
  const socketRef = useRef<WebSocket | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const stateRef = useRef<AssistantState>("disconnected");
  const captionTimeoutRef = useRef<any>(null);
  const pendingUserTranscriptRef = useRef("");
  const sessionGenerationRef = useRef(0);
  const sessionStartingRef = useRef(false);
  const pendingTextCommandsRef = useRef<string[]>([]);
  const voiceControllerRef = useRef<VoiceConversationController | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoiceConversationPhase>("sleeping");
  const [textCommand, setTextCommand] = useState("");

  useEffect(() => {
    playerRef.current?.setVolume(runtimeSettings.floating_voice_volume);
  }, [runtimeSettings.floating_voice_volume]);

  useEffect(() => {
    const controller = voiceControllerRef.current;
    if (!controller) return;
    controller.configure(
      runtimeSettings.auto_sleep_enabled,
      runtimeSettings.auto_sleep_timeout_seconds,
      runtimeSettings.wake_word_enabled,
    );
    if (!runtimeSettings.wake_word_enabled && controller.sleeping) {
      controller.wake();
      setVoicePhase(controller.state);
      socketRef.current?.send(JSON.stringify({ type: "voice_mode", mode: "active" }));
    }
  }, [runtimeSettings.auto_sleep_enabled, runtimeSettings.auto_sleep_timeout_seconds, runtimeSettings.wake_word_enabled]);

  // Maintain state ref for audio callbacks
  useEffect(() => {
    stateRef.current = assistantState;
  }, [assistantState]);

  const commitPendingUserTranscript = () => {
    const text = toLatinDisplayText(pendingUserTranscriptRef.current.trim());
    pendingUserTranscriptRef.current = "";
    if (!text) return;
    setCurrentCaption(text);
    setCaptionRole("user");
    setTranscriptHistory(previous => [...previous, {
      id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      role: "user",
      timestamp: new Date(),
    }]);
  };

  const bufferUserTranscript = (text: string) => {
    pendingUserTranscriptRef.current = mergeTranscriptFragments(pendingUserTranscriptRef.current, toLatinDisplayText(text));
    // Input transcription is incremental and pauses between words can exceed
    // hundreds of milliseconds. Show the merged live caption immediately, but
    // create a history row only when Gemini starts its reply or completes the
    // turn. A silence timer split one spoken command into several YOU rows.
    setCurrentCaption(pendingUserTranscriptRef.current);
    setCaptionRole("user");
  };

  useEffect(() => window.shreeDesktop?.onReminderDue((payload) => {
    const reminderText = toLatinDisplayText(`Reminder: ${payload.reminder.text}`);
    console.info("Reminder due received", payload.reminder.id, { announce: payload.announce });
    setCurrentCaption(reminderText);
    setCaptionRole("model");
    setTranscriptHistory(previous => [...previous, {
      id: `reminder-${payload.reminder.id}-${Date.now()}`,
      role: "model",
      text: reminderText,
      timestamp: new Date(),
    }]);
    apiFetch<Array<Omit<ReminderRecord,"timestamp">>>("/api/reminders")
      .then(items => setReminders(items.map(withReminderTimestamp)))
      .catch(error => console.error("Failed to refresh reminders after notification", error));
    if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
    captionTimeoutRef.current = setTimeout(() => {
      setCurrentCaption("");
      setCaptionRole(null);
    }, 8000);
    // Windows speech synthesis has a different timbre from Gemini's Achernar
    // voice. Never let both voice engines speak during the same live session.
    if (payload.announce && stateRef.current === "disconnected" && "speechSynthesis" in window) {
      playerRef.current?.stopAll();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(reminderText);
      utterance.lang = payload.language === "Hindi" ? "hi-IN" : "en-IN";
      const languagePrefix = utterance.lang.slice(0, 2).toLowerCase();
      utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith(languagePrefix)) || null;
      utterance.rate = 0.95;
      utterance.volume = Math.max(0, Math.min(1, runtimeSettings.floating_voice_volume / 100));
      window.speechSynthesis.speak(utterance);
    }
  }), []);

  // Handle active session cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, []);

  const cleanupSession = () => {
    sessionGenerationRef.current += 1;
    sessionStartingRef.current = false;
    if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
    pendingUserTranscriptRef.current = "";
    voiceControllerRef.current?.destroy();
    voiceControllerRef.current = null;
    
    if (streamerRef.current) {
      streamerRef.current.stop();
      streamerRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setInputAnalyser(null);
    setOutputAnalyser(null);
  };

  const startSession = async (options: { wakeOnly?: boolean } = {}) => {
    if (!setupReady) {
      setErrorMessage("Complete Settings and validate the required Gemini API key before starting Shree.");
      setShowSettingsPanel(true);
      return;
    }
    const existingSocket = socketRef.current;
    if (
      sessionStartingRef.current
      || existingSocket?.readyState === WebSocket.CONNECTING
      || existingSocket?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    cleanupSession();
    sessionStartingRef.current = true;
    const sessionGeneration = ++sessionGenerationRef.current;
    setErrorMessage(null);
    setAssistantState("connecting");
    setCurrentCaption("Waking up Shree...");
    setCaptionRole("model");

    try {
      // Connect to full-stack websocket endpoint on server.ts
      const wsUrl = liveWebSocketUrl();
      console.log("Connecting to the local SHREE voice service.");
      
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;
      const initiallySleeping = Boolean(options.wakeOnly && runtimeSettings.wake_word_enabled);
      const voiceController = new VoiceConversationController({
        wakeWordEnabled: runtimeSettings.wake_word_enabled,
        initiallySleeping,
        autoSleepEnabled: runtimeSettings.auto_sleep_enabled,
        timeoutSeconds: runtimeSettings.auto_sleep_timeout_seconds,
        onSleep: () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "voice_mode", mode: "sleeping" }));
          playerRef.current?.stopAll();
          streamerRef.current?.setPlaybackActive(false);
          streamerRef.current?.setWakeWordMode(true);
          setVoicePhase("sleeping");
          setAssistantState("listening");
          setCurrentCaption('Waiting for "Shree"');
          setCaptionRole("model");
        },
      });
      voiceControllerRef.current = voiceController;
      setVoicePhase(voiceController.state);

      ws.onopen = () => {
        if (sessionGeneration !== sessionGenerationRef.current) {
          ws.close();
          return;
        }
        console.log("WebSocket connected to backend. Waiting for live context setup...");
      };

      ws.onmessage = async (event) => {
        if (sessionGeneration !== sessionGenerationRef.current) return;
        try {
          const data = JSON.parse(event.data);

          // 0. Handle session disconnected state
          if (data.state === "disconnected") {
            console.log("Gemini session was disconnected by the server.");
            stopSession("Session ended. Tap to restart!");
            return;
          }

          // Handle server-side ping
          if (data.type === "ping") {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            return;
          }

          // 1. Session established and ready
          if (data.state === "connected") {
            sessionStartingRef.current = false;
            console.log("Gemini session ready. Starting audio pipelines...");
            setAssistantState("listening");
            setCurrentCaption(initiallySleeping ? 'Waiting for "Shree"' : "Shree is online. Talk to her!");
            setCaptionRole("model");
            ws.send(JSON.stringify({ type: "voice_mode", mode: initiallySleeping ? "sleeping" : "active" }));

            // Sync current reminders list to the server right away on connect
            ws.send(JSON.stringify({
              type: "reminders_sync",
              reminders: reminders
            }));

            // Setup audio playback first so we are ready to output
            const player = new AudioPlayer(
              (analyser) => {
                setOutputAnalyser(analyser);
              },
              (isPlaying) => {
                streamerRef.current?.setPlaybackActive(isPlaying);
                // Return to listening state when Shree finishes talking
                if (!isPlaying && voiceControllerRef.current?.state === "speaking") {
                  setAssistantState("listening");
                  voiceControllerRef.current?.waitForUser();
                  setVoicePhase(voiceControllerRef.current?.state || "waiting_for_user");
                }
              },
              runtimeSettings.audio_output_device_id,
              runtimeSettings.floating_voice_volume,
            );
            playerRef.current = player;

            // Setup microphone recording streamer
            const streamer = new AudioStreamer(
              (base64Audio) => {
                // Forward recorded PCM16 chunk to server WS
                if (ws.readyState === WebSocket.OPEN && stateRef.current !== "disconnected") {
                  ws.send(JSON.stringify({ audio: base64Audio }));
                }
              },
              (analyser) => {
                setInputAnalyser(analyser);
              },
              runtimeSettings.audio_input_device_id,
              (message) => {
                if (message) {
                  console.error("Microphone stream problem:", message);
                  setErrorMessage(message);
                } else {
                  setErrorMessage(null);
                }
              },
              () => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "audio_stream_end" }));
                }
              },
              () => {
                const controller = voiceControllerRef.current;
                if (!controller || controller.sleeping) return;
                controller.markGenuineSpeech();
                setVoicePhase(controller.state);
              },
              () => voiceControllerRef.current?.markPotentialSpeech(),
              () => voiceControllerRef.current?.markRejectedNoise(),
            );
            
            streamerRef.current = streamer;
            streamer.setWakeWordMode(initiallySleeping);
            const pendingCommands = pendingTextCommandsRef.current.splice(0);
            for (const command of pendingCommands) {
              if (ws.readyState !== WebSocket.OPEN) break;
              ws.send(JSON.stringify({type:"text_input",text:command}));
            }
            try {
              await streamer.start();
            } catch (error) {
              console.error("Could not start the selected microphone:", error);
              setErrorMessage(
                "SHREE connected, but the microphone could not start. Check Windows microphone permission and the selected input device in Settings.",
              );
              stopSession("Microphone unavailable. Open Settings to select another input.");
            }
          }

          if (data.type === "session_rotating") {
            console.log("Gemini session is rotating before its duration limit.", data.time_left);
            setAssistantState("connecting");
            setCurrentCaption("Refreshing Shree's live connection...");
            setCaptionRole("model");
            playerRef.current?.stopAll();
          }

          if (data.type === "connection_retry") {
            setAssistantState("connecting");
            setCurrentCaption(`Gemini is taking longer to connect. Retrying (${data.attempt}/${data.max_attempts})...`);
            setCaptionRole("model");
          }

          if (data.type === "model_fallback") {
            setAssistantState("connecting");
            setCurrentCaption(data.message || "Switching to a compatible Gemini Live model...");
            setCaptionRole("model");
            setErrorMessage(null);
          }

          if (data.type === "session_resumed") {
            console.log("Gemini session resumed.", data.context_restored);
            setAssistantState("listening");
            setCurrentCaption(data.context_restored ? "Live connection refreshed. Conversation restored." : "Live connection refreshed.");
            setCaptionRole("model");
          }

          // 2. Received response audio chunk (24kHz)
          if (data.audio) {
            if (voiceControllerRef.current?.sleeping) return;
            voiceControllerRef.current?.markSpeaking();
            setVoicePhase(voiceControllerRef.current?.state || "speaking");
            setAssistantState("speaking");
            streamerRef.current?.setPlaybackActive(true);
            if (playerRef.current) {
              playerRef.current.playChunk(data.audio);
            }
          }

          // 3. User voice interruption (VAD)
          if (data.interrupted) {
            console.log("Shree interrupted by user.");
            setAssistantState("listening");
            if (playerRef.current) {
              playerRef.current.stopAll();
            }
            streamerRef.current?.setPlaybackActive(false);
            voiceControllerRef.current?.markGenuineSpeech();
            setVoicePhase(voiceControllerRef.current?.state || "listening");
          }

          if (data.type === "wake_accepted") {
            if (voiceControllerRef.current?.wake()) {
              void window.shreeDesktop?.bringToForegroundOnWake();
              streamerRef.current?.setWakeWordMode(false);
              setVoicePhase("listening");
              setAssistantState("listening");
              setCurrentCaption("Listening...");
              setCaptionRole("model");
            }
            return;
          }

          if (data.type === "wake_duplicate_ignored") {
            console.info("[WakeWord] Duplicate ignored by server");
            return;
          }

          if (data.type === "voice_state" && data.state === "sleeping") {
            setVoicePhase("sleeping");
            return;
          }

          if (data.type === "session_replaced") {
            playerRef.current?.stopAll();
            streamerRef.current?.setPlaybackActive(false);
            stopSession(data.message || "Voice moved to another SHREE device.");
            return;
          }

          // 4. Transcription captures
          if (data.text) {
            const displayText = toLatinDisplayText(String(data.text));
            if (data.role === "user") {
              voiceControllerRef.current?.markThinking();
              setVoicePhase(voiceControllerRef.current?.state || "thinking");
              bufferUserTranscript(displayText);
              return;
            }
            commitPendingUserTranscript();
            if (voiceControllerRef.current?.sleeping) return;
            setCurrentCaption(displayText);
            setCaptionRole(data.role);

            // Add to transcript log
            setTranscriptHistory((prev) => {
              const lastLine = prev[prev.length - 1];
              const lastTimestamp = lastLine && (lastLine.timestamp instanceof Date ? lastLine.timestamp : new Date(lastLine.timestamp));
              // If the last line belongs to the same role, append to it for readability
              if (lastLine && lastLine.role === data.role && lastTimestamp && (Date.now() - lastTimestamp.getTime() < 10000)) {
                return [
                  ...prev.slice(0, -1),
                  { ...lastLine, text: lastLine.text + " " + displayText },
                ];
              } else {
                return [
                  ...prev,
                  {
                    id: Math.random().toString(36).substr(2, 9),
                    text: displayText,
                    role: data.role,
                    timestamp: new Date(),
                  },
                ];
              }
            });

            // Fade out caption after a few seconds of silence
            if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
            captionTimeoutRef.current = setTimeout(() => {
              setCurrentCaption("");
              setCaptionRole(null);
            }, 6000);
          }

          if (data.type === "turn_complete") {
            commitPendingUserTranscript();
            const controller = voiceControllerRef.current;
            if (controller && controller.state !== "speaking") {
              controller.waitForUser();
              setVoicePhase(controller.state);
            }
          }

          // 5.5 Handle persistent memory syncing
          if (data.type === "memories_loaded" || data.type === "memories_updated") {
            setMemories(data.memories || []);
          }

          // 5.6 Sync reminders after a verified Gemini tool call
          if (data.type === "reminders_updated") {
            setReminders((data.reminders || []).map(withReminderTimestamp));
          }

          // 6. Handle backend errors
          if (data.error) {
            setErrorMessage(data.error);
            stopSession();
          }

        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onclose = () => {
        if (sessionGeneration !== sessionGenerationRef.current || socketRef.current !== ws) return;
        sessionStartingRef.current = false;
        console.log("WebSocket connection closed.");
        stopSession("Session ended. Tap to restart!");
      };

      ws.onerror = (err) => {
        if (sessionGeneration !== sessionGenerationRef.current || socketRef.current !== ws) return;
        sessionStartingRef.current = false;
        console.error("WebSocket error:", err);
        setErrorMessage("Websocket connection error. Please verify your server is running.");
        stopSession("Connection error. Tap to retry.");
      };

    } catch (err: any) {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      sessionStartingRef.current = false;
      console.error("Failed to connect:", err);
      setErrorMessage(err.message || "Failed to start Shree session.");
      stopSession("Failed to connect.");
    }
  };

  const submitTextCommand = async () => {
    const command = toLatinDisplayText(textCommand.trim());
    if (!command) return;
    setTextCommand("");
    setTranscriptHistory(previous => [...previous, {id:`typed-${Date.now()}`,role:"user",text:command,timestamp:new Date()}]);
    playerRef.current?.stopAll();
    voiceControllerRef.current?.wake();
    voiceControllerRef.current?.markThinking();
    setVoicePhase(voiceControllerRef.current?.state || "thinking");
    if (stateRef.current === "speaking") setAssistantState("listening");
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && stateRef.current !== "disconnected") {
      socket.send(JSON.stringify({type:"text_input",text:command}));
      return;
    }
    pendingTextCommandsRef.current.push(command);
    if (stateRef.current === "disconnected") await startSession();
  };

  const stopSession = (reason?: string) => {
    setAssistantState("disconnected");
    cleanupSession();
    if (reason) {
      setCurrentCaption(reason);
      setCaptionRole("model");
    } else {
      setCurrentCaption("");
      setCaptionRole(null);
    }
  };

  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const isNight = currentTime.getHours() >= 18 || currentTime.getHours() < 6;
  const weatherIcon = isNight ? (
    <CloudMoon className="text-[#6EE7FF] drop-shadow-[0_0_8px_rgba(110,231,255,0.6)] animate-pulse" size={38} />
  ) : (
    <CloudSun className="text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" size={38} />
  );
  const weatherText = isNight ? "Clear Night" : "Partly Cloudy";
  const weatherTemp = isNight ? "18°C" : "24°C";

  const toggleSession = () => {
    if (assistantState === "disconnected") {
      startSession();
    } else if (assistantState === "connecting") {
      return;
    } else if (voiceControllerRef.current?.sleeping) {
      voiceControllerRef.current.wake();
      streamerRef.current?.setWakeWordMode(false);
      setVoicePhase("listening");
      socketRef.current?.send(JSON.stringify({ type: "voice_mode", mode: "active" }));
      setCurrentCaption("Listening...");
      setCaptionRole("model");
    } else {
      if (runtimeSettings.wake_word_enabled && runtimeSettings.background_listening) {
        playerRef.current?.stopAll();
        streamerRef.current?.setPlaybackActive(false);
        voiceControllerRef.current?.sleepNow();
      } else {
        stopSession();
      }
    }
  };

  useEffect(() => {
    if (!setupReady || !runtimeSettings.wake_word_enabled || !runtimeSettings.background_listening || assistantState !== "disconnected") return;
    const retry = window.setTimeout(() => startSession({ wakeOnly: true }), 350);
    return () => window.clearTimeout(retry);
  }, [setupReady, runtimeSettings.wake_word_enabled, runtimeSettings.background_listening, assistantState]);

  useEffect(() => window.shreeDesktop?.onCompanionToggleSession(toggleSession), [assistantState, setupReady, runtimeSettings]);

  useEffect(() => {
    const companionState = assistantState === "disconnected" || voicePhase === "sleeping"
      ? (errorMessage ? "error" : "idle")
      : (assistantState === "listening" && captionRole === "user" ? "thinking" : assistantState);
    window.shreeDesktop?.reportCompanionSessionState({
      state: companionState,
      audioLevel: audioVolume,
      muted: assistantState === "disconnected",
      caption: currentCaption,
      captionRole,
    });
  }, [assistantState, voicePhase, audioVolume, captionRole, currentCaption, errorMessage]);

  return (
    <div className="h-screen bg-[#020203] text-[#f0f0f0] flex flex-col font-sans relative overflow-hidden select-none">
      
      {/* Atmospheric Background Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-cyan-900/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-purple-900/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[30%] left-[30%] w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Top minimal header bar with slideout triggers */}
      <header className="w-full px-6 pt-4 pb-2 flex items-center justify-between border-b border-white/5 bg-transparent z-35 shrink-0 select-none">
        <div className="flex items-center space-x-3">
          <img src={shreeMark} alt="Shree" className="h-7 w-7 object-contain drop-shadow-[0_0_10px_rgba(217,70,239,.35)]" />
          <div className={`w-1.5 h-1.5 rounded-full ${
            assistantState === "disconnected" ? "bg-slate-600" :
            assistantState === "connecting" ? "bg-amber-400 animate-ping" :
            "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"
          }`} />
          <span className="text-[10px] tracking-[0.25em] font-medium text-cyan-400 uppercase">
            {assistantState === "disconnected" ? "Offline" : voicePhase === "sleeping" ? 'Waiting for "Shree"' : "System Connected"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={emergencyStop} className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all flex items-center justify-center" title="Immediately stop all desktop automation" aria-label="Emergency stop">
            <OctagonX size={14} />
          </button>
          <button onClick={() => setShowSettingsPanel(true)} className="p-2 rounded-lg border border-cyan-500/15 bg-cyan-500/[.06] text-cyan-200 hover:bg-cyan-500/10 transition-all flex items-center justify-center" title="Settings (Ctrl+,)" aria-label="Settings">
            <img src={shreeMark} alt="" className="h-4 w-4 object-contain"/>
          </button>
          <button
            onClick={() => {
              setShowMemoryPanel(true);
              setShowHistoryPanel(false);
            }}
            className="p-1.5 rounded-lg border border-white/5 bg-white/5 text-slate-400 hover:text-[#6EE7FF] hover:bg-white/10 transition-all cursor-pointer"
            title="Shree Brain Core"
          >
            <Brain size={14} />
          </button>

          <button
            onClick={() => {
              setShowHistoryPanel(true);
              setShowMemoryPanel(false);
            }}
            className="p-1.5 rounded-lg border border-white/5 bg-white/5 text-slate-400 hover:text-[#6EE7FF] hover:bg-white/10 transition-all cursor-pointer"
            title="Conversation History"
          >
            <History size={14} />
          </button>
          
        </div>
      </header>

      {/* Immersive 3-Column Dashboard Container */}
      <main className="flex-1 w-full max-w-[1450px] mx-auto px-6 py-4 flex flex-col min-h-0 z-20 overflow-hidden">
        
        {/* Error notification banner */}
        {errorMessage && (
          <div className="w-full max-w-lg mx-auto p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 flex gap-3 text-xs text-rose-300 backdrop-blur-md mb-3 shrink-0 animate-float">
            <AlertTriangle className="shrink-0 text-rose-400" size={16} />
            <div className="flex-1">
              <h4 className="font-semibold text-rose-200">System Warning</h4>
              <p className="leading-relaxed mt-0.5">{errorMessage}</p>
              {errorMessage.toLowerCase().includes("quota") && (
                <button
                  onClick={() => {
                    setErrorMessage(null);
                    setShowSettingsPanel(true);
                  }}
                  className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-1.5 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-400/20"
                >
                  Open API Settings
                </button>
              )}
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-200"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 3-Column Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 overflow-hidden">
          
          {/* Left Column (Dialogue Stream & Tools) - col-span-3 */}
          <div className="lg:col-span-3 flex flex-col h-full min-h-0 gap-4">
            
            {/* Dialogue Stream Panel */}
            <div className="flex-1 min-h-0 flex flex-col bg-[#04060c]/45 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(110,231,255,0.01)] relative overflow-hidden">
              <div className="flex items-center justify-between mb-3 shrink-0 select-none">
                <div className="flex items-center space-x-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    assistantState === "disconnected" ? "bg-slate-600" : "bg-emerald-400 animate-pulse"
                  }`} />
                  <span className="text-[10px] font-mono tracking-wider font-semibold text-white/40 uppercase">Dialogue Stream</span>
                </div>
                <div className="px-1.5 py-0.5 rounded bg-cyan-500/5 border border-cyan-500/10 text-[8px] font-mono text-cyan-400 uppercase">
                  {assistantState === "disconnected" ? assistantState : voicePhase.replaceAll("_", " ")}
                </div>
              </div>

              {/* Scrollable message dialog list */}
              <div ref={dialogueScrollRef} className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1 scrollbar-thin scrollbar-thumb-white/5">
                {assistantState !== "disconnected" && (
                  <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/10 backdrop-blur-sm">
                    <span className="text-[9px] font-mono text-cyan-400 tracking-wider block uppercase mb-1">
                      {voicePhase === "sleeping" ? 'Waiting for "Shree"' : voicePhase === "thinking" ? "Thinking..." : assistantState === "listening" ? "Listening..." : "Speaking..."}
                    </span>
                    <DecorativeWaveform />
                    <span className="text-[8px] text-slate-500 font-mono">00:07</span>
                  </div>
                )}

                {transcriptHistory.map((line, idx) => (
                  <div key={line.id || idx} className="flex flex-col gap-1 border-b border-white/5 pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[9px] font-mono font-bold uppercase tracking-wider ${
                        line.role === "user" ? "text-fuchsia-400" : "text-cyan-400"
                      }`}>
                        {line.role === "user" ? "You" : "Shree"}
                      </span>
                      <span className="text-[8px] text-slate-600 font-mono">
                        {(line.timestamp instanceof Date ? line.timestamp : new Date(line.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed max-w-full">
                      {line.text}
                    </p>
                  </div>
                ))}
              </div>
              <form onSubmit={event=>{event.preventDefault();void submitTextCommand();}} className="mt-3 flex shrink-0 items-center gap-2 border-t border-white/5 pt-3">
                <input
                  value={textCommand}
                  onChange={event=>setTextCommand(event.target.value)}
                  maxLength={10000}
                  placeholder="Type a command for Shree…"
                  aria-label="Type a command for Shree"
                  className="min-w-0 flex-1 rounded-xl border border-white/5 bg-black/25 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/30"
                />
                <button type="submit" disabled={!textCommand.trim()} title="Send command" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-500/15 bg-cyan-500/10 text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-30">
                  <SendHorizontal size={14}/>
                </button>
              </form>
            </div>

            {/* Systems Quick Launcher Tools Grid */}
            <div className="shrink-0 bg-[#04060c]/45 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(110,231,255,0.01)] flex flex-col gap-3">
              <div className="flex items-center justify-between select-none">
                <span className="text-[10px] font-mono tracking-wider font-semibold text-white/40 uppercase">System Tools</span>
                <Wrench size={11} className="text-slate-500" />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => runtimeSettings.floating_mode_enabled
                    ? window.shreeDesktop?.showCompanion()
                    : setErrorMessage("Enable Floating Mode in Settings first.")}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-violet-300 hover:border-violet-400/25 hover:bg-violet-400/5 transition-all cursor-pointer"
                  title="Open Floating Companion"
                  aria-label="Open Floating Companion"
                >
                  <PictureInPicture2 size={16} />
                </button>

                <button
                  onClick={() => setShowSettingsPanel(true)}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-[#6EE7FF] hover:border-[#6EE7FF]/25 hover:bg-[#6EE7FF]/5 transition-all cursor-pointer"
                  title="Quantum Settings"
                >
                  <img src={shreeMark} alt="" className="h-5 w-5 object-contain" />
                </button>

                <button
                  onClick={() => {
                    setShowMemoryPanel(true);
                    setShowHistoryPanel(false);
                  }}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-[#6EE7FF] hover:border-[#6EE7FF]/25 hover:bg-[#6EE7FF]/5 transition-all cursor-pointer"
                  title="Brain Memory Status"
                >
                  <Brain size={16} />
                </button>

                <button
                  onClick={() => void (async () => {
                    cleanupSession();
                    setAssistantState("disconnected");
                    setCurrentCaption("");
                    setCaptionRole(null);
                    setTranscriptHistory([
                      { id: "init-1", role: "model", text: "Hey! I'm here. What's on your mind?", timestamp: new Date() }
                    ]);
                    try {
                      const [storedReminders, storedMemories] = await Promise.all([
                        apiFetch<Array<Omit<ReminderRecord,"timestamp">>>("/api/reminders"),
                        apiFetch<Memory[]>("/api/memories"),
                      ]);
                      setReminders(storedReminders.map(withReminderTimestamp));
                      setMemories(storedMemories);
                      setErrorMessage(null);
                    } catch (error) {
                      setErrorMessage(`Local data refresh failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                  })()}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-[#6EE7FF] hover:border-[#6EE7FF]/25 hover:bg-[#6EE7FF]/5 transition-all cursor-pointer"
                  title="Refresh Shree Data"
                >
                  <Wrench size={16} />
                </button>

                <button
                  onClick={() => {
                    setNewReminderDueAt(defaultReminderDateTime());
                    setShowNewReminderInput(true);
                  }}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-[#6EE7FF] hover:border-[#6EE7FF]/25 hover:bg-[#6EE7FF]/5 transition-all cursor-pointer"
                  title="Add Reminder"
                >
                  <Plus size={16} />
                </button>

                <button
                  onClick={() => {
                    setShowHistoryPanel(true);
                    setShowMemoryPanel(false);
                  }}
                  className="aspect-square rounded-xl bg-[#050711]/60 border border-white/5 flex flex-col items-center justify-center text-slate-400 hover:text-[#6EE7FF] hover:border-[#6EE7FF]/25 hover:bg-[#6EE7FF]/5 transition-all cursor-pointer"
                  title="View Full Dialog Logs"
                >
                  <History size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Center Column (Shree Core, Platform, and Recording Wave) - col-span-6 */}
          <div className="lg:col-span-6 flex flex-col h-full min-h-0 justify-between items-center py-2 relative">
            
            {/* Brand Title Block */}
            <div className="text-center select-none shrink-0 mb-2">
              <h1 className="text-2xl font-light tracking-[0.32em] text-cyan-400 filter drop-shadow-[0_0_12px_rgba(110,231,255,0.4)]">Shree</h1>
              <p className="mt-1 text-[9px] uppercase tracking-[0.24em] text-white/35 font-mono"><span className="text-fuchsia-300/80">Mark 12</span> · Your AI Companion</p>
            </div>

            {/* Main Holographic Capsule Area */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              <HologramAvatar
                state={assistantState}
                onClick={toggleSession}
                inputAnalyser={inputAnalyser}
                outputAnalyser={outputAnalyser}
              />
            </div>

            {/* Glowing Microphone Controls and symmetric horizontal pink waveform */}
            <div className="shrink-0 flex flex-col items-center justify-center w-full max-w-md mt-2 pb-2">
              
              <div className="flex items-center justify-center gap-6 w-full px-4 mb-2">
                {/* Left side wave */}
                <div className="flex items-center gap-[3px] h-8 flex-1 justify-end opacity-70">
                  {Array.from({ length: 18 }).map((_, i) => {
                    const activeHeight = 5 + Math.sin(i * 0.4) * 22 * audioVolume;
                    const restingHeight = 3 + Math.sin(i * 0.2) * 5;
                    const h = assistantState === "speaking" || assistantState === "listening" ? activeHeight : restingHeight;
                    return (
                      <div 
                        key={i} 
                        className="w-[2px] bg-gradient-to-t from-fuchsia-500 to-pink-400 rounded-full transition-all duration-150"
                        style={{ height: `${h}px` }}
                      />
                    );
                  })}
                </div>

                {/* Main micro button */}
                <button 
                  onClick={toggleSession}
                  className={`w-14 h-14 rounded-full flex items-center justify-center relative cursor-pointer border-4 border-fuchsia-500/20 shadow-[0_0_15px_rgba(217,70,239,0.3)] hover:shadow-[0_0_20px_rgba(217,70,239,0.5)] hover:scale-105 active:scale-95 transition-all duration-300 z-20 ${
                    voicePhase === "sleeping" ? "bg-[#090b17]" :
                    assistantState === "listening" ? "bg-fuchsia-600" : 
                    assistantState === "speaking" ? "bg-rose-500 animate-pulse" : 
                    assistantState === "connecting" ? "bg-purple-600 animate-bounce" :
                    "bg-[#090b17] hover:bg-[#11142a]"
                  }`}
                >
                  <Mic size={20} className="text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.7)]" />
                </button>

                {/* Right side wave */}
                <div className="flex items-center gap-[3px] h-8 flex-1 justify-start opacity-70">
                  {Array.from({ length: 18 }).map((_, i) => {
                    const activeHeight = 5 + Math.sin(i * 0.4) * 22 * audioVolume;
                    const restingHeight = 3 + Math.sin(i * 0.2) * 5;
                    const h = assistantState === "speaking" || assistantState === "listening" ? activeHeight : restingHeight;
                    return (
                      <div 
                        key={i} 
                        className="w-[2px] bg-gradient-to-t from-fuchsia-500 to-pink-400 rounded-full transition-all duration-150"
                        style={{ height: `${h}px` }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Subtitle / Caption Display */}
              <p className="text-[10px] font-mono tracking-wider text-slate-400 uppercase text-center animate-pulse min-h-[15px]">
                {currentCaption ? `"${currentCaption}"` : "Tap to speak or just talk..."}
              </p>
            </div>
          </div>

          {/* Right Column (System Status, Reminders Checklist, Neural Graph, Voice Indicator) - col-span-3 */}
          <div className="lg:col-span-3 flex flex-col h-full min-h-0 gap-4">
            
            <div className="flex items-center justify-between shrink-0 select-none px-1">
              <span className="text-[11px] font-mono tracking-[0.2em] font-semibold text-white/50 uppercase">System Status</span>
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/20" />
              </div>
            </div>

            {/* Weather & Time card */}
            <div className="shrink-0 bg-[#04060c]/45 backdrop-blur-md border border-white/5 rounded-2xl p-4 flex items-center space-x-4 shadow-[0_0_20px_rgba(110,231,255,0.01)]">
              <div className="flex-1 flex flex-col justify-center min-w-0">
                <span className="text-[8px] tracking-wider font-semibold text-white/40 uppercase font-mono">Time & Date</span>
                <span className="text-xl font-light text-white tracking-tight leading-none mt-2">
                  {formattedTime}
                </span>
                <span className="text-[9px] text-white/50 font-sans tracking-wide mt-2 leading-tight truncate">
                  {formattedDate}
                </span>
              </div>

              <div className="border-l border-white/5 h-10" />

              <div className="flex flex-col items-center justify-center text-center w-20 shrink-0">
                <span className="text-[8px] tracking-wider font-semibold text-white/40 uppercase font-mono mb-1">Weather</span>
                {weatherIcon}
                <span className="text-[8px] text-white/60 font-sans tracking-wide mt-1 leading-none truncate w-full">{weatherText}</span>
                <span className="text-[9px] font-semibold text-white mt-1 font-mono leading-none">{weatherTemp}</span>
              </div>
            </div>

            {/* Things to Remember - Reminders Checklist */}
            <div id="shree-reminders" className="flex-1 min-h-0 flex flex-col bg-[#04060c]/45 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(110,231,255,0.01)]">
              <div className="flex items-center justify-between mb-3 shrink-0 select-none">
                <div className="flex items-center space-x-2">
                  <List size={13} className="text-cyan-400" />
                  <span className="text-[10px] font-mono tracking-wider font-semibold text-white/40 uppercase">Things to Remember</span>
                </div>
                <span className="text-[9px] font-mono text-cyan-400/60 bg-cyan-500/5 px-2 py-0.5 rounded border border-cyan-500/10">
                  {reminders.filter(r => !r.completed).length} Pending
                </span>
              </div>

              {/* Scrollable checklists list with scrollbar-thin */}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-2.5 pr-1 scrollbar-thin">
                <div className="flex items-center gap-1.5 text-[9px] font-mono text-white/40 tracking-wider font-bold mb-1 border-b border-white/5 pb-1 select-none">
                  <Check size={9} className="text-cyan-400" /> *Reminders:
                </div>

                {reminders.map((rem) => (
                  <div 
                    key={rem.id} 
                    className={`p-2 rounded-xl border flex items-center justify-between gap-2.5 transition-all duration-300 ${
                      rem.completed 
                        ? "bg-slate-950/20 border-white/5 opacity-40" 
                        : rem.urgent 
                          ? "bg-rose-950/10 border-rose-500/20 shadow-[0_0_10px_rgba(239,68,68,0.02)]" 
                          : "bg-slate-950/40 border-white/5 hover:border-cyan-500/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button 
                        onClick={() => toggleReminder(rem.id)}
                        className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                          rem.completed 
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" 
                            : rem.urgent 
                              ? "border-rose-500/40 hover:border-rose-500 text-rose-400" 
                              : "border-white/20 hover:border-cyan-400 text-cyan-400"
                        }`}
                      >
                        {rem.completed && <Check size={10} />}
                      </button>
                      <span className={`text-xs truncate min-w-0 flex-1 ${
                        rem.completed ? "line-through text-slate-500 font-light" : "text-slate-200"
                      }`}>
                        {rem.text} {rem.urgent && <span className="text-[8px] font-bold text-rose-400 uppercase tracking-widest font-mono ml-1">(Urgent)</span>}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0 select-none">
                      <span className="text-[8px] text-slate-500 font-mono">{rem.timestamp}</span>
                      <button 
                        onClick={() => deleteReminder(rem.id)}
                        disabled={deletingReminderId === rem.id}
                        className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-30"
                        title="Remove reminder"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Inline New Reminder Form */}
                {showNewReminderInput ? (
                  <div className="flex flex-col gap-2 p-2 rounded-xl border border-dashed border-cyan-500/30 bg-cyan-950/5 animate-slide-in shrink-0">
                    <input type="text" placeholder="What should Shree remind you about?" value={newReminderText} onChange={(e) => setNewReminderText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReminder()} className="w-full bg-black/20 rounded-lg border border-white/5 outline-none text-xs text-slate-200 placeholder:text-slate-600 px-2 py-1.5 font-sans" autoFocus />
                    <input type="datetime-local" value={newReminderDueAt} onChange={(e) => setNewReminderDueAt(e.target.value)} className="w-full bg-black/20 rounded-lg border border-white/5 outline-none text-[10px] text-slate-300 px-2 py-1.5 [color-scheme:dark]" aria-label="Reminder date and time" />
                    <div className="flex items-center gap-1.5">
                      <select value={newReminderRecurrence} onChange={(e) => setNewReminderRecurrence(e.target.value as "none" | ReminderRecurrence)} className="min-w-0 flex-1 bg-black/20 rounded-lg border border-white/5 text-[9px] text-slate-300 px-1.5 py-1.5" aria-label="Reminder recurrence">
                        <option value="none">Once</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                      </select>
                      <button onClick={() => setIsUrgent(!isUrgent)} className={`px-2 py-1.5 text-[8px] font-mono font-bold rounded-lg uppercase tracking-wider cursor-pointer ${isUrgent ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-400 hover:text-white"}`}>Urgent</button>
                      <button onClick={addReminder} disabled={!newReminderText.trim() || !newReminderDueAt} className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30" title="Save reminder"><Plus size={12} /></button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setNewReminderDueAt(defaultReminderDateTime()); setShowNewReminderInput(true); }}
                    className="w-full py-2 border border-dashed border-white/5 rounded-xl text-[10px] font-mono text-slate-500 hover:text-cyan-400 hover:border-cyan-500/25 transition-all text-center flex items-center justify-center gap-1 cursor-pointer select-none shrink-0"
                  >
                    <Plus size={9} /> Add New Reminder
                  </button>
                )}
              </div>
            </div>

            {/* Memory status wave visualizer block */}
            <div className="shrink-0 bg-[#04060c]/45 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(110,231,255,0.01)] flex flex-col gap-2 select-none">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Brain size={13} className="text-[#6EE7FF]" />
                  <span className="text-[10px] font-mono tracking-wider font-semibold text-white/40 uppercase">Memory Status</span>
                </div>
                <Cpu size={11} className="text-cyan-500/60 animate-pulse" />
              </div>
              <MemoryStatusGraph />
            </div>

            {/* Voice Conversation mode specs card */}
            <div className="shrink-0 bg-[#04060c]/45 border border-white/5 rounded-2xl p-4 shadow-[0_0_20px_rgba(110,231,255,0.01)] relative overflow-hidden flex items-center justify-between">
              <div className="absolute right-3 top-3 opacity-25 text-fuchsia-400 animate-pulse pointer-events-none">
                <Sparkles size={20} />
              </div>

              <div className="flex flex-col flex-1 min-w-0">
                <div className="flex items-center gap-1.5 select-none mb-1">
                  <Volume2 size={11} className="text-fuchsia-400" />
                  <span className="text-[9px] font-mono tracking-wider font-semibold text-white/40 uppercase">Voice Mode</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-200 tracking-wide truncate">Natural Conversation</span>
                <div className="w-24 h-[3px] rounded-full bg-slate-800/80 overflow-hidden mt-1.5">
                  <div className={`h-full bg-fuchsia-500 rounded-full transition-all duration-700 ${
                    assistantState !== "disconnected" ? "w-[75%] animate-pulse" : "w-[10%]"
                  }`} />
                </div>
              </div>
            </div>

          </div>

        </div>

      </main>

      {/* Slide-out: CONVERSATION HISTORY LOG */}
      {showHistoryPanel && (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-950/95 border-l border-slate-900 shadow-2xl backdrop-blur-md z-40 flex flex-col transition-all duration-300 animate-slide-in">
          <div className="p-4 border-b border-slate-900 flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2 text-slate-200 uppercase tracking-wider text-[11px]">
              <History size={16} className="text-indigo-400" /> Conversation Log
            </h3>
            <button
              onClick={() => setShowHistoryPanel(false)}
              className="p-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {transcriptHistory.length === 0 ? (
              <div className="text-center py-12 text-slate-600 text-xs">
                No active conversations recorded.
              </div>
            ) : (
              transcriptHistory.map((line) => (
                <div key={line.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-wider ${
                      line.role === "user" ? "text-cyan-400" : "text-rose-400"
                    }`}>
                      {line.role === "user" ? "You" : "Shree"}
                    </span>
                    <span className="text-[9px] text-slate-600 font-mono">
                      {line.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/40 p-2.5 rounded-xl border border-slate-900">
                    {line.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}



      {/* Slide-out: Shree Memory Brain Panel */}
      {showMemoryPanel && (
        <MemoryBrain
          memories={memories}
          onRemember={handleRememberMemory}
          onForget={handleForgetMemory}
          onClose={() => setShowMemoryPanel(false)}
        />
      )}

      {showSettingsPanel && <DesktopSettings
        forceSetup={!setupReady}
        onClose={closeSettings}
        onReady={(settings) => { setRuntimeSettings(settings); setSetupReady(true); applyAppearance(settings); }}
        onSettingsChange={(settings) => {
          setRuntimeSettings(settings);
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "wake_settings", phrases: settings.wake_phrases }));
          }
        }}
      />}

      {updateState && <UpdatePrompt state={updateState} setState={setUpdateState} />}

    </div>
  );
}
