import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceSvg = join(root, "public", "icon.svg");
const buildDir = join(root, "build");
const pngPath = join(buildDir, "icon.png");

await mkdir(buildDir, { recursive: true });
await rm(join(buildDir, "icon.iconset"), { recursive: true, force: true });
await sharp(sourceSvg).resize(1024, 1024, { fit: "cover" }).png().toFile(pngPath);

console.log(`Electron icon source generated: ${pngPath}`);
