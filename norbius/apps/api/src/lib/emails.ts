import type { Email } from "./mailer";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string, cta: { label: string; url: string }, footnote: string) {
  const url = escape(cta.url);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#050505;font-family:Helvetica,Arial,sans-serif;color:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;padding:40px 16px">
<tr><td align="center"><table role="presentation" width="100%" style="max-width:480px;background:#121214;border:1px solid #1A1A1D;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:4px;font-weight:700;color:#ffffff">NORBIUS<span style="color:#E50914">.</span></td></tr>
<tr><td style="padding-top:24px;font-size:22px;font-weight:600">${escape(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#A1A1AA">${body}</td></tr>
<tr><td style="padding-top:28px"><a href="${url}" style="display:inline-block;background:#E50914;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escape(cta.label)}</a></td></tr>
<tr><td style="padding-top:28px;font-size:12px;line-height:1.6;color:#66666D">${escape(footnote)}<br>Se o botão não funcionar, copie este link: <span style="color:#A1A1AA;word-break:break-all">${url}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: "Confirme seu e-mail no NORBIUS",
    html: layout(
      `Olá, ${name}.`,
      "Confirme seu e-mail para ativar sua conta e começar a organizar sua vida financeira com o NORBIUS.",
      { label: "Confirmar e-mail", url },
      "Este link expira em 24 horas. Se você não criou uma conta, ignore esta mensagem.",
    ),
    text: `Olá, ${name}. Confirme seu e-mail no NORBIUS: ${url}\n\nO link expira em 24 horas. Se você não criou uma conta, ignore esta mensagem.`,
  };
}

export function resetPasswordEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: "Redefinição de senha do NORBIUS",
    html: layout(
      `Olá, ${name}.`,
      "Recebemos um pedido para redefinir a senha da sua conta. Ao redefinir, todas as sessões abertas serão encerradas.",
      { label: "Redefinir senha", url },
      "Este link expira em 30 minutos. Se você não pediu a redefinição, ignore esta mensagem — sua senha continua a mesma.",
    ),
    text: `Olá, ${name}. Redefina sua senha do NORBIUS: ${url}\n\nO link expira em 30 minutos. Se você não pediu, ignore esta mensagem.`,
  };
}

export function passwordChangedEmail(to: string, name: string, supportUrl: string): Email {
  return {
    to,
    subject: "Sua senha do NORBIUS foi alterada",
    html: layout(
      `Olá, ${name}.`,
      "A senha da sua conta foi alterada e as sessões abertas foram encerradas. Se foi você, nada mais é necessário.",
      { label: "Não fui eu", url: supportUrl },
      "Se você não reconhece esta alteração, redefina sua senha imediatamente.",
    ),
    text: `Olá, ${name}. A senha da sua conta NORBIUS foi alterada. Se não foi você, redefina a senha: ${supportUrl}`,
  };
}
