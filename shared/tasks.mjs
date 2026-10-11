// Completed records remain persisted; only unfinished work belongs in the task bar.
export function analysisTaskActivity(job) {
  const pending = !!(
    job?.photoIds?.length ||
    job?.runningIds?.length ||
    job?.running
  );
  return { pending, visible: pending || (job?.errors || 0) > 0 };
}
export function creationTaskVisible(job) {
  return ["running", "paused", "error"].includes(job?.state);
}
