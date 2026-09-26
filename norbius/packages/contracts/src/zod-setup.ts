import { z } from "zod";

// No navegador a CSP não permite eval: sem isto o zod testa `new Function` e o
// navegador registra uma violação de CSP. Precisa rodar ANTES de qualquer
// schema ser criado (o zod decide o modo JIT na criação). No servidor o JIT
// continua ativo.
if ("window" in globalThis) z.config({ jitless: true });
