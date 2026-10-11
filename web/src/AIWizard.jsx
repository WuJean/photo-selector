import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { api, json } from "./api";
import { Modal, Button } from "./LibraryParts";
import { TAG_CATEGORIES } from "../../shared/tags.mjs";
export default function AIWizard({
  projectId,
  ids,
  onClose,
  onChanged,
  onSettings,
  notify,
}) {
  const [library, setLibrary] = useState(null),
    [job, setJob] = useState(null),
    [analysis, setAnalysis] = useState(null),
    [tags, setTags] = useState([]),
    [enabled, setEnabled] = useState(new Set()),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [category, setCategory] = useState("环境"),
    [editing, setEditing] = useState(null),
    [newName, setNewName] = useState("");
  const initialized = useRef("");
  const alive = useRef(true);
  const load = async () => {
    const [lib, value, jobs] = await Promise.all([
      api(`/projects/${projectId}/tags`),
      api(`/projects/${projectId}/vocabulary`),
      api("/jobs"),
    ]);
    if (!alive.current) return;
    setLibrary(lib);
    setJob(value);
    setAnalysis(jobs.ai.projectId === projectId ? jobs.ai : null);
    const key =
      value?.state === "review"
        ? `review:${value.baseVersion}:${value.completedIds.length}:${Object.keys(value.failed).length}`
        : value?.state === "confirmed"
          ? "confirmed"
          : `base:${lib.version}`;
    if (key !== initialized.current) {
      initialized.current = key;
      const list = value?.state === "review" ? value.candidates : lib.tags;
      setTags(list);
      setEnabled(new Set(list.map((t) => t.name)));
    }
  };
  useEffect(() => {
    alive.current = true;
    load().catch((e) => notify(e.message));
    const timer = setInterval(() => load().catch(() => {}), 1200);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [projectId]);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      await onChanged();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    run(async () => {
      const chosen = tags.filter((t) => enabled.has(t.name));
      await api(
        `/projects/${projectId}/vocabulary`,
        json("POST", { ids, tags: chosen, version: library.version }),
      );
    });
  const confirmed = job?.state === "confirmed";
  const sampling = ["sampling", "paused"].includes(job?.state);
  const review = job?.state === "review";
  const candidateAction = (action) =>
    run(() =>
      api(`/projects/${projectId}/vocabulary/${action}`, json("POST", {})),
    );
  const analysisAction = (action) =>
    run(() => api(`/ai/${action}`, json("POST", {})));
  return (
    <Modal title="AI 分类" onClose={onClose} wide>
      <div className="ai-wizard">
        <header className="ai-step">
          <strong>
            {confirmed
              ? "批量分类"
              : review
                ? "确认候选标签"
                : sampling
                  ? "抽样识别"
                  : "补充常用标签"}
          </strong>
          <button className="text-button" onClick={onSettings}>
            服务设置
          </button>
        </header>
        {!library ? (
          <p>载入中…</p>
        ) : confirmed ? (
          <>
            <div className="job-summary">
              <strong>
                {analysis?.done || 0} / {analysis?.total || 0}
              </strong>
              <span>已完成</span>
              {analysis?.errors > 0 && <span>失败 {analysis.errors}</span>}
            </div>
            <progress
              value={
                (analysis?.done || 0) +
                (analysis?.errors || 0) +
                (analysis?.skipped || 0)
              }
              max={analysis?.total || 1}
            />
            {analysis?.error && <p role="alert">{analysis.error}</p>}
            <div className="wizard-actions">
              {analysis?.photoIds?.length > 0 && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      analysisAction(analysis.paused ? "resume" : "pause")
                    }
                  >
                    {analysis.paused ? "继续分析" : "暂停分析"}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => analysisAction("cancel")}
                  >
                    取消分析
                  </Button>
                </>
              )}
              {analysis?.errors > 0 &&
                !analysis.running &&
                !analysis.photoIds.length && (
                  <Button onClick={() => analysisAction("retry")}>
                    重试失败照片
                  </Button>
                )}
              {!analysis?.running && !analysis?.photoIds?.length && (
                <Button onClick={() => candidateAction("cancel")}>
                  重新分类
                </Button>
              )}
              <Button primary onClick={onClose}>
                返回作品集
              </Button>
            </div>
            {analysis?.usage && (
              <small className="muted">
                用量 {analysis.usage.prompt_tokens} /{" "}
                {analysis.usage.completion_tokens} tokens
              </small>
            )}
          </>
        ) : sampling ? (
          <>
            <div className="job-summary">
              <strong>
                {job.completedIds.length} / {job.sampleIds.length}
              </strong>
              <span>抽样照片</span>
            </div>
            <progress
              value={job.completedIds.length}
              max={job.sampleIds.length}
            />
            {job.error && <p role="alert">{job.error}</p>}
            <div className="wizard-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  candidateAction(job.state === "paused" ? "resume" : "pause")
                }
              >
                {job.state === "paused" ? "继续抽样" : "暂停抽样"}
              </Button>
              <Button disabled={busy} onClick={() => candidateAction("cancel")}>
                取消抽样
              </Button>
              <Button onClick={onClose}>后台继续</Button>
            </div>
          </>
        ) : (
          <>
            {!review && (
              <p className="minimal-prompt">需要添加其他常用标签吗？</p>
            )}
            {review && Object.keys(job.failed).length > 0 && (
              <div role="alert">
                {Object.keys(job.failed).length} 张抽样失败{" "}
                <button
                  className="text-button"
                  onClick={() => candidateAction("retry")}
                >
                  重试
                </button>
              </div>
            )}
            <div className="candidate-tags">
              {TAG_CATEGORIES.map((cat) => (
                <section key={cat}>
                  <h4>{cat}</h4>
                  <div className="tag-chips">
                    {tags
                      .filter((t) => t.category === cat)
                      .map((tag) => (
                        <div className="candidate-tag" key={tag.name}>
                          <button
                            aria-pressed={enabled.has(tag.name)}
                            className={enabled.has(tag.name) ? "active" : ""}
                            onClick={() =>
                              setEnabled((set) => {
                                const next = new Set(set);
                                next.has(tag.name)
                                  ? next.delete(tag.name)
                                  : next.add(tag.name);
                                return next;
                              })
                            }
                          >
                            {tag.name}
                          </button>
                          {review && (
                            <button
                              className="tag-edit"
                              aria-label={`编辑标签 ${tag.name}`}
                              onClick={() => {
                                setEditing(tag.name);
                                setNewName(tag.name);
                              }}
                            >
                              ···
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </section>
              ))}
            </div>
            {editing && review && (
              <form
                className="inline-tag-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  const target = newName.trim();
                  if (!target) return;
                  setTags((list) => [
                    ...new Map(
                      list
                        .map((t) =>
                          t.name === editing
                            ? { ...t, name: target, description: target }
                            : t,
                        )
                        .map((t) => [t.name, t]),
                    ).values(),
                  ]);
                  setEnabled((set) => {
                    const next = new Set(set);
                    next.delete(editing);
                    next.add(target);
                    return next;
                  });
                  setEditing(null);
                }}
              >
                <input
                  aria-label="候选标签新名称"
                  maxLength={40}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button>保存／合并</Button>
                <Button
                  type="button"
                  onClick={() => {
                    setTags((list) => list.filter((t) => t.name !== editing));
                    setEditing(null);
                  }}
                >
                  删除
                </Button>
              </form>
            )}
            <form
              className="new-tag"
              onSubmit={(e) => {
                e.preventDefault();
                const value = name.trim();
                if (!value) return;
                if (!tags.some((t) => t.name === value))
                  setTags((list) => [
                    ...list,
                    { name: value, category, description: value },
                  ]);
                setEnabled((set) => new Set([...set, value]));
                setName("");
              }}
            >
              <input
                aria-label="补充标签"
                placeholder="添加标签"
                maxLength={40}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                aria-label="候选标签分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {TAG_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button className="icon-button" aria-label="添加候选标签">
                <Plus size={18} />
              </button>
            </form>
            <footer>
              <span className="muted">
                {review ? job.photoIds.length : ids.length} 张照片
              </span>
              <Button
                primary
                disabled={busy || !enabled.size || (!review && !ids.length)}
                onClick={
                  review
                    ? () =>
                        run(() =>
                          api(
                            `/projects/${projectId}/vocabulary/confirm`,
                            json("POST", {
                              tags: tags.filter((t) => enabled.has(t.name)),
                            }),
                          ),
                        )
                    : start
                }
              >
                {busy ? <Loader2 className="spin" size={15} /> : null}
                {review ? "确认并开始分类" : "开始抽样"}
              </Button>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}
