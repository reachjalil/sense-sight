export const pageMetrics = [
  { value: "sub-second", label: "operator context updates" },
  { value: "RGB-D + pose", label: "first-class capture inputs" },
  { value: "3DGS-ready", label: "world assets by design" },
  { value: "auditable", label: "every human decision recorded" },
] as const;

export const worldPipeline = [
  {
    tag: "Capture",
    title: "Bring every robot signal into one spatial timeline",
    body: "SenseSight accepts RGB, depth, LiDAR, pose, IMU, odometry, and robot-state packets as evidence about the same physical place. The product goal is not another telemetry feed; it is a synchronized world ledger that knows what the robot saw, where it was, and how confident the model should be.",
    points: [
      "Timestamped observations with robot, mission, sensor, and frame identity.",
      "Pose-aware capture paths that can be replayed against the generated scene.",
      "Sensor health and data quality surfaced before operators trust the model.",
    ],
  },
  {
    tag: "Generate",
    title: "Turn sensor streams into explorable world state",
    body: "The world-generation layer builds a live scene from incoming frames, then promotes stable geometry, trajectories, semantic anchors, and risk surfaces into durable spatial memory. Point-cloud previews work now; the asset boundary is ready for Gaussian splats as reconstruction quality increases.",
    points: [
      "Live point-cloud and trajectory previews for inspection during capture.",
      "Splat-ready artifacts for high-fidelity reconstruction and review.",
      "Semantic labels, hazards, and operator annotations attached to space.",
    ],
  },
  {
    tag: "Review",
    title: "Keep human judgment inside the operating loop",
    body: "SenseSight treats the human as a required part of the system, not an exception handler bolted on after autonomy fails. The operator sees the robot's model, checks evidence, approves actions, and leaves a decision trail the system can learn from.",
    points: [
      "Human approval, denial, modification, and rationale captured as events.",
      "World-model uncertainty stays visible in the same place as robot intent.",
      "Corrections become training signal and future mission context.",
    ],
  },
] as const;

export const worldOutputs = [
  {
    title: "Realtime scene stream",
    body: "A live spatial view that updates as the robot moves, with camera frames, depth evidence, trajectories, and reconstructed surfaces kept in one inspectable interface.",
  },
  {
    title: "Mission-ready world asset",
    body: "A stored world model that can be reopened for investigation, route review, annotation, and future robot planning instead of disappearing after a single session.",
  },
  {
    title: "Operator evidence pack",
    body: "A human-readable trail of what the robot saw, what the system inferred, what a person changed, and why a decision became operational truth.",
  },
  {
    title: "Adapter boundary",
    body: "A clean contract for live robots, local datasets, simulators, and future customer capture formats without rewriting the product surface.",
  },
] as const;

export const loopStages = [
  {
    tag: "01",
    title: "Observe",
    body: "Robot streams arrive with pose, sensor identity, health state, and mission context. SenseSight turns these packets into a structured record of reality rather than isolated files.",
  },
  {
    tag: "02",
    title: "Reconstruct",
    body: "The system continuously updates the world model, linking raw observations to spatial anchors, movement, known surfaces, uncertain regions, and candidate risks.",
  },
  {
    tag: "03",
    title: "Inspect",
    body: "The operator enters the same world the robot is using, compares viewpoints, checks sensor evidence, and understands exactly why the machine is asking for a decision.",
  },
  {
    tag: "04",
    title: "Decide",
    body: "Human approval, denial, modification, route suggestion, or annotation becomes a first-class mission event. Robot behavior changes only after the decision is captured.",
  },
  {
    tag: "05",
    title: "Remember",
    body: "Corrections and decisions are attached to the world model so the next mission starts with better spatial memory and a clearer audit trail.",
  },
] as const;

export const operatorCapabilities = [
  {
    title: "See the robot's evidence",
    body: "Switch between robot view, overhead view, reconstruction view, and review view without losing the relationship between raw pixels and spatial state.",
  },
  {
    title: "Approve action with context",
    body: "Route changes, blocked-zone requests, uncertain-object flags, and mission escalations are reviewed in the scene where they occur.",
  },
  {
    title: "Create durable corrections",
    body: "Labels, no-go regions, semantic anchors, and rationale become reusable spatial memory instead of one-off chat notes or screenshots.",
  },
] as const;

export const stackLayers = [
  {
    label: "Robot edge",
    title: "Capture adapters",
    body: "Adapter contracts normalize live robot feeds, dataset playback, and simulator output into shared observations without forcing every robot to look identical.",
  },
  {
    label: "Spatial core",
    title: "Typed mission contracts",
    body: "Shared TypeScript definitions cover observations, poses, risks, requests, decisions, annotations, and mission events so the site, console, and future services speak the same language.",
  },
  {
    label: "World engine",
    title: "Generation pipeline",
    body: "The pipeline aligns sensor packets, builds live point previews, prepares splat-ready assets, and keeps provenance attached to every generated artifact.",
  },
  {
    label: "Operator surface",
    title: "Review workspace",
    body: "The portal and future console expose the generated world, pending robot intent, human decision tools, timeline replay, and audit log as one product experience.",
  },
  {
    label: "Cloud edge",
    title: "Cloudflare deployment",
    body: "The web product is built for Pages, Workers, D1, and R2 so public pages, private workspaces, auth, audit storage, and world assets can share one domain.",
  },
  {
    label: "Open platform",
    title: "Extensible packages",
    body: "The monorepo keeps app-specific code in apps and reusable robotics contracts in packages, leaving room for viewer packages, dataset tools, and worker services.",
  },
] as const;

export const openSourceCommitments = [
  {
    title: "Readable architecture",
    body: "The repo should explain where public site code, operator product code, typed robotics contracts, world viewers, workers, and data adapters belong.",
  },
  {
    title: "Production habits",
    body: "Every change should pass formatting, type checks, and build validation before it is promoted. The baseline keeps CI/CD visible rather than hidden in local scripts.",
  },
  {
    title: "Useful extension points",
    body: "Contributors should be able to add a robot adapter, dataset adapter, world-view layer, or operator workflow without changing unrelated app surfaces.",
  },
  {
    title: "Human-in-the-loop by default",
    body: "The project should make inspection, correction, approval, and auditability part of the core product contract, not optional enterprise polish later.",
  },
] as const;

export const roadmap = [
  "Private operator workspaces tied to missions, robots, and generated world assets.",
  "Cloudflare-backed audit storage for login, review, annotation, and decision events.",
  "Dataset playback for reproducible world-generation runs before live robot integration.",
  "Gaussian-splat asset loading with point-cloud fallback for low-latency review.",
  "Robot adapter examples for RGB-D, pose, odometry, IMU, LiDAR, and state streams.",
] as const;
