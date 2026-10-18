// Generated, versioned PDF.js resources are served by this app, never a third-party CDN.
const fs = require("node:fs");
const path = require("node:path");
const source = path.dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = require("pdfjs-dist/package.json");
const destination = path.join(
  __dirname,
  "..",
  "public",
  "vendor",
  "pdfjs",
  version,
);
fs.mkdirSync(destination, { recursive: true });
for (const folder of ["cmaps", "standard_fonts"])
  fs.cpSync(path.join(source, folder), path.join(destination, folder), {
    recursive: true,
  });
fs.copyFileSync(
  path.join(source, "LICENSE"),
  path.join(destination, "LICENSE"),
);
