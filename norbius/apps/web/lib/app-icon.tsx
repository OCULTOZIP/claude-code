import { ImageResponse } from "next/og";

/**
 * Ícone do app gerado a partir da marca (anel + arco vermelho + núcleo).
 * `padding` reserva a zona segura dos ícones "maskable" (Android recorta as bordas).
 */
export function appIcon(size: number, padding = 0.18) {
  const mark = Math.round(size * (1 - padding * 2));
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#050505" }}>
        <svg width={mark} height={mark} viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" />
          <path d="M16 2a14 14 0 0 1 14 14" fill="none" stroke="#E50914" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16" cy="16" r="4.5" fill="#E50914" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
