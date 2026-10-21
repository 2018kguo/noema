import { useState } from "react";
import { ArrowRight, Check, ChevronRight, Circle, ExternalLink, Menu } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { Progress } from "./components/ui/progress";
import { cn } from "./lib/utils";

export type LessonSummary = {
  id: string;
  title: string;
  goal: string;
  phase: string;
  skipped?: boolean;
};
export type HomeProps = {
  meta: {
    title: string;
    introduction: string;
    footnote: string;
    origin?: { url: string; title: string; image?: string };
  };
  lessons: LessonSummary[];
  current: LessonSummary;
  started: boolean;
  completed: Record<string, unknown>;
  storageOK: boolean;
  progress: {
    read: number;
    practiced: number;
    total: number;
    blockCount: number;
    resumeRoute: string;
  };
  routes: Record<string, string>;
  navigate: (route: string) => void;
  placement: null | { placed: boolean; levels: { section: string; level: string }[] };
};
const phaseName = (phase: string) =>
  phase.includes(" · ") ? phase.split(" · ").slice(1).join(" · ") : phase;
export function CourseHome({
  meta,
  lessons,
  current,
  started,
  completed,
  progress,
  routes,
  storageOK,
  navigate,
  placement,
}: HomeProps) {
  const phases = [...new Set(lessons.map((l) => l.phase))],
    currentPhase = phases.indexOf(current.phase);
  const [open, setOpen] = useState([...new Set(["phase-0", "phase-" + currentPhase])]);
  const [mobileOpen, setMobileOpen] = useState(false),
    [selected, setSelected] = useState(-1);
  const finished = lessons.filter((l) => completed[l.id]).length;
  function jump(index: number) {
    const id = "phase-" + index;
    setOpen((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setSelected(index);
    setMobileOpen(false);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }
  return (
    <div
      className="ui:grid ui:items-start ui:gap-8 ui:lg:grid-cols-[216px_minmax(0,1fr)] ui:lg:gap-12"
      data-course-home
    >
      <aside className="ui:min-w-0 ui:lg:sticky ui:lg:top-24" aria-label="Course navigation">
        <Button
          variant="outline"
          className="ui:flex ui:w-full ui:justify-between ui:text-base ui:lg:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls="course-sidebar"
        >
          <span className="ui:flex ui:items-center ui:gap-2">
            <Menu size={18} />
            Browse course
          </span>
          <ChevronRight size={18} />
        </Button>
        <div
          id="course-sidebar"
          className={cn("ui:pt-4 ui:lg:block ui:lg:pt-0", !mobileOpen && "ui:hidden")}
        >
          <nav aria-label="Jump to a course section" className="ui:space-y-2">
            <Button
              variant={selected === -1 ? "secondary" : "ghost"}
              className="ui:mb-4 ui:w-full ui:justify-start ui:px-3 ui:text-base"
              onClick={() => {
                setSelected(-1);
                window.scrollTo({ top: 0 });
              }}
            >
              Overview
            </Button>
            {phases.map((phase, i) => (
              <Button
                key={phase}
                variant={selected === i ? "secondary" : "ghost"}
                className="ui:h-auto ui:w-full ui:justify-start ui:whitespace-normal ui:px-3 ui:py-2.5 ui:text-left ui:text-base ui:leading-6"
                onClick={() => jump(i)}
                data-phase-jump={i}
              >
                {phaseName(phase)}
              </Button>
            ))}
          </nav>
          <div className="ui:mt-8 ui:border-t ui:border-border ui:px-3 ui:pt-6">
            <p className="ui:mb-3 ui:text-sm ui:leading-6 ui:text-muted-foreground">
              {progress.read} of {lessons.length} topics read
              <br />
              {finished} practiced
            </p>
            <Progress
              value={(100 * progress.read) / lessons.length}
              aria-valuenow={Math.round((100 * progress.read) / lessons.length)}
              className="ui:h-1.5"
              aria-label="Topics marked read"
            />
          </div>
        </div>
      </aside>
      <div className="ui:min-w-0">
        <header className="ui:mb-8">
          <h1 className="ui:mb-5 ui:text-3xl ui:font-semibold ui:leading-tight ui:tracking-tight ui:sm:text-4xl">
            {meta.title}
          </h1>
          <p className="ui:max-w-[64ch] ui:text-lg ui:leading-8 ui:text-muted-foreground">
            {meta.introduction}
          </p>
          {meta.origin && (
            <a
              href={meta.origin.url}
              target="_blank"
              rel="noopener"
              className="ui:mt-5 ui:flex ui:max-w-xl ui:items-center ui:gap-4 ui:rounded-lg ui:border ui:border-border ui:p-3 ui:no-underline ui:transition-colors ui:hover:bg-muted"
              data-course-origin
            >
              {meta.origin.image && (
                <img
                  src={meta.origin.image}
                  alt=""
                  className="ui:h-14 ui:w-24 ui:shrink-0 ui:rounded ui:object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              <span className="ui:min-w-0">
                <span className="ui:block ui:text-sm ui:text-muted-foreground">Started from</span>
                <span className="ui:block ui:truncate ui:text-base ui:font-medium ui:text-foreground">
                  {meta.origin.title}
                </span>
              </span>
              <ExternalLink size={16} className="ui:ml-auto ui:shrink-0 ui:text-muted-foreground" />
            </a>
          )}
          <p className="ui:mt-5 ui:text-base ui:leading-7 ui:text-muted-foreground">
            {lessons.length} topics in {progress.blockCount} reading blocks, each ending with a few
            questions.
          </p>
        </header>
        {placement && !placement.placed && (
          <Card className="ui:mb-6 ui:gap-4 ui:rounded-lg ui:shadow-none" data-course-placement>
            <CardHeader className="ui:gap-3">
              <CardTitle className="ui:text-xl ui:font-semibold ui:leading-7">
                Start at the right depth
              </CardTitle>
              <CardDescription className="ui:text-base ui:leading-7">
                Each topic is written at up to three depths: Intuition, Mechanism and Frontier. A
                few questions per section show what you already know, so you skip what’s too easy.
                {started && " Your progress so far is kept."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="ui:text-base" onClick={() => navigate("placement")}>
                Find my starting depth
                <ArrowRight size={18} />
              </Button>
            </CardContent>
          </Card>
        )}
        <Card className="ui:mb-10 ui:gap-5 ui:rounded-lg ui:shadow-none" data-course-resume>
          <CardHeader className="ui:gap-3">
            <CardTitle className="ui:text-xl ui:font-semibold ui:leading-7">
              {current.title}
            </CardTitle>
            <CardDescription className="ui:text-base ui:leading-7">{current.goal}</CardDescription>
          </CardHeader>
          <CardContent className="ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-4">
            <p className="ui:text-sm ui:text-muted-foreground">
              Topic {lessons.findIndex((l) => l.id === current.id) + 1} of {lessons.length}
            </p>
            <Button
              className="ui:text-base"
              onClick={() => navigate(progress.resumeRoute)}
              data-course-continue
            >
              {started ? "Resume learning" : "Begin reading"}
              <ArrowRight size={18} />
            </Button>
          </CardContent>
        </Card>
        {placement?.placed && (
          <p className="ui:-mt-6 ui:mb-10 ui:text-base ui:leading-7 ui:text-muted-foreground">
            Your depth: {placement.levels.map((l) => `${l.section} · ${l.level}`).join(", ")}.{" "}
            <button
              type="button"
              className="ui:underline ui:underline-offset-4"
              onClick={() => navigate("placement")}
            >
              Change
            </button>
          </p>
        )}
        <section aria-labelledby="curriculum-title" data-course-outline>
          <h2
            id="curriculum-title"
            className="ui:mb-4 ui:text-xl ui:font-semibold ui:tracking-tight"
          >
            Course content
          </h2>
          <Accordion
            type="multiple"
            value={open}
            onValueChange={setOpen}
            className="ui:w-full ui:rounded-lg ui:border ui:border-border ui:px-5 ui:sm:px-6"
          >
            {phases.map((phase, i) => (
              <AccordionItem
                key={phase}
                value={"phase-" + i}
                id={"phase-" + i}
                className="ui:scroll-mt-6"
              >
                <AccordionTrigger
                  className="ui:items-center ui:gap-3 ui:py-5 ui:text-base ui:hover:no-underline"
                  data-course-section={i}
                >
                  <span className="ui:flex ui:min-w-0 ui:flex-1 ui:flex-wrap ui:items-center ui:gap-x-4 ui:gap-y-1">
                    <span className="ui:text-base ui:font-medium">{phaseName(phase)}</span>
                    <span className="ui:ml-auto ui:shrink-0 ui:text-sm ui:font-normal ui:text-muted-foreground">
                      {lessons.filter((l) => l.phase === phase).length} topics
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="ui:pb-2">
                  {lessons.map((l, j) =>
                    l.phase !== phase ? null : (
                      <button
                        key={l.id}
                        type="button"
                        data-course-lesson={l.id}
                        onClick={() => navigate(routes[l.id])}
                        className="ui:grid ui:w-full ui:grid-cols-[minmax(0,1fr)_20px] ui:sm:grid-cols-[24px_minmax(0,1fr)_20px] ui:items-start ui:gap-3 ui:rounded-md ui:px-1 ui:py-4 ui:text-left ui:transition-colors ui:hover:bg-muted ui:sm:px-2"
                      >
                        <span className="ui:hidden ui:pt-0.5 ui:text-sm ui:tabular-nums ui:sm:block ui:text-muted-foreground">
                          {j + 1}
                        </span>
                        <span className="ui:min-w-0">
                          <span
                            className={cn(
                              "ui:block ui:text-base ui:font-medium ui:leading-7",
                              l.skipped && "ui:text-muted-foreground",
                            )}
                          >
                            {l.title}
                          </span>
                          {l.skipped && (
                            <span className="ui:block ui:text-sm ui:text-muted-foreground">
                              Skipped by your placement
                            </span>
                          )}
                          <span className="ui:mt-1 ui:block ui:text-base ui:leading-7 ui:text-muted-foreground">
                            {l.goal}
                          </span>
                        </span>
                        <span className="ui:pt-1 ui:text-muted-foreground">
                          {completed[l.id] ? (
                            <Check size={18} aria-label="Practiced" />
                          ) : current.id === l.id && started ? (
                            <Circle size={16} fill="currentColor" aria-label="In progress" />
                          ) : (
                            <ArrowRight size={18} aria-hidden="true" />
                          )}
                        </span>
                      </button>
                    ),
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
        <p className="ui:mt-7 ui:text-sm ui:leading-7 ui:text-muted-foreground">{meta.footnote}</p>
        {!storageOK && (
          <p
            role="alert"
            className="ui:mt-4 ui:rounded-md ui:border ui:border-border ui:p-4 ui:text-base"
          >
            Your browser cannot save progress. Use Reference → Export progress before leaving.
          </p>
        )}
      </div>
    </div>
  );
}
