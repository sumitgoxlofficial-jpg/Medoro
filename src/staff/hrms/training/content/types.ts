import type { AreaId, LessonContent, Slide } from "../shared";

/** Standard course content, written once here and installed into the database by HR (then edited in the Course Builder). */
export type Q = { prompt: string; options: string[]; answer: number; explanation: string; area?: AreaId };
export type CourseLesson = {
  slug: string; title: string; summary: string; durationMin: number; mandatory?: boolean;
  video?: { kind: "official"; ref: string };
  /** Spoken text of the video, when there is one; otherwise the slides' narration is the transcript. */
  transcript?: string;
  slides: Slide[]; content: LessonContent; quiz: Q[];
};
export type CourseModule = { slug: string; title: string; kind: "intro" | "tour" | "product" | "sales" | "practice"; description: string; lessons: CourseLesson[] };
export type CourseSession = { start: string; end: string; title: string; kind: "session" | "quiz" | "break" | "practical" | "assessment"; moduleSlug?: string };
export type Scenario = { slug: string; title: string; persona: string; situation: string; script: { who: "customer" | "coach"; text: string }[]; goals: string[] };
export type Course = {
  slug: string; title: string; description: string;
  sessions: CourseSession[]; modules: CourseModule[];
  /** One question per official tour chapter (lessonSlug = that chapter). */
  productQuiz: (Q & { lessonSlug: string })[];
  finalExam: Q[];
  scenarios: Scenario[];
};
