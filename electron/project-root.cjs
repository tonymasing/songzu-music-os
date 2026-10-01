const path = require("node:path");
module.exports = {
  projectRoot: process.env.SONGZU_PROJECT_ROOT || path.resolve(__dirname, ".."),
  defaultPort: "3000",
  serverScript: "start"
};
