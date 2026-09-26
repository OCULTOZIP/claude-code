"use client";
import { Button } from "@norbius/ui";
import { X } from "lucide-react";
import { NEURAL_PREFIX, type useVoice } from "./use-voice";

type Voice = ReturnType<typeof useVoice>;

// Vozes masculinas conhecidas do macOS/Chrome em português.
const MALE = /\b(eddy|reed|rocko|grandpa|felipe|daniel|ricardo)\b/i;

// Vozes neurais do Piper em pt-BR (todas masculinas).
const NEURAL_LABEL: Record<string, string> = {
  faber: "Faber — masculina, natural",
  cadu: "Cadu — masculina, natural",
  jeff: "Jeff — masculina, natural",
};

function label(v: SpeechSynthesisVoice) {
  const name = v.name.replace(/\s*\(.*\)\s*$/, "");
  return MALE.test(name) ? `${name} (masculina)` : name;
}

const SAMPLE = "Olá, eu sou o NORBIUS. Posso consultar seus gastos, registrar despesas e acompanhar suas metas.";

export function VoicePanel({ voice, onClose }: { voice: Voice; onClose: () => void }) {
  const { voices, neuralVoices, settings, activeVoiceURI, updateSettings } = voice;
  const neural = activeVoiceURI?.startsWith(NEURAL_PREFIX) ?? false;
  const sorted = [...voices].sort((a, b) => Number(MALE.test(b.name)) - Number(MALE.test(a.name)) || a.name.localeCompare(b.name));

  return (
    <div
      role="dialog"
      aria-label="Configurar voz"
      className="absolute top-full right-0 z-20 mt-2 w-80 rounded-2xl border border-line-strong bg-surface p-4 text-sm shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Voz do NORBIUS</h2>
        <button type="button" aria-label="Fechar" onClick={onClose} className="rounded-md p-1 text-fg-muted hover:text-fg">
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <label htmlFor="voice-select" className="text-xs text-fg-secondary">
        Voz
      </label>
      {sorted.length || neuralVoices.length ? (
        <select
          id="voice-select"
          value={activeVoiceURI ?? ""}
          onChange={(e) => updateSettings({ voiceURI: e.target.value || null })}
          className="mt-1 w-full rounded-lg border border-line-strong bg-secondary px-2.5 py-2 text-sm text-fg"
        >
          {neuralVoices.length ? (
            <optgroup label="Realistas (geradas no seu computador)">
              {neuralVoices.map((n) => (
                <option key={n} value={NEURAL_PREFIX + n}>
                  {NEURAL_LABEL[n] ?? n}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Do sistema">
            {sorted.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {label(v)}
              </option>
            ))}
          </optgroup>
        </select>
      ) : (
        <p className="mt-1 text-xs text-fg-muted">Nenhuma voz em português encontrada neste navegador.</p>
      )}

      {neural ? null : (
        <>
          <label htmlFor="voice-pitch" className="mt-4 flex justify-between text-xs text-fg-secondary">
            <span>Tom</span>
            <span>{settings.pitch < 0.95 ? "mais grave" : settings.pitch > 1.05 ? "mais agudo" : "normal"}</span>
          </label>
          <input
            id="voice-pitch"
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={settings.pitch}
            onChange={(e) => updateSettings({ pitch: Number(e.target.value) })}
            className="mt-1 w-full accent-primary"
          />
        </>
      )}

      <label htmlFor="voice-rate" className="mt-4 flex justify-between text-xs text-fg-secondary">
        <span>Velocidade</span>
        <span>{settings.rate.toFixed(2).replace(".", ",")}×</span>
      </label>
      <input
        id="voice-rate"
        type="range"
        min={0.6}
        max={1.6}
        step={0.05}
        value={settings.rate}
        onChange={(e) => updateSettings({ rate: Number(e.target.value) })}
        className="mt-1 w-full accent-primary"
      />

      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          onClick={() => {
            voice.unlockAudio();
            voice.speak(SAMPLE);
          }}
        >
          Testar voz
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => updateSettings({ voiceURI: null, pitch: 1, rate: 1 })}>
          Padrão
        </Button>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-fg-muted">
        {neural
          ? "Voz neural gerada no seu computador, sem custo. O tom é fixo em cada voz."
          : "Voz do sistema. A escolha fica salva neste navegador."}
      </p>
    </div>
  );
}
