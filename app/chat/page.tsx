'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, RotateCcw, User, Bot, Mic, ShieldAlert, ArrowRight, Phone, UserCheck, PlusCircle } from 'lucide-react';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  time: string;
  isEmergency?: boolean;
}

const PRESET_PATIENTS = [
  { name: 'أحمد التميمي', phone: '+962791234567' },
  { name: 'سارة عبد الله', phone: '+962799887766' },
  { name: 'عمر قاسم', phone: '+962795554433' },
];

export default function CleanChatPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [patientPhone, setPatientPhone] = useState('+962791234567');
  const [patientName, setPatientName] = useState('أحمد التميمي');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷',
      time: '',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsMounted(true);
    let initialPhone = patientPhone;
    // Restore unsubmitted draft input and selected patient from sessionStorage if present
    try {
      if (typeof window !== 'undefined') {
        const savedPhone = sessionStorage.getItem('tarteeb_chat_patient_phone');
        const savedName = sessionStorage.getItem('tarteeb_chat_patient_name');
        if (savedPhone) {
          setPatientPhone(savedPhone);
          initialPhone = savedPhone;
        }
        if (savedName) {
          setPatientName(savedName);
        }
        const savedDraft = sessionStorage.getItem('tarteeb_chat_draft');
        if (savedDraft) {
          setInput(savedDraft);
        }
      }
    } catch (_) {}

    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'welcome' && !m.time
          ? {
              ...m,
              time: new Date().toLocaleTimeString('ar-JO', {
                hour: '2-digit',
                minute: '2-digit',
              }),
            }
          : m
      )
    );
    fetchChatHistory(initialPhone);
  }, []);

  const handleInputChange = (val: string) => {
    setInput(val);
    try {
      if (typeof window !== 'undefined') {
        if (val) {
          sessionStorage.setItem('tarteeb_chat_draft', val);
        } else {
          sessionStorage.removeItem('tarteeb_chat_draft');
        }
      }
    } catch (_) {}
  };

  const handlePatientNameChange = (name: string) => {
    setPatientName(name);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('tarteeb_chat_patient_name', name);
      }
    } catch (_) {}
  };

  const handlePatientPhoneChange = (phone: string) => {
    setPatientPhone(phone);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('tarteeb_chat_patient_phone', phone);
      }
    } catch (_) {}
  };

  const fetchChatHistory = async (targetPhone: string) => {
    try {
      const res = await fetch(`/api/history?phone=${encodeURIComponent(targetPhone)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.chat_history) && data.chat_history.length > 0) {
        const formatted: Message[] = data.chat_history.map((m: any, idx: number) => ({
          id: `ch-${idx}-${m.timestamp || Date.now()}`,
          role: m.role === 'user' ? 'user' : 'model',
          text: m.text,
          time: m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })
            : '',
        }));
        setMessages(formatted);
      } else {
        setMessages([
          {
            id: `welcome-${Date.now()}`,
            role: 'model',
            text: `يا هلا والله فيك في مركز نشمي لطب الأسنان بعمان! تفضل يا ${patientName || 'غالي'}، كيف بقدر أساعدك اليوم؟ 🦷`,
            time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }
    } catch (err) {
      console.warn('[CleanChat] Failed to hydrate chat history:', err);
    }
  };

  const handleSwitchPatient = (name: string, phone: string) => {
    setPatientName(name);
    setPatientPhone(phone);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('tarteeb_chat_patient_phone', phone);
        sessionStorage.setItem('tarteeb_chat_patient_name', name);
      }
    } catch (_) {}
    fetchChatHistory(phone);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Safety Watchdog: Guarantee loading indicator NEVER hangs longer than 10 seconds
  useEffect(() => {
    if (!loading) return;
    const watchdog = setTimeout(() => {
      console.warn('[Safety Watchdog] Auto-clearing hung loading state');
      setLoading(false);
    }, 10000);
    return () => clearTimeout(watchdog);
  }, [loading]);

  const handleSend = async (customMessage?: string, isVoice = false) => {
    const textToSend = customMessage || input.trim();
    if (!textToSend || loading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: isVoice ? `🎤 [رسالة صوتية] "${textToSend}"` : textToSend,
      time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('tarteeb_chat_draft');
      }
    } catch (_) {}
    setLoading(true);

    const controller = new AbortController();
    const clientTimeout = setTimeout(() => {
      controller.abort();
    }, 14000);

    const isGreeting = /(?:السلام|سلام|مرحبا|صباح|مساء|يعطيك|هلا|أهلا|اهلا)/.test(textToSend);

    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      let res: Response;
      try {
        res = await fetch('/api/clean-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            history: historyPayload,
            phone: patientPhone,
            patientName: patientName,
          }),
          signal: controller.signal,
        });
      } catch (cleanChatErr: any) {
        if (cleanChatErr?.name === 'AbortError') throw cleanChatErr;
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            history: historyPayload,
            phone: patientPhone,
            patientName: patientName,
          }),
          signal: controller.signal,
        });
      }

      clearTimeout(clientTimeout);

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      const nameMatch = textToSend.match(/(?:أنا|اسمي|معك|لـ|للمريض|الأخ|السيد)\s+([^\s،.]+)/);
      const detectedName = nameMatch ? nameMatch[1] : patientName || '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟'
        : `${greeting}، وصل طلبك وبتابعه معك فوراً! تفضل شو الاستفسار أو الموعد اللي حابب ترتبه؟ 🦷`;

      const botReply = data.reply || fallbackText;

      const agentMsg: Message = {
        id: `m-${Date.now()}`,
        role: 'model',
        text: botReply,
        time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
        isEmergency: data.isEmergency,
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      clearTimeout(clientTimeout);
      console.error('[Chat Client Request Error]:', err);

      const nameMatch = textToSend.match(/(?:أنا|اسمي|معك|لـ|للمريض|الأخ|السيد)\s+([^\s،.]+)/);
      const detectedName = nameMatch ? nameMatch[1] : patientName || '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟'
        : `${greeting}، واجهنا بطء مؤقت بالاتصال، ممكن تعيد طلبك بعد إذنك؟`;

      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'model',
          text: fallbackText,
          time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = async () => {
    try {
      await fetch(`/api/history?phone=${encodeURIComponent(patientPhone)}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('[CleanChat] Failed to clear history:', err);
    }
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'model',
        text: `يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا ${patientName || 'غالي'}، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷`,
        time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setInput('');
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('tarteeb_chat_draft');
      }
    } catch (_) {}
    inputRef.current?.focus();
  };

  return (
    <div dir="rtl" className="flex flex-col h-screen bg-slate-100 text-slate-900 font-sans">
      {/* Top Header */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            title="الرئيسية"
            className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center shadow-md shadow-teal-600/20 text-white font-bold"
          >
            ت
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base md:text-lg text-slate-900">
                نظام ترتيب - الاستقبال الذكي
              </h1>
              <span className="flex items-center gap-1 text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
                المساعد نشمي متصل
              </span>
            </div>
            <p className="text-xs text-slate-500">
              محادثة واتساب مباشرة لحجز المواعيد والاستفسارات - عمان، الأردن
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/sandbox"
            className="hidden sm:flex items-center gap-1.5 text-xs text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200 transition font-medium"
          >
            <span>لوحة التحكم Sandbox</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <button
            onClick={handleReset}
            title="بدء محادثة جديدة"
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg border border-slate-200 transition font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">محادثة جديدة</span>
          </button>
        </div>
      </header>

      {/* Patient Switcher & Context Bar */}
      <section className="bg-white/80 backdrop-blur border-b border-slate-200/80 px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
            <UserCheck className="w-3.5 h-3.5 text-teal-600" />
            <input
              type="text"
              value={patientName}
              onChange={(e) => handlePatientNameChange(e.target.value)}
              placeholder="اسم المريض"
              className="bg-transparent border-none outline-none text-slate-800 font-medium w-28 text-xs"
              title="اسم المريض"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
            <Phone className="w-3.5 h-3.5 text-teal-600" />
            <input
              type="text"
              value={patientPhone}
              onChange={(e) => handlePatientPhoneChange(e.target.value)}
              onBlur={() => fetchChatHistory(patientPhone)}
              placeholder="رقم الهاتف"
              dir="ltr"
              className="bg-transparent border-none outline-none text-slate-800 font-mono text-xs w-32"
              title="رقم هاتف المريض"
            />
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-slate-400 text-[11px] ml-1">تغيير المريض:</span>
          {PRESET_PATIENTS.map((p) => {
            const isActive = patientPhone === p.phone;
            return (
              <button
                key={p.phone}
                onClick={() => handleSwitchPatient(p.name, p.phone)}
                className={`px-2.5 py-1 rounded-md text-[11px] transition font-medium border ${
                  isActive
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {p.name}
              </button>
            );
          })}
          <button
            onClick={() => handleSwitchPatient('مريض جديد', `+96279${Math.floor(1000000 + Math.random() * 9000000)}`)}
            className="px-2 py-1 rounded-md text-[11px] text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 flex items-center gap-1 transition"
          >
            <PlusCircle className="w-3 h-3" />
            <span>مريض جديد</span>
          </button>
        </div>
      </section>

      {/* Messages Feed */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl w-full mx-auto bg-slate-100/60">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-end gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs shadow-sm ${
                  isUser
                    ? 'bg-slate-800 text-white'
                    : msg.isEmergency
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-teal-100 text-teal-700 border border-teal-200 font-bold'
                }`}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm md:text-[15px] leading-relaxed shadow-sm ${
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
                  className={`block text-[10px] mt-1.5 text-left opacity-75 ${
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
          <div className="flex items-end gap-2.5">
            <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-br-none px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Quick Jordanian Action Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs text-slate-600 scrollbar-none">
            <span className="text-slate-400 shrink-0 font-medium">جرّب تسأل:</span>
            {[
              'بدي احجز موعد بكرة الساعة 4 العصر',
              'وين موقع العيادة وهل في صفة؟',
              'شو أوقات الدوام عندكم؟',
              'بتتعاملوا مع تأمين نات هيلث؟',
              'كم سعر تنظيف وتلميع الأسنان؟',
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                disabled={loading}
                className="shrink-0 bg-slate-50 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 border border-slate-200 rounded-full px-3 py-1 transition disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2 bg-slate-50 border border-slate-300 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-transparent transition">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`اكتب رسالتك للمساعد نشمي باسم (${patientName})...`}
              disabled={loading}
              className="flex-1 max-h-32 bg-transparent resize-none border-none outline-none text-slate-800 placeholder-slate-400 text-sm md:text-base px-2 py-1.5"
            />

            <button
              onClick={() => handleSend(undefined, true)}
              disabled={loading}
              title="إرسال رسالة صوتية تجريبية"
              className="p-2.5 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition disabled:opacity-50"
            >
              <Mic className="w-5 h-5" />
            </button>

            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="p-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl shadow-sm transition disabled:opacity-40 disabled:hover:bg-teal-600"
            >
              <Send className="w-5 h-5 rtl:-rotate-90" />
            </button>
          </div>

          <p className="text-[11px] text-center text-slate-400">
            مساعد عيادة الأسنان الذكي نشمي - ملتزم بقانون المسؤولية الطبية رقم 25 وقانون حماية البيانات رقم 24
          </p>
        </div>
      </footer>
    </div>
  );
}
