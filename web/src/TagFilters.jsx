import React, { useEffect, useState } from "react";
import { api } from "./api";
import { tagsOf } from "../../shared/domain.mjs";
import { TAG_CATEGORIES, tagCategory } from "../../shared/tags.mjs";
export default function TagFilters({ projectId, photos, filters, setFilters }) {
  const [library, setLibrary] = useState([]);
  const names = [...new Set(photos.flatMap(tagsOf))];
  const key = names.join("|");
  useEffect(() => {
    let live = true;
    api(`/projects/${projectId}/tags`)
      .then((v) => live && setLibrary(v.tags))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId, key]);
  return (
    <div className="tag-filter">
      <div className="tag-domains">
        {TAG_CATEGORIES.map((cat) => {
          const values = names.filter((n) => tagCategory(n, library) === cat);
          return values.length ? (
            <details key={cat} open={cat === "主体" ? true : undefined}>
              <summary>
                {cat}{" "}
                <small>
                  {values.filter((n) => filters.tags?.includes(n)).length || ""}
                </small>
              </summary>
              <div className="tag-chips">
                {values.map((n) => (
                  <button
                    key={n}
                    className={filters.tags?.includes(n) ? "active" : ""}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        tags: filters.tags?.includes(n)
                          ? filters.tags.filter((v) => v !== n)
                          : [...(filters.tags || []), n],
                      })
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </details>
          ) : null;
        })}
      </div>
      {!!filters.tags?.length && (
        <>
          <select
            aria-label="多标签匹配"
            value={filters.tagMode || "all"}
            onChange={(e) =>
              setFilters({ ...filters, tagMode: e.target.value })
            }
          >
            <option value="all">同时满足</option>
            <option value="any">满足任一</option>
          </select>
          <button
            className="text-button"
            onClick={() => setFilters({ ...filters, tags: [] })}
          >
            清除标签
          </button>
        </>
      )}
    </div>
  );
}
