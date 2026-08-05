import React, { useEffect, useRef } from "react";
import { AssistantState } from "../types";

interface WaveformVisualizerProps {
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
  state: AssistantState;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  inputAnalyser,
  outputAnalyser,
  state,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high-DPI displays
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Dynamic animation parameters
    let rotationAngle = 0;
    let breathingPhase = 0;
    const inputBuffer = new Uint8Array(inputAnalyser ? inputAnalyser.frequencyBinCount : 128);
    const outputBuffer = new Uint8Array(outputAnalyser ? outputAnalyser.frequencyBinCount : 128);

    const render = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);

      // Clear with very slight fade for trailing/ghosting effect
      ctx.fillStyle = "rgba(10, 10, 15, 0.25)";
      ctx.fillRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      // Update phases
      rotationAngle += 0.02;
      breathingPhase += 0.03;
      const breatheScale = 1 + Math.sin(breathingPhase) * 0.06;

      // Draw based on state
      if (state === "disconnected") {
        // Draw elegant, silent breathing orbit ring and smooth line
        ctx.shadowBlur = 15;
        ctx.shadowColor = "rgba(99, 102, 241, 0.4)"; // Indigo glow
        ctx.strokeStyle = "rgba(99, 102, 241, 0.25)";
        ctx.lineWidth = 1.5;

        // Orbit ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, 70 * breatheScale, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glowing core
        ctx.fillStyle = "rgba(99, 102, 241, 0.08)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, 55 * breatheScale, 0, Math.PI * 2);
        ctx.fill();

        // Elegant horizon line
        ctx.beginPath();
        ctx.moveTo(centerX - 180, centerY);
        ctx.bezierCurveTo(centerX - 90, centerY, centerX - 50, centerY, centerX - 45, centerY);
        ctx.moveTo(centerX + 45, centerY);
        ctx.bezierCurveTo(centerX + 50, centerY, centerX + 90, centerY, centerX + 180, centerY);
        ctx.strokeStyle = "rgba(99, 102, 241, 0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (state === "connecting") {
        // Draw elegant orbiting glowing planets/rings representing system linking
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(168, 85, 247, 0.6)"; // Purple glow
        ctx.lineWidth = 2;

        // Two counter-rotating orbit paths
        ctx.strokeStyle = "rgba(168, 85, 247, 0.15)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, 80, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(139, 92, 246, 0.1)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, 110, 0, Math.PI * 2);
        ctx.stroke();

        // Rotating nodes
        const nodeX1 = centerX + Math.cos(rotationAngle) * 80;
        const nodeY1 = centerY + Math.sin(rotationAngle) * 80;
        const nodeX2 = centerX + Math.cos(-rotationAngle * 1.5) * 110;
        const nodeY2 = centerY + Math.sin(-rotationAngle * 1.5) * 110;

        ctx.fillStyle = "rgba(168, 85, 247, 0.9)";
        ctx.beginPath();
        ctx.arc(nodeX1, nodeY1, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(139, 92, 246, 0.8)";
        ctx.beginPath();
        ctx.arc(nodeX2, nodeY2, 4, 0, Math.PI * 2);
        ctx.fill();

        // Pulse core
        ctx.fillStyle = "rgba(168, 85, 247, 0.12)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, 50 * breatheScale, 0, Math.PI * 2);
        ctx.fill();
      } else if (state === "listening") {
        // USER SPEAKING: Glowing neon blue/cyan responsive waveforms
        let maxVal = 0;
        if (inputAnalyser) {
          inputAnalyser.getByteTimeDomainData(inputBuffer);
          // Find max deviation to measure active speaking volume
          for (let i = 0; i < inputBuffer.length; i++) {
            const v = Math.abs(inputBuffer[i] - 128);
            if (v > maxVal) maxVal = v;
          }
        }

        const normalizedVolume = Math.min(1, maxVal / 64);

        ctx.shadowBlur = 18 + normalizedVolume * 20;
        ctx.shadowColor = "rgba(6, 182, 212, 0.75)"; // Cyan glow
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.4 + normalizedVolume * 0.5})`;
        ctx.lineWidth = 2.5;

        // Draw double sinusoidal waves based on microphone input
        ctx.beginPath();
        const sliceWidth = 320 / inputBuffer.length;
        let x = centerX - 160;

        for (let i = 0; i < inputBuffer.length; i++) {
          const v = inputBuffer[i] / 128.0;
          const amplitude = 35 * normalizedVolume + Math.sin(breathingPhase * 2 + i * 0.05) * 4;
          const y = centerY + (v - 1.0) * amplitude;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // Draw helper secondary out-of-phase wave
        ctx.strokeStyle = "rgba(6, 182, 212, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        x = centerX - 160;
        for (let i = 0; i < inputBuffer.length; i++) {
          const v = inputBuffer[i] / 128.0;
          const amplitude = 20 * normalizedVolume + Math.cos(breathingPhase * 1.5 + i * 0.1) * 3;
          const y = centerY - (v - 1.0) * amplitude;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // Breathing core
        ctx.fillStyle = `rgba(6, 182, 212, ${0.06 + normalizedVolume * 0.12})`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, (60 + normalizedVolume * 25) * breatheScale, 0, Math.PI * 2);
        ctx.fill();
      } else if (state === "speaking") {
        // ASSISTANT (SHREE) SPEAKING: Beautiful warm pink/magenta glowing ribbons
        let maxVal = 0;
        if (outputAnalyser) {
          outputAnalyser.getByteTimeDomainData(outputBuffer);
          for (let i = 0; i < outputBuffer.length; i++) {
            const v = Math.abs(outputBuffer[i] - 128);
            if (v > maxVal) maxVal = v;
          }
        }

        const normalizedVolume = Math.min(1, maxVal / 64);

        ctx.shadowBlur = 22 + normalizedVolume * 25;
        ctx.shadowColor = "rgba(244, 63, 94, 0.85)"; // Hot rose/pink glow
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.5 + normalizedVolume * 0.5})`;
        ctx.lineWidth = 3;

        // Main voice ribbon
        ctx.beginPath();
        const sliceWidth = 340 / outputBuffer.length;
        let x = centerX - 170;

        for (let i = 0; i < outputBuffer.length; i++) {
          const v = outputBuffer[i] / 128.0;
          const amplitude = 55 * normalizedVolume + Math.sin(-breathingPhase * 3 + i * 0.08) * 6;
          const y = centerY + (v - 1.0) * amplitude;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // Elegant secondary high-frequency companion wave
        ctx.strokeStyle = "rgba(236, 72, 153, 0.35)"; // Pink
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        x = centerX - 170;
        for (let i = 0; i < outputBuffer.length; i++) {
          const v = outputBuffer[i] / 128.0;
          const amplitude = 30 * normalizedVolume + Math.sin(breathingPhase * 2.2 + i * 0.12) * 4;
          const y = centerY - (v - 1.0) * amplitude;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // Pulsing core
        ctx.fillStyle = `rgba(244, 63, 94, ${0.08 + normalizedVolume * 0.15})`;
        ctx.beginPath();
        ctx.arc(centerX, centerY, (65 + normalizedVolume * 30) * breatheScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0; // Reset shadow for clean state
      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [inputAnalyser, outputAnalyser, state]);

  return (
    <div className="relative w-full h-[320px] flex items-center justify-center">
      {/* Decorative backdrop mesh */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent via-slate-950/20 to-transparent pointer-events-none" />
      
      <canvas
        ref={canvasRef}
        id="voice_canvas_visualizer"
        className="w-full h-full block rounded-3xl"
        style={{ maxWidth: "100%", height: "320px" }}
      />
    </div>
  );
};
