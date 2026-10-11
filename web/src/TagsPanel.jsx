import React, { useState, useEffect } from "react";
import { X, Plus, Check } from "lucide-react";
import { api, json } from "./api";
import { TAG_CATEGORIES } from "../../shared/tags.mjs";
import { tagsOf } from "../../shared/domain.mjs";
export default function TagsPanel({
  projectId,
  photos,
  ids,
  onClose,
  onChanged,
  notify,
}) {
  const [library, setLibrary] = useState(null),
    [mode, setMode] = useState("assign"),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [category, setCategory] = useState("其他"),
    [rename, setRename] = useState(null),
    [target, setTarget] = useState("");
  const reload = () => api(`/projects/${projectId}/tags`).then(setLibrary);
  useEffect(() => {
    reload().catch((e) => notify(e.message));
  }, [projectId]);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      await onChanged();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const selected = photos.filter((p) => ids.includes(p.id));
  return (
    <aside className="tags-panel" aria-label="人工标签">
      <header>
        <h3>人工标签</h3>
        <button className="icon-button" aria-label="关闭标签" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="tabs">
        <button
          aria-selected={mode === "assign"}
          onClick={() => setMode("assign")}
        >
          打标签 {selected.length || ""}
        </button>
        <button
          aria-selected={mode === "manage"}
          onClick={() => setMode("manage")}
        >
          管理
        </button>
      </div>
      {!!selected.length && (
        <button
          className="text-button"
          onClick={() =>
            run(() =>
              api(
                `/projects/${projectId}/tags/clear`,
                json("POST", { ids: selected.map((p) => p.id) }),
              ),
            )
          }
        >
          清空所选标签
        </button>
      )}
      {!library ? (
        <p>载入中…</p>
      ) : (
        <>
          {TAG_CATEGORIES.map((cat) => {
            const values = library.tags.filter((t) => t.category === cat);
            return values.length ? (
              <section key={cat}>
                <h4>{cat}</h4>
                <div className="tag-chips">
                  {values.map((tag) => {
                    const count = selected.filter((p) =>
                      tagsOf(p).includes(tag.name),
                    ).length;
                    const all =
                      selected.length > 0 && count === selected.length;
                    return mode === "assign" ? (
                      <button
                        key={tag.name}
                        className={all ? "active" : count ? "mixed" : ""}
                        aria-pressed={all ? "true" : count ? "mixed" : "false"}
                        disabled={!selected.length || busy}
                        onClick={() =>
                          run(() =>
                            api(
                              `/projects/${projectId}/tags/assign`,
                              json("POST", {
                                ids: selected.map((p) => p.id),
                                name: tag.name,
                                enabled: !all,
                              }),
                            ),
                          )
                        }
                      >
                        {tag.name}
                        {all && <Check size={12} />}
                      </button>
                    ) : (
                      <button
                        key={tag.name}
                        onClick={() => {
                          setRename(tag.name);
                          setTarget(tag.name);
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null;
          })}
          {rename && mode === "manage" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(
                    `/projects/${projectId}/tags/rename`,
                    json("POST", { from: rename, to: target }),
                  );
                  setRename(null);
                });
              }}
            >
              <label className="field">
                改名或合并：{rename}
                <input
                  aria-label="新标签名称"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                  maxLength={40}
                />
              </label>
              <button className="button" disabled={busy}>
                保存
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await api(
                      `/projects/${projectId}/tags/common`,
                      json("POST", { names: [rename] }),
                    );
                    notify("已保存为常用标签");
                  })
                }
              >
                设为常用
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await api(
                      `/projects/${projectId}/tags`,
                      json("PUT", {
                        version: library.version,
                        tags: library.tags.filter((t) => t.name !== rename),
                      }),
                    );
                    setRename(null);
                  })
                }
              >
                移除标签
              </button>
            </form>
          )}
          <form
            className="new-tag"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(
                  `/projects/${projectId}/tags`,
                  json("PUT", {
                    version: library.version,
                    tags: [
                      ...library.tags,
                      { name, category, description: name },
                    ],
                  }),
                );
                setName("");
              });
            }}
          >
            <input
              aria-label="自定义标签"
              placeholder="新标签"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select
              aria-label="标签分类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {TAG_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="创建标签"
              disabled={busy}
            >
              <Plus size={18} />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
