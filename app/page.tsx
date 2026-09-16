import Script from "next/script";

// These ordered stylesheets also serve the independent Preact report renderer.
// Keep their shared URLs instead of making them Next-only CSS imports.
/* eslint-disable @next/next/no-css-tags */

export default function Home() {
  const appScript = process.env.NODE_ENV === "development"
    ? "/app.js?v=20260825-display5"
    : "/bundle/metis-app.js?v=20260825-display5";
  return (
    <>
      <link rel="stylesheet" href="/styles.css?v=20260825-display5" />
      <link rel="stylesheet" href="/metis-next.css?v=20260825-display5" />
      <link rel="stylesheet" href="/metis-gpt.css?v=20260825-display5" />
      <div id="app" suppressHydrationWarning />
      <Script
        type="module"
        src={appScript}
        strategy="afterInteractive"
        data-metis-app="true"
      />
    </>
  );
}
