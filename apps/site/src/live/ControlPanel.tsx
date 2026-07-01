import type {
  InteriorVisibilityTuning,
  RenderLayers,
  RenderPreset,
  SceneShapeAnalysis,
  TrainedPreviewMode,
  TrainedRenderProfileId,
  TrainedRenderProfile,
} from "@sense-sight/render-contracts";
import type { RunPodCapacitySummary } from "../lib/runpod-capacity";

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
const LIVE_QUALITY_OPTIONS = [
  { id: "preview", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "research", label: "Research" },
] as const;

export type LiveGenerationQuality = (typeof LIVE_QUALITY_OPTIONS)[number]["id"];

const TRAINED_PREVIEW_MODE_OPTIONS = [
  { id: "splat", label: "Splat" },
  { id: "points", label: "Dots" },
] as const satisfies readonly {
  readonly id: TrainedPreviewMode;
  readonly label: string;
}[];

export interface RenderProfileControlOption {
  readonly id: TrainedRenderProfileId;
  readonly label: string;
  readonly description?: string;
}

export interface ControlPanelProps {
  layers: RenderLayers;
  onToggleLayer: (key: keyof RenderLayers) => void;
  loadStatus: LoadStatus;
  preset: RenderPreset | null;
  trainedRenderProfile: TrainedRenderProfile;
  baseTrainedRenderProfile?: TrainedRenderProfile;
  renderProfileOptions?: readonly RenderProfileControlOption[];
  renderProfileId?: TrainedRenderProfileId;
  onRenderProfileIdChange?: (id: TrainedRenderProfileId) => void;
  trainedPreviewMode?: TrainedPreviewMode;
  onTrainedPreviewModeChange?: (mode: TrainedPreviewMode) => void;
  onTrainedRenderProfileChange?: (patch: Partial<TrainedRenderProfile>) => void;
  onResetTrainedRenderProfile?: () => void;
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
  liveQualityPreset?: LiveGenerationQuality;
  onLiveQualityPresetChange?: (quality: LiveGenerationQuality) => void;
  sensorEvidence?: SensorEvidenceSummary | null;
  runPodStatus?: string | null;
  runPodCapacity?: RunPodCapacitySummary | null;
}

export function ControlPanel({
  layers,
  onToggleLayer,
  loadStatus,
  preset,
  trainedRenderProfile,
  baseTrainedRenderProfile,
  renderProfileOptions = [],
  renderProfileId,
  onRenderProfileIdChange,
  trainedPreviewMode = "splat",
  onTrainedPreviewModeChange,
  onTrainedRenderProfileChange,
  onResetTrainedRenderProfile,
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
  liveQualityPreset = "balanced",
  onLiveQualityPresetChange,
  sensorEvidence,
  runPodStatus,
  runPodCapacity,
}: ControlPanelProps) {
  const dominantShape = sceneShapeAnalysis?.shapes[0];
  const shapeCount = sceneShapeAnalysis?.shapes.length ?? 0;
  const editableProfile = baseTrainedRenderProfile ?? trainedRenderProfile;
  const selectedProfile =
    renderProfileOptions.find((option) => option.id === renderProfileId) ??
    renderProfileOptions[0];
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
          {runPodCapacity && (
            <fieldset className="cn-gpu-capacity">
              <legend className="sr-only">RunPod GPU queue</legend>
              <div className="cn-gpu-meter">
                <span
                  style={{
                    width: `${Math.min(
                      100,
                      (runPodCapacity.warmedGpuCount /
                        runPodCapacity.targetWarmGpuCount) *
                        100
                    )}%`,
                  }}
                />
              </div>
              <div className="metric">
                <span className="k">Warm pool</span>
                <span className="v">
                  {runPodCapacity.warmedGpuCount}/
                  {runPodCapacity.targetWarmGpuCount} GPUs
                </span>
              </div>
              <div className="metric">
                <span className="k">Per user</span>
                <span className="v">{runPodCapacity.gpusPerSession} GPUs</span>
              </div>
              <div className="metric">
                <span className="k">Queue</span>
                <span className="v">
                  {runPodCapacity.queuedSessionCount > 0
                    ? `${runPodCapacity.queuedSessionCount} waiting`
                    : "No wait"}
                </span>
              </div>
            </fieldset>
          )}
          <fieldset className="cn-segmented" aria-label="Live splat quality">
            <legend className="sr-only">Live splat quality</legend>
            {LIVE_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={liveQualityPreset === option.id ? "active" : ""}
                aria-pressed={liveQualityPreset === option.id}
                onClick={() => onLiveQualityPresetChange?.(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
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
          Render style
        </div>
        <div className="panel-section-body">
          <fieldset
            className="cn-segmented cn-segmented--two"
            aria-label="Trained splat preview mode"
          >
            <legend className="sr-only">Trained splat preview mode</legend>
            {TRAINED_PREVIEW_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={trainedPreviewMode === option.id ? "active" : ""}
                aria-pressed={trainedPreviewMode === option.id}
                onClick={() => onTrainedPreviewModeChange?.(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          {renderProfileOptions.length > 0 && (
            <fieldset className="cn-render-presets">
              <legend className="sr-only">Render style</legend>
              {renderProfileOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={renderProfileId === option.id ? "active" : ""}
                  aria-pressed={renderProfileId === option.id}
                  title={option.description}
                  onClick={() => onRenderProfileIdChange?.(option.id)}
                >
                  <strong>{option.label}</strong>
                  {option.description && <span>{option.description}</span>}
                </button>
              ))}
            </fieldset>
          )}
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
          <label className="cn-tuning-control">
            <span>
              Spark radius
              <strong>{editableProfile.radiusDefault.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min={editableProfile.radiusMin}
              max={editableProfile.radiusMax}
              step={editableProfile.radiusStep}
              value={editableProfile.radiusDefault}
              onChange={(event) =>
                onTrainedRenderProfileChange?.({
                  radiusDefault: Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
          <label className="cn-tuning-control">
            <span>
              Alpha gate
              <strong>{Math.round(editableProfile.minAlpha * 255)}/255</strong>
            </span>
            <input
              type="range"
              min={1}
              max={64}
              step={1}
              value={Math.round(editableProfile.minAlpha * 255)}
              onChange={(event) =>
                onTrainedRenderProfileChange?.({
                  minAlpha: Number.parseInt(event.target.value, 10) / 255,
                })
              }
            />
          </label>
          <label className="cn-tuning-control">
            <span>
              Max radius
              <strong>{editableProfile.maxPixelRadius}px</strong>
            </span>
            <input
              type="range"
              min={12}
              max={512}
              step={1}
              value={editableProfile.maxPixelRadius}
              onChange={(event) =>
                onTrainedRenderProfileChange?.({
                  maxPixelRadius: Number.parseInt(event.target.value, 10),
                })
              }
            />
          </label>
          <label className="cn-tuning-control">
            <span>
              Falloff
              <strong>{editableProfile.falloff.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min={0.35}
              max={1.4}
              step={0.01}
              value={editableProfile.falloff}
              onChange={(event) =>
                onTrainedRenderProfileChange?.({
                  falloff: Number.parseFloat(event.target.value),
                })
              }
            />
          </label>
          <button
            type="button"
            className={`cn-visibility-toggle${
              editableProfile.sortRadial ? "" : " off"
            }`}
            aria-pressed={editableProfile.sortRadial}
            onClick={() =>
              onTrainedRenderProfileChange?.({
                sortRadial: !editableProfile.sortRadial,
              })
            }
          >
            <span
              className="swatch"
              style={{
                background: editableProfile.sortRadial ? "#33f0d1" : "#61757e",
              }}
            />
            Radial sort
          </button>
          <button
            type="button"
            className="cn-panel-action"
            onClick={() => onResetTrainedRenderProfile?.()}
          >
            Reset {selectedProfile?.label ?? "style"}
          </button>
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
