import Link from 'next/link';
import {
  ShieldCheck,
  FileCode,
  Calendar,
  Mic,
  Crosshair,
  Bell,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Building,
  Users,
  Shield,
  Stethoscope,
  Sparkles,
} from 'lucide-react';
import { CLINIC_CONFIG } from '@/lib/config/constants';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between selection:bg-teal-600 selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center font-bold text-xl text-white shadow-md shadow-teal-600/20">
              ت
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-slate-900">نظام ترتيب (Tarteeb)</h1>
                <span className="text-[11px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full font-semibold">
                  نظام تشغيل العيادات
                </span>
              </div>
              <p className="text-xs text-slate-500">
                إدارة العيادات الطبية بالذكاء الاصطناعي مع المساعد &quot;نشمي&quot;
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="text-xs text-slate-700 hover:text-teal-700 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl border border-slate-200 transition font-medium"
            >
              شات الاستقبال (المساعد نشمي)
            </Link>
            <Link
              href="/sandbox"
              className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-md shadow-teal-600/20 flex items-center gap-2 transition"
            >
              <span>فتح لوحة التحكم (Sandbox)</span>
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-5xl mx-auto px-6 py-16 md:py-20 text-center space-y-6">
        {/* Trust Shield Badge */}
        <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 px-4 py-2 rounded-full text-teal-800 text-xs font-semibold shadow-sm">
          <ShieldCheck className="w-4 h-4 text-teal-600" />
          <span>درع الثقة: متوافق مع قانون المسؤولية الطبية رقم 25، قانون حماية البيانات رقم 24، والربط مع JoFotara</span>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-slate-900 leading-tight">
          ودّع فوضى المواعيد.. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-l from-teal-700 via-teal-600 to-cyan-600">
            نظام ترتيب لإدارة عيادات الأسنان
          </span>
        </h1>

        <p className="text-slate-600 text-base md:text-lg max-w-3xl mx-auto leading-relaxed">
          منصة سحابية متكاملة لعيادات ومراكز الأسنان في المملكة الأردنية الهاشمية. أتمتة تشغيلية كاملة لحجز المواعيد
          عبر الواتساب مع المساعد الذكي <strong>&quot;نشمي&quot;</strong>، فوترة إلكترونية وطنية فورية (JoFotara Phase 2)،
          وقناص تلقائي للمواعيد الشاغرة دون أي إرباك لموظفي الاستقبال.
        </p>

        <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sandbox"
            className="bg-teal-600 hover:bg-teal-500 text-white font-bold px-8 py-3.5 rounded-xl shadow-lg shadow-teal-600/25 flex items-center gap-2 transition transform hover:-translate-y-0.5 text-sm"
          >
            <span>بدء التجربة في لوحة التحكم (Sandbox)</span>
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Link
            href="/chat"
            className="bg-white hover:bg-slate-100 text-slate-700 font-semibold px-6 py-3.5 rounded-xl border border-slate-300 shadow-sm transition text-sm flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>تجربة المساعد نشمي (WhatsApp Web)</span>
          </Link>
        </div>
      </section>

      {/* 6 Responsive White Feature Cards Grid */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">
            منظومة تشغيلية ذكية صُممت خصيصاً لعيادات الأسنان
          </h2>
          <p className="text-sm text-slate-500 max-w-xl mx-auto">
            كافة الأدوات التي يحتاجها طبيب الأسنان وطاقم الاستقبال لضبط الجداول وزيادة الإيرادات والامتثال للقوانين
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Conversational AI (Nashmi) */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
              <Mic className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">المساعد الذكي &quot;نشمي&quot; (Voice &amp; Text)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              معالجة الرسائل الصوتية والنصية بلهجة أردنية عفوية وسريعة، اقتراح المواعيد الشاغرة، وتثبيت الحجز الفوري
              مع دعم كامل لملفات العائلة والمرافقين.
            </p>
          </div>

          {/* Card 2: JoFotara E-Invoicing */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-700">
              <FileCode className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">الفوترة الوطنية JoFotara (المرحلة 2)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              إصدار فواتير إلكترونية معتمدة بصيغة UBL 2.1 XML مشفرة تسلسلياً (PIH)، مع رمز الاستجابة السريعة
              (TLV Base64 QR) ودعم الفواتير المبسطة B2C والعامة B2B.
            </p>
          </div>

          {/* Card 3: Waitlist Sniper */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Crosshair className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">قناص قائمة الانتظار (Waitlist Sniper)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              بمجرد إلغاء أي مريض لموعده، يقوم القناص آلياً بمطابقة مدة الشاغر مع قائمة الانتظار وإرسال عرض فوري للمريض
              الأنسب لشغل الكرسي بدون أي هدر زمني.
            </p>
          </div>

          {/* Card 4: Reminders & No-Show Recovery */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <Bell className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">التذكير الذكي واستعادة الغائبين (No-Show)</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              تذكير مؤتمت قبل 24 ساعة، وتذكير تفاعلي قبل ساعتين مع موقع العيادة الجغرافي، مع ملاحقة لطيفة بعد ساعة من
              فوات الموعد لإعادة جدولته فوراً.
            </p>
          </div>

          {/* Card 5: Legal Shield (Law 25 & 24) */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">درع المسؤولية الطبية وحماية البيانات</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              حظر قطعي لأي تشخيص أو صرف مسكنات عن بعد وفق قانون 25 لعام 2018، وتفعيل بروتوكول الطوارئ السريرية
              [EMERGENCY_TRIGGER]، مع حماية بيانات المرضى وفق قانون 24 لعام 2023.
            </p>
          </div>

          {/* Card 6: Multi-Practitioner & Chairs Roster */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">جدولة الأطباء المتعددين وكراسي الأسنان</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              إدارة مرنة لأطباء المركز وتوزيع الحجوزات حسب التخصص والكرسي المتاح، مع احتساب إلزامي لـ 15 دقيقة تعقيم
              طبي بين المواعيد المتتابعة.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <p>نظام ترتيب لإدارة العيادات (Tarteeb Clinic OS) © 2026 | مدعوم بالمساعد الذكي نشمي - عمان، المملكة الأردنية الهاشمية</p>
      </footer>
    </main>
  );
}
