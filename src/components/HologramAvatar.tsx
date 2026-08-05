import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AssistantState } from "../types";
import { Mic, Volume2, Sparkles, Power, Eye, Radio, Cpu, Network } from "lucide-react";
import shreeLogo from "../assets/branding/shree-logo-transparent.png";

interface HologramAvatarProps {
  state: AssistantState;
  onClick: () => void;
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
}

export const HologramAvatar: React.FC<HologramAvatarProps> = ({
  state,
  onClick,
  inputAnalyser,
  outputAnalyser,
}) => {
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const [glitchTrigger, setGlitchTrigger] = useState<boolean>(false);
  const animationRef = useRef<number | null>(null);

  // Sound-reactive animation driver
  useEffect(() => {
    const analyser = state === "listening" ? inputAnalyser : state === "speaking" ? outputAnalyser : null;
    if (!analyser) {
      setAudioVolume(0);
      return;
    }

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    
    const update = () => {
      analyser.getByteTimeDomainData(buffer);
      let maxDeviation = 0;
      for (let i = 0; i < buffer.length; i++) {
        const dev = Math.abs(buffer[i] - 128);
        if (dev > maxDeviation) maxDeviation = dev;
      }
      // Normalize to 0-1
      const normalized = Math.min(1, maxDeviation / 64);
      setAudioVolume(normalized);
      animationRef.current = requestAnimationFrame(update);
    };

    update();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, inputAnalyser, outputAnalyser]);

  // Periodic visual glitch effect for sci-fi atmosphere
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.4) {
        setGlitchTrigger(true);
        setTimeout(() => setGlitchTrigger(false), 250);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Determine themes based on state
  const getTheme = () => {
    switch (state) {
      case "disconnected":
        return {
          glowColor: "rgba(99, 102, 241, 0.2)",
          borderColor: "border-indigo-500/20",
          textColor: "text-indigo-400",
          ringColor: "bg-indigo-500/10",
          shadowColor: "shadow-indigo-500/20",
          particleColor: "bg-indigo-400/40",
          statusLabel: "CORE OFFLINE",
          accentColor: "indigo",
        };
      case "connecting":
        return {
          glowColor: "rgba(168, 85, 247, 0.4)",
          borderColor: "border-purple-500/30",
          textColor: "text-purple-400",
          ringColor: "bg-purple-500/20",
          shadowColor: "shadow-purple-500/40 animate-pulse",
          particleColor: "bg-purple-400/50",
          statusLabel: "SYNCHRONIZING Matrix...",
          accentColor: "purple",
        };
      case "listening":
        return {
          glowColor: "rgba(34, 211, 238, 0.5)",
          borderColor: "border-cyan-400/40",
          textColor: "text-cyan-400",
          ringColor: "bg-cyan-400/25",
          shadowColor: "shadow-cyan-400/50",
          particleColor: "bg-cyan-300/60",
          statusLabel: "AURAL SCANNER ACTIVE",
          accentColor: "cyan",
        };
      case "speaking":
        return {
          glowColor: "rgba(244, 63, 94, 0.6)",
          borderColor: "border-rose-500/40",
          textColor: "text-rose-400",
          ringColor: "bg-rose-500/25",
          shadowColor: "shadow-rose-500/60",
          particleColor: "bg-rose-300/70",
          statusLabel: "VOCAL ARRAY BROADCASTING",
          accentColor: "rose",
        };
    }
  };

  const theme = getTheme();

  return (
    <div className="relative w-full flex flex-col items-center justify-center select-none min-h-0">
      
      {/* 3D Holographic Chamber Viewport */}
      <div className="relative w-[270px] h-[360px] md:w-[320px] md:h-[420px] flex items-center justify-center z-10">
        
        {/* Background ambient glow behind the card */}
        <div 
          className="absolute w-[220px] h-[300px] rounded-full blur-[80px] opacity-25 transition-all duration-700 pointer-events-none"
          style={{
            background: theme.glowColor,
            transform: `scale(${1 + audioVolume * 0.4})`
          }}
        />

        {/* The Cyber Chamber Card Frame */}
        <motion.button
          onClick={onClick}
          id="myraa-avatar-main-capsule"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className={`w-full h-full rounded-2xl bg-gradient-to-b from-[#080d1d]/85 via-[#03050a]/95 to-[#020204] border ${theme.borderColor} overflow-hidden relative flex flex-col items-center justify-center cursor-pointer shadow-[0_0_30px_rgba(110,231,255,0.03)] transition-all duration-500 backdrop-blur-md ${theme.shadowColor}`}
        >
          {/* Cybernetic Grid Background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(110,231,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(110,231,255,0.015)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none opacity-40" />
          
          {/* Shree Mark 12 brand core */}
          <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
            <motion.img
              src={shreeLogo}
              alt="Shree Mark 12 logo"
              referrerPolicy="no-referrer"
              animate={state === "speaking" ? {
                scale: [1.02, 1.05 + audioVolume * 0.08, 1.02],
                filter: [
                  `brightness(0.9) contrast(1.1) drop-shadow(0 0 4px ${theme.accentColor === "rose" ? "rgba(244,63,94,0.4)" : "rgba(34,211,238,0.4)"})`,
                  `brightness(1.1) contrast(1.25) drop-shadow(0 0 14px ${theme.accentColor === "rose" ? "rgba(244,63,94,0.7)" : "rgba(34,211,238,0.7)"})`,
                  `brightness(0.9) contrast(1.1) drop-shadow(0 0 4px ${theme.accentColor === "rose" ? "rgba(244,63,94,0.4)" : "rgba(34,211,238,0.4)"})`
                ]
              } : state === "listening" ? {
                scale: 1.02,
                filter: `brightness(1.0) contrast(1.15) drop-shadow(0 0 8px rgba(34,211,238,0.5))`
              } : {
                scale: 1.0,
                filter: `brightness(0.55) contrast(0.9) grayscale(0.5)`
              }}
              transition={state === "speaking" ? {
                duration: 0.18,
                repeat: Infinity,
                repeatType: "mirror"
              } : {
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="h-full w-full object-contain p-4 transition-all duration-700 select-none pointer-events-none opacity-90"
            />

            {/* Futuristic blue light vignetting inside capsule */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#020204] via-transparent to-[#080d1d]/40 mix-blend-multiply pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#020204] to-transparent pointer-events-none" />
          </div>

          {/* Concentric 3D Hologram Stage Base Rings (at feet) */}
          <div className="absolute bottom-[28px] w-52 h-14 pointer-events-none flex items-center justify-center">
            {/* Outer ring */}
            <motion.div 
              animate={{ 
                scale: state !== "disconnected" ? [1.0, 1.08 + audioVolume * 0.12, 1.0] : 1.0,
                opacity: state !== "disconnected" ? [0.4, 0.7, 0.4] : 0.25
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className={`absolute w-full h-full rounded-full border border-${theme.accentColor}-400/40 scale-y-[0.25] blur-[1px] shadow-[0_0_12px_rgba(110,231,255,0.3)]`} 
            />
            {/* Middle ring */}
            <motion.div 
              animate={{ 
                scale: state !== "disconnected" ? [0.8, 0.88 + audioVolume * 0.08, 0.8] : 0.8,
                opacity: state !== "disconnected" ? [0.6, 0.9, 0.6] : 0.4
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              className={`absolute w-full h-full rounded-full border-2 border-${theme.accentColor}-400/60 scale-y-[0.23] shadow-[inset_0_0_8px_rgba(110,231,255,0.4)]`} 
            />
            {/* Glowing core under character */}
            <div className={`absolute w-1/2 h-1/2 rounded-full bg-${theme.accentColor}-400/10 scale-y-[0.2] blur-[4px]`} />
          </div>

          {/* Matrix Scan Lines and CRT sweep effect */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.25)_50%),_linear-gradient(90deg,_rgba(255,0,0,0.03),_rgba(0,255,0,0.01),_rgba(0,0,255,0.03))] bg-[size:100%_4px,_6px_100%] opacity-30" />

          {/* Glowing horizontal scanner line sweeping down */}
          <motion.div 
            animate={{ 
              top: ["-5%", "105%"] 
            }}
            transition={{ 
              duration: state === "connecting" ? 1.5 : 4, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className={`absolute left-0 w-full h-[2.5px] bg-gradient-to-r from-transparent via-${theme.accentColor}-400 to-transparent shadow-[0_0_10px_var(--color-${theme.accentColor}-400)] opacity-60 pointer-events-none`}
          />

          {/* Holographic vertical rising energy streams/particles */}
          {state !== "disconnected" && (
            <div className="absolute inset-x-4 bottom-8 top-12 pointer-events-none overflow-hidden">
              {Array.from({ length: 6 }).map((_, i) => {
                const speed = 2 + (i % 3) * 1.5;
                const delay = i * 0.7;
                const leftPos = 15 + i * 14;
                return (
                  <motion.div
                    key={i}
                    initial={{ y: "110%", opacity: 0 }}
                    animate={{ y: "-10%", opacity: [0, 0.7, 0] }}
                    transition={{
                      duration: speed,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: delay
                    }}
                    className={`absolute w-[1.5px] h-10 bg-gradient-to-t from-${theme.accentColor}-400/40 to-transparent`}
                    style={{ left: `${leftPos}%` }}
                  />
                );
              })}
            </div>
          )}

          {/* Sound-reactive particle flash glitch */}
          {glitchTrigger && state !== "disconnected" && (
            <div className="absolute inset-0 bg-cyan-400/10 mix-blend-color-dodge animate-pulse pointer-events-none">
              <div className="absolute top-1/4 left-0 w-full h-[10px] bg-white/20 blur-[1px]" />
              <div className="absolute top-2/3 left-0 w-full h-[4px] bg-cyan-500/20 blur-[2px]" />
            </div>
          )}

          {/* Cybernetic corner brackets */}
          <div className={`absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-${theme.accentColor}-400/40 rounded-tl-sm pointer-events-none`} />
          <div className={`absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-${theme.accentColor}-400/40 rounded-tr-sm pointer-events-none`} />
          <div className={`absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-${theme.accentColor}-400/40 rounded-bl-sm pointer-events-none`} />
          <div className={`absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-${theme.accentColor}-400/40 rounded-br-sm pointer-events-none`} />

          {/* Miniature holographic coordinate metrics */}
          <div className="absolute top-2.5 left-8 px-1 text-[8px] font-mono tracking-wider text-slate-500 pointer-events-none uppercase">
            SYS_LNK: ACTIVE
          </div>
          <div className="absolute top-2.5 right-8 px-1 text-[8px] font-mono tracking-wider text-slate-500 pointer-events-none uppercase">
            {theme.statusLabel}
          </div>
          <div className="absolute bottom-2.5 left-8 px-1 text-[8px] font-mono tracking-wider text-slate-500 pointer-events-none uppercase">
            SHREE_MARK_12
          </div>
          <div className="absolute bottom-2.5 right-8 px-1 text-[8px] font-mono tracking-wider text-slate-500 pointer-events-none uppercase">
            BY: AYUSH
          </div>

          {/* Middle holographic scan status display when disconnected */}
          {state === "disconnected" && (
            <div className="absolute inset-0 bg-slate-950/50 flex flex-col items-center justify-center backdrop-blur-[2px] hover:backdrop-blur-none transition-all">
              <div className="p-4 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-300 shadow-[0_0_20px_rgba(110,231,255,0.2)] animate-pulse mb-3">
                <Power size={32} />
              </div>
              <span className="text-[10px] font-mono tracking-[0.25em] text-[#6EE7FF] uppercase animate-pulse">
                Click to Initialize
              </span>
            </div>
          )}
        </motion.button>

      </div>
    </div>
  );
};
