import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReadyCourse, type ReadyCourseProps } from "./ready-course";
import { CourseHome, type HomeProps } from "./course-home";
import { ReadingContents, type ContentsProps } from "./reading-contents";
import { Card, CardContent } from "./components/ui/card";
import { Progress } from "./components/ui/progress";

const roots = new Map<Element, Root>();
function mount(element: Element, content: React.ReactNode) {
  const root = roots.get(element) || createRoot(element);
  roots.set(element, root);
  element.classList.add("shadcn");
  flushSync(() => root.render(content));
}
const ui = {
  unmount() {
    for (const root of roots.values()) root.unmount();
    roots.clear();
  },
  home(element: Element, props: HomeProps) {
    mount(element, <CourseHome {...props} />);
  },
  contents(element: Element, props: ContentsProps) {
    mount(element, <ReadingContents {...props} />);
  },
  readyCourse(element: Element, props: ReadyCourseProps) {
    mount(element, <ReadyCourse {...props} />);
  },
  lesson() {
    document.querySelectorAll<HTMLElement>("[data-example-card]").forEach((element) => {
      const step = Number(element.dataset.exampleStep),
        count = Number(element.dataset.exampleCount);
      const html = element.innerHTML;
      mount(
        element,
        <Card className="ui:gap-0 ui:rounded-lg ui:shadow-none">
          <CardContent>
            <div className="ui:mb-5 ui:flex ui:items-center ui:justify-between ui:gap-4 ui:text-sm ui:text-muted-foreground">
              <span>
                Step {step + 1} of {count}
              </span>
              <Progress
                value={(100 * (step + 1)) / count}
                className="ui:h-1 ui:w-24"
                aria-label="Example progress"
              />
            </div>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </CardContent>
        </Card>,
      );
    });
    document.querySelectorAll<HTMLElement>("[data-block-card]").forEach((element) => {
      const html = element.innerHTML;
      mount(
        element,
        <Card className="ui:gap-0 ui:rounded-lg ui:shadow-none">
          <CardContent>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </CardContent>
        </Card>,
      );
    });
  },
};
declare global {
  interface Window {
    NoemaUI: typeof ui;
  }
}
window.NoemaUI = ui;

window.dispatchEvent(new Event("noema-ui-ready"));
if (document.getElementById("course-brand"))
  fetch("course.json")
    .then((response) => {
      if (!response.ok) throw Error("Course data could not load");
      return response.json();
    })
    .then((course) => {
      Object.assign(window, course);
      document.title = course.META.title;
      if (location.pathname.startsWith("/learn/"))
        document.getElementById("course-brand")!.setAttribute("href", "/");
      const script = document.createElement("script");
      script.src = "app.js";
      document.body.appendChild(script);
    })
    .catch(() => {
      document.getElementById("main")!.innerHTML =
        '<h1>Open your local course</h1><p>Start Noema with <code>bun run start</code>, then open <a href="http://127.0.0.1:8765">http://127.0.0.1:8765</a>.</p>';
    });
