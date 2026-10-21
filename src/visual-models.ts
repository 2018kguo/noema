// Small teaching models. They describe the stated assumptions, not experimental evidence.
export function bindingFraction(kd: number, concentration: number) {
  if (!Number.isFinite(kd) || kd <= 0 || !Number.isFinite(concentration) || concentration < 0)
    throw Error("Binding needs positive Kd and nonnegative free ligand concentration.");
  return concentration / (kd + concentration);
}

export function screenCounts(
  population: number,
  prevalence: number,
  sensitivity: number,
  falsePositiveRate: number,
) {
  if (
    !Number.isFinite(population) ||
    population <= 0 ||
    [prevalence, sensitivity, falsePositiveRate].some((n) => !Number.isFinite(n) || n < 0 || n > 1)
  )
    throw Error("Screening needs a positive population and rates from 0 to 1.");
  const positive = population * prevalence,
    negative = population - positive,
    truePositive = positive * sensitivity,
    falsePositive = negative * falsePositiveRate,
    flagged = truePositive + falsePositive;
  return {
    positive,
    negative,
    truePositive,
    falsePositive,
    falseNegative: positive - truePositive,
    trueNegative: negative - falsePositive,
    flagged,
    precision: flagged ? truePositive / flagged : null,
  };
}

export function scheduleTimes(tasks: { id: string; duration: number; after: string[] }[]) {
  const times = new Map<string, { start: number; end: number }>();
  for (const task of tasks) {
    if (
      times.has(task.id) ||
      !Number.isFinite(task.duration) ||
      task.duration < 0 ||
      task.after.some((id) => !times.has(id))
    )
      throw Error(
        "Schedule tasks need unique IDs, nonnegative durations and dependencies listed first.",
      );
    const start = Math.max(0, ...task.after.map((id) => times.get(id)!.end));
    times.set(task.id, { start, end: start + task.duration });
  }
  const finish = Math.max(0, ...[...times.values()].map((t) => t.end)),
    critical = new Set<string>();
  const visit = (id: string) => {
    if (critical.has(id)) return;
    critical.add(id);
    const task = tasks.find((t) => t.id === id)!;
    for (const dependency of task.after)
      if (times.get(dependency)!.end === times.get(id)!.start) visit(dependency);
  };
  for (const task of tasks) if (times.get(task.id)!.end === finish) visit(task.id);
  return { times, finish, critical };
}
