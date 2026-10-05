/** Where a dashboard task / recent item / insight should take the student. */
export function linkFor(l: Record<string, any> | null | undefined): string {
  if (!l) return "/app";
  if (l.screen === "learn" && l.chapter_id) return `/app/learn/chapter/${l.chapter_id}`;
  if (l.screen === "practice") return `/app/practice?topics=${(l.topic_ids || []).join(",")}`;
  if (l.screen === "study" && l.id) return `/app/study/${l.id}`;
  if (l.screen === "subject" && l.id) return `/app/learn/${l.id}`;
  if (l.screen === "resource" && l.url) return l.url;
  return "/app";
}
