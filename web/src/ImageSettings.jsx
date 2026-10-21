import React, { useEffect, useState } from "react";
import { api, json } from "./api";
export default function ImageSettings({ notify }) {
  const [config, setConfig] = useState(null),
    [key, setKey] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/settings/image-generation")
      .then(setConfig)
      .catch((e) => notify(e.message));
  }, []);
  const action = async (type) => {
    setBusy(true);
    setStatus("");
    try {
      if (type === "delete") {
        await api("/settings/image-generation/key", { method: "DELETE" });
        setConfig(await api("/settings/image-generation"));
        setKey("");
        setStatus("已清除独立生图密钥");
      } else if (type === "test") {
        const result = await api(
          "/settings/image-generation/test",
          json("POST", { ...config, apiKey: key }),
        );
        setStatus(`参考图生成测试通过 · ${result.width}×${result.height}`);
      } else {
        setConfig(
          await api(
            "/settings/image-generation",
            json("PUT", { ...config, apiKey: key }),
          ),
        );
        setKey("");
        setStatus("生图配置已保存");
      }
    } catch (e) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!config) return <div>载入中…</div>;
  return (
    <section className="image-settings">
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={config.enabled !== false}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        启用生图服务
      </label>
      {config.enabled === false && (
        <p>生图已关闭，拼图与本地图片理解仍可使用。配置和已有创作会保留。</p>
      )}
      <label className="field">
        <span>生图 API 地址</span>
        <input
          aria-label="生图 API 地址"
          value={config.endpoint}
          onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
        />
      </label>
      <label className="field">
        <span>生图模型</span>
        <input
          aria-label="生图模型"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
        />
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={config.inheritKey}
          onChange={(e) =>
            setConfig({ ...config, inheritKey: e.target.checked })
          }
        />
        使用图片理解服务的密钥
      </label>
      {!config.inheritKey && (
        <label className="field">
          <span>生图 API Key {config.hasKey ? "已保存" : ""}</span>
          <input
            aria-label="生图 API Key"
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="留空保留已有密钥"
          />
        </label>
      )}
      {status && <p role="status">{status}</p>}
      <footer>
        {!config.inheritKey && (
          <button
            className="text-button"
            disabled={busy || !config.hasKey}
            onClick={() => action("delete")}
          >
            清除生图密钥
          </button>
        )}
        <button
          className="button"
          disabled={busy || config.enabled === false}
          onClick={() => action("test")}
        >
          {busy ? "处理中…" : "测试生成一张"}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => action("save")}
        >
          保存生图配置
        </button>
      </footer>
    </section>
  );
}
