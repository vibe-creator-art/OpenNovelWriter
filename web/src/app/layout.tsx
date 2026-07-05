import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import { I18nProvider } from "@/components/i18n-provider";
import { AiRunUi } from "@/components/ai/ai-run-ui";

export const metadata: Metadata = {
  title: "OpenNovelWriter - AI 驱动小说创作平台",
  description: "一个类似 NovelCrafter 的开源 AI 驱动小说创作平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        <I18nProvider>
          {children}
          <AiRunUi />
        </I18nProvider>
      </body>
    </html>
  );
}
