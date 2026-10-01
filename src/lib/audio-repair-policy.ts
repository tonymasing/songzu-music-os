export function isManagedAudioProvider(provider: string) {
  return provider === "local_upload" || provider === "local_generated";
}

type RepairStatus = {
  exists: boolean;
  archivedAt: string | null;
  sha256: string | null;
  qualityStatus: string;
  latestReport: { errorMessage: string | null } | null;
};

export function audioRepairState(item: RepairStatus): "archived" | "repair" | "review" | "healthy" {
  if (item.archivedAt) return "archived";
  if (!item.exists || !item.sha256 || !item.latestReport || item.latestReport.errorMessage
    || item.qualityStatus === "pending" || item.qualityStatus === "fail") return "repair";
  if (item.qualityStatus === "warning") return "review";
  return "healthy";
}
