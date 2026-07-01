import type {
  InteriorVisibilityTuning,
  RenderLayers,
  RenderPreset,
  SceneShapeAnalysis,
  TrainedRenderProfile,
} from "@sense-sight/render-contracts";

export type LoadStatus = "idle" | "loading" | "ready" | "failed";

export interface SensorStreamSummary {
  readonly sensorId: string;
  readonly modality: string;
  readonly rateHz?: number;
  readonly usedByMapper?: boolean;
}

export interface SensorEvidenceSummary {
  readonly sensorCount?: number;
  readonly mappedSensorCount?: number;
  readonly streamCount?: number;
  readonly poseCoverage?: number;
  readonly depthValidMean?: number;
  readonly pathLengthM?: number;
  readonly imuRateHz?: number;
  readonly odomStepErrorM?: number;
  readonly streams?: readonly SensorStreamSummary[];
}

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

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const;

export interface ControlPanelProps {
  layers: RenderLayers;
  onToggleLayer: (key: keyof RenderLayers) => void;
  loadStatus: LoadStatus;
  preset: RenderPreset | null;
  trainedRenderProfile: TrainedRenderProfile;
  interiorVisibility: InteriorVisibilityTuning;
  onInteriorVisibilityChange?: (next: InteriorVisibilityTuning) => void;
  sceneShapeAnalysis?: SceneShapeAnalysis | null;
  pointCount: number;
  gaussianCount: number;
  /** Whether a replay stream is currently live (enables the transport row). */
  isLive?: boolean;
  playing?: boolean;
  speed?: number;
  loop?: boolean;
  /** 0..1 playback progress through the sequence. */
  progress?: number;
  onPlayPause?: () => void;
  onSpeed?: (speed: number) => void;
  /** Receives a 0..1 fraction to seek to. */
  onSeek?: (fraction: number) => void;
  onLoop?: (loop: boolean) => void;
  sensorEvidence?: SensorEvidenceSummary | null;
  runPodStatus?: string | null;
}

export function ControlPanel({
  layers,
  onToggleLayer,
  loadStatus,
  preset,
  trainedRenderProfile,
  interiorVisibility,
  onInteriorVisibilityChange,
  sceneShapeAnalysis,
  pointCount,
  gaussianCount,
  isLive = false,
  playing = false,
  speed = 1,
  loop = false,
  progress = 0,
  onPlayPause,
  onSpeed,
  onSeek,
  onLoop,
  sensorEvidence,
  runPodStatus,
}: ControlPanelProps) {
  const dominantShape = sceneShapeAnalysis?.shapes[0];
  const shapeCount = sceneShapeAnalysis?.shapes.length ?? 0;
  const updateInteriorVisibility = (
    patch: Partial<InteriorVisibilityTuning>
  ) => {
    onInteriorVisibilityChange?.({
      ...interiorVisibility,
      ...patch,
    });
  };

  return (
    <aside className="cn-panel" aria-label="Console controls">
      {isLive && (
        <section className="panel-section">
          <div className="panel-section-head">
            <span className="tick" />
            Transport
          </div>
          <div className="panel-section-body">
            <div className="cn-transport-row">
              <button
                type="button"
                className="cn-btn cn-btn--primary cn-transport-play"
                aria-pressed={playing}
                onClick={() => onPlayPause?.()}
              >
                {playing ? "⏸ Pause" : "▶ Play"}
              </button>
              <button
                type="button"
                className={`cn-btn cn-transport-loop${loop ? " active" : ""}`}
                aria-pressed={loop}
                onClick={() => onLoop?.(!loop)}
              >
                ⟳ Loop
              </button>
            </div>

            <label className="cn-transport-seek">
              <span className="cn-transport-seek__label">
                Seek
                <span className="cn-transport-seek__pct">
                  {Math.round(progress * 100)}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={progress}
                onChange={(event) =>
                  onSeek?.(Number.parseFloat(event.target.value))
                }
              />
            </label>

            <fieldset className="cn-transport-speed">
              <legend className="sr-only">Speed</legend>
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cn-speed-btn${speed === option ? " active" : ""}`}
                  aria-pressed={speed === option}
                  onClick={() => onSpeed?.(option)}
                >
                  {option}×
                </button>
              ))}
            </fieldset>
          </div>
        </section>
      )}
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
          {runPodStatus && (
            <div className="metric">
              <span className="k">RunPod GPU</span>
              <span className="v">{runPodStatus}</span>
            </div>
          )}
        </div>
      </section>

      {sensorEvidence && (
        <section className="panel-section">
          <div className="panel-section-head">
            <span className="tick" />
            Sensor evidence
          </div>
          <div className="panel-section-body">
            <div className="metric">
              <span className="k">Mapped sensors</span>
              <span className="v">
                {sensorEvidence.mappedSensorCount ?? "—"}/
                {sensorEvidence.sensorCount ?? "—"}
              </span>
            </div>
            <div className="metric">
              <span className="k">Streams</span>
              <span className="v">{sensorEvidence.streamCount ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="k">Pose coverage</span>
              <span className="v">
                {sensorEvidence.poseCoverage === undefined
                  ? "—"
                  : `${Math.round(sensorEvidence.poseCoverage * 100)}%`}
              </span>
            </div>
            <div className="metric">
              <span className="k">Depth valid</span>
              <span className="v">
                {sensorEvidence.depthValidMean === undefined
                  ? "—"
                  : `${Math.round(sensorEvidence.depthValidMean * 100)}%`}
              </span>
            </div>
            <div className="metric">
              <span className="k">Path length</span>
              <span className="v">
                {sensorEvidence.pathLengthM === undefined
                  ? "—"
                  : `${sensorEvidence.pathLengthM.toFixed(1)} m`}
              </span>
            </div>
            {sensorEvidence.imuRateHz !== undefined && (
              <div className="metric">
                <span className="k">IMU</span>
                <span className="v">
                  {Math.round(sensorEvidence.imuRateHz)} Hz
                </span>
              </div>
            )}
            {sensorEvidence.odomStepErrorM !== undefined && (
              <div className="metric">
                <span className="k">Odom Δ</span>
                <span className="v">
                  {(sensorEvidence.odomStepErrorM * 100).toFixed(1)} cm
                </span>
              </div>
            )}
            {sensorEvidence.streams && sensorEvidence.streams.length > 0 && (
              <div className="cn-sensor-streams">
                {sensorEvidence.streams.slice(0, 6).map((stream) => (
                  <div className="cn-sensor-stream" key={stream.sensorId}>
                    <span>{stream.modality}</span>
                    <strong>{stream.sensorId}</strong>
                    <em>
                      {stream.rateHz === undefined
                        ? "audit"
                        : `${stream.rateHz.toFixed(1)} Hz`}
                      {stream.usedByMapper ? " · mapped" : ""}
                    </em>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

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
          Interior view
        </div>
        <div className="panel-section-body">
          <button
            type="button"
            className={`cn-visibility-toggle${
              interiorVisibility.enabled ? "" : " off"
            }`}
            aria-pressed={interiorVisibility.enabled}
            onClick={() =>
              updateInteriorVisibility({
                enabled: !interiorVisibility.enabled,
              })
            }
          >
            <span
              className="swatch"
              style={{
                background: interiorVisibility.enabled ? "#4fd1ff" : "#61757e",
              }}
            />
            Interior mode
          </button>

          <div className="metric">
            <span className="k">Shapes</span>
            <span className="v">{shapeCount === 0 ? "—" : shapeCount}</span>
          </div>
          <div className="metric">
            <span className="k">Dominant</span>
            <span className="v">
              {dominantShape
                ? `${dominantShape.kind} ${Math.round(
                    dominantShape.confidence * 100
                  )}%`
                : "—"}
            </span>
          </div>
          <label className="cn-tuning-control">
            <span>
              Opacity
              <strong>{Math.round(interiorVisibility.opacity * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0.08}
              max={1}
              step={0.01}
              value={interiorVisibility.opacity}
              disabled={!interiorVisibility.enabled}
              onChange={(event) =>
                updateInteriorVisibility({
                  opacity: Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
          <label className="cn-tuning-control">
            <span>
              Spacing
              <strong>{Math.round(interiorVisibility.spacing * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={interiorVisibility.spacing}
              disabled={!interiorVisibility.enabled}
              onChange={(event) =>
                updateInteriorVisibility({
                  spacing: Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
          <label className="cn-tuning-control">
            <span>
              Intensity
              <strong>{Math.round(interiorVisibility.intensity * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={interiorVisibility.intensity}
              disabled={!interiorVisibility.enabled}
              onChange={(event) =>
                updateInteriorVisibility({
                  intensity: Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
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
