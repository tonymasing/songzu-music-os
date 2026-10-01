import { isAbsolute, join, normalize, relative, resolve } from "node:path";

export type StorageZone = "database" | "uploads" | "exports" | "backups" | "sounds" | "cache";

export type StorageLayout = {
  mode: "legacy" | "hybrid";
  dataRoot: string;
  databasePath: string;
  uploadsRoot: string;
  exportsRoot: string;
  backupsRoot: string;
  soundLibraryRoot: string;
  cacheRoot: string;
  appAssetsRoot: string;
  configPath: string | null;
};

function value(name: string) {
  return process.env[name]?.trim() || null;
}

export function getStorageLayout(): StorageLayout {
  const dataRoot = value("SONGZU_MUSIC_OS_DATA_ROOT") || value("SONGZU_PROJECT_ROOT") || ".";
  const appAssetsRoot = value("SONGZU_MUSIC_OS_APP_ASSETS_ROOT") || value("SONGZU_PROJECT_ROOT") || value("SONGZU_MUSIC_OS_DATA_ROOT") || ".";
  const databasePath = value("SONGZU_MUSIC_OS_DATABASE_PATH") || join(dataRoot, "prisma", "dev.db");
  const uploadsRoot = value("SONGZU_MUSIC_OS_UPLOADS_ROOT") || join(dataRoot, "uploads");
  const exportsRoot = value("SONGZU_MUSIC_OS_EXPORTS_ROOT") || join(dataRoot, "exports");
  const backupsRoot = value("SONGZU_MUSIC_OS_BACKUPS_ROOT") || join(exportsRoot, "system-backups");
  const soundLibraryRoot = value("SONGZU_MUSIC_OS_SOUND_LIBRARY_ROOT") || join(appAssetsRoot, "public", "sound-assets");
  const cacheRoot = value("SONGZU_MUSIC_OS_CACHE_ROOT") || join(dataRoot, ".cache");
  const splitRoots = [
    "SONGZU_MUSIC_OS_DATABASE_PATH",
    "SONGZU_MUSIC_OS_UPLOADS_ROOT",
    "SONGZU_MUSIC_OS_EXPORTS_ROOT",
    "SONGZU_MUSIC_OS_BACKUPS_ROOT",
    "SONGZU_MUSIC_OS_SOUND_LIBRARY_ROOT",
    "SONGZU_MUSIC_OS_CACHE_ROOT"
  ].some((name) => Boolean(value(name)));

  return {
    mode: value("SONGZU_STORAGE_MODE") === "hybrid" || (!value("SONGZU_STORAGE_MODE") && splitRoots) ? "hybrid" : "legacy",
    dataRoot,
    databasePath,
    uploadsRoot,
    exportsRoot,
    backupsRoot,
    soundLibraryRoot,
    cacheRoot,
    appAssetsRoot,
    configPath: value("SONGZU_STORAGE_CONFIG_PATH")
  };
}

export function appRoot() {
  return getStorageLayout().dataRoot;
}

export function appAssetPath(...segments: string[]) {
  return join(getStorageLayout().appAssetsRoot, ...segments);
}

export function storagePath(zone: StorageZone, ...segments: string[]) {
  const layout = getStorageLayout();
  const root =
    zone === "database"
      ? layout.databasePath
      : zone === "uploads"
        ? layout.uploadsRoot
        : zone === "exports"
          ? layout.exportsRoot
          : zone === "backups"
            ? layout.backupsRoot
            : zone === "sounds"
              ? layout.soundLibraryRoot
              : layout.cacheRoot;

  return segments.length ? join(root, ...segments) : root;
}

export function appPath(...segments: string[]) {
  const [first, second, ...rest] = segments;
  if (first === "prisma" && second === "dev.db") return storagePath("database", ...rest);
  if (first === "uploads") return storagePath("uploads", ...(second ? [second, ...rest] : rest));
  if (first === "exports") return storagePath("exports", ...(second ? [second, ...rest] : rest));
  return join(appRoot(), ...segments);
}

export function resolveStoredFilePath(filePath: string) {
  const trimmed = filePath.trim();
  if (!trimmed) return trimmed;
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) return normalize(trimmed);

  const segments = trimmed
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("儲存檔案路徑不可離開頌祖音樂 OS 資料根目錄。");
  }
  return appPath(...segments);
}

export function relativeToAppRoot(filePath: string) {
  const layout = getStorageLayout();
  const roots: Array<[string, string]> = [
    [layout.uploadsRoot, "uploads"],
    [layout.exportsRoot, "exports"],
    [layout.backupsRoot, "backups"],
    [layout.soundLibraryRoot, "sound-library"],
    [layout.cacheRoot, "cache"],
    [layout.dataRoot, ""]
  ];
  const absoluteFilePath = resolve(filePath);
  const match = roots.find(([root]) => {
    const pathFromRoot = relative(resolve(root), absoluteFilePath);
    return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
  });
  if (!match) return filePath;
  const pathFromRoot = relative(resolve(match[0]), absoluteFilePath).replaceAll("\\", "/");
  return [match[1], pathFromRoot].filter(Boolean).join("/");
}
