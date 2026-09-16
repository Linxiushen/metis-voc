import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(process.cwd(), "build/metis-vendor.ts"),
      formats: ["es"],
      fileName: () => "metis-vendor.js",
    },
    minify: true,
    outDir: resolve(process.cwd(), "public/vendor"),
    sourcemap: false,
  },
});
