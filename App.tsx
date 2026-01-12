
import React, { useState, useEffect, useRef } from 'react';
import VoiceBot from './components/VoiceBot';
import { BotStatus } from './types';

const App: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950 font-sans text-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800 shadow-xl z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <i className="fa-solid fa-robot text-white text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Your Voice Assistant AI
            </h1>
            <p className="text-xs text-blue-400 font-medium tracking-widest uppercase">Powered by Gemini</p>
          </div>
        </div>
        
        <button 
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors md:hidden"
        >
          <i className="fa-solid fa-bars"></i>
        </button>
      </header>

      <main className="flex-1 relative flex overflow-hidden">
        {/* Sidebar for info / settings on desktop */}
        <aside className={`
          fixed inset-y-0 left-0 z-30 w-64 bg-gray-900 border-r border-gray-800 transform transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Intelligence</h2>
            <div className="space-y-4 text-sm text-gray-300">
              <p>Ask anything from coding to philosophy. I am equipped with native multi-modal audio intelligence.</p>
              <div className="p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                <p className="text-blue-300 font-medium mb-1"><i className="fa-solid fa-bolt mr-2"></i>Capabilities</p>
                <p className="text-gray-400">Real-time reasoning, cross-domain knowledge, and ultra-low latency audio.</p>
              </div>
            </div>
            
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mt-8 mb-4">Interaction</h2>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><i className="fa-solid fa-check text-blue-500 mr-2"></i>Multi-domain knowledge</li>
              <li><i className="fa-solid fa-check text-blue-500 mr-2"></i>No session timeout</li>
              <li><i className="fa-solid fa-check text-blue-500 mr-2"></i>Real-time interruption</li>
              <li><i className="fa-solid fa-check text-blue-500 mr-2"></i>Visual audio feedback</li>
            </ul>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <VoiceBot />
        </div>
      </main>

      {/* Footer */}
      <footer className="py-2 px-6 bg-gray-900 border-t border-gray-800 text-[10px] text-gray-500 flex justify-between">
        <span>Continuous Real-time Interaction Protocol</span>
        <span>&copy; 2024 Your Personal AI Assistant</span>
      </footer>
    </div>
  );
};

export default App;
