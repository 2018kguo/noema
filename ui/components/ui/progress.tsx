// Adapted from shadcn/ui (MIT); see ../LICENSE and ../source.json.
"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import { Progress as ProgressPrimitive } from "radix-ui";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "ui:relative ui:h-2 ui:w-full ui:overflow-hidden ui:rounded-full ui:bg-primary/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="ui:h-full ui:w-full ui:flex-1 ui:bg-primary ui:transition-transform"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
