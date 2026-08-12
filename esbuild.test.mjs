import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/translation-core.test.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: ".test-dist/translation-core.test.cjs",
  logLevel: "info"
});
