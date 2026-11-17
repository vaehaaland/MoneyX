import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MoneyX",
    short_name: "MoneyX",
    description: "Hald styr på lån, nedbetaling og forbruk.",
    lang: "nn",
    start_url: "/",
    display: "standalone",
    background_color: "#f4fbf8",
    theme_color: "#006a60",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
