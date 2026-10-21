import { ArrowRight, ExternalLink, MoreHorizontal } from "lucide-react";
import { Card, CardContent } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import { Button } from "./components/ui/button";
export type ReadyCourseProps = {
  id: string;
  title: string;
  domain: string;
  url: string;
  sample: boolean;
  // The link that started the course and its preview image, so people recognize it.
  origin: string;
  image: string | null;
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
        levelName: string;
        passes: number;
      };
};
const host = (url: string) => {
  try {
    // Archived links show the original site, not the archive.
    const u = new URL(url.replace(/^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//, ""));
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export function ReadyCourse({
  id,
  title,
  domain,
  url,
  sample,
  progress,
  origin,
  image,
}: ReadyCourseProps) {
  const available = progress?.kind === "available" ? progress : null;
  const href = available?.started && !available.complete ? url + "#" + available.resumeRoute : url;
  return (
    <Card className="ui:mb-3 ui:gap-0 ui:py-0 ui:rounded-lg ui:shadow-none" data-learning-card={id}>
      <CardContent className="ui:relative ui:flex ui:gap-5 ui:p-6">
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="ui:hidden ui:h-[84px] ui:w-[160px] ui:shrink-0 ui:rounded-md ui:border ui:border-border ui:object-cover ui:sm:block"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        <a
          href={href}
          className={
            (sample ? "sample-row" : "ready-row") +
            " ui:block ui:min-w-0 ui:flex-1 ui:pr-16 ui:no-underline"
          }
        >
          <h3 className="ui:mb-2 ui:text-xl ui:font-medium ui:leading-7 ui:text-foreground">
            {title}
          </h3>
          <div className="ui:mb-4 ui:flex ui:items-center ui:gap-2 ui:text-sm ui:text-muted-foreground">
            <img
              src={`https://icons.duckduckgo.com/ip3/${host(origin)}.ico`}
              alt=""
              width={16}
              height={16}
              className="ui:rounded-sm"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
            {domain}
          </div>
          {available ? (
            <>
              <div className="ui:mt-4 ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-x-3 ui:gap-y-1 ui:text-base ui:text-muted-foreground">
                <span>
                  {available.passes > 1 && available.levelName + " · "}
                  {available.read} of {available.total} topics read · {available.practiced}{" "}
                  questions answered
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
                    ? "Every question answered"
                    : "Continue: " + available.currentTitle}
                </p>
              )}
            </>
          ) : (
            <p className="ui:my-3 ui:text-sm ui:text-muted-foreground">
              {progress
                ? "Couldn’t load this course. Open it to see the error."
                : "Loading saved progress…"}
            </p>
          )}
          <span className="ui:mt-4 ui:flex ui:items-center ui:gap-2 ui:text-base ui:font-medium ui:text-foreground">
            {available?.started ? "Continue learning" : "Open course"}
            <ArrowRight size={14} />
          </span>
        </a>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className={"ui:absolute ui:top-3 " + (sample ? "ui:right-3" : "ui:right-12")}
        >
          <a
            href={origin}
            target="_blank"
            rel="noopener"
            aria-label={"Open the original link: " + host(origin)}
            title={"Open the original link: " + origin}
          >
            <ExternalLink size={16} />
          </a>
        </Button>
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
