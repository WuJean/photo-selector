const call = async (action, data = {}) => {
  const { result } = await wx.cloud.callFunction({
    name: "photoApiV2",
    data: { action, data },
  });
  if (!result?.ok) throw new Error(result?.error?.message || "服务暂不可用");
  return result.data;
};
const toast = (e) =>
  wx.showToast({ title: e.message || String(e), icon: "none", duration: 3000 });
async function hydrate(photos, variant = "thumb") {
  const rows = [];
  for (let i = 0; i < photos.length; i += 50) {
    const batch = photos.slice(i, i + 50);
    const urls = await call("files.urls", {
      ids: batch.map((p) => p.id),
      variant,
    });
    rows.push(
      ...batch.map((p, n) => ({
        ...p,
        url: urls[n]?.url || "",
        imageError: !urls[n]?.url,
      })),
    );
  }
  return rows;
}
module.exports = { call, toast, hydrate };
