const DEFAULT_DATASET_RELATIVE_PATH = "data/openloris-gaussian-splat";

export interface ResolveDatasetRootOptions {
  env?: Record<string, string | undefined>;
  repoRoot?: string;
}

export function resolveDatasetRoot(
  options: ResolveDatasetRootOptions = {}
): string {
  const env = options.env ?? process.env;
  const override = env.SENSESIGHT_DATA_ROOT;
  if (override && override.trim().length > 0) {
    return override;
  }

  const repoRoot = options.repoRoot ?? process.cwd();
  return `${repoRoot}/${DEFAULT_DATASET_RELATIVE_PATH}`;
}
