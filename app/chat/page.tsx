'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, RotateCcw, User, Bot, Mic, ShieldAlert, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  time: string;
  isEmergency?: boolean;
}

export default function CleanChatPage() {
  const [isMounted, setIsMounted] = useState(false);
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
    fetchChatHistory();
  }, []);

  const fetchChatHistory = async () => {
    try {
      const res = await fetch('/api/history?phone=+962791234567');
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
      }
    } catch (err) {
      console.warn('[CleanChat] Failed to hydrate chat history:', err);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Safety Watchdog: Guarantee loading indicator NEVER hangs longer than 10 seconds under any circumstances
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
    setLoading(true);

    // AbortController with generous 14s maximum client timeout
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

      // Call /api/clean-chat with fallback to /api/chat
      let res: Response;
      try {
        res = await fetch('/api/clean-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            history: historyPayload,
            phone: '+962791234567',
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
            phone: '+962791234567',
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
      const detectedName = nameMatch ? nameMatch[1] : '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟'
        : `${greeting}، غلبتك صار خطأ بسيط بالاتصال، ممكن تعيدلي طلبك بعد إذنك؟`;

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
      const detectedName = nameMatch ? nameMatch[1] : '';
      const greeting = detectedName ? `أهلاً بك يا ${detectedName}` : 'أهلاً بك يا غالي';
      const fallbackText = isGreeting
        ? 'وعليكم السلام ورحمة الله، يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟'
        : `${greeting}، غلبتك صار خطأ بسيط بالاتصال، ممكن تعيدلي طلبك بعد إذنك؟`;

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
      // Guaranteed termination of loading state under all circumstances
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
      await fetch('/api/history?phone=+962791234567', { method: 'DELETE' });
    } catch (err) {
      console.warn('[CleanChat] Failed to clear history:', err);
    }
    setMessages([
      {
        id: 'welcome',
        role: 'model',
        text: 'يا هلا والله فيك في مركز نشمي لطب وجراحة الأسنان بعمان! تفضل يا غالي، كيف بقدر أساعدك بموعدك أو استفسارك اليوم؟ 🦷',
        time: new Date().toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setInput('');
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
            <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 border border-teal-200 flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 animate-spin text-teal-600" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-br-none px-4 py-3 text-sm text-slate-600 flex items-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-teal-600 animate-bounce"></span>
              <span
                className="w-2 h-2 rounded-full bg-teal-600 animate-bounce"
                style={{ animationDelay: '0.15s' }}
              ></span>
              <span
                className="w-2 h-2 rounded-full bg-teal-600 animate-bounce"
                style={{ animationDelay: '0.3s' }}
              ></span>
              <span className="text-xs mr-2 text-slate-500 font-medium">المساعد نشمي يكتب الآن...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input Bar */}
      <footer className="p-4 border-t border-slate-200 bg-white sticky bottom-0 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-end gap-2">
          <button
            onClick={() => handleSend('يا هلا دكتور، بسجل صوتي عشان أسأل عن موعد تنظيف أسنان الأسبوع الجاي', true)}
            title="إرسال رسالة صوتية تجريبية"
            className="h-12 w-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-teal-600 border border-slate-200 flex items-center justify-center transition shrink-0 shadow-sm"
          >
            <Mic className="w-5 h-5" />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="اكتب رسالتك هنا كالمريض... (اضغط Enter للإرسال)"
            className="flex-1 resize-none bg-slate-50 border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:bg-white rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition max-h-32 min-h-[48px]"
          />

          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            aria-label="إرسال"
            className="h-12 w-12 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 disabled:opacity-40 text-white flex items-center justify-center transition shrink-0 shadow-md shadow-teal-600/20"
          >
            <Send className="w-5 h-5 -rotate-90" />
          </button>
        </div>
      </footer>
    </div>
  );
}
