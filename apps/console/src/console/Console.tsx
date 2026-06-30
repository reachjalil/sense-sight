import {
  DEFAULT_TRAINED_RENDER_PROFILE,
  trainedSplatFilename,
  type RenderLayers,
  type RenderPreset,
} from "@sense-sight/render-contracts";
import { SPLAT_RECORD_BYTES } from "@sense-sight/splat-codec";
import type { Bounds } from "@sense-sight/world-schema";
import { useEffect, useState } from "react";
import { fetchPresetAssets } from "../live/asset-loader";
import { ControlPanel, type LoadStatus } from "../live/ControlPanel";
import {
  CAMERA_VIEW_LABELS,
  type CameraViewId,
  type CameraViewRequest,
  type TrainedSplatAsset,
  Viewer,
  type ViewerRenderMode,
} from "../live/Viewer";

const DEFAULT_LAYERS: RenderLayers = {
  pointcloud: true,
  trajectory: false,
  splat: true,
  grid: true,
  annotations: false,
};

const DEMO_PRESET: RenderPreset = {
  label: "Corridor demo",
  description: "Default console preview preset.",
  base: "corridor-demo",
  pointSize: 0.05,
  tone: "Live preview",
  coordinateFrame: "training-frame",
};

const TRAINED_ITERATIONS = 30000;

const RENDER_MODE_LABEL: Record<ViewerRenderMode, string> = {
  empty: "No scene",
  fallback: "Point fallback",
  seed: "Seed cloud",
  spark: "Spark 3DGS",
  stream: "Live stream",
};

export function Console() {
  const [layers, setLayers] = useState<RenderLayers>(DEFAULT_LAYERS);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Orbit camera");
  const [cameraView, setCameraView] = useState<CameraViewRequest>({
    id: "orbit",
    version: 0,
  });
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [renderMode, setRenderMode] = useState<ViewerRenderMode>("empty");
  const [worldBounds, setWorldBounds] = useState<Bounds | null>(null);
  const [seedPositions, setSeedPositions] = useState<Float32Array | null>(null);
  const [seedColors, setSeedColors] = useState<Float32Array | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [trainedSplat, setTrainedSplat] = useState<TrainedSplatAsset | null>(
    null
  );
  const [gaussianCount, setGaussianCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadStatus("loading");
    setLoadError(null);

    fetchPresetAssets(
      DEMO_PRESET.base,
      trainedSplatFilename(TRAINED_ITERATIONS, "viewer"),
      controller.signal
    )
      .then((assets) => {
        if (controller.signal.aborted) return;
        setWorldBounds(assets.world.bounds);
        setSeedPositions(assets.positions);
        const colors = new Float32Array(assets.colors.length);
        for (let i = 0; i < assets.colors.length; i += 1) {
          colors[i] = assets.colors[i] / 255;
        }
        setSeedColors(colors);
        setPointCount(
          assets.world.primitiveCount ?? assets.positions.length / 3
        );
        if (assets.trainedSplat) {
          setGaussianCount(
            Math.floor(assets.trainedSplat.byteLength / SPLAT_RECORD_BYTES)
          );
          const blobUrl = URL.createObjectURL(
            new Blob([assets.trainedSplat], {
              type: "application/octet-stream",
            })
          );
          setTrainedSplat({
            url: blobUrl,
            sourceBounds: assets.world.bounds,
            coordinateFrame: DEMO_PRESET.coordinateFrame,
          });
        }
        setLoadStatus("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadStatus("failed");
        setLoadError(
          err instanceof Error ? err.message : "Preset assets unavailable"
        );
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (trainedSplat) URL.revokeObjectURL(trainedSplat.url);
    };
  }, [trainedSplat]);

  const toggleLayer = (key: keyof RenderLayers) =>
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  const requestCameraView = (id: CameraViewId) =>
    setCameraView((current) => ({ id, version: current.version + 1 }));

  const trainedRenderProfile =
    DEMO_PRESET.trainedRender ?? DEFAULT_TRAINED_RENDER_PROFILE;

  const hasScene = seedPositions !== null && seedColors !== null;

  return (
    <div className="cn-console">
      <div className="cn-viewer">
        {hasScene ? (
          <>
            <Viewer
              autoOrbit={autoOrbit}
              cameraView={cameraView}
              layers={layers}
              trainedRenderProfile={trainedRenderProfile}
              worldBounds={worldBounds}
              seedPositions={seedPositions}
              seedColors={seedColors}
              trainedSplat={trainedSplat}
              isStreamingLive={false}
              onAutoOrbitChange={setAutoOrbit}
              onCameraStatusChange={setCameraStatus}
              onCameraViewChange={requestCameraView}
              onRenderModeChange={setRenderMode}
            />
            <div className="cn-viewer-overlay">
              <div
                className="cn-viewer-toolbar"
                role="toolbar"
                aria-label="Camera controls"
              >
                <fieldset className="cn-viewer-tabs">
                  <legend className="sr-only">Camera view</legend>
                  {(Object.keys(CAMERA_VIEW_LABELS) as CameraViewId[]).map(
                    (id, index) => (
                      <button
                        key={id}
                        type="button"
                        className={cameraView.id === id ? "active" : ""}
                        aria-pressed={cameraView.id === id}
                        aria-keyshortcuts={`${index + 1}`}
                        title={`Camera ${index + 1}`}
                        onClick={() => {
                          setAutoOrbit(false);
                          requestCameraView(id);
                        }}
                      >
                        {CAMERA_VIEW_LABELS[id]}
                      </button>
                    )
                  )}
                </fieldset>
                <fieldset className="cn-viewer-actions">
                  <legend className="sr-only">Camera actions</legend>
                  <button
                    type="button"
                    className={autoOrbit ? "active" : ""}
                    aria-pressed={autoOrbit}
                    aria-keyshortcuts="A"
                    title="Auto orbit"
                    onClick={() => setAutoOrbit((enabled) => !enabled)}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    aria-keyshortcuts="F R"
                    title="Fit scene"
                    onClick={() => {
                      setAutoOrbit(false);
                      requestCameraView("orbit");
                    }}
                  >
                    Fit
                  </button>
                </fieldset>
              </div>
              <div className="cn-viewer-status">
                <span className="cn-viewer-status__item">
                  {RENDER_MODE_LABEL[renderMode]}
                </span>
                <span className="cn-viewer-status__item">{cameraStatus}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="cn-empty-state">
            <div className="cn-empty-panel">
              <p className="eyebrow mono">SenseSight Console</p>
              <h1>
                {loadError ? "Preset assets not published" : "Loading scene…"}
              </h1>
              <p>
                {loadError
                  ? "Publish a preset under apps/console/public/presets/ to preview a reconstruction."
                  : "Fetching the seed cloud and trained splat for the configured preset."}
              </p>
              {loadError && <p className="mono">{loadError}</p>}
            </div>
          </div>
        )}
      </div>
      <ControlPanel
        layers={layers}
        onToggleLayer={toggleLayer}
        loadStatus={loadStatus}
        preset={DEMO_PRESET}
        trainedRenderProfile={trainedRenderProfile}
        pointCount={pointCount}
        gaussianCount={gaussianCount}
      />
    </div>
  );
}
