import { api, json } from "./api";
import { photoBlob } from "./local-media";
const relevant = (url) =>
  /^\/projects\/library\/(analyze|recommend|vocabulary(?:\/(?:confirm|resume|retry))?|collections\/[^/]+\/create)$/.test(
    url,
  ) || /^\/(ai|creation-jobs\/[^/]+)\/(resume|retry)$/.test(url);
export function pendingAI() {
  try {
    return JSON.parse(localStorage.getItem("photo-ai-pending") || "[]");
  } catch {
    return [];
  }
}
const update = (list) => {
  localStorage.setItem("photo-ai-pending", JSON.stringify(list));
  window.dispatchEvent(new Event("photo-ai-pending"));
};
export function cancelPending(id) {
  update(pendingAI().filter((j) => j.id !== id));
}
export async function prepareAI(url, options) {
  if (options?.method !== "POST" || !relevant(url)) return;
  const body = JSON.parse(options.body || "{}");
  const result = await api("/media/requirements", json("POST", { url, body }));
  let next = 0,
    done = 0;
  try {
    await Promise.all(
      [0, 1].map(async () => {
        while (next < result.ids.length) {
          const id = result.ids[next++];
          const blob = await photoBlob(id, "preview");
          const form = new FormData();
          form.append("photo", blob, "preview.jpg");
          await api(`/assets/${id}/analysis-preview`, {
            method: "POST",
            body: form,
          });
          window.dispatchEvent(
            new CustomEvent("photo-media-progress", {
              detail: { done: ++done, total: result.ids.length },
            }),
          );
        }
      }),
    );
  } catch (e) {
    if (/文件夹|文件不可访问|原文件已改变|其他电脑/.test(e.message)) {
      const list = pendingAI();
      if (!list.some((j) => j.url === url && j.options.body === options.body))
        update([
          ...list,
          { id: crypto.randomUUID(), url, options, createdAt: Date.now() },
        ]);
      throw new Error("任务待发送，请重新连接电脑文件夹");
    }
    throw e;
  } finally {
    window.dispatchEvent(
      new CustomEvent("photo-media-progress", { detail: null }),
    );
  }
}
let resuming = false;
export async function resumePending() {
  if (resuming) return;
  resuming = true;
  try {
    for (const j of pendingAI()) {
      try {
        await api(j.url, j.options);
        cancelPending(j.id);
      } catch (e) {
        window.dispatchEvent(
          new CustomEvent("photo-ai-error", { detail: e.message }),
        );
        break;
      }
    }
  } finally {
    resuming = false;
  }
}

export function completePending(url, options) {
  if (relevant(url))
    update(
      pendingAI().filter(
        (j) => j.url !== url || j.options.body !== options.body,
      ),
    );
}
