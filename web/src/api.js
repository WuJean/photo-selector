import { prepareAI, completePending } from "./ai-media";
import { mediaAddress } from "./local-media";
export async function api(url, options = {}) {
  await prepareAI(url, options);
  const response = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    let message = "请求失败";
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  completePending(url, options);
  if (options.method && options.method !== "GET" && /collections/.test(url))
    window.dispatchEvent(new Event("photo-collections-changed"));
  return response.json();
}
export const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const photoURL = (id, variant = "thumb") => {
  const local = mediaAddress(id, variant);
  if (local) return local;
  if (variant === "thumb" || variant === "preview") {
    const size =
      variant === "thumb"
        ? "tile"
        : window.matchMedia("(max-width: 1024px)").matches
          ? "mobile"
          : "screen";
    return `/api/photos/${id}/display/${size}`;
  }
  return `/api/photos/${id}/${variant}`;
};
