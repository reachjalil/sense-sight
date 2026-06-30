import {
  SOURCE_REGISTRY,
  type ReplaySourceEntry,
} from "@sense-sight/replay-protocol";
import { useState } from "react";

type AddKind = "replay" | "live";

let userSourceSeq = 0;

export interface SourcePickerProps {
  sources: readonly ReplaySourceEntry[];
  onSelect: (entry: ReplaySourceEntry) => void;
  onAddSource: (entry: ReplaySourceEntry) => void;
}

/**
 * Entry state for the console: a grid of selectable replay/live sources plus
 * an inline "add source" form. `available` cards launch a stream; `coming_soon`
 * cards advertise a future capability and are non-interactive.
 */
export function SourcePicker({
  sources,
  onSelect,
  onAddSource,
}: SourcePickerProps) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<AddKind>("replay");
  const [endpoint, setEndpoint] = useState("");

  const resetForm = () => {
    setLabel("");
    setKind("replay");
    setEndpoint("");
    setAdding(false);
  };

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    userSourceSeq += 1;
    if (kind === "replay") {
      onAddSource({
        id: `user-replay-${userSourceSeq}`,
        label: trimmed,
        kind: "replay",
        status: "available",
        modalities: ["rgb", "depth"],
        suggestedReplayRateHz: 3,
        presetPath: "/presets/corridor1-2",
        description:
          "User-added simulated replay (reuses the corridor1-2 dataset).",
      });
    } else {
      onAddSource({
        id: `user-live-${userSourceSeq}`,
        label: trimmed,
        kind: "live",
        status: "coming_soon",
        modalities: ["rgb", "depth", "lidar", "imu"],
        description: endpoint.trim()
          ? `Real robot stream endpoint: ${endpoint.trim()} — coming soon.`
          : "Real robot stream — coming soon.",
      });
    }
    resetForm();
  };

  return (
    <div className="cn-source-picker">
      <div className="cn-source-picker__head">
        <p className="eyebrow mono">Source</p>
        <h1>Select a stream</h1>
        <p>
          Pick a previously recorded sensor stream to replay, or add a new one.
        </p>
      </div>

      <div className="cn-source-grid">
        {sources.map((entry) => {
          const available = entry.status === "available";
          return (
            <button
              key={entry.id}
              type="button"
              className={`cn-source-card${available ? "" : " disabled"}`}
              disabled={!available}
              aria-disabled={!available}
              onClick={() => available && onSelect(entry)}
            >
              <div className="cn-source-card__head">
                <span className={`cn-source-kind ${entry.kind}`}>
                  {entry.kind === "replay" ? "Replay" : "Live"}
                </span>
                {!available && (
                  <span className="cn-source-badge">Coming soon</span>
                )}
              </div>
              <strong className="cn-source-card__label">{entry.label}</strong>
              {entry.description && (
                <span className="cn-source-card__desc">
                  {entry.description}
                </span>
              )}
              <span className="cn-source-card__modalities">
                {entry.modalities.join(" · ")}
              </span>
            </button>
          );
        })}

        {adding ? (
          <form
            className="cn-source-card cn-source-card--form"
            onSubmit={submit}
          >
            <label className="cn-source-field">
              <span>Label</span>
              <input
                type="text"
                value={label}
                placeholder="My stream"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <fieldset className="cn-source-radio">
              <label>
                <input
                  type="radio"
                  name="add-kind"
                  checked={kind === "replay"}
                  onChange={() => setKind("replay")}
                />
                Simulated replay
              </label>
              <label>
                <input
                  type="radio"
                  name="add-kind"
                  checked={kind === "live"}
                  onChange={() => setKind("live")}
                />
                Real robot stream
              </label>
            </fieldset>
            {kind === "live" && (
              <label className="cn-source-field">
                <span>Endpoint (ROS2 / WebRTC)</span>
                <input
                  type="text"
                  value={endpoint}
                  placeholder="wss://robot.local/stream"
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
            )}
            <div className="cn-source-form-actions">
              <button type="submit" className="cn-btn cn-btn--primary">
                Add
              </button>
              <button type="button" className="cn-btn" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="cn-source-card cn-source-card--add"
            onClick={() => setAdding(true)}
          >
            <span className="cn-source-add-plus">+</span>
            <strong>Add source</strong>
            <span className="cn-source-card__desc">
              Select a previous stream or add a new one.
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export { SOURCE_REGISTRY };
