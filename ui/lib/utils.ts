import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
const merge = extendTailwindMerge({ prefix: "ui" });
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
