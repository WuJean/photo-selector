import { filterPhotos } from "./domain.mjs";
export function normalizeCandidateFilter(input = {}) {
  return {
    query: String(input?.query || "")
      .trim()
      .slice(0, 500),
    tags: Array.isArray(input?.tags)
      ? [
          ...new Set(
            input.tags
              .filter((t) => typeof t === "string")
              .map((t) => t.slice(0, 40)),
          ),
        ].slice(0, 100)
      : [],
    tagMode: input?.tagMode === "any" ? "any" : "all",
  };
}
export function candidatePhotos(photos, input) {
  return filterPhotos(photos, normalizeCandidateFilter(input));
}
