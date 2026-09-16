import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(process.cwd(), "public/app.js"),
      formats: ["es"],
      fileName: () => "metis-app.js",
    },
    minify: true,
    outDir: resolve(process.cwd(), "public/bundle"),
    sourcemap: false,
  },
});
