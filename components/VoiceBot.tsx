
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { BotStatus, Message, VoiceName } from '../types';
import { createBlob, decode, decodeAudioData, encode } from '../services/audioUtils';

const VoiceBot: React.FC = () => {
  // State
  const [status, setStatus] = useState<BotStatus>(BotStatus.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentVoice, setCurrentVoice] = useState<VoiceName>('Zephyr');
  const [error, setError] = useState<string | null>(null);

  // Audio Contexts & Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Visualization
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Active Session reference for manual closing as per guidelines
  const activeSessionRef = useRef<any>(null);

  // Transcriptions
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  // Refs for state to avoid stale closures in callbacks
  // Fix: Explicitly type statusRef as BotStatus to resolve TypeScript comparison errors in callbacks
  const statusRef = useRef<BotStatus>(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Messages Scroll Ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Visualizer Animation Loop
  const drawVisualizer = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 80;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      for (let i = 0; i < bufferLength; i += 4) {
        const barHeight = (dataArray[i] / 255) * 60;
        const angle = (i / bufferLength) * Math.PI * 2;
        
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `hsla(${210 + (dataArray[i] / 5)}, 80%, 60%, ${0.3 + dataArray[i]/255})`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    };

    render();
  }, []);

  const stopAudioOutput = useCallback(() => {
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleDisconnect = useCallback(() => {
    setStatus(BotStatus.DISCONNECTED);
    stopAudioOutput();
    
    // Explicitly close the session to release resources as per API guidelines
    if (activeSessionRef.current) {
      try {
        activeSessionRef.current.close();
      } catch (e) {
        console.debug('Session already closed or error closing:', e);
      }
      activeSessionRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }

    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
  }, [stopAudioOutput]);

  const handleConnect = async () => {
    try {
      setError(null);
      setStatus(BotStatus.CONNECTING);

      if (!process.env.API_KEY) {
        throw new Error("API_KEY is not defined in the environment.");
      }

      // Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      // Setup Analyser
      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      analyser.connect(outputCtx.destination);

      // Get Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.debug('Live Session Opened');
            setStatus(BotStatus.IDLE);
            drawVisualizer();

            // Track active session for management
            sessionPromise.then(session => {
              activeSessionRef.current = session;
            });

            // Setup input stream
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              // CRITICAL: initiate sendRealtimeInput after live.connect call resolves as per guidelines
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const inputTxt = currentInputTranscriptionRef.current.trim();
              const outputTxt = currentOutputTranscriptionRef.current.trim();
              
              if (inputTxt) {
                setMessages(prev => [...prev, { 
                  id: Math.random().toString(), 
                  text: inputTxt, 
                  sender: 'user', 
                  timestamp: Date.now() 
                }]);
              }
              if (outputTxt) {
                setMessages(prev => [...prev, { 
                  id: Math.random().toString(), 
                  text: outputTxt, 
                  sender: 'bot', 
                  timestamp: Date.now() 
                }]);
              }

              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
              setStatus(BotStatus.IDLE);
            }

            if (message.serverContent?.interrupted) {
              stopAudioOutput();
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setStatus(BotStatus.SPEAKING);
              const outputCtx = outputAudioContextRef.current;
              if (outputCtx && analyserRef.current) {
                // Ensure audio chunks are scheduled gaplessly as per guidelines
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                
                source.connect(analyserRef.current);
                
                source.onended = () => {
                  audioSourcesRef.current.delete(source);
                  if (audioSourcesRef.current.size === 0 && statusRef.current === BotStatus.SPEAKING) {
                    setStatus(BotStatus.IDLE);
                  }
                };

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
              }
            }
          },
          onerror: (e) => {
            console.error('Session Error:', e);
            setError("Communication error occurred. Please try again.");
            setStatus(BotStatus.ERROR);
          },
          onclose: (e) => {
            console.debug('Session Closed:', e);
            // Comparison fix: statusRef.current is now explicitly typed as BotStatus
            if (statusRef.current !== BotStatus.DISCONNECTED) {
               handleDisconnect();
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } },
          },
          systemInstruction: `You are an advanced, multi-domain AI Voice Assistant.
          Your personality is intelligent, helpful, and highly capable.
          
          Guidelines:
          1. Answer all questions from any domain (Science, Tech, Art, History, Daily Life).
          2. Maintain a continuous conversation. Do not say goodbye unless the user explicitly asks to end the session.
          3. Responses should be conversational but precise.
          4. When explaining complex topics, be clear and use analogies where appropriate.
          5. Always remain available and attentive. If you finish an answer, wait for the next user input without timing out the session.
          6. You can answer in any language requested, but default to the language the user speaks to you in.
          7. You are powered by Gemini 2.5 Flash Native Audio.`,
        },
      });

    } catch (err: any) {
      console.error('Connection Error:', err);
      setError(err.message || "Failed to connect to Voice Assistant AI.");
      setStatus(BotStatus.ERROR);
    }
  };

  const voices: VoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>

        {status === BotStatus.DISCONNECTED ? (
          <div className="text-center animate-fade-in relative z-10">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-gray-700 shadow-2xl">
               <i className="fa-solid fa-robot text-blue-400 text-3xl"></i>
            </div>
            <h3 className="text-2xl font-semibold mb-2 text-white">Advanced AI Assistant</h3>
            <p className="text-gray-400 max-w-xs mx-auto mb-8">Ready to assist you with any query through high-fidelity voice interaction.</p>
            <button
              onClick={handleConnect}
              className="px-10 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-full font-bold text-lg shadow-xl shadow-blue-900/40 transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
            >
              <i className="fa-solid fa-bolt"></i>
              Connect Assistant
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center relative z-10">
            <div className="relative">
              <canvas 
                ref={canvasRef} 
                width={400} 
                height={400} 
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              />
              <div className={`pulse-container ${status === BotStatus.SPEAKING || status === BotStatus.IDLE ? 'active-pulse' : 'inactive-pulse'}`}>
                <div className="pulse-ring"></div>
                <div className="pulse-dot flex items-center justify-center">
                   {status === BotStatus.CONNECTING ? (
                      <i className="fa-solid fa-spinner fa-spin text-4xl text-blue-100 opacity-50"></i>
                   ) : (
                      <div className="text-white/80 text-center px-4">
                         <p className="text-[10px] uppercase tracking-[0.3em] font-black mb-1 text-blue-400">AI ASSISTANT</p>
                         <p className="text-sm font-bold tracking-tight">{status}</p>
                      </div>
                   )}
                </div>
              </div>
            </div>

            <div className="mt-20 flex flex-col items-center gap-4">
              <div className="flex gap-2">
                {voices.map(v => (
                  <button
                    key={v}
                    onClick={() => setCurrentVoice(v)}
                    disabled={status !== BotStatus.DISCONNECTED}
                    className={`px-3 py-1 text-xs rounded-full border transition-all ${
                      currentVoice === v 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40' 
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 font-medium">Select Interaction Voice Persona</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-900/50 border border-red-500 text-red-200 text-xs rounded-lg flex items-center gap-2 shadow-lg backdrop-blur-md">
            <i className="fa-solid fa-circle-exclamation"></i>
            {error}
          </div>
        )}
      </div>

      <div className="h-2/5 bg-gray-950/80 backdrop-blur-xl border-t border-gray-800 flex flex-col shadow-2xl relative z-20">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800/50">
           <div className="flex items-center gap-2">
             <i className="fa-solid fa-microphone-lines text-blue-500 text-xs"></i>
             <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500">Continuous AI Interaction Log</h3>
           </div>
           <div className="flex items-center gap-2 bg-gray-900 px-2 py-1 rounded-md">
             <div className={`w-1.5 h-1.5 rounded-full ${status !== BotStatus.DISCONNECTED ? 'bg-blue-500 animate-pulse' : 'bg-red-500'}`}></div>
             <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{status}</span>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-gray-800">
          {messages.length === 0 && status !== BotStatus.DISCONNECTED && (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
              <i className="fa-solid fa-wave-square text-xl opacity-20"></i>
              <span className="italic">Ready for your request. Speak naturally...</span>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm ${
                m.sender === 'user' 
                  ? 'bg-blue-600 text-white font-medium shadow-md' 
                  : 'bg-gray-800/60 text-gray-200 border border-gray-700/50 backdrop-blur-sm'
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-gray-900/50 border-t border-gray-800/50 flex items-center justify-center gap-4">
          {status !== BotStatus.DISCONNECTED ? (
             <button
               onClick={handleDisconnect}
               className="flex items-center gap-2 px-8 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-full transition-all text-sm font-bold shadow-lg shadow-red-900/20"
             >
               <i className="fa-solid fa-phone-slash"></i>
               Stop Session
             </button>
          ) : (
             <button
               onClick={handleConnect}
               className="flex items-center gap-2 px-10 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-all text-sm font-bold shadow-lg shadow-blue-900/20"
             >
               <i className="fa-solid fa-microphone"></i>
               Start Conversation
             </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceBot;
