import React, { useEffect, useState } from "react";
import { api } from "./api";
import { tagsOf } from "../../shared/domain.mjs";
import { TAG_CATEGORIES, tagCategory } from "../../shared/tags.mjs";
export default function CandidateSearch({
  photos,
  filter = {},
  onChange,
  count,
  projectId,
  tagDefinitions = [],
}) {
  const [library, setLibrary] = useState(tagDefinitions);
  useEffect(() => {
    if (projectId)
      api(`/projects/${projectId}/tags`)
        .then((v) => setLibrary(v.tags))
        .catch(() => {});
  }, [projectId]);
  const names = [...new Set(photos.flatMap(tagsOf))];
  return (
    <div className="candidate-search">
      <input
        type="search"
        aria-label="搜索拼图候选"
        placeholder="搜索照片、描述或标签"
        value={filter.query || ""}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <div className="candidate-domains">
        {TAG_CATEGORIES.map((category) => {
          const values = names.filter(
            (n) => tagCategory(n, library) === category,
          );
          return (
            values.length > 0 && (
              <details key={category}>
                <summary>
                  {category}{" "}
                  <small>
                    {values.filter((t) => filter.tags?.includes(t)).length ||
                      ""}
                  </small>
                </summary>
                <div className="tag-chips">
                  {values.map((n) => (
                    <button
                      key={n}
                      aria-pressed={!!filter.tags?.includes(n)}
                      className={filter.tags?.includes(n) ? "active" : ""}
                      onClick={() =>
                        onChange({
                          ...filter,
                          tags: filter.tags?.includes(n)
                            ? filter.tags.filter((v) => v !== n)
                            : [...(filter.tags || []), n],
                        })
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </details>
            )
          );
        })}
      </div>
      {!!filter.tags?.length && (
        <select
          aria-label="拼图标签匹配"
          value={filter.tagMode || "all"}
          onChange={(e) => onChange({ ...filter, tagMode: e.target.value })}
        >
          <option value="all">同时满足</option>
          <option value="any">满足任一</option>
        </select>
      )}
      <div className="candidate-count">
        <span>{count} 张匹配</span>
        {(filter.query || filter.tags?.length > 0) && (
          <button
            onClick={() => onChange({ query: "", tags: [], tagMode: "all" })}
          >
            清除条件
          </button>
        )}
      </div>
      {!count && <p className="muted">没有匹配照片，请调整关键词或标签</p>}
    </div>
  );
}
