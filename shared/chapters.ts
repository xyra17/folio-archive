import type { Chapter } from "./types";

// Source numbering is distinct from archive position (prefaces and selections
// can shift that position). Keep it out of navigation/title matching.
export function chapterTitle(chapter: Pick<Chapter, "title" | "sourceNumber">) {
  const number = chapter.sourceNumber?.trim();
  if (!number || chapter.title.trimStart().startsWith(number + " "))
    return chapter.title;
  return `${number} ${chapter.title}`;
}
