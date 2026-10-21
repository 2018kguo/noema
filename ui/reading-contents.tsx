import { Check } from "lucide-react";
import { Card, CardContent } from "./components/ui/card";

export type ContentsProps = {
  items: { id: string; n: number; title: string; href: string; read: boolean }[];
};
// The topics in a reading block; a check marks each one read.
export function ReadingContents({ items }: ContentsProps) {
  return (
    <Card className="ui:my-7 ui:gap-0 ui:rounded-lg ui:py-2 ui:shadow-none">
      <CardContent className="ui:px-2">
        <ol className="ui:m-0 ui:list-none ui:p-0">
          {items.map((t) => (
            <li key={t.id}>
              <a
                href={t.href}
                data-read-jump={t.id}
                data-read={t.read || undefined}
                className="ui:grid ui:grid-cols-[1.5rem_minmax(0,1fr)_1rem] ui:items-center ui:gap-3 ui:rounded-md ui:px-3 ui:py-2.5 ui:text-base ui:leading-6 ui:text-foreground ui:no-underline ui:transition-colors ui:hover:bg-muted"
              >
                <span className="ui:text-sm ui:tabular-nums ui:text-muted-foreground">{t.n}</span>
                <span>{t.title}</span>
                {t.read ? (
                  <Check size={16} className="ui:text-muted-foreground" aria-label="Read" />
                ) : (
                  <span />
                )}
              </a>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
