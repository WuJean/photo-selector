import React from "react";
import { api, json } from "./api";
export default function TaskBar({ jobs, projectId, refresh, notify }) {
  const rows = [];
  const ai = jobs?.ai;
  if (ai?.projectId === projectId && ai.total)
    rows.push({
      key: "ai",
      label: "AI 分类",
      done: ai.done + (ai.skipped || 0),
      total: ai.total,
      errors: ai.errors,
      active: ai.runningIds?.length || 0,
      paused: ai.paused,
      pending: !!ai.photoIds.length,
      action: (a) => api(`/ai/${a}`, json("POST", {})),
    });
  for (const j of jobs?.vocabulary || [])
    if (
      j.projectId === projectId &&
      !["confirmed", "cancelled"].includes(j.state)
    )
      rows.push({
        key: "sample",
        label: j.state === "review" ? "标签待确认" : "抽样",
        done: j.completedIds.length,
        total: j.sampleIds.length,
        errors: Object.keys(j.failed).length,
        paused: j.state === "paused",
        pending: ["sampling", "paused"].includes(j.state),
        action: (a) =>
          api(`/projects/${projectId}/vocabulary/${a}`, json("POST", {})),
      });
  for (const j of jobs?.creations || [])
    if (j.projectId === projectId)
      rows.push({
        key: j.id,
        label: j.kind === "cover" ? "生成封面" : "生成文案",
        done: j.done || 0,
        total: j.total || 1,
        errors: j.state === "error" ? 1 : 0,
        pending: j.state === "running",
        paused: j.state === "paused",
        action: (a) => api(`/creation-jobs/${j.id}/${a}`, json("POST", {})),
      });
  const act = async (row, a) => {
    try {
      await row.action(a);
      await refresh();
    } catch (e) {
      notify(e.message);
    }
  };
  return rows.length ? (
    <div className="global-tasks" aria-label="任务进度">
      {rows.map((row) => (
        <div key={row.key} className="task-row">
          <strong>{row.label}</strong>
          <progress value={row.done} max={row.total} />
          <span>
            {row.done}/{row.total}
          </span>
          {!!row.active && <small>处理中 {row.active}</small>}
          {!!row.errors && <small>失败 {row.errors}</small>}
          {row.pending && (
            <>
              <button onClick={() => act(row, row.paused ? "resume" : "pause")}>
                {row.paused ? "继续" : "暂停"}
              </button>
              <button onClick={() => act(row, "cancel")}>取消</button>
            </>
          )}
          {row.errors > 0 && !row.pending && (
            <button onClick={() => act(row, "retry")}>重试失败</button>
          )}
        </div>
      ))}
    </div>
  ) : null;
}
