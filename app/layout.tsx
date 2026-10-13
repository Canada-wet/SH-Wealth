import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Together · 家庭财富",
  description: "为两个人共同看见、计划和管理财富。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
