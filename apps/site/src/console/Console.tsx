import {
  DEFAULT_TRAINED_RENDER_PROFILE,
  trainedSplatFilename,
  type RenderLayers,
  type RenderPreset,
} from "@sense-sight/render-contracts";
import {
  decodeSplat,
  SPLAT_RECORD_BYTES,
  type DecodedSplat,
} from "@sense-sight/splat-codec";
import {
  SOURCE_REGISTRY,
  type FrameStreamSource,
  type ReplayHello,
  type ReplaySourceEntry,
} from "@sense-sight/replay-protocol";
import type { Bounds } from "@sense-sight/world-schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPresetAssets } from "../live/asset-loader";
import { ControlPanel, type LoadStatus } from "../live/ControlPanel";
import {
  appendGaussians,
  appendPoints,
  getRevealedGaussians,
  getRevealedPoints,
  initCloud,
  initSplat,
  resetCloud,
  resetSplat,
} from "../live/live-cloud";
import { createReplaySource } from "../live/replay-source";
import {
  CAMERA_VIEW_LABELS,
  type CameraViewId,
  type CameraViewRequest,
  type TrainedSplatAsset,
  Viewer,
  type ViewerRenderMode,
} from "../live/Viewer";
import { SourcePicker } from "./SourcePicker";

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

type ConsolePhase = "picker" | "selected" | "live";

function boundsFromHello(hello: ReplayHello): Bounds {
  return { min: hello.bounds.min, max: hello.bounds.max };
}

export function Console() {
  const [phase, setPhase] = useState<ConsolePhase>("picker");
  const [sources, setSources] =
    useState<readonly ReplaySourceEntry[]>(SOURCE_REGISTRY);
  const [selected, setSelected] = useState<ReplaySourceEntry | null>(null);

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

  // --- Live streaming state ---
  const [isLive, setIsLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cameraImageUrl, setCameraImageUrl] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const sourceRef = useRef<FrameStreamSource | null>(null);
  const helloRef = useRef<ReplayHello | null>(null);
  const splatRef = useRef<DecodedSplat | null>(null);
  const splatCursorRef = useRef(0);

  // Static preview assets (idle/selected state): keep the corridor-demo Spark
  // splat path working so the picker → idle viewer shows a real scene.
  useEffect(() => {
    const controller = new AbortController();
    const splatFileName = trainedSplatFilename(TRAINED_ITERATIONS, "viewer");
    setLoadStatus("loading");
    setLoadError(null);

    fetchPresetAssets(DEMO_PRESET.base, splatFileName, controller.signal)
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
            fileBytes: assets.trainedSplat,
            fileName: splatFileName,
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

  const teardownSource = useCallback(() => {
    sourceRef.current?.dispose();
    sourceRef.current = null;
    helloRef.current = null;
    splatRef.current = null;
    splatCursorRef.current = 0;
    resetCloud();
    resetSplat();
  }, []);

  // Dispose the live source on unmount.
  useEffect(() => teardownSource, [teardownSource]);

  const handleSelect = (entry: ReplaySourceEntry) => {
    setSelected(entry);
    setPhase("selected");
    setLiveError(null);
  };

  const handleAddSource = (entry: ReplaySourceEntry) => {
    setSources((current) => [...current, entry]);
  };

  const backToPicker = () => {
    teardownSource();
    setIsLive(false);
    setPlaying(false);
    setProgress(0);
    setCameraImageUrl(null);
    setPhase("picker");
    setSelected(null);
  };

  const revealSplatTo = useCallback((target: number) => {
    const splat = splatRef.current;
    if (!splat) return;
    const cursor = splatCursorRef.current;
    const clampedTarget = Math.min(target, splat.count);
    if (clampedTarget <= cursor) return;
    const n = clampedTarget - cursor;
    const positions = Array.from(
      splat.positions.subarray(cursor * 3, clampedTarget * 3)
    );
    const scales = Array.from(
      splat.scales.subarray(cursor * 3, clampedTarget * 3)
    );
    const rotations: number[] = new Array(n * 4);
    const colorsRGBA = Array.from(
      splat.colors.subarray(cursor * 4, clampedTarget * 4)
    );
    const opacities: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const src = (cursor + i) * 4;
      // Decode antimatter15 rotation bytes → quaternion x,y,z,w in [-1,1].
      rotations[i * 4] = (splat.rotations[src] - 128) / 128;
      rotations[i * 4 + 1] = (splat.rotations[src + 1] - 128) / 128;
      rotations[i * 4 + 2] = (splat.rotations[src + 2] - 128) / 128;
      rotations[i * 4 + 3] = (splat.rotations[src + 3] - 128) / 128;
      opacities[i] = splat.colors[src + 3] / 255;
    }
    appendGaussians(positions, scales, rotations, colorsRGBA, opacities);
    splatCursorRef.current = clampedTarget;
  }, []);

  const goLive = async () => {
    if (!selected) return;
    setLiveError(null);
    teardownSource();

    const src = createReplaySource(selected);
    sourceRef.current = src;

    let hello: ReplayHello;
    try {
      hello = await src.hello();
    } catch (err: unknown) {
      setLiveError(
        err instanceof Error ? err.message : "Failed to load replay source"
      );
      teardownSource();
      return;
    }
    if (sourceRef.current !== src) return; // superseded
    helloRef.current = hello;

    setWorldBounds(boundsFromHello(hello));
    resetCloud();
    initCloud(hello.pointTotal);
    setPointCount(0);

    // Fetch + decode the trained splat for progressive reveal.
    if (hello.splatUrl && hello.splatCount !== undefined) {
      try {
        const res = await fetch(hello.splatUrl);
        if (!res.ok) throw new Error(`scene.splat ${res.status}`);
        const buf = await res.arrayBuffer();
        if (sourceRef.current !== src) return;
        splatRef.current = decodeSplat(buf);
        splatCursorRef.current = 0;
        resetSplat();
        initSplat(hello.splatCount);
        setGaussianCount(hello.splatCount);
        // Dense-by-default: reveal the entire trained splat immediately so the
        // photoreal environment is visible from the first frame.
        revealSplatTo(hello.splatCount);
      } catch (err: unknown) {
        // Splat is optional; the point cloud still streams without it.
        console.warn("[console] splat decode failed:", err);
        splatRef.current = null;
      }
    }

    const unsubscribe = src.subscribe((msg) => {
      if (sourceRef.current !== src) return;
      switch (msg.type) {
        case "frame": {
          appendPoints(msg.frame.points.xyz, msg.frame.points.rgb);
          setPointCount(getRevealedPoints());
          setProgress(msg.frame.progress);
          if (msg.frame.imageUrl) setCameraImageUrl(msg.frame.imageUrl);
          if (helloRef.current?.splatCount) {
            // Dense-by-default: keep the whole trained splat revealed (also
            // re-densifies after a seek-driven reset).
            revealSplatTo(helloRef.current.splatCount);
          }
          break;
        }
        case "reset": {
          const h = helloRef.current;
          if (!h) break;
          resetCloud();
          initCloud(h.pointTotal);
          resetSplat();
          if (h.splatCount !== undefined) initSplat(h.splatCount);
          splatCursorRef.current = 0;
          setPointCount(0);
          break;
        }
        case "telemetry": {
          setPlaying(msg.snapshot.playing);
          setProgress(msg.snapshot.progress);
          break;
        }
        default:
          break;
      }
    });

    // Keep the unsubscribe tied to the source's lifetime.
    const baseDispose = src.dispose.bind(src);
    src.dispose = () => {
      unsubscribe();
      baseDispose();
    };

    setIsLive(true);
    setPhase("live");
    setProgress(0);
    setCameraImageUrl(null);
    src.play();
    setPlaying(true);
  };

  const toggleLayer = (key: keyof RenderLayers) =>
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  const requestCameraView = (id: CameraViewId) =>
    setCameraView((current) => ({ id, version: current.version + 1 }));

  // --- Transport handlers ---
  const handlePlayPause = () => {
    const src = sourceRef.current;
    if (!src) return;
    if (playing) {
      src.pause();
      setPlaying(false);
    } else {
      src.play();
      setPlaying(true);
    }
  };
  const handleSpeed = (next: number) => {
    setSpeed(next);
    sourceRef.current?.setSpeed(next);
  };
  const handleSeek = (fraction: number) => {
    const hello = helloRef.current;
    const src = sourceRef.current;
    if (!hello || !src) return;
    const frameIndex = Math.min(
      hello.keyframeCount - 1,
      Math.max(0, Math.floor(fraction * hello.keyframeCount))
    );
    setProgress(fraction);
    src.seek(frameIndex);
  };
  const handleLoop = (next: boolean) => {
    setLoop(next);
    sourceRef.current?.setLoop(next);
  };

  const trainedRenderProfile =
    DEMO_PRESET.trainedRender ?? DEFAULT_TRAINED_RENDER_PROFILE;

  const hasScene = seedPositions !== null && seedColors !== null;
  const liveGaussianLabel = new Intl.NumberFormat("en-US").format(
    isLive ? getRevealedGaussians() : gaussianCount
  );
  const livePointLabel = new Intl.NumberFormat("en-US").format(pointCount);
  const sequenceLabel = selected?.label ?? DEMO_PRESET.label;
  const pctLabel = `${Math.round(progress * 100)}%`;

  if (phase === "picker") {
    return (
      <div className="cn-console-shell">
        <header className="cn-appbar">
          <div className="cn-appbar-brand">
            <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
              <circle
                cx="13"
                cy="13"
                r="10"
                fill="none"
                stroke="#33f0d1"
                strokeWidth="1.4"
              />
              <circle cx="13" cy="13" r="3.4" fill="#33f0d1" />
            </svg>
            <div>
              SenseSight
              <small>Console</small>
            </div>
          </div>
        </header>
        <div className="cn-console cn-console--picker">
          <SourcePicker
            sources={sources}
            onSelect={handleSelect}
            onAddSource={handleAddSource}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cn-console-shell">
      <header className="cn-appbar">
        <div className="cn-appbar-brand">
          <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
            <circle
              cx="13"
              cy="13"
              r="10"
              fill="none"
              stroke="#33f0d1"
              strokeWidth="1.4"
            />
            <circle cx="13" cy="13" r="3.4" fill="#33f0d1" />
          </svg>
          <div>
            SenseSight
            <small>Console</small>
          </div>
        </div>

        <div
          className="cn-appbar-tools"
          role="toolbar"
          aria-label="Viewport controls"
        >
          <button
            type="button"
            className="cn-appbar-back"
            onClick={backToPicker}
            title="Back to sources"
          >
            ← Sources
          </button>
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
              title="Follow orbit"
              onClick={() => setAutoOrbit((enabled) => !enabled)}
            >
              Follow
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

        <div
          className="cn-appbar-status"
          role="status"
          aria-label="Console status"
        >
          <span className="cn-status-chip">
            <span
              className={`status-dot ${isLive ? "online pulse" : "offline"}`}
            />
            {isLive ? "Live" : "Idle"}
          </span>
          <span className="cn-status-chip">
            {RENDER_MODE_LABEL[renderMode]}
          </span>
          <span className="cn-status-chip">{cameraStatus}</span>
        </div>
      </header>

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
                trainedSplat={isLive ? null : trainedSplat}
                isStreamingLive={isLive}
                onAutoOrbitChange={setAutoOrbit}
                onCameraStatusChange={setCameraStatus}
                onCameraViewChange={requestCameraView}
                onRenderModeChange={setRenderMode}
              />
              <div className="cn-viewer-overlay">
                <div className="cn-viewer-readout">
                  <span>{sequenceLabel}</span>
                  <span>{livePointLabel} pts</span>
                  <span>{liveGaussianLabel} gs</span>
                  {isLive && <span>{pctLabel}</span>}
                </div>
                <div className="cn-viewer-status">
                  <span className="cn-viewer-status__item">
                    {RENDER_MODE_LABEL[renderMode]}
                  </span>
                  <span className="cn-viewer-status__item">{cameraStatus}</span>
                </div>
              </div>

              {isLive && (
                <fieldset className="cn-camera-pip">
                  <legend className="sr-only">Robot camera feed</legend>
                  <div className="cn-camera-pip__head">
                    <span className="cn-live-badge">● LIVE</span>
                    <span className="cn-camera-pip__seq">{sequenceLabel}</span>
                  </div>
                  {cameraImageUrl ? (
                    <img
                      className="cn-camera-pip__img"
                      src={cameraImageUrl}
                      alt="Robot camera frame"
                    />
                  ) : (
                    <div className="cn-camera-pip__placeholder">
                      Awaiting first frame…
                    </div>
                  )}
                </fieldset>
              )}

              {phase === "selected" && !isLive && (
                <div className="cn-golive-overlay">
                  <div className="cn-golive-card">
                    <p className="eyebrow mono">{selected?.kind ?? "replay"}</p>
                    <h2>{selected?.label}</h2>
                    {selected?.description && <p>{selected.description}</p>}
                    {liveError && <p className="cn-error mono">{liveError}</p>}
                    <button
                      type="button"
                      className="cn-btn cn-btn--primary cn-golive-btn"
                      onClick={goLive}
                    >
                      ● Go Live
                    </button>
                  </div>
                </div>
              )}
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
                    ? "Publish a preset under apps/site/public/presets/ to preview a reconstruction."
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
          pointCount={isLive ? getRevealedPoints() : pointCount}
          gaussianCount={isLive ? getRevealedGaussians() : gaussianCount}
          isLive={isLive}
          playing={playing}
          speed={speed}
          loop={loop}
          progress={progress}
          onPlayPause={handlePlayPause}
          onSpeed={handleSpeed}
          onSeek={handleSeek}
          onLoop={handleLoop}
        />
      </div>
    </div>
  );
}
