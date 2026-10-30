import fs from "node:fs/promises";
import path from "node:path";
const seen = new Set();
const parts = [
  "# Third party notices\n\nFolio includes the following runtime libraries. Electron and Chromium notices are distributed by Electron inside the application bundle.\n",
];
async function visit(name, parent = process.cwd()) {
  let dir = parent;
  let root;
  while (true) {
    const candidate = path.join(dir, "node_modules", name);
    try {
      await fs.access(path.join(candidate, "package.json"));
      root = candidate;
      break;
    } catch {}
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  if (!root || seen.has(root)) return;
  seen.add(root);
  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  parts.push(
    `\n## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license || "See package license"}\n`,
  );
  for (const file of await fs.readdir(root)) {
    if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)) {
      const st = await fs.stat(path.join(root, file));
      if (st.isFile() && st.size < 250000)
        parts.push(
          `\n### ${file}\n\n${await fs.readFile(path.join(root, file), "utf8")}\n`,
        );
    }
  }
  for (const child of Object.keys(pkg.dependencies || {}))
    await visit(child, root);
}
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
for (const name of [
  ...Object.keys(pkg.dependencies),
  "pdfjs-dist",
  "react",
  "react-dom",
  "lucide-react",
])
  await visit(name);
await fs.writeFile("THIRD_PARTY_NOTICES.md", parts.join("\n"));
await fs.mkdir("dist", { recursive: true });
await fs.copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
