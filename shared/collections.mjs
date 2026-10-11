export function collectionDetails(input = {}, previous = {}) {
  const date = String(input.date ?? previous.date ?? "").trim();
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw new Error("作品集时间请填写有效日期");
  return {
    date,
    location: String(input.location ?? previous.location ?? "")
      .trim()
      .slice(0, 200),
    poem: String(input.poem ?? previous.poem ?? "")
      .trim()
      .slice(0, 300),
    description: String(input.description ?? previous.description ?? "").slice(
      0,
      4000,
    ),
  };
}
function validTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}
export function collectionTimeline(collections, photos) {
  const byId = new Map(photos.filter((p) => !p.deleted).map((p) => [p.id, p]));
  return collections
    .map((collection) => {
      const members = (collection.photoIds || [])
        .map((id) => byId.get(id))
        .filter(Boolean);
      const captures = members
        .map((p) => validTime(p.takenAt))
        .filter((t) => t !== null);
      const imports = members
        .map((p) => validTime(p.importedAt || p.createdAt))
        .filter((t) => t !== null);
      const time =
        validTime(collection.date) ??
        (captures.length
          ? Math.min(...captures)
          : imports.length
            ? Math.min(...imports)
            : null);
      return {
        collection,
        cover:
          members.find((p) => p.id === collection.coverId) ||
          members[0] ||
          null,
        time,
        date:
          collection.date ||
          (time === null ? "" : new Date(time).toISOString().slice(0, 10)),
        dateSource: collection.date
          ? "manual"
          : captures.length
            ? "capture"
            : imports.length
              ? "import"
              : "unknown",
      };
    })
    .sort(
      (a, b) =>
        (a.time ?? Infinity) - (b.time ?? Infinity) ||
        a.collection.id.localeCompare(b.collection.id),
    );
}
