import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { AssistantState } from "../types";
import shreeLogo from "../assets/branding/shree-logo-transparent.png";

interface HologramAvatarProps {
  state: AssistantState;
  onClick: () => void;
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
}

const stateTheme = (state: AssistantState) => {
  if (state === "listening") return { primary: "#22d3ee", secondary: "#38bdf8", label: "LISTENING" };
  if (state === "speaking") return { primary: "#f02ed1", secondary: "#fb7185", label: "SHREE IS SPEAKING" };
  if (state === "connecting") return { primary: "#a855f7", secondary: "#d946ef", label: "CONNECTING" };
  return { primary: "#875cff", secondary: "#22d3ee", label: "CLICK TO ACTIVATE" };
};

export const HologramAvatar: React.FC<HologramAvatarProps> = ({
  state,
  onClick,
  inputAnalyser,
  outputAnalyser,
}) => {
  const [audioVolume, setAudioVolume] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const analyser = state === "listening" ? inputAnalyser : state === "speaking" ? outputAnalyser : null;
    if (!analyser) {
      setAudioVolume(0);
      return;
    }
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
      setAudioVolume(Math.min(1, peak / 64));
      animationRef.current = requestAnimationFrame(update);
    };
    update();
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [state, inputAnalyser, outputAnalyser]);

  const theme = stateTheme(state);
  const active = state !== "disconnected";
  const pulseScale = 1 + audioVolume * 0.08;

  return (
    <div className="relative flex w-full min-h-0 flex-col items-center justify-center select-none">
      <div className="relative flex h-[310px] w-[310px] items-center justify-center md:h-[360px] md:w-[360px]">
        <motion.div
          aria-hidden="true"
          animate={{ scale: active ? [1, 1.035 + audioVolume * 0.04, 1] : [1, 1.018, 1] }}
          transition={{ duration: active ? 1.1 : 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-[7%] rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.primary}36 0%, transparent 70%)` }}
        />

        <motion.button
          id="myraa-avatar-main-capsule"
          onClick={onClick}
          aria-label={active ? "Stop SHREE voice session" : "Start SHREE voice session"}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.985 }}
          animate={{ scale: pulseScale }}
          transition={{ duration: 0.15 }}
          className="relative flex h-[78%] w-[78%] cursor-pointer items-center justify-center overflow-visible rounded-full border bg-[#030711]/90 shadow-2xl outline-none"
          style={{
            borderColor: `${theme.primary}cc`,
            boxShadow: `0 0 18px ${theme.primary}7a, inset 0 0 34px ${theme.secondary}22, 0 0 65px ${theme.secondary}20`,
          }}
        >
          <div className="absolute inset-[3%] rounded-full border border-fuchsia-400/45" />
          <div className="absolute inset-[7%] rounded-full border border-cyan-300/20" />
          <motion.div
            aria-hidden="true"
            animate={{ rotate: 360 }}
            transition={{ duration: active ? 7 : 14, repeat: Infinity, ease: "linear" }}
            className="absolute inset-[-2%] rounded-full border-t-2 border-r border-t-cyan-300 border-r-fuchsia-400/60 border-b-transparent border-l-transparent"
          />
          <motion.div
            aria-hidden="true"
            animate={{ rotate: -360 }}
            transition={{ duration: active ? 10 : 20, repeat: Infinity, ease: "linear" }}
            className="absolute inset-[5%] rounded-full border-b-2 border-l border-b-fuchsia-400 border-l-cyan-300/60 border-t-transparent border-r-transparent"
          />
          <motion.img
            src={shreeLogo}
            alt="Shree Mark 12"
            className="h-[76%] w-[76%] object-contain pointer-events-none"
            animate={{
              scale: state === "speaking" ? [1, 1.025 + audioVolume * 0.08, 1] : [1, 1.012, 1],
              filter: active
                ? [`brightness(1) drop-shadow(0 0 8px ${theme.primary})`, `brightness(1.12) drop-shadow(0 0 16px ${theme.secondary})`, `brightness(1) drop-shadow(0 0 8px ${theme.primary})`]
                : "brightness(.72) saturate(.8) drop-shadow(0 0 5px rgba(135,92,255,.5))",
            }}
            transition={{ duration: state === "speaking" ? 0.22 : 2.8, repeat: Infinity, ease: "easeInOut" }}
          />

        </motion.button>

        <div className="absolute bottom-3 h-7 w-[78%] rounded-[50%] border border-cyan-400/35 shadow-[0_0_22px_rgba(34,211,238,.3)]" />
      </div>
      <span className="mt-1 text-[10px] font-mono tracking-[0.3em] uppercase" style={{ color: theme.primary }}>
        ‹‹ {theme.label} ››
      </span>
    </div>
  );
};
