import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import { I18nProvider } from "@/components/i18n-provider";
import { AiRunUi } from "@/components/ai/ai-run-ui";
import { APP_COLOR_THEME_STORAGE_KEY } from "@/lib/app-theme";

export const metadata: Metadata = {
  title: "OpenNovelWriter - AI 驱动小说创作平台",
  description: "一个类似 NovelCrafter 的开源 AI 驱动小说创作平台",
};

const appThemeBootstrapScript = `
(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(APP_COLOR_THEME_STORAGE_KEY)}) || 'null');
    const theme = stored?.state?.colorTheme;
    const colorTheme = theme === 'eyeCare' || theme === 'dark' ? theme : 'light';
    const root = document.documentElement;
    root.dataset.colorTheme = colorTheme;
    root.classList.toggle('dark', colorTheme === 'dark');
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appThemeBootstrapScript }} />
      </head>
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
