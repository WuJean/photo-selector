import { uid } from "./store.mjs";
// Every original is represented. Phase barriers make retries resume only missing work.
export function creationTasks(type, photos) {
  if (!["copy", "cover"].includes(type)) return [{ id: uid(), phase: 0 }];
  const tasks = photos.map((p) => ({
    id: uid(),
    phase: 0,
    step: "describe",
    photoId: p.id,
  }));
  let previous = tasks.slice(),
    phase = 1;
  while (previous.length > 1 || phase === 1) {
    const next = [];
    for (let i = 0; i < previous.length; i += 20) {
      const group = previous.slice(i, i + 20),
        t = {
          id: uid(),
          phase,
          step: "summarize",
          depends: group.map((v) => v.id),
        };
      tasks.push(t);
      next.push(t);
    }
    previous = next;
    phase++;
  }
  tasks.push({
    id: uid(),
    phase,
    step: type,
    depends: previous.map((v) => v.id),
  });
  return tasks;
}
