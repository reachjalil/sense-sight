import type {
  RenderLayers,
  RenderPreset,
  TrainedRenderProfile,
} from "@sense-sight/render-contracts";

export type LoadStatus = "idle" | "loading" | "ready" | "failed";

const LAYER_LABELS: Record<keyof RenderLayers, string> = {
  pointcloud: "Seed point cloud",
  trajectory: "Trajectory",
  splat: "Trained splat",
  grid: "Floor grid",
  annotations: "Annotations",
};

const LOAD_STATUS_LABEL: Record<LoadStatus, string> = {
  idle: "Idle",
  loading: "Loading",
  ready: "Ready",
  failed: "Failed",
};

function metric(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export interface ControlPanelProps {
  layers: RenderLayers;
  onToggleLayer: (key: keyof RenderLayers) => void;
  loadStatus: LoadStatus;
  preset: RenderPreset | null;
  trainedRenderProfile: TrainedRenderProfile;
  pointCount: number;
  gaussianCount: number;
}

export function ControlPanel({
  layers,
  onToggleLayer,
  loadStatus,
  preset,
  trainedRenderProfile,
  pointCount,
  gaussianCount,
}: ControlPanelProps) {
  return (
    <aside className="cn-panel" aria-label="Console controls">
      <section className="panel-section">
        <div className="panel-section-head">
          <span className="tick" />
          Reconstruction
        </div>
        <div className="panel-section-body">
          <span className={`load-status-badge ${loadStatus}`}>
            <span
              className={`status-dot${
                loadStatus === "loading"
                  ? " degraded pulse"
                  : loadStatus === "ready"
                    ? " online"
                    : loadStatus === "failed"
                      ? " error"
                      : " offline"
              }`}
            />
            {LOAD_STATUS_LABEL[loadStatus]}
          </span>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <span className="tick" />
          Layers
        </div>
        <div className="panel-section-body">
          {(Object.keys(LAYER_LABELS) as Array<keyof RenderLayers>).map(
            (key) => (
              <button
                key={key}
                type="button"
                className={`layer-toggle${layers[key] ? "" : " off"}`}
                aria-pressed={layers[key]}
                onClick={() => onToggleLayer(key)}
              >
                <span
                  className="swatch"
                  style={{
                    background: layers[key] ? "#2fe0c8" : "#61757e",
                  }}
                />
                {LAYER_LABELS[key]}
              </button>
            )
          )}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <span className="tick" />
          Render profile
        </div>
        <div className="panel-section-body">
          <div className="metric">
            <span className="k">Profile</span>
            <span className="v">{trainedRenderProfile.label}</span>
          </div>
          <div className="metric">
            <span className="k">Radius</span>
            <span className="v">
              {trainedRenderProfile.radiusDefault.toFixed(2)}
            </span>
          </div>
          <div className="metric">
            <span className="k">Min alpha</span>
            <span className="v">
              {(trainedRenderProfile.minAlpha * 255).toFixed(1)}/255
            </span>
          </div>
          <div className="metric">
            <span className="k">Max px radius</span>
            <span className="v">{trainedRenderProfile.maxPixelRadius}</span>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-section-head">
          <span className="tick" />
          Scene
        </div>
        <div className="panel-section-body">
          <div className="metric">
            <span className="k">Preset</span>
            <span className="v">{preset?.label ?? "—"}</span>
          </div>
          <div className="metric">
            <span className="k">Coordinate frame</span>
            <span className="v">{preset?.coordinateFrame ?? "—"}</span>
          </div>
          <div className="metric">
            <span className="k">Seed points</span>
            <span className="v">{metric(pointCount)}</span>
          </div>
          <div className="metric">
            <span className="k">Gaussians</span>
            <span className="v">{metric(gaussianCount)}</span>
          </div>
        </div>
      </section>

      <p className="panel-note">
        The console renders progressive world reconstruction only — no mission,
        approval, or fleet-operation UI lives here.
      </p>
    </aside>
  );
}
