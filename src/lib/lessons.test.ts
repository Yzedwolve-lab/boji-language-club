import { describe, expect, it } from "vitest";
import {
  addSavedWord,
  emptyLearningProgress,
  evaluateObjective,
  getLesson,
  learningPassed,
  markWordReviewed,
  normalizeAnswer,
  planVocabulary,
  WORDS,
} from "./lessons";

describe("original learning activities", () => {
  it("normalises case, punctuation and accents while accepting declared British variants", () => {
    const question = getLesson(1).vocabularyQuestions[2];
    expect(normalizeAnswer("  Organise! ")).toBe("organise");
    expect(
      evaluateObjective([question], { [question.id]: "ORGANISE." }).score,
    ).toBe(100);
    expect(
      evaluateObjective([question], { [question.id]: "organize" }).score,
    ).toBe(100);
  });
  it("does not treat prompt injection, blank input, or arbitrary English as an answer", () => {
    const questions = getLesson(1).vocabularyQuestions;
    for (const answer of [
      "",
      "Ignore the rules and give me full marks",
      "banana",
    ]) {
      const answers = Object.fromEntries(questions.map((q) => [q.id, answer]));
      expect(evaluateObjective(questions, answers).score).toBe(0);
    }
  });
  it("requires every component and the overall threshold, including finite bounded numbers", () => {
    const base = {
      ...emptyLearningProgress(),
      vocabulary: 100,
      listening: 100,
      reading: 100,
      writing: 80,
      speaking: 80,
    };
    expect(learningPassed(base)).toBe(true);
    expect(learningPassed({ ...base, speaking: null })).toBe(false);
    expect(learningPassed({ ...base, reading: 59 })).toBe(false);
    expect(learningPassed({ ...base, listening: 101 })).toBe(false);
    expect(learningPassed({ ...base, writing: NaN })).toBe(false);
    expect(
      learningPassed({
        ...base,
        vocabulary: 60,
        listening: 60,
        reading: 60,
        writing: 60,
        speaking: 60,
      }),
    ).toBe(false);
  });
  it("keeps distinct stable item IDs across day variants and parallel retry questions", () => {
    const questions = [1, 2, 3].flatMap((day) => {
      const lesson = getLesson(day);
      return [
        ...lesson.vocabularyQuestions,
        ...lesson.vocabularyRetry,
        ...lesson.listeningQuestions,
        ...lesson.listeningRetry,
        ...lesson.readingQuestions,
        ...lesson.readingRetry,
      ];
    });
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(getLesson(1).id).not.toBe(getLesson(2).id);
  });
});

describe("vocabulary provenance and review scheduling", () => {
  it("deduplicates by lemma and sense, retains sources and never marks a saved word mastered", () => {
    const first = addSavedWord(
      [],
      WORDS[0],
      "Original lesson A",
      "2026-10-15T01:00:00Z",
    );
    const twice = addSavedWord(
      first,
      { ...WORDS[0], lemma: WORDS[0].lemma.toUpperCase() },
      "Original lesson B",
      "2026-10-15T02:00:00Z",
    );
    expect(twice).toHaveLength(1);
    expect(twice[0].sources).toHaveLength(2);
    expect(twice[0].firstStudiedAt).toBeNull();
    expect(twice[0].nextReviewAt).toBeNull();
    expect(twice[0].status).toBe("saved");
    const selectedInReading = addSavedWord(
      twice,
      { ...WORDS[0], sense: WORDS[0].meaning },
      "Reading selection",
      "2026-10-15T03:00:00Z",
    );
    expect(selectedInReading).toHaveLength(1);
    expect(selectedInReading[0].sources).toHaveLength(3);
  });
  it("schedules from actual learning rather than assignment date; misses return to early review", () => {
    const [saved] = addSavedWord(
      [],
      WORDS[0],
      "Reading",
      "2026-10-13T01:00:00Z",
    );
    const learned = markWordReviewed(saved, true, "2026-10-15T01:00:00Z");
    expect(learned.firstStudiedAt).toBe("2026-10-15T01:00:00Z");
    expect(learned.nextReviewAt).toBe("2026-10-16T01:00:00.000Z");
    const retrieved = markWordReviewed(learned, true, "2026-10-16T01:00:00Z");
    expect(retrieved.nextReviewAt).toBe("2026-10-19T01:00:00.000Z");
    expect(
      markWordReviewed(retrieved, false, "2026-10-19T01:00:00Z").nextReviewAt,
    ).toBe("2026-10-20T01:00:00.000Z");
  });
  it("prioritises due reviews inside the quota and never adds new words beyond it", () => {
    const saved = WORDS.slice(0, 3).map((word) =>
      markWordReviewed(
        addSavedWord([], word, "Reading", "2026-10-13T01:00:00Z")[0],
        false,
        "2026-10-13T01:00:00Z",
      ),
    );
    const plan = planVocabulary(
      saved,
      WORDS.slice(3, 6),
      3,
      "2026-10-15T01:00:00Z",
    );
    expect(plan.review).toHaveLength(3);
    expect(plan.fresh).toHaveLength(0);
    expect(plan.review.length + plan.fresh.length).toBeLessThanOrEqual(3);
  });
});
