import type { Metadata } from "next";
import "./styles.css";
import NavigationProvider from "./components/NavigationProvider";
import "./navigation.css";

export const metadata: Metadata = {
  title: "Together · 家庭生活空间",
  description: "把家庭财富、市场、思考与兴趣放在一起。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <NavigationProvider>{children}</NavigationProvider>
      </body>
    </html>
  );
}
