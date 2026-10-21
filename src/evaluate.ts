import { parseArgs } from "node:util";
import { join } from "node:path";
import { loadBundle, ROOT } from "./course";
import { assess } from "./grade";
import fixtures from "../tests/fixtures/grader-smoke.json";
const { values } = parseArgs({
  options: { provider: { type: "string" }, model: { type: "string", default: "" } },
});
if (!values.provider || !["claude", "codex", "openrouter"].includes(values.provider))
  throw Error(
    "Choose --provider claude, codex or openrouter. Jev needs separately labeled probability evaluation.",
  );
const bundle = loadBundle(join(ROOT, "courses/deepinfer"));
let failures = 0;
for (const fixture of fixtures) {
  const result = await assess(
      bundle.challenges[fixture.id],
      fixture.answer,
      values.provider,
      values.model,
    ),
    met = result.grade.criteria.filter((r) => r.verdict === "met").length,
    passed = met >= fixture.minimum_met && met <= fixture.maximum_met;
  if (!passed) failures++;
  console.log(
    JSON.stringify({
      fixture: fixture.name,
      met,
      smoke_expectation_met: passed,
      provider: result.meta.provider,
      model: result.meta.model,
      seconds: result.meta.seconds,
    }),
  );
}
console.log("Authored smoke cases do not establish calibration, robustness or grading accuracy.");
process.exitCode = failures ? 1 : 0;
