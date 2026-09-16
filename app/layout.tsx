import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    "localhost:3001";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.svg`;

  return {
    title: "Metis · 跨境选品决策系统",
    description:
      "从问题到决策：汇聚市场、竞品、消费者声音与成本信号，交付可执行、可追溯的跨境选品结论。",
    metadataBase: new URL(origin),
    icons: {
      icon: "/og.svg",
      shortcut: "/og.svg",
    },
    openGraph: {
      title: "Metis · 跨境选品决策系统",
      description:
        "从问题到决策。五节点研究链，交付可拍板、可追溯的跨境选品报告。",
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: "Metis · 跨境选品决策系统",
      description:
        "从问题到决策。五节点研究链，交付可拍板、可追溯的跨境选品报告。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
