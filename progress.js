"use strict";
(() => {
  // browser/progress.ts
  function minutes(lesson) {
    return lesson.reading_minutes || Math.max(
      5,
      Math.ceil(
        (String(lesson.layers?.[0] || "").replace(/<[^>]*>/g, " ").split(/\s+/).length + (Array.isArray(lesson.example?.[1]) ? lesson.example[1] : []).join(" ").split(/\s+/).length) / 170
      ) + 3
    );
  }
  function blocks(lessons, size) {
    const count = Number.isInteger(size) && size >= 2 && size <= 12 ? size : void 0, result = [];
    for (let i = 0; i < lessons.length; ) {
      const start = i, topics = [];
      let duration = 0;
      do {
        const lesson = lessons[i++];
        topics.push(lesson);
        duration += minutes(lesson);
      } while (i < lessons.length && (count ? topics.length < count : duration < 30));
      result.push({
        id: "block-" + topics.map((l) => l.id).join("."),
        index: result.length,
        start,
        minutes: duration,
        lessons: topics
      });
    }
    if (result.length > 1 && result.at(-1).lessons.length === 1) {
      const last = result.pop(), previous = result.at(-1);
      previous.lessons.push(...last.lessons);
      previous.minutes += last.minutes;
      previous.id = "block-" + previous.lessons.map((l) => l.id).join(".");
    }
    return result;
  }
  function summary(course) {
    if (!course.META || !course.LESSONS?.length) throw Error("Course metadata unavailable.");
    return {
      key: course.META.progress_key || "noema:" + course.META.id,
      size: course.META.reading_block_size,
      lessons: course.LESSONS.map((l) => ({
        id: l.id,
        title: l.title,
        phase: l.phase,
        reading_minutes: minutes(l)
      }))
    };
  }
  function snapshot(course, state = {}) {
    const info = "lessons" in course ? course : summary(course), lessons = info.lessons;
    if (!lessons.length) throw Error("Course has no topics.");
    const practiced = lessons.filter((l) => state.completed?.[l.id]).length, read2 = lessons.filter((l) => state.read?.[l.id] || state.completed?.[l.id]).length, readingBlocks = blocks(lessons, info.size);
    let current = lessons.find((l) => l.id === state.lastLesson) || lessons.find((l) => !state.completed?.[l.id]) || lessons[0], block = readingBlocks.find((b) => b.lessons.some((l) => l.id === current.id)), step = state.blocks?.[block.id]?.step || "read";
    if (step === "done") {
      block = readingBlocks.find((b) => b.lessons.some((l) => !state.completed?.[l.id])) || block;
      current = block.lessons.find((l) => !state.completed?.[l.id]) || block.lessons.at(-1);
      step = state.blocks?.[block.id]?.step || "read";
    }
    if (!["read", "practice", "explain"].includes(step)) step = "read";
    const complete = practiced === lessons.length, started = !!state.lastLesson || read2 > 0 || practiced > 0;
    return {
      kind: "available",
      total: lessons.length,
      read: read2,
      practiced,
      percent: Math.round(100 * read2 / lessons.length),
      started,
      complete,
      currentId: current.id,
      currentTitle: current.title || current.id,
      blockIndex: block.index,
      blockCount: readingBlocks.length,
      resumeRoute: complete ? "home" : "block/" + block.id + "/" + step + (step === "read" && started ? "/" + current.id : "")
    };
  }
  function read(course, storage) {
    try {
      const info = "lessons" in course ? course : summary(course), raw = storage.getItem(info.key), state = raw === null ? {} : JSON.parse(raw);
      if (!state || typeof state !== "object" || Array.isArray(state))
        throw Error("Saved progress is invalid");
      return snapshot(info, state);
    } catch {
      return { kind: "unavailable" };
    }
  }
  var progress = { blocks, summary, snapshot, read };
  if (typeof window !== "undefined") window.NoemaProgress = progress;
})();
