import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'نظام ترتيب (Tarteeb) - نظام تشغيل عيادات الأسنان الذكي',
  description: 'نظام ترتيب لإدارة عيادات الأسنان بالذكاء الاصطناعي مع المساعد نشمي - متوافق مع التشريعات الأردنية والفوترة الوطنية JoFotara',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-slate-50 text-slate-900 min-h-screen selection:bg-teal-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
