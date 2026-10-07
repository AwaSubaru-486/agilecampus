import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgileCampus · 团队协作空间",
  description: "面向高校团队的 Agent 驱动轻量项目管理平台",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f6f5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Browser extensions can inject attributes on <html> before hydration.
    // Keep this exception on the root so application mismatches remain visible.
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
