import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { readPublicConfig } from "@/lib/config/public";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "PAP — Authz Admin",
  description: "Policy Administration Point for the service-policy PDP",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Read per request, on the server: this is what keeps the browser's
  // configuration a property of the running container and not of the image.
  const publicConfig = readPublicConfig();

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers config={publicConfig}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
