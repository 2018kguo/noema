import type { Course } from "../src/course";
import type { HomeProps } from "../ui/course-home";
declare global {
  const META: Course["META"];
  const LESSONS: Course["LESSONS"];
  const SOURCES: Course["SOURCES"];
  const LABS: Course["LABS"];
  const GLOSSARY: Course["GLOSSARY"];
  const CONTENT_REVISION: string;
  const NoemaUI: {
    unmount(): void;
    home(element: Element, props: HomeProps): void;
    lesson(): void;
    contents(element: Element, props: import("../ui/reading-contents").ContentsProps): void;
    readyCourse(element: Element, props: import("../ui/ready-course").ReadyCourseProps): void;
  };
  interface Window {
    NoemaUI: typeof NoemaUI;
    NoemaProgress: typeof NoemaProgress;
    NoemaVisuals: typeof NoemaVisuals;
  }
  const NoemaProgress: typeof import("./progress").progress;
  const NoemaVisuals: typeof import("./visuals").visuals;
}
