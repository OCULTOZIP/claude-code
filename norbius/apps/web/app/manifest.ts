import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NORBIUS — inteligência financeira",
    short_name: "NORBIUS",
    description: "Organize, entenda e projete sua vida financeira com o NORBIUS.",
    lang: "pt-BR",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Conversar por voz", url: "/norbius", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Transações", url: "/transacoes", icons: [{ src: "/icons/192", sizes: "192x192" }] },
    ],
  };
}
