import { ArrowRight, MoreHorizontal } from "lucide-react";
import { Card, CardContent } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import { Button } from "./components/ui/button";
export type ReadyCourseProps = {
  id: string;
  title: string;
  domain: string;
  url: string;
  sample: boolean;
  progress:
    | null
    | { kind: "unavailable" }
    | {
        kind: "available";
        read: number;
        practiced: number;
        total: number;
        percent: number;
        started: boolean;
        complete: boolean;
        currentTitle: string;
        resumeRoute: string;
      };
};
export function ReadyCourse({ id, title, domain, url, sample, progress }: ReadyCourseProps) {
  const available = progress?.kind === "available" ? progress : null;
  const href = available?.started && !available.complete ? url + "#" + available.resumeRoute : url;
  return (
    <Card className="ui:mb-3 ui:gap-0 ui:py-0 ui:rounded-lg ui:shadow-none" data-learning-card={id}>
      <CardContent className="ui:relative ui:p-6">
        <a
          href={href}
          className={(sample ? "sample-row" : "ready-row") + " ui:block ui:pr-8 ui:no-underline"}
        >
          <h3 className="ui:mb-2 ui:text-xl ui:font-medium ui:leading-7 ui:text-foreground">
            {title}
          </h3>
          <div className="ui:mb-4 ui:flex ui:items-center ui:gap-2 ui:text-sm ui:text-muted-foreground">
            {domain}
          </div>
          {available ? (
            <>
              <div className="ui:mt-4 ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-x-3 ui:gap-y-1 ui:text-base ui:text-muted-foreground">
                <span>
                  {available.read} of {available.total} topics read · {available.practiced}{" "}
                  practiced
                </span>
                <span className="ui:tabular-nums">{available.percent}%</span>
              </div>
              <Progress
                value={available.percent}
                aria-label={title + " reading progress"}
                aria-valuenow={available.percent}
                className="ui:mt-2 ui:h-1.5"
              />
              {(available.started || available.complete) && (
                <p className="ui:mt-3 ui:text-base ui:leading-7 ui:text-muted-foreground">
                  {available.complete
                    ? "All blocks practiced"
                    : "Continue: " + available.currentTitle}
                </p>
              )}
            </>
          ) : (
            <p className="ui:my-3 ui:text-sm ui:text-muted-foreground">
              {progress ? "Progress unavailable in this browser" : "Loading saved progress…"}
            </p>
          )}
          <span className="ui:mt-4 ui:flex ui:items-center ui:gap-2 ui:text-base ui:font-medium ui:text-foreground">
            {available?.started ? "Continue learning" : "Open course"}
            <ArrowRight size={14} />
          </span>
        </a>
        {!sample && (
          <Button
            variant="ghost"
            size="icon"
            className="ui:absolute ui:right-3 ui:top-3"
            data-item={id}
            aria-label={"Details and sharing for " + title}
          >
            <MoreHorizontal size={17} />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
