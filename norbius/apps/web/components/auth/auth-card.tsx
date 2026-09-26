import { Card } from "@norbius/ui";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{description}</p> : null}
        <div className="mt-7">{children}</div>
      </Card>
      {footer ? <div className="mt-6 text-center text-sm text-fg-secondary">{footer}</div> : null}
    </>
  );
}
