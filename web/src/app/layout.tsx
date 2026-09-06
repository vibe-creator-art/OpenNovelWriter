import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";
import { I18nProvider } from "@/components/i18n-provider";
import { AiRunUi } from "@/components/ai/ai-run-ui";
import { IPhoneViewport } from "@/components/iphone-viewport";
import { APP_COLOR_THEME_STORAGE_KEY } from "@/lib/app-theme";

export const metadata: Metadata = {
  title: "OpenNovelWriter - AI 驱动小说创作平台",
  description: "一个类似 NovelCrafter 的开源 AI 驱动小说创作平台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const appBootstrapScript = `
(() => {
  const root = document.documentElement;
  root.toggleAttribute('data-phone-layout', /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent));
  try {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(APP_COLOR_THEME_STORAGE_KEY)}) || 'null');
    const theme = stored?.state?.colorTheme;
    const colorTheme = theme === 'eyeCare' || theme === 'dark' ? theme : 'light';
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
        <script dangerouslySetInnerHTML={{ __html: appBootstrapScript }} />
      </head>
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        <IPhoneViewport />
        <I18nProvider>
          {children}
          <AiRunUi />
        </I18nProvider>
      </body>
    </html>
  );
}
