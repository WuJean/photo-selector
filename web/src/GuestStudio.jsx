import PhotoImage from "./PhotoImage";
import CandidateSearch from "./CandidateSearch";
import { candidatePhotos } from "../../shared/candidates.mjs";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button } from "./LibraryParts";
import { Canvas } from "./Studio";
import { json } from "./api";
import {
  newDraft,
  slotFor,
  validateDraft,
  TEMPLATES,
  RATIOS,
} from "../../shared/layout.mjs";
import {
  QUICK_PAIRINGS,
  randomPairing,
  matchesRole,
  PAIRING_SUBJECTS,
  PAIRING_SHOTS,
} from "../../shared/pairing.mjs";

export default function GuestStudio({ share, base, onClose, onSaved }) {
  const photos = useMemo(
    () =>
      share.photos.map((p) => ({
        ...p,
        ai: { tags: p.tags },
        projectId: "library",
      })),
    [share.photos],
  );
  const key = "guest-collage:" + base;
  const [draft, setDraft] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(key));
      if (d) return validateDraft(d, photos);
    } catch {}
    return newDraft("library", photos);
  });
  const [active, setActive] = useState(0),
    [preset, setPreset] = useState("portrait_triptych"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [roles, setRoles] = useState(
    Array.from({ length: 4 }, () => ({ subject: [], shot: [] })),
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }, [draft, key]);
  const [sourceLimit, setSourceLimit] = useState(100);
  useEffect(
    () => setSourceLimit(100),
    [
      JSON.stringify(draft.candidateFilter),
      active,
      preset,
      JSON.stringify(roles),
    ],
  );
  const available = candidatePhotos(photos, draft.candidateFilter);
  const visiblePhotos = available.filter(
    (p) => preset !== "custom" || matchesRole(p, roles[active]),
  );
  const updateSlot = (i, patch) =>
    setDraft((d) => ({
      ...d,
      slots: d.slots.map((s, j) => (i === j ? { ...s, ...patch } : s)),
    }));
  const imageURL = (id) => `${base}/photos/${id}/display?view=screen`;
  const count = TEMPLATES[draft.template].count,
    slot = draft.slots[active];
  const shuffle = () => {
    try {
      const pairing =
        preset === "custom"
          ? {
              name: "自选标签搭配",
              template: draft.template,
              roles: roles.slice(0, count),
            }
          : preset;
      const next = randomPairing(available, pairing, { slots: draft.slots });
      setDraft((d) => ({
        ...d,
        template: next.template,
        slots: next.photoIds.map((id) =>
          slotFor(photos.find((p) => p.id === id)),
        ),
      }));
      setActive(0);
      setMessage(next.unchanged ? "符合条件的组合只有这一组" : "");
    } catch (e) {
      setMessage(e.message);
    }
  };
  const submit = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`${base}/collages/${action}`, json("POST", draft));
      if (!r.ok) throw new Error((await r.json()).error || "操作失败");
      if (action === "save") {
        await r.json();
        setMessage("已保存到此作品集 · 访客拼图");
        await onSaved();
      } else {
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = (draft.title || "拼图") + ".jpg";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="制作拼图" wide onClose={onClose}>
      <div className="guest-studio">
        <section className="guest-canvas">
          <Canvas
            draft={draft}
            photos={photos}
            active={active}
            setActive={setActive}
            updateSlot={updateSlot}
            imageURL={imageURL}
          />
        </section>
        <section className="guest-controls">
          <label className="field">
            拼图名称
            <input
              value={draft.title}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="guest-actions">
            <Button primary disabled={busy} onClick={() => submit("save")}>
              保存到此作品集
            </Button>
            <Button disabled={busy} onClick={() => submit("render")}>
              下载拼图
            </Button>
          </div>
          {(message || busy) && (
            <p role="status">{busy ? "正在制作…" : message}</p>
          )}
          <label className="field">
            快捷搭配
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.entries(QUICK_PAIRINGS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">自选每格标签</option>
            </select>
          </label>
          <Button onClick={shuffle}>随机组合</Button>
          <label className="field">
            布局
            <select
              value={draft.template}
              onChange={(e) => {
                const template = e.target.value;
                setDraft({
                  ...draft,
                  template,
                  slots: Array.from(
                    { length: TEMPLATES[template].count },
                    (_, i) =>
                      draft.slots[i] || slotFor(photos[i % photos.length]),
                  ),
                });
                setActive(0);
              }}
            >
              {Object.entries(TEMPLATES).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            画幅
            <select
              aria-label="画幅"
              value={draft.ratio}
              onChange={(e) => setDraft({ ...draft, ratio: e.target.value })}
            >
              {Object.keys(RATIOS).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {preset === "custom" &&
            roles.slice(0, count).map((role, i) => (
              <div className="guest-role" key={i}>
                <strong>第 {i + 1} 格</strong>
                {[
                  ["subject", "主体", PAIRING_SUBJECTS],
                  ["shot", "景别", PAIRING_SHOTS],
                ].map(([key, label, options]) => (
                  <label key={key}>
                    {label}
                    <select
                      aria-label={`第 ${i + 1} 格${label}`}
                      value={role[key][0] || ""}
                      onChange={(e) =>
                        setRoles(
                          roles.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  [key]: e.target.value ? [e.target.value] : [],
                                }
                              : r,
                          ),
                        )
                      }
                    >
                      <option value="">不限</option>
                      {options.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ))}
          <div className="guest-slot-tabs">
            {Array.from({ length: count }, (_, i) => (
              <Button
                key={i}
                primary={i === active}
                onClick={() => setActive(i)}
              >
                第 {i + 1} 格
              </Button>
            ))}
          </div>
          {slot && (
            <>
              <label className="field">
                缩放
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.05"
                  value={slot.zoom}
                  onChange={(e) =>
                    updateSlot(active, { zoom: Number(e.target.value) })
                  }
                />
              </label>
              <Button
                onClick={() =>
                  updateSlot(active, {
                    fit: slot.fit === "contain" ? "cover" : "contain",
                    zoom: 1,
                    cx: 0.5,
                    cy: 0.5,
                  })
                }
              >
                {slot.fit === "contain" ? "填充" : "适应"}
              </Button>
            </>
          )}
          <label className="field">
            间距
            <input
              type="range"
              min="0"
              max="0.08"
              step="0.002"
              value={draft.gap}
              onChange={(e) =>
                setDraft({ ...draft, gap: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            背景
            <input
              type="color"
              value={draft.background}
              onChange={(e) =>
                setDraft({ ...draft, background: e.target.value })
              }
            />
          </label>
          <CandidateSearch
            photos={photos}
            tagDefinitions={share.tagDefinitions}
            filter={draft.candidateFilter}
            count={visiblePhotos.length}
            onChange={(candidateFilter) =>
              setDraft({ ...draft, candidateFilter })
            }
          />
          <div className="guest-photo-picker">
            {visiblePhotos.slice(0, sourceLimit).map((p) => (
              <button
                key={p.id}
                aria-label={`放入 ${p.name}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    slots: Array.from({ length: count }, (_, i) =>
                      i === active
                        ? slotFor(p)
                        : d.slots[i] || slotFor(photos[i % photos.length]),
                    ),
                  }))
                }
              >
                <PhotoImage
                  src={`${base}/photos/${p.id}/display?view=tile`}
                  loading="lazy"
                  alt={p.name}
                />
                <span>{p.tags.join(" · ") || p.name}</span>
              </button>
            ))}
          </div>
          {visiblePhotos.length > sourceLimit && (
            <Button onClick={() => setSourceLimit((n) => n + 100)}>
              显示更多照片
            </Button>
          )}
        </section>
      </div>
    </Modal>
  );
}
