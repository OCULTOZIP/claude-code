"use client";
import { useEffect, useRef } from "react";

export type OrbMode = "listening" | "thinking" | "speaking" | "idle";

/**
 * Esfera do modo voz (preto e vermelho da marca): forma orgânica preta e brilhante.
 * Ouvindo: ondas de sonar saindo dela. Pensando: arcos girando em volta.
 * Falando (só com som saindo): glitch (separação RGB, faixas deslocadas,
 * linhas de varredura) na intensidade da voz enquanto o NORBIUS fala.
 * `getLevel` devolve o volume atual da voz (0 a 1).
 */
export function VoiceOrb({ mode, getLevel, size = 300 }: { mode: OrbMode; getLevel: () => number; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const levelRef = useRef(getLevel);
  levelRef.current = getLevel;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Área maior que a esfera: sombra e deslocamentos do glitch cabem sem cortar.
    const W = Math.round(size * 1.5 * dpr);
    el.width = W;
    el.height = W;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = W;
    const octx = off.getContext("2d")!;
    const tint = document.createElement("canvas");
    tint.width = W;
    tint.height = W;
    const tctx = tint.getContext("2d")!;

    const c = W / 2;
    const R = (size / 2) * 0.72 * dpr;
    const waves = [
      { k: 2, a: 0.06, w: 0.55, p: 0.3 },
      { k: 3, a: 0.045, w: -0.8, p: 1.7 },
      { k: 4, a: 0.03, w: 1.1, p: 2.9 },
      { k: 5, a: 0.018, w: -1.4, p: 4.2 },
    ];
    let t = 0;
    let last = performance.now();
    let spin = 0;
    let level = 0;
    let glitchUntil = 0;
    let raf = 0;

    function blobPath(g: CanvasRenderingContext2D, amp: number, speed: number) {
      const n = 96;
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        let r = 1;
        for (const wv of waves) r += wv.a * amp * Math.sin(wv.k * th + wv.p + wv.w * t * speed + spin);
        const x = c + Math.cos(th) * R * r;
        const y = c + Math.sin(th) * R * r * 0.97;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }

    function drawBlob(g: CanvasRenderingContext2D, amp: number, speed: number) {
      g.clearRect(0, 0, W, W);
      // Sombra projetada
      g.save();
      blobPath(g, amp, speed);
      // Aura vermelha em volta (a esfera "acende" por trás)
      g.shadowColor = "rgba(229,9,20,0.55)";
      g.shadowBlur = 70 * dpr;
      g.shadowOffsetY = 0;
      g.fillStyle = "#1a0305";
      g.fill();
      g.restore();
      // Corpo: luz vindo de cima à esquerda
      blobPath(g, amp, speed);
      const body = g.createRadialGradient(c - R * 0.35, c - R * 0.45, R * 0.05, c, c, R * 1.25);
      body.addColorStop(0, "#4a0a0f");
      body.addColorStop(0.35, "#1f0406");
      body.addColorStop(0.75, "#080102");
      body.addColorStop(1, "#000000");
      g.fillStyle = body;
      g.fill();
      g.save();
      g.clip();
      // Luz vermelha rebatida embaixo à direita
      const bounce = g.createRadialGradient(c + R * 0.45, c + R * 0.6, 0, c + R * 0.45, c + R * 0.6, R * 0.85);
      bounce.addColorStop(0, "rgba(229,9,20,0.55)");
      bounce.addColorStop(1, "rgba(229,9,20,0)");
      g.fillStyle = bounce;
      g.fillRect(0, 0, W, W);
      // Brilho especular
      const spec = g.createRadialGradient(c - R * 0.3, c - R * 0.42, 0, c - R * 0.3, c - R * 0.42, R * 0.38);
      spec.addColorStop(0, "rgba(255,225,228,0.55)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = spec;
      g.fillRect(0, 0, W, W);
      g.restore();
      // Contorno de luz vermelha (rim light)
      blobPath(g, amp, speed);
      g.strokeStyle = "rgba(255,59,48,0.35)";
      g.lineWidth = 1.5 * dpr;
      g.stroke();
    }

    /** Animações em volta da esfera: sonar (ouvindo) e arcos girando (pensando). */
    function drawAura(m: OrbMode) {
      const g = ctx!;
      if (m === "listening") {
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.45 + i / 3) % 1;
          g.beginPath();
          g.arc(c, c, R * (1.02 + p * 0.68), 0, Math.PI * 2);
          g.strokeStyle = `rgba(229,9,20,${0.5 * (1 - p)})`;
          g.lineWidth = (2.2 - p * 1.4) * dpr;
          g.stroke();
        }
      } else if (m === "thinking") {
        g.save();
        g.lineCap = "round";
        const a0 = t * 2.4;
        for (let i = 0; i < 3; i++) {
          const start = a0 + (i * Math.PI * 2) / 3;
          const len = 0.7 + 0.45 * Math.sin(t * 3 + i * 2);
          g.beginPath();
          g.arc(c, c, R * 1.24, start, start + len);
          g.strokeStyle = "rgba(229,9,20,0.9)";
          g.lineWidth = 2.5 * dpr;
          g.shadowColor = "rgba(229,9,20,0.8)";
          g.shadowBlur = 12 * dpr;
          g.stroke();
        }
        g.shadowBlur = 0;
        // Anel pontilhado girando ao contrário
        g.setLineDash([2 * dpr, 10 * dpr]);
        g.lineDashOffset = t * 40 * dpr;
        g.beginPath();
        g.arc(c, c, R * 1.12, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,90,90,0.35)";
        g.lineWidth = 1.5 * dpr;
        g.stroke();
        g.setLineDash([]);
        // Ponto orbitando
        const oa = -t * 1.7;
        g.beginPath();
        g.arc(c + Math.cos(oa) * R * 1.36, c + Math.sin(oa) * R * 1.36, 3 * dpr, 0, Math.PI * 2);
        g.fillStyle = "#ff5a5a";
        g.shadowColor = "rgba(229,9,20,1)";
        g.shadowBlur = 14 * dpr;
        g.fill();
        g.restore();
      }
    }

    function tinted(color: string) {
      tctx.globalCompositeOperation = "source-over";
      tctx.clearRect(0, 0, W, W);
      tctx.drawImage(off, 0, 0);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, W, W);
      return tint;
    }

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = modeRef.current;
      const target = m === "speaking" ? levelRef.current() : 0;
      // Sobe rápido, desce devagar: o glitch acompanha as sílabas sem piscar.
      level += (target - level) * (target > level ? 0.6 : 0.12);
      const speed = m === "thinking" ? 2.6 : m === "speaking" ? 1.6 + level * 2 : m === "listening" ? 1 : 0.5;
      const amp = m === "thinking" ? 1.5 : m === "speaking" ? 1.2 + level * 1.4 : m === "listening" ? 1.1 + 0.15 * Math.sin(t * 2.2) : 0.8;
      t += dt;
      spin += dt * (m === "thinking" ? 0.9 : 0.15);

      drawBlob(octx, reduced ? 0.8 : amp, reduced ? 0.4 : speed);
      ctx!.clearRect(0, 0, W, W);
      if (!reduced) drawAura(m);

      const glitching = m === "speaking" && !reduced;
      if (glitching && level > 0.12 && Math.random() < level * 0.5) glitchUntil = now + 60 + Math.random() * 140;
      const g = glitching && now < glitchUntil ? Math.max(level, 0.35) : 0;

      if (g > 0) {
        const shift = (4 + g * 16) * dpr;
        ctx!.globalCompositeOperation = "lighter";
        ctx!.globalAlpha = 0.8;
        ctx!.drawImage(tinted("rgba(229,9,20,1)"), -shift, 0);
        ctx!.drawImage(tinted("rgba(255,255,255,0.9)"), shift, 0);
        ctx!.globalAlpha = 1;
        ctx!.globalCompositeOperation = "source-over";
      }
      ctx!.drawImage(off, 0, 0);

      if (g > 0) {
        // Faixas horizontais deslocadas
        const bands = 2 + Math.floor(g * 5);
        for (let i = 0; i < bands; i++) {
          const y = c - R + Math.random() * R * 2;
          const h = (2 + Math.random() * 14 * g) * dpr;
          const dx = (Math.random() - 0.5) * 50 * g * dpr;
          ctx!.clearRect(0, y, W, h);
          ctx!.drawImage(off, 0, y, W, h, dx, y, W, h);
        }
        // Linhas de varredura só sobre a esfera
        ctx!.globalCompositeOperation = "source-atop";
        ctx!.fillStyle = `rgba(0,0,0,${0.12 + g * 0.18})`;
        for (let y = 0; y < W; y += 3 * dpr) ctx!.fillRect(0, y, W, dpr);
        ctx!.globalCompositeOperation = "source-over";
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvas} aria-hidden style={{ width: size * 1.5, height: size * 1.5 }} className="max-w-full" />;
}
