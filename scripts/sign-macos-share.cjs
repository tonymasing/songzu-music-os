// Sign the friend-distribution App before the DMG is assembled. This is ad hoc,
// not Developer ID signing or Apple notarization.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function makeWritable(entry) {
  const info = fs.lstatSync(entry);
  if (info.isSymbolicLink()) return;
  fs.chmodSync(entry, info.mode | 0o200);
  if (info.isDirectory()) for (const name of fs.readdirSync(entry)) makeWritable(path.join(entry, name));
}
module.exports = async function signShare(context) {
  if (context.electronPlatformName !== "darwin") return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  makeWritable(bundle);
  for (const args of [["--force", "--deep", "--sign", "-", bundle], ["--verify", "--deep", "--strict", bundle]]) {
    const result = spawnSync("/usr/bin/codesign", args, {stdio: "inherit"});
    if (result.error || result.status !== 0) throw new Error("分享版 macOS 簽章失敗，停止封裝。");
  }
};
