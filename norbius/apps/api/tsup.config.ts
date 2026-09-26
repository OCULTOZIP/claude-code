import { defineConfig } from "tsup";

// Empacota a API com os pacotes internos (@norbius/*), mantendo as demais
// dependências externas (instaladas no container de produção).
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: [/^@norbius\//],
});
