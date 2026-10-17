import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "薄肌语言俱乐部 · 每天一点，双倍成长",
  description: "记录真实生活，练习真实表达。薄肌与语言，每天一起进步。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
