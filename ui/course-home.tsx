import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  List,
  Menu,
  RotateCcw,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { Badge } from "./components/ui/badge";
import { Progress } from "./components/ui/progress";
import { cn } from "./lib/utils";

export type LessonSummary = { id: string; title: string; goal: string; phase: string };
export type HomeProps = {
  meta: { title: string; introduction: string; footnote: string };
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
}: HomeProps) {
  const phases = [...new Set(lessons.map((l) => l.phase))];
  const currentPhase = phases.indexOf(current.phase);
  const [open, setOpen] = useState([...new Set(["phase-0", "phase-" + currentPhase])]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
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
      className="ui:grid ui:items-start ui:gap-8 ui:lg:grid-cols-[216px_minmax(0,1fr)] ui:lg:gap-14"
      data-course-home
    >
      <aside className="ui:min-w-0 ui:lg:sticky ui:lg:top-24" aria-label="Course navigation">
        <Button
          variant="outline"
          className="ui:flex ui:w-full ui:justify-between ui:lg:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls="course-sidebar"
        >
          <span className="ui:flex ui:items-center ui:gap-2">
            <Menu size={16} /> Browse course
          </span>
          <ChevronRight size={16} />
        </Button>
        <div
          id="course-sidebar"
          className={cn("ui:pt-4 ui:lg:block ui:lg:pt-0", !mobileOpen && "ui:hidden")}
        >
          <div className="ui:mb-6 ui:flex ui:items-start ui:gap-3 ui:px-2">
            <BookOpen className="ui:mt-0.5 ui:size-4 ui:shrink-0 ui:text-muted-foreground" />
            <div>
              <p className="ui:text-sm ui:font-medium">{meta.title}</p>
              <p className="ui:mt-1 ui:text-xs ui:text-muted-foreground">
                {lessons.length} lessons · self-paced
              </p>
            </div>
          </div>
          <nav aria-label="Jump to a course section" className="ui:space-y-1">
            <Button
              variant={selected === -1 ? "secondary" : "ghost"}
              className="ui:w-full ui:justify-start ui:gap-2 ui:px-3 ui:text-[13px]"
              onClick={() => {
                setSelected(-1);
                window.scrollTo({ top: 0 });
              }}
            >
              <List size={15} /> Overview
            </Button>
            <p className="ui:px-3 ui:pb-2 ui:pt-6 ui:text-xs ui:font-medium ui:text-muted-foreground">
              Course content
            </p>
            {phases.map((phase, i) => (
              <Button
                key={phase}
                variant={selected === i ? "secondary" : "ghost"}
                className="ui:h-auto ui:w-full ui:justify-start ui:gap-3 ui:whitespace-normal ui:px-3 ui:py-2.5 ui:text-left ui:text-[13px] ui:leading-5"
                onClick={() => jump(i)}
                data-phase-jump={i}
              >
                <span className="ui:w-4 ui:shrink-0 ui:text-xs ui:tabular-nums ui:text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {phaseName(phase)}
              </Button>
            ))}
          </nav>
          <div className="ui:mt-7 ui:border-t ui:border-border ui:px-3 ui:pt-5">
            <p className="ui:mb-2 ui:text-xs ui:text-muted-foreground">
              {progress.read} of {lessons.length} topics read
            </p>
            <Progress
              value={(100 * progress.read) / lessons.length}
              className="ui:h-1"
              aria-label="Topics marked read"
            />
            <p className="ui:mt-2 ui:text-xs ui:text-muted-foreground">{finished} practiced</p>
            <p className="ui:mt-3 ui:text-xs ui:leading-5 ui:text-muted-foreground">
              Your place and answers are saved in this browser.
            </p>
          </div>
        </div>
      </aside>

      <div className="ui:min-w-0">
        <nav
          aria-label="Breadcrumb"
          className="ui:mb-7 ui:flex ui:items-center ui:gap-2 ui:text-xs ui:text-muted-foreground"
        >
          <span>Learning</span>
          <ChevronRight size={13} />
          <span className="ui:text-foreground">Course overview</span>
        </nav>
        <header className="ui:mb-8">
          <h1 className="ui:mb-4 ui:text-[30px] ui:font-semibold ui:leading-tight ui:tracking-tight ui:sm:text-4xl">
            {meta.title}
          </h1>
          <p className="ui:max-w-[64ch] ui:text-[15px] ui:leading-7 ui:text-muted-foreground">
            {meta.introduction}
          </p>
          <div className="ui:mt-5 ui:flex ui:flex-wrap ui:items-center ui:gap-2">
            <Badge variant="secondary">{progress.blockCount} reading blocks</Badge>
            <Badge variant="outline">{lessons.length} topics</Badge>
            <span className="ui:text-xs ui:text-muted-foreground">
              Grouped quizzes after each block
            </span>
          </div>
        </header>

        <Card className="ui:mb-10 ui:gap-5 ui:rounded-lg ui:shadow-none" data-course-resume>
          <CardHeader className="ui:gap-2">
            <div className="ui:mb-1 ui:flex ui:items-center ui:gap-2 ui:text-xs ui:font-medium ui:text-muted-foreground">
              <RotateCcw size={13} />
              {started ? "Continue learning" : "Start here"}
            </div>
            <CardTitle className="ui:text-lg ui:leading-7 ui:font-semibold">
              {current.title}
            </CardTitle>
            <CardDescription className="ui:leading-6">{current.goal}</CardDescription>
          </CardHeader>
          <CardContent className="ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-4">
            <p className="ui:text-xs ui:text-muted-foreground">
              Lesson {lessons.indexOf(current) + 1} of {lessons.length}
            </p>
            <Button onClick={() => navigate(progress.resumeRoute)} data-course-continue>
              {started ? "Resume learning" : "Begin reading"}
              <ArrowRight size={16} />
            </Button>
          </CardContent>
        </Card>

        <section aria-labelledby="curriculum-title" data-course-outline>
          <div className="ui:mb-3 ui:flex ui:items-baseline ui:justify-between ui:gap-4">
            <h2 id="curriculum-title" className="ui:text-lg ui:font-semibold ui:tracking-tight">
              Course content
            </h2>
            <span className="ui:text-xs ui:text-muted-foreground">{phases.length} sections</span>
          </div>
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
                  className="ui:items-center ui:gap-3 ui:py-5 ui:hover:no-underline"
                  data-course-section={i}
                >
                  <span className="ui:flex ui:min-w-0 ui:flex-1 ui:items-center ui:gap-3">
                    <span className="ui:text-xs ui:font-normal ui:tabular-nums ui:text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="ui:text-sm ui:font-medium">{phaseName(phase)}</span>
                    <span className="ui:ml-auto ui:shrink-0 ui:text-xs ui:font-normal ui:text-muted-foreground">
                      {lessons.filter((l) => l.phase === phase).length} lessons
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
                        className="ui:group ui:grid ui:w-full ui:grid-cols-[24px_minmax(0,1fr)_20px] ui:items-start ui:gap-3 ui:rounded-md ui:px-1 ui:py-4 ui:text-left ui:transition-colors ui:hover:bg-muted ui:sm:px-2"
                      >
                        <span className="ui:pt-0.5 ui:text-xs ui:tabular-nums ui:text-muted-foreground">
                          {String(j + 1).padStart(2, "0")}
                        </span>
                        <span className="ui:min-w-0">
                          <span className="ui:block ui:text-sm ui:font-medium ui:leading-6">
                            {l.title}
                          </span>
                          <span className="ui:mt-1 ui:block ui:text-[13px] ui:leading-6 ui:text-muted-foreground">
                            {l.goal}
                          </span>
                        </span>
                        <span className="ui:pt-1 ui:text-muted-foreground">
                          {completed[l.id] ? (
                            <Check size={16} aria-label="Practiced" />
                          ) : current.id === l.id && started ? (
                            <Circle size={14} fill="currentColor" aria-label="In progress" />
                          ) : (
                            <ArrowRight size={15} aria-hidden="true" />
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
        <p className="ui:mt-7 ui:text-xs ui:leading-6 ui:text-muted-foreground">{meta.footnote}</p>
        {!storageOK && (
          <p
            role="alert"
            className="ui:mt-4 ui:rounded-md ui:border ui:border-border ui:p-4 ui:text-sm"
          >
            Your browser cannot save progress. Use Reference → Export progress before leaving.
          </p>
        )}
      </div>
    </div>
  );
}
