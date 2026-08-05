import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, Square } from "lucide-react";
import { defaultSettings, type ShreeSettings } from "../settingsTypes";
import shreeAvatar from "../assets/images/shree_hologram_1782572590362.jpg";
import shreeMark from "../assets/branding/shree-mark.png";

type CompanionState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "working" | "success" | "error" | "reminder";

interface SessionState {
  state: CompanionState;
  audioLevel: number;
  muted: boolean;
  caption: string;
  captionRole: "user" | "model" | null;
}

const stateLabels: Record<CompanionState, string> = {
  idle: "Ready",
  connecting: "Connecting...",
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking...",
  working: "Working...",
  success: "Done",
  error: "Something went wrong",
  reminder: "Reminder",
};

const DRAG_THRESHOLD = 8;

export function FloatingCompanion() {
  const [settings, setSettings] = useState<ShreeSettings>(defaultSettings);
  const [session, setSession] = useState<SessionState>({ state: "idle", audioLevel: 0, muted: false, caption: "", captionRole: null });
  const [bubble, setBubble] = useState("Click Talk when you need Shree.");
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const controlsVisible = true;
  const [blink, setBlink] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const pointerRef = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    window.shreeDesktop?.setCompanionClickThrough(false);
  }, []);

  const showBubble = useCallback((message: string, duration = 7000) => {
    const clean = String(message || "").trim();
    if (!clean) return;
    setBubble(clean);
    setBubbleVisible(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    if (duration > 0) bubbleTimerRef.current = setTimeout(() => setBubbleVisible(false), duration);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("companion-mode");
    document.body.classList.add("companion-mode");
    Promise.all([
      window.shreeDesktop?.getPreferences() ?? Promise.resolve({}),
      window.shreeDesktop?.getCompanionSessionState(),
    ]).then(([preferences, current]) => {
      setSettings({ ...defaultSettings, ...preferences } as ShreeSettings);
      if (current) {
        setSession(current);
        if (current.caption) showBubble(current.caption, current.captionRole === "model" ? 8000 : 4000);
      }
    }).catch(console.error);
    return () => {
      document.documentElement.classList.remove("companion-mode");
      document.body.classList.remove("companion-mode");
    };
  }, [showBubble]);

  useEffect(() => window.shreeDesktop?.onCompanionPreferences(preferences => {
    setSettings(current => ({ ...current, ...preferences } as ShreeSettings));
  }), []);

  useEffect(() => window.shreeDesktop?.onCompanionSessionState(next => {
    setSession(next);
    if (next.caption) showBubble(next.caption, next.captionRole === "model" ? 8000 : 4000);
  }), [showBubble]);

  useEffect(() => window.shreeDesktop?.onEmergencyStop(() => {
    setSession(current => ({ ...current, state: "error", audioLevel: 0, muted: true }));
    showBubble("Emergency stop activated. Desktop automation was cancelled.", 8000);
  }), [showBubble]);

  useEffect(() => {
    if (!settings.floating_idle_animations) return;
    let timer: ReturnType<typeof setTimeout>;
    let closeTimer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        closeTimer = setTimeout(() => { setBlink(false); schedule(); }, 150);
      }, 2500 + Math.random() * 3200);
    };
    schedule();
    return () => { clearTimeout(timer); clearTimeout(closeTimer); };
  }, [settings.floating_idle_animations]);

  useEffect(() => {
    if (!settings.floating_click_through_idle) {
      window.shreeDesktop?.setCompanionClickThrough(false);
      return;
    }
    const timer = setTimeout(() => {
      window.shreeDesktop?.setCompanionClickThrough(session.state === "idle" && !controlsVisible);
    }, 1200);
    return () => clearTimeout(timer);
  }, [controlsVisible, session.state, settings.floating_click_through_idle]);

  useEffect(() => () => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
  }, []);

  const beginPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
  };

  const movePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.dragging && Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) >= DRAG_THRESHOLD) {
      pointer.dragging = true;
      window.shreeDesktop?.startCompanionDrag();
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    suppressClickRef.current = pointer.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointer.dragging) window.shreeDesktop?.endCompanionDrag();
  };

  const avatarClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    showControls();
  };

  const active = !["idle", "error"].includes(session.state);
  const level = Math.max(0, Math.min(1, Number(session.audioLevel) || 0));
  const shellStyle = { "--audio-level": level } as CSSProperties;

  return (
    <main
      className={`companion-shell state-${session.state} quality-${settings.floating_animation_quality.toLowerCase()}`}
      style={shellStyle}
      onContextMenu={event => { event.preventDefault(); window.shreeDesktop?.showCompanionContextMenu(); }}
      onMouseEnter={showControls}
      onMouseMove={event => setGaze({ x: (event.clientX / innerWidth - .5) * 2, y: (event.clientY / innerHeight - .5) * 2 })}
    >
      <AnimatePresence>
        {settings.floating_show_speech_bubble && bubbleVisible && (
          <motion.div className="companion-bubble" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}>
            <div>{bubble}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="companion-drag-hint" aria-hidden="true"><span /><span /><span /></div>
      <button
        type="button"
        className="companion-avatar"
        onClick={avatarClick}
        onDoubleClick={() => window.shreeDesktop?.openMain("chat")}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDragStart={event => event.preventDefault()}
        aria-label="Shree floating companion"
      >
        <div className="companion-aura" />
        {settings.floating_animation_quality !== "Low" && <div className="companion-particles"><i /><i /><i /><i /><i /></div>}
        <motion.img
          src={shreeAvatar}
          alt="Shree"
          draggable={false}
          animate={settings.floating_idle_animations ? { opacity: [.96, 1, .96] } : { opacity: 1 }}
          transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
          style={{ translateX: gaze.x * 1.5, translateY: gaze.y * 1.2 }}
        />
        <span className={`companion-eye left ${blink ? "blink" : ""}`} />
        <span className={`companion-eye right ${blink ? "blink" : ""}`} />
        {settings.floating_lip_sync && <span className="companion-mouth" style={{ transform: `translateX(-50%) scaleY(${.35 + level * 1.7})` }} />}
        <div className="companion-progress" style={{ "--progress": `${Math.max(8, level * 100)}%` } as CSSProperties} />
        <span className="companion-status-dot" />
        <span className="companion-brand" style={{ backgroundImage: `url(${shreeMark})` }} aria-hidden="true" />
      </button>

      <div className="companion-status"><strong>{stateLabels[session.state]}</strong></div>

      <AnimatePresence>
        {controlsVisible && (
          <motion.div className="companion-controls companion-controls-single" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} onMouseEnter={showControls}>
            <button
              onClick={() => window.shreeDesktop?.toggleCompanionSession()}
              title={active ? "Stop Shree" : "Talk to Shree"}
              aria-label={active ? "Stop Shree" : "Talk to Shree"}
            >
              {active ? <Square /> : <Mic />}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
