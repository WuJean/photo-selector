import React, { useEffect, useState } from "react";
import { api, json } from "./api";
export default function StorageSettings() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState("");
  const refresh = () =>
    api("/storage/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="settings-section">
      <h3>压缩展示与 R2</h3>
      <p>手机选片使用 1080 像素预览，列表使用 480 像素缩略图。原片保持不变。</p>
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          <p>{status.enabled ? "R2 已连接" : "使用本机压缩图"}</p>
          {status.enabled && (
            <>
              <p>
                已同步 {status.ready} 份展示图 ·{" "}
                {(status.bytes / 1024 / 1024).toFixed(1)} MB
                {status.active ? ` · 正在上传 ${status.active}` : ""}
                {status.failed ? ` · 失败 ${status.failed}` : ""}
              </p>
              <button
                onClick={() =>
                  api("/storage/retry", json("POST", {}))
                    .then(setStatus)
                    .catch((e) => setError(e.message))
                }
              >
                同步与重试
              </button>
            </>
          )}
          <p>
            电脑文件夹只同步压缩展示图。旧的本地照片请在原电脑重新连接文件夹；手机无需访问原文件夹。
          </p>
        </>
      )}
    </section>
  );
}
