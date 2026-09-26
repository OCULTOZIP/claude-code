import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Checagem barata de presença de cookie para UX (redireciona cedo).
// A barreira real de segurança é a API, que valida a sessão em toda rota.
export function proxy(request: NextRequest) {
  const hasSession = getSessionCookie(request, { cookiePrefix: "norbius" });
  if (!hasSession) {
    const url = new URL("/entrar", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/configuracoes/:path*"],
};
