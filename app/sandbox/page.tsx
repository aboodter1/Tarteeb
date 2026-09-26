'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Mic,
  Bot,
  User,
  Shield,
  FileCode,
  Calendar,
  Crosshair,
  Bell,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  QrCode,
  Sparkles,
  RotateCcw,
  Users,
  Stethoscope,
  Activity,
} from 'lucide-react';
import { CLINIC_CONFIG, CLINICAL_SERVICES } from '@/lib/config/constants';
import { InvoiceViewer } from '@/components/invoice-viewer';
import { supabaseBrowser } from '@/lib/db/supabase-browser';
import { ReceptionistAlert } from '@/types';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  isVoice?: boolean;
  time: string;
  isEmergency?: boolean;
}

export default function SandboxPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      sender: 'bot',
      text: 'يا هلا والله فيك في نظام ترتيب لإدارة العيادات (المساعد نشمي) 🦷 تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟',
      time: '10:00 ص',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'tools' | 'database' | 'roster' | 'ehr' | 'alerts' | 'jofotara' | 'jobs' | 'apm'>('tools');
  const [liveAlerts, setLiveAlerts] = useState<ReceptionistAlert[]>([]);
  const [telemetry, setTelemetry] = useState<any>({
    toolCalls: [],
    database: { appointments: [], patients: [], waitlist: [], invoices: [] },
    latestXml: '',
    latestQr: '',
    latestInvoiceMeta: null,
    jobsLog: [],
  });
  const [isMounted, setIsMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
    fetchTelemetry();
    fetchChatHistory();
    executeJobAction('test_jofotara', { invoiceType: 'B2C_SIMPLIFIED' });

    // 1. Supabase Realtime Subscription on appointments table
    let channel: any = null;
    let alertsChannel: any = null;
    try {
      channel = supabaseBrowser
        .channel('realtime-appointments-sandbox')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'appointments' },
          () => {
            fetchTelemetry();
          }
        )
        .subscribe();
    } catch (realtimeErr) {
      console.warn('[Sandbox Realtime] Subscription error, relying on poll fallback:', realtimeErr);
    }

    // 2. Supabase Realtime Broadcast Channel for Live Receptionist Alerts
    try {
      alertsChannel = supabaseBrowser
        .channel('receptionist-alerts')
        .on('broadcast', { event: 'RECEPTIONIST_ALERT' }, (payload: any) => {
          console.log('[Live Alert Broadcast Received]:', payload);
          if (payload?.payload) {
            setLiveAlerts((prev) => [payload.payload, ...prev.filter((a) => a.id !== payload.payload.id)]);
          }
        })
        .subscribe();
    } catch (alertsErr) {
      console.warn('[Sandbox Realtime Alerts] Subscription error:', alertsErr);
    }

    // Polling fallback every 3.5 seconds for instant synchrony
    const pollInterval = setInterval(() => {
      fetchTelemetry();
    }, 3500);

    return () => {
      if (channel) {
        supabaseBrowser.removeChannel(channel);
      }
      if (alertsChannel) {
        supabaseBrowser.removeChannel(alertsChannel);
      }
      clearInterval(pollInterval);
    };
  }, []);

  const fetchChatHistory = async () => {
    try {
      const res = await fetch('/api/history?phone=+962791234567');
      const data = await res.json();
      if (data.success && Array.isArray(data.chat_history) && data.chat_history.length > 0) {
        const formatted: ChatMessage[] = data.chat_history.map((m: any, idx: number) => ({
          id: `h-${idx}-${m.timestamp || Date.now()}`,
          sender: m.role === 'user' ? 'user' : 'bot',
          text: m.text,
          time: m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })
            : '10:00 ص',
        }));
        setMessages(formatted);
      }
    } catch (err) {
      console.warn('[Sandbox] Failed to hydrate chat history:', err);
    }
  };

  const handleResetChat = async () => {
    try {
      await fetch('/api/history?phone=+962791234567', { method: 'DELETE' });
      setMessages([
        {
          id: `m-reset-${Date.now()}`,
          sender: 'bot',
          text: 'يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان في عمان 🦷 تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟',
          time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      console.warn('[Sandbox] Failed to reset chat history:', err);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleDismissAlert = async (alertId: string) => {
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', alertId }),
      });
      setLiveAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      console.warn('Failed to dismiss alert:', err);
    }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      setTelemetry((prev: any) => ({
        ...prev,
        database: data,
      }));
      if (Array.isArray(data.receptionist_alerts)) {
        setLiveAlerts(data.receptionist_alerts);
      }
    } catch (err) {
      console.warn('Failed to fetch telemetry:', err);
    }
  };

  // Safety Watchdog: Guarantee loading indicator NEVER hangs longer than 10 seconds under any circumstances
  useEffect(() => {
    if (!loading) return;
    const watchdog = setTimeout(() => {
      console.warn('[Sandbox Watchdog] Auto-clearing hung loading state');
      setLoading(false);
    }, 10000);
    return () => clearTimeout(watchdog);
  }, [loading]);

  const handleSendMessage = async (customText?: string, isVoice = false) => {
    const textToSend = customText || inputText.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: isVoice ? `🎤 [رسالة صوتية] "${textToSend}"` : textToSend,
      isVoice,
      time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    const controller = new AbortController();
    const clientTimeout = setTimeout(() => {
      controller.abort();
    }, 14000);

    const isGreeting = /(?:السلام|سلام|مرحبا|صباح|مساء|يعطيك|هلا|أهلا|اهلا)/.test(textToSend);

    try {
      const res = await fetch('/api/clean-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          audioBase64: isVoice ? 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' : undefined,
          phone: '+962791234567',
          history: messages.map((m) => ({
            role: m.sender === 'user' ? 'user' : 'model',
            text: m.text,
          })),
        }),
        signal: controller.signal,
      });

      clearTimeout(clientTimeout);

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      const nameMatch = textToSend.match(/(?:أنا|اسمي|معك|لـ|للمريض|الأخ|السيد)\s+([^\s،.]+)/);
      const detectedName = nameMatch ? nameMatch[1] : '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في نظام ترتيب لإدارة العيادات (المساعد نشمي)! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷'
        : `${greeting}، غلبتك صار خطأ بسيط بالاتصال، ممكن تعيدلي طلبك بعد إذنك؟`;

      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: 'bot',
        text: data.reply || fallbackText,
        time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
        isEmergency: data.isEmergency,
      };

      setMessages((prev) => [...prev, botMsg]);

      // Update telemetry
      if (data.toolCalls && data.toolCalls.length > 0) {
        setTelemetry((prev: any) => ({
          ...prev,
          toolCalls: [...data.toolCalls, ...prev.toolCalls],
        }));
      }

      await fetchTelemetry();
    } catch (err: any) {
      clearTimeout(clientTimeout);
      console.warn('[Sandbox Client Error/Timeout]:', err?.message || err);

      const nameMatch = textToSend.match(/(?:أنا|اسمي|معك|لـ|للمريض|الأخ|السيد)\s+([^\s،.]+)/);
      const detectedName = nameMatch ? nameMatch[1] : '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في نظام ترتيب لإدارة العيادات (المساعد نشمي)! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷'
        : `${greeting}، غلبتك صار خطأ بسيط بالاتصال، ممكن تعيدلي طلبك بعد إذنك؟`;

      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: fallbackText,
          time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const executeJobAction = async (action: string, payload?: any) => {
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const data = await res.json();
      setTelemetry((prev: any) => ({
        ...prev,
        jobsLog: [{ action, timestamp: new Date().toISOString(), result: data.result || data.compileRes }, ...prev.jobsLog],
        latestXml: data.compileRes?.xml || prev.latestXml,
        latestQr: data.compileRes?.tlvQrCode || prev.latestQr,
        latestInvoiceMeta: data.compileRes || prev.latestInvoiceMeta,
      }));
      await fetchTelemetry();
    } catch (err) {
      console.error('Job trigger error:', err);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Header */}
      <header className="px-6 py-3.5 border-b border-slate-200 bg-white sticky top-0 z-50 flex items-center justify-between no-print shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center font-bold text-white shadow-md shadow-teal-600/20">
            ت
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base md:text-lg text-slate-900">نظام ترتيب (Tarteeb Clinic OS)</h1>
              <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full font-semibold">
                عمان - الأردن 🇯🇴
              </span>
            </div>
            <p className="text-xs text-slate-500">
              لوحة التحكم الطبية والمحاكاة التفاعلية (Clinic ERP Dashboard) | نظام تشغيل العيادات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTelemetry}
            className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg border border-slate-200 transition font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث البيانات</span>
          </button>
        </div>
      </header>

      {/* Main Dual-Pane Container */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden h-[calc(100vh-65px)]">
        {/* LEFT PANE: WhatsApp Simulator (5 cols on desktop) */}
        <section className="lg:col-span-5 flex flex-col border-b lg:border-b-0 lg:border-l border-slate-200 bg-white no-print">
          {/* WhatsApp Header Simulation */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
                  نشمي
                </div>
                <span className="absolute bottom-0 left-0 w-3 h-3 bg-teal-500 border-2 border-white rounded-full"></span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-semibold text-slate-900">{CLINIC_CONFIG.name}</h2>
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                </div>
                <p className="text-[11px] text-slate-500">متصل الآن عبر واتساب الأعمال • عمان</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleResetChat}
                title="بدء محادثة جديدة ومسح السجل"
                className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-rose-600 bg-white hover:bg-slate-100 px-2.5 py-1 rounded border border-slate-200 transition font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                <span>محادثة جديدة</span>
              </button>
              <span className="text-[10px] text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded font-mono">
                +962 7 9000 0000
              </span>
            </div>
          </div>

          {/* Quick Scenario Chips */}
          <div className="p-2.5 bg-slate-50/80 border-b border-slate-200 overflow-x-auto flex gap-2 text-xs">
            <button
              onClick={() => handleSendMessage('مرحبا، بدي احجز موعد كشف واستشارة بكرة بعد الظهر')}
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-sm transition font-medium"
            >
              🩺 حجز موعد كشف
            </button>
            <button
              onClick={() =>
                handleSendMessage('مرحبا يا دكتور، عندي نزيف مستمر في اللثة مع ورم كبير في خدي ومش قادر اتنفس كويس', false)
              }
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 shadow-sm transition flex items-center gap-1 font-medium"
            >
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              <span>🚨 اختبار طوارئ قانون 25</span>
            </button>
            <button
              onClick={() =>
                handleSendMessage('بدي احجز موعد تنظيف أسنان لابني عمره 10 سنوات واسمه كرم التميمي', false)
              }
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 shadow-sm transition font-medium"
            >
              👨‍👩‍👧 حجز لابني (عائلة)
            </button>
            <button
              onClick={() =>
                handleSendMessage('بدي الغي موعدي بكرة لانه عندي ظرف طارئ', false)
              }
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 shadow-sm transition font-medium"
            >
              ❌ إلغاء موعد (قناص)
            </button>
            <button
              onClick={() =>
                handleSendMessage('أنا شركة استشارات، بدي فاتورة ضريبية رسمية للشركة باسم شركة الأمل ورقمها الضريبي 102938475', false)
              }
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm transition font-medium"
            >
              📜 فاتورة JoFotara B2B
            </button>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-100/60">
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 shadow-sm ${
                      isUser
                        ? 'bg-slate-800 text-white'
                        : msg.isEmergency
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-teal-100 text-teal-700 border border-teal-200 font-bold'
                    }`}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs md:text-sm leading-relaxed shadow-sm ${
                      isUser
                        ? 'bg-teal-600 text-white rounded-bl-none'
                        : msg.isEmergency
                        ? 'bg-rose-50 border border-rose-200 text-rose-900 rounded-br-none font-medium'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-br-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <span
                      suppressHydrationWarning={true}
                      className={`block text-[10px] mt-1 text-left opacity-75 ${
                        isUser ? 'text-teal-100' : 'text-slate-400'
                      }`}
                    >
                      {isMounted ? msg.time : ''}
                    </span>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <Sparkles className="w-4 h-4 animate-spin text-teal-600" />
                <span>المساعد نشمي يكتب الآن...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
            <button
              onClick={() => handleSendMessage('يا هلا دكتور، بسجل صوتي عشان أسأل عن موعد تنظيف أسنان الأربعاء الجاي', true)}
              title="إرسال رسالة صوتية تجريبية"
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-teal-600 border border-slate-200 transition shrink-0"
            >
              <Mic className="w-4 h-4" />
            </button>

            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="اكتب رسالة واتساب كالمريض..."
              className="flex-1 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white rounded-xl px-3.5 py-2 text-xs md:text-sm text-slate-900 outline-none resize-none transition"
            />

            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim() || loading}
              className="p-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white transition shrink-0 shadow-md shadow-teal-600/20"
            >
              <Send className="w-4 h-4 -rotate-90" />
            </button>
          </div>
        </section>

        {/* RIGHT PANE: Live Telemetry & Control Center (7 cols on desktop) */}
        <section className="lg:col-span-7 flex flex-col bg-slate-50 overflow-hidden">
          {/* Tabs Navigation */}
          <div className="flex items-center border-b border-slate-200 bg-white px-4 pt-2 no-print overflow-x-auto shadow-sm">
            <button
              onClick={() => setActiveTab('tools')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'tools'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>أدوات Gemini</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'database'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>قاعدة البيانات</span>
              {telemetry.database?.appointments?.length > 0 && (
                <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded-full font-mono font-bold">
                  {telemetry.database.appointments.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('roster')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'roster'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>الأطباء والكراسي</span>
            </button>

            <button
              onClick={() => setActiveTab('ehr')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'ehr'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Stethoscope className="w-3.5 h-3.5" />
              <span>السجل الطبي (EHR)</span>
            </button>

            <button
              onClick={() => setActiveTab('alerts')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'alerts'
                  ? 'border-rose-600 text-rose-700 bg-rose-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>تنبيهات الاستقبال</span>
              {liveAlerts.length > 0 && (
                <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.2 rounded-full font-mono font-bold animate-pulse">
                  {liveAlerts.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('jofotara')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'jofotara'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>JoFotara</span>
            </button>

            <button
              onClick={() => setActiveTab('jobs')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'jobs'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>المهام الذكية</span>
            </button>

            <button
              onClick={() => setActiveTab('apm')}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === 'apm'
                  ? 'border-teal-600 text-teal-700 bg-teal-50/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>مراقبة APM</span>
            </button>
          </div>

          {/* Prominent Live Receptionist Alerts Banner (Light Medical High-Contrast) */}
          {liveAlerts.length > 0 && (
            <div className="bg-rose-50 border-b border-rose-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-900 font-bold text-xs">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                  </span>
                  <span>تنبيهات الاستجابة الفورية لطاقم الاستقبال ({liveAlerts.length} تنبيه نشط)</span>
                </div>
                <button
                  onClick={() => setActiveTab('alerts')}
                  className="text-[11px] text-rose-700 font-semibold underline hover:text-rose-900"
                >
                  فتح لوحة التنبيهات الكاملة
                </button>
              </div>

              {liveAlerts.slice(0, 2).map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between text-xs p-2.5 rounded-lg border shadow-sm ${
                    alert.type === 'EMERGENCY'
                      ? 'bg-white border-rose-200 text-rose-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden text-ellipsis">
                    <span className="font-bold shrink-0">
                      {alert.type === 'EMERGENCY' ? '🚨 طوارئ سريرية:' : '⚠️ تعذر إرسال واتساب:'}
                    </span>
                    <span className="truncate">{alert.description}</span>
                    <span className="text-[10px] opacity-75 font-mono shrink-0">
                      {new Date(alert.timestamp).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDismissAlert(alert.id)}
                    className="px-2.5 py-1 rounded text-[11px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition shrink-0 mr-2 shadow-xs font-medium"
                  >
                    تمت المتابعة ✓
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Tab Content Display */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {/* TAB 1: Gemini Tool Calls */}
            {activeTab === 'tools' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                    <span>سجل استدعاء أدوات الذكاء الاصطناعي (Function Declarations)</span>
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    النموذج: gemini-3.5-flash / gemini-2.5-flash
                  </span>
                </div>

                {telemetry.toolCalls.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500 text-xs shadow-xs">
                    لم يتم تنفيذ أي استدعاء أدوات حتى الآن. جرب إرسال رسالة حجز أو إلغاء في لوحة المحادثة على اليمين!
                  </div>
                ) : (
                  telemetry.toolCalls.map((call: any, idx: number) => (
                    <div
                      key={idx}
                      className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs font-mono shadow-xs"
                    >
                      <div className="flex items-center justify-between text-teal-700 font-semibold border-b border-slate-100 pb-2">
                        <span>Tool: {call.name}()</span>
                        <span className="text-[10px] text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                          Success
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-1 font-sans">المعاملات (Arguments):</span>
                        <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-slate-700 overflow-x-auto">
                          {JSON.stringify(call.args, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <span className="text-slate-500 block mb-1 font-sans">نتيجة التنفيذ (Execution Result):</span>
                        <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-teal-800 overflow-x-auto">
                          {JSON.stringify(call.result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: Supabase Multi-Tenant RLS */}
            {activeTab === 'database' && (
              <div className="space-y-6">
                {/* Appointments Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-teal-600" />
                      <span>جدول المواعيد (appointments) - شاملاً فترة التعقيم الإلزامية 15 دقيقة</span>
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Clinic ID: {CLINIC_CONFIG.id}
                    </span>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-xs">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                        <tr>
                          <th className="p-2.5">المريض</th>
                          <th className="p-2.5">الخدمة</th>
                          <th className="p-2.5">وقت البدء</th>
                          <th className="p-2.5">نهاية التعقيم</th>
                          <th className="p-2.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {telemetry.database.appointments.map((appt: any) => (
                          <tr key={appt.id} className="hover:bg-slate-50/70">
                            <td className="p-2.5 font-medium text-slate-900">{appt.patient_name}</td>
                            <td className="p-2.5 text-slate-600">{appt.service_type}</td>
                            <td className="p-2.5 font-mono text-[11px]">
                              {new Date(appt.start_time).toLocaleString('ar-JO')}
                            </td>
                            <td className="p-2.5 font-mono text-[11px] text-amber-700 font-medium">
                              {new Date(appt.sterilization_end_time || appt.end_time).toLocaleTimeString(
                                'ar-JO'
                              )}
                            </td>
                            <td className="p-2.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  appt.status === 'CONFIRMED'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : appt.status === 'CANCELLED'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {appt.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Waitlist Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-teal-600" />
                    <span>قائمة الانتظار الذكية (waitlist)</span>
                  </h4>

                  <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-xs">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                        <tr>
                          <th className="p-2.5">المريض</th>
                          <th className="p-2.5">الهاتف</th>
                          <th className="p-2.5">الخدمة</th>
                          <th className="p-2.5">التاريخ المفضل</th>
                          <th className="p-2.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {telemetry.database.waitlist.map((wait: any) => (
                          <tr key={wait.id} className="hover:bg-slate-50/70">
                            <td className="p-2.5 font-medium text-slate-900">{wait.patient_name}</td>
                            <td className="p-2.5 font-mono text-slate-600">{wait.patient_phone}</td>
                            <td className="p-2.5 text-slate-600">{wait.requested_service}</td>
                            <td className="p-2.5 font-mono text-slate-600">{wait.preferred_date}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                                {wait.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: JoFotara Phase 2 UBL 2.1 */}
            {activeTab === 'jofotara' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 p-4 rounded-xl shadow-xs no-print">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      محرك الفوترة الإلكترونية الوطنية JoFotara (Phase 2)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      معاينة بصرية كاملة للفاتورة مع طباعة رسمية وتوليد XML مطابق لمعيار UBL 2.1 ورمز TLV QR
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => executeJobAction('test_jofotara', { invoiceType: 'B2C_SIMPLIFIED' })}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-xs transition active:scale-95"
                    >
                      توليد B2C مبسطة
                    </button>
                    <button
                      onClick={() =>
                        executeJobAction('test_jofotara', {
                          invoiceType: 'B2B_STANDARD',
                          buyerName: 'شركة النماء الطبية',
                          buyerTaxId: '109283746',
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs transition active:scale-95"
                    >
                      توليد B2B معتمدة
                    </button>
                  </div>
                </div>

                {telemetry.latestXml ? (
                  <InvoiceViewer
                    xml={telemetry.latestXml}
                    metadata={telemetry.latestInvoiceMeta}
                  />
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs no-print shadow-xs">
                    اضغط على &quot;توليد B2C مبسطة&quot; أو &quot;توليد B2B معتمدة&quot; لمعاينة الفاتورة أو كود الـ XML الناتج فوراً!
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Autonomous Background Jobs */}
            {activeTab === 'jobs' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-slate-900">Waitlist Sniper</h4>
                      <Crosshair className="w-4 h-4 text-teal-600" />
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      عند إلغاء موعد، يقنص أقرب مريض في قائمة الانتظار ويرسل له قالب واتساب فوري لملء الشاغر.
                    </p>
                    <button
                      onClick={() => executeJobAction('trigger_waitlist_sniper')}
                      className="w-full mt-2 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-xs font-semibold py-1.5 rounded-lg transition"
                    >
                      تشغيل القناص فوراً
                    </button>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-slate-900">No-Show Recovery</h4>
                      <RefreshCw className="w-4 h-4 text-amber-600" />
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      يرصد المواعيد الفائتة ويرسل رسالة إعادة تفعيل لطيفة بعد ساعة لإعادة جدولة الموعد مجاناً.
                    </p>
                    <button
                      onClick={() => executeJobAction('trigger_no_show_recovery')}
                      className="w-full mt-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-semibold py-1.5 rounded-lg transition"
                    >
                      معالجة الغائبين (No-Show)
                    </button>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-2 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs text-slate-900">Smart Reminders</h4>
                      <Bell className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      يرسل تذكير قبل 24 ساعة، وتذكير قبل ساعتين يتضمن رابط خرائط جوجل المباشر لعيادة الدوار السابع.
                    </p>
                    <button
                      onClick={() => executeJobAction('trigger_smart_reminders')}
                      className="w-full mt-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold py-1.5 rounded-lg transition"
                    >
                      فحص التذكيرات الذكية
                    </button>
                  </div>
                </div>

                {/* Job Execution Logs */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700">سجل تشغيل المهام بالخلفية:</h4>
                  {telemetry.jobsLog.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 text-center text-slate-500 text-xs shadow-xs">
                      اضغط على أحد أزرار تشغيل المهام بالأعلى لمعاينة نتيجته المباشرة هنا!
                    </div>
                  ) : (
                    telemetry.jobsLog.map((log: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-white border border-slate-200 p-3 rounded-xl text-xs font-mono space-y-1.5 shadow-xs"
                      >
                        <div className="flex items-center justify-between text-slate-500 text-[11px]">
                          <span className="text-teal-700 font-bold">{log.action}</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString('ar-JO')}</span>
                        </div>
                        <pre className="bg-slate-50 border border-slate-200 p-2 rounded text-slate-700 overflow-x-auto text-[11px]">
                          {JSON.stringify(log.result, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: Multi-Practitioner & Dental Chairs Roster */}
            {activeTab === 'roster' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Users className="w-4 h-4 text-teal-600" />
                      <span>كادر الأطباء وكراسي الأسنان (Multi-Practitioner & Multi-Chair Roster)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      توزيع المواعيد تلقائياً حسب تخصص الطبيب أو الكرسي الطبي المتاح (3 أطباء و 3 كراسي مجهزة)
                    </p>
                  </div>
                  <span className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full border border-teal-200 font-medium">
                    Phase 2 Active
                  </span>
                </div>

                {/* Practitioners Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>👨‍⚕️ الأطباء المعتمدون بالمركز (Practitioners):</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(telemetry.database?.practitioners || [
                      {
                        id: 'doc-qasim-001',
                        name_ar: 'د. قاسم نشمي',
                        name_en: 'Dr. Qasim Nashmi',
                        specialty_ar: 'استشاري أول وجراحة الفم والفكين',
                        phone: '+962790001001',
                        license_number: 'JDA-SURG-2012-089',
                        color_code: '#0d9488',
                        is_active: true,
                      },
                      {
                        id: 'doc-dima-002',
                        name_ar: 'د. ديما التميمي',
                        name_en: 'Dr. Dima Tamimi',
                        specialty_ar: 'تقويم الأسنان والأسنان التحفظية للأطفال',
                        phone: '+962790001002',
                        license_number: 'JDA-ORTH-2016-144',
                        color_code: '#8b5cf6',
                        is_active: true,
                      },
                      {
                        id: 'doc-rami-003',
                        name_ar: 'د. رامي عبيدات',
                        name_en: 'Dr. Rami Obeidat',
                        specialty_ar: 'تجميل الأسنان ومعالجة الجذور والتعويضات',
                        phone: '+962790001003',
                        license_number: 'JDA-ENDO-2018-205',
                        color_code: '#3b82f6',
                        is_active: true,
                      },
                    ]).map((doc: any) => (
                      <div
                        key={doc.id}
                        className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 hover:border-slate-300 transition shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: doc.color_code || '#0d9488' }}
                            />
                            <h5 className="font-bold text-sm text-slate-900">{doc.name_ar}</h5>
                          </div>
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
                            نشط بالدوام
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 font-medium">{doc.specialty_ar}</p>
                        <div className="text-[11px] text-slate-500 space-y-1 font-mono">
                          <div>الترخيص: {doc.license_number || 'JDA-LIC-2026'}</div>
                          <div>الهاتف المباشر: {doc.phone || '+962790000000'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dental Chairs Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>🪑 كراسي وأجنحة الأسنان المجهزة (Dental Chairs):</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(telemetry.database?.dental_chairs || [
                      {
                        id: 'chair-001',
                        chair_number: 1,
                        name_ar: 'كرسي 1 - جناح الجراحة وزراعة الأسنان',
                        description_ar: 'مجهز بوحدة تخدير جراحي وشاشة تصوير رقمي بانورامي 3D',
                        is_active: true,
                      },
                      {
                        id: 'chair-002',
                        chair_number: 2,
                        name_ar: 'كرسي 2 - جناح التقويم وطب أسنان الأطفال',
                        description_ar: 'مجهز بتقنيات المسح الضوئي الرقمي (iTero) وأدوات وقائية',
                        is_active: true,
                      },
                      {
                        id: 'chair-003',
                        chair_number: 3,
                        name_ar: 'كرسي 3 - جناح المعالجات الترميمية والجذور',
                        description_ar: 'مجهز بميكروسكوب جراحة العصب وجهاز التبييض بالليزر',
                        is_active: true,
                      },
                    ]).map((chair: any) => (
                      <div
                        key={chair.id}
                        className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 hover:border-slate-300 transition shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                            كرسي #{chair.chair_number}
                          </span>
                          <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-medium">
                            جاهز ومُعقم
                          </span>
                        </div>
                        <h5 className="font-bold text-xs text-slate-900">{chair.name_ar}</h5>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {chair.description_ar}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 6: Clinical EHR & Dental Charting */}
            {activeTab === 'ehr' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Stethoscope className="w-4 h-4 text-teal-600" />
                      <span>السجل الطبي السريري ومخطط الأسنان (Clinical EHR & Odontogram)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      توثيق الملاحظات الطبية، التشخيص، الوصفات، ومخطط الأسنان FDI وفق قانون المسؤولية الطبية رقم 25
                    </p>
                  </div>
                  <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full border border-blue-200 font-medium">
                    حفظ إلزامي 5 سنوات
                  </span>
                </div>

                {/* Medical Records List */}
                <div className="space-y-3">
                  {(telemetry.database?.clinical_records || [
                    {
                      id: 'ehr-demo-001',
                      patient_name: 'أحمد قاسم الزعبي',
                      practitioner_name: 'د. قاسم نشمي',
                      chief_complaint: 'ألم حاد في الضرس السفلي الأيمن مع حساسية شديدة على السوائل الباردة والساخنة',
                      diagnosis: 'التهاب لب سني غير ردود (Irreversible Pulpitis) في الضرس رقم 46 مع تسوس عميق',
                      clinical_notes: 'تم فحص المريض سريرياً وإجراء صورة أشعة رقمية كشفت وصول التسوس للب السني. تم تخدير موضعي وفتح حجرة اللب واستئصال العصب وتوسيع القنوات.',
                      treatment_rendered: 'بدء علاج عصب الضرس (Root Canal Treatment - Phase 1) ووضع حشوة مؤقتة علاجية',
                      prescriptions: [
                        { drug_name: 'Amoxicillin 500mg', dosage: '500 mg', frequency: 'كل 8 ساعات', duration: '5 أيام' },
                        { drug_name: 'Ibuprofen 400mg', dosage: '400 mg', frequency: 'عند اللزوم بعد الطعام', duration: '3 أيام' },
                      ],
                      odontogram: [
                        { tooth_number: 46, surface: 'MOD', status: 'ROOT_CANAL', notes: 'بدء علاج عصب وحشوة مؤقتة' },
                        { tooth_number: 16, surface: 'O', status: 'FILLED', notes: 'حشوة كمبوزيت تجميلية سليمة' },
                      ],
                      informed_consent_signed: true,
                      created_at: new Date().toISOString(),
                    },
                  ]).map((rec: any) => (
                    <div
                      key={rec.id}
                      className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs leading-relaxed shadow-xs"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{rec.patient_name || 'مريض ترتيب'}</span>
                          <span className="text-slate-400 font-mono text-[11px]">({rec.id})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 font-medium">
                            طبيب معالج: {rec.practitioner_name}
                          </span>
                          {rec.informed_consent_signed && (
                            <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-medium">
                              موافقة مستنيرة موثقة ✓
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-200/60">
                          <span className="text-amber-800 font-bold block mb-1">الشكوى الرئيسية (Chief Complaint):</span>
                          <p className="text-slate-700">{rec.chief_complaint}</p>
                        </div>
                        <div className="bg-teal-50/50 p-3 rounded-lg border border-teal-200/60">
                          <span className="text-teal-800 font-bold block mb-1">التشخيص السريري (Diagnosis):</span>
                          <p className="text-slate-700">{rec.diagnosis}</p>
                        </div>
                      </div>

                      <div className="bg-blue-50/40 p-3 rounded-lg border border-blue-200/60">
                        <span className="text-blue-800 font-bold block mb-1">الإجراء العلاجي المنفذ (Treatment Rendered):</span>
                        <p className="text-slate-700">{rec.treatment_rendered}</p>
                      </div>

                      {/* FDI Odontogram representation */}
                      {Array.isArray(rec.odontogram) && rec.odontogram.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <span className="text-slate-700 font-bold block">مخطط الأسنان (FDI Odontogram Record):</span>
                          <div className="flex flex-wrap gap-2">
                            {rec.odontogram.map((tooth: any, tIdx: number) => (
                              <div
                                key={tIdx}
                                className="bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg flex items-center gap-2"
                              >
                                <span className="font-bold font-mono text-teal-700">سن #{tooth.tooth_number}</span>
                                <span className="text-[10px] bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded font-mono font-medium">
                                  {tooth.surface || 'ALL'}
                                </span>
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                    tooth.status === 'ROOT_CANAL'
                                      ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                      : tooth.status === 'CARIES'
                                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                      : 'bg-teal-100 text-teal-800 border border-teal-200'
                                  }`}
                                >
                                  {tooth.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: Real-Time Receptionist Alerts */}
            {activeTab === 'alerts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-rose-600" />
                      <span>تنبيهات الاستجابة الفورية لطاقم الاستقبال (Receptionist Live Alerts)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      إشعارات فورية متصلة بـ Supabase Realtime عند رصد حالات طوارئ سريرية حرجة أو تعذر تسليم رسائل واتساب للمرضى
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await fetch('/api/alerts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              alert: {
                                type: 'EMERGENCY',
                                title: '🚨 تنبيه محاكاة طوارئ تجريبي [EMERGENCY_TRIGGER]',
                                description: 'المريض تجريبي (0791234567) - نزيف حاد مفاجئ بعد خلع الضرس ويتطلب تدخل فوري',
                                patient_name: 'مريض تجريبي',
                                patient_phone: '+962791234567',
                                severity: 'CRITICAL',
                              },
                            }),
                          });
                          fetchTelemetry();
                        } catch (e) {
                          console.warn(e);
                        }
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-xs"
                    >
                      🚨 محاكاة تنبيه طوارئ (Test Emergency)
                    </button>
                  </div>
                </div>

                {/* Alerts Stream */}
                <div className="space-y-3">
                  {liveAlerts.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs">
                      لا توجد أي تنبيهات معلقة لطاقم الاستقبال حالياً. جميع الرسائل تم إرسالها بنجاح ولا توجد حالات طوارئ حرجة!
                    </div>
                  ) : (
                    liveAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`border p-4 rounded-xl space-y-2.5 transition shadow-xs ${
                          alert.type === 'EMERGENCY'
                            ? 'bg-rose-50 border-rose-200 text-rose-900'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                alert.severity === 'CRITICAL'
                                  ? 'bg-rose-200/80 text-rose-900 border border-rose-300 animate-pulse'
                                  : 'bg-amber-200/80 text-amber-900 border border-amber-300'
                              }`}
                            >
                              {alert.type === 'EMERGENCY' ? 'طوارئ سريرية حرجة' : 'فشل إرسال واتساب'}
                            </span>
                            <span className="font-semibold text-xs text-slate-900">
                              {alert.title}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(alert.timestamp).toLocaleTimeString('ar-JO', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>

                        <p className="text-xs text-slate-800 leading-relaxed font-sans">
                          {alert.description}
                        </p>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                          <div className="flex items-center gap-3 text-slate-600 font-mono text-[11px]">
                            {alert.patient_phone && <span>الهاتف: {alert.patient_phone}</span>}
                            {alert.patient_name && <span>الاسم: {alert.patient_name}</span>}
                          </div>
                          <button
                            onClick={() => handleDismissAlert(alert.id)}
                            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 px-3 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1 shadow-xs"
                          >
                            <span>تم التعامل مع التنبيه وحله</span>
                            <span>✓</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 7: Real-Time APM & Error Tracking */}
            {activeTab === 'apm' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-teal-600" />
                      <span>مراقبة الأخطاء والأداء الحية (Real-Time APM & Error Tracking)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      محرك تتبع الاستثناءات البرمجية والتحذيرات التشغيلية عبر الـ API والـ Webhook لحظياً
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await fetch('/api/jobs', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'trigger_test_apm' }),
                        });
                        fetchTelemetry();
                      } catch (err) {
                        console.warn(err);
                      }
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-xs"
                  >
                    ⚡ اختبار تنبيه تشخيصي (Test APM)
                  </button>
                </div>

                {/* Event stream */}
                <div className="space-y-2.5">
                  {(telemetry.database?.apm_events || []).length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs">
                      لا توجد أخطاء مسجلة حالياً. النظام يعمل باستقرار تام وبمعدل استجابة 100%!
                    </div>
                  ) : (
                    (telemetry.database?.apm_events || []).map((ev: any) => (
                      <div
                        key={ev.id}
                        className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-2 text-xs shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                ev.severity === 'ERROR' || ev.severity === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : ev.severity === 'WARNING'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}
                            >
                              {ev.severity}
                            </span>
                            <span className="font-mono text-slate-600 text-[11px]">
                              {ev.context?.route || ev.context?.endpoint || '/api'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(ev.timestamp).toLocaleTimeString('ar-JO')}
                          </span>
                        </div>
                        <p className="text-slate-800 font-medium">{ev.message}</p>
                        {ev.stack_trace && (
                          <pre className="text-[10px] font-mono bg-rose-50 border border-rose-200 p-2 rounded text-rose-800 overflow-x-auto max-h-24">
                            {ev.stack_trace}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
