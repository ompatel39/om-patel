import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateSpeech } from './services/geminiService';
import { 
  decodeAudioData, 
  decodeBase64, 
  audioBufferToWav, 
  getSupportedFormats, 
  transcodeToBlob,
  AudioFormat 
} from './utils/audioUtils';
import { VoiceName } from './types';
import Visualizer from './components/Visualizer';

// Default story provided by user
const DEFAULT_TEXT = `एक छोटे से गाँव में रीता नाम की एक मेहनती और ईमानदार औरत रहती थी। रीता रोज़-रोज़ मेहनत करती — उसके हाथ में सब्ज़ियां, मसाले, आटा आदि मिलते ही वह अपने घर के पास एक छोटी सी दूकान खोल लेती: वहाँ वो छोले, समोसे और गरम-गरम चाय बेचती थी।

रीता की कमाई ज़्यादा नहीं थी, लेकिन उसने कभी भी झूठ, मिलावट या चोरी नहीं की। वह हमेशा अपने ग्राहकों को सच्चा माल देती, चाहे उसे थोड़ा कम लाभ मिले। लोग उसे पसंद करते — क्योंकि उसकी दूकान साफ-सुथरी थी, सबकुछ ताज़ा होता, और रीता मुस्कुरा कर सेवा करती।

एक दिन, गाँव में एक अमीर व्यापारी आया। उसने देखा कि रीता की दूकान पर भीड़ लगी है और लोग उससे खुश-खुश खरीदारी कर रहे हैं। व्यापारी ने सोचा, “अगर मैं यहाँ आकर दोगुनी कीमत लगाऊँ या थोड़ी मिलावट कर दूँ तो मुझे ज़्यादा मुनाफ़ा मिल जाएगा।”

तो व्यापारी ने रीता से कहा, “अगर तुम मेरी मदद करोगी — हम दोनों मिलकर बड़ी दूकान खोलेंगे, तेज़ कमाई होगी।” पर रीता ने सच्चाई से कहा, “मैं आपकी मदद नहीं कर सकती। मैं अपने काम से खुश हूँ और मुझे मिलावट पसंद नहीं।”

व्यापारी को गुस्सा आया। उसने चोरी-छुपे ही रीता के माल में मिलावट कर दी — स्वाद कम, सस्ता माल मिलाया — और दाम बढ़ा दिए। शुरुआत में कुछ लोग उसके पास भी गए, लेकिन जल्दी ही असली और मिलावटी माल में फर्क समझ गए।

गाँव वाले धीरे-धीरे उस व्यापारी की दूकान से दूर होने लगे। उनकी शिकायतें बढ़ी कि खाना खराब है, स्वाद ग़लत है, और पैसे वसूल नहीं हो रहे।

वहीं दूसरी ओर, रीता की दूकान की रौनक बनी रही — लोग फिर से वहाँ आने लगे। रीता की ईमानदारी और मेहनत को लोगों ने स्वीकार किया।

समय के साथ, व्यापारी की दुकान बंद हो गई — लोग पसंद न करने लगे। पर रीता की छोटी-सी ईमानदार दूकान हमेशा गाँव वालों की पहली पसंद बनी रही।

मोरल / सन्देश: मेहनत और ईमानदारी से किया गया काम चाहे छोटा हो — लेकिन सच्चाई और दृढ़ता से किया जाए, तो वह हमेशा सम्मान और भरोसा कमाता है। बनावट या मिलावट से होती हुई कमाई थोडे समय के लिए असर दिखा सकती है — लेकिन अंत में ईमानदारी और असली मेहनत सबसे मजबूत होती है।`;

const App: React.FC = () => {
  const [text, setText] = useState<string>(DEFAULT_TEXT);
  const [voice, setVoice] = useState<VoiceName>(VoiceName.Kore);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  
  // Download State
  const [formats, setFormats] = useState<AudioFormat[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string>('audio/wav');
  const [isProcessingDownload, setIsProcessingDownload] = useState<boolean>(false);
  
  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Initialize AudioContext & Formats
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    
    // Create Analyser
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;

    // Load supported formats
    const supported = getSupportedFormats();
    setFormats(supported);
    // Default to the first one (usually WAV)
    if (supported.length > 0) {
      setSelectedFormat(supported[0].mimeType);
    }

    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const handleGenerate = async () => {
    if (!text.trim()) return;

    // Stop any current playback
    handleStop();
    setAudioBuffer(null);
    setIsLoading(true);
    setError(null);

    try {
      const base64Audio = await generateSpeech(text, voice);
      
      if (!audioContextRef.current) return;
      
      const rawBytes = decodeBase64(base64Audio);
      const decodedBuffer = await decodeAudioData(rawBytes, audioContextRef.current);
      
      setAudioBuffer(decodedBuffer);
      // Auto-play after generation
      playBuffer(decodedBuffer);
    } catch (err: any) {
      setError(err.message || "Failed to generate speech");
    } finally {
      setIsLoading(false);
    }
  };

  const playBuffer = useCallback((buffer: AudioBuffer) => {
    if (!audioContextRef.current || !analyserRef.current) return;

    // If already playing, stop first
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore if already stopped */ }
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    
    // Connect Source -> Analyser -> Destination
    source.connect(analyserRef.current);
    analyserRef.current.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      setIsPlaying(false);
    };

    source.start();
    startTimeRef.current = audioContextRef.current.currentTime;
    sourceNodeRef.current = source;
    setIsPlaying(true);
  }, []);

  const handlePlay = () => {
    if (audioBuffer) {
      // Resume context if suspended (browser policy)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      playBuffer(audioBuffer);
    }
  };

  const handleStop = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore */ }
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleDownload = async () => {
    if (!audioBuffer) return;

    const formatInfo = formats.find(f => f.mimeType === selectedFormat) || formats[0];
    const filename = `gemini-story-${Date.now()}.${formatInfo.ext}`;

    try {
      let blob: Blob;

      if (formatInfo.mimeType === 'audio/wav') {
        // Fast path for WAV
        blob = audioBufferToWav(audioBuffer);
      } else {
        // Slow path for compressed formats
        setIsProcessingDownload(true);
        // Small delay to allow UI to update
        await new Promise(r => setTimeout(r, 50));
        blob = await transcodeToBlob(audioBuffer, formatInfo.mimeType);
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
      setError("Failed to process download. Please try WAV format.");
    } finally {
      setIsProcessingDownload(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 flex flex-col items-center">
      <header className="mb-8 text-center max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500 mb-2">
          Gemini Storyteller
        </h1>
        <p className="text-slate-400">
          Transform your stories into speech with Gemini 2.5 Flash TTS.
        </p>
      </header>

      <main className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Left Panel: Input */}
        <div className="flex-1 p-6 md:p-8 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col gap-6">
          
          <div className="flex flex-col gap-2">
            <label htmlFor="voice-select" className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Select Voice
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.values(VoiceName).map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border ${
                    voice === v
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750 hover:border-slate-600'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2 min-h-[300px]">
            <label htmlFor="story-input" className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Story Text
            </label>
            <textarea
              id="story-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all resize-none font-sans text-slate-300"
              placeholder="Enter your story here..."
            />
          </div>

          <div className="flex items-center gap-4">
             <button
              onClick={handleGenerate}
              disabled={isLoading || !text}
              className={`flex-1 py-3 px-6 rounded-xl font-bold text-lg shadow-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                isLoading
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white hover:shadow-blue-500/20 transform hover:-translate-y-0.5'
              }`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                  </svg>
                  Generate Speech
                </>
              )}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        {/* Right Panel: Visualization & Controls */}
        <div className="w-full md:w-80 bg-slate-925 p-6 flex flex-col justify-center items-center gap-8 border-l border-slate-800/50 bg-gradient-to-b from-slate-900 to-slate-950">
           
           <div className="w-full flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center shadow-inner relative overflow-hidden">
                {isPlaying && (
                   <div className="absolute inset-0 bg-blue-500/20 animate-ping rounded-full"></div>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-10 w-10 ${isPlaying ? 'text-blue-400' : 'text-slate-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-white">{voice}</h3>
                <p className="text-xs text-slate-500 uppercase tracking-widest">Active Voice</p>
              </div>
           </div>

           <div className="w-full">
              <Visualizer analyser={analyserRef.current} isPlaying={isPlaying} />
           </div>

           <div className="flex gap-4 w-full">
             <button 
                onClick={handlePlay} 
                disabled={!audioBuffer || isPlaying}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                  !audioBuffer 
                    ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                    : isPlaying 
                      ? 'bg-slate-800 text-slate-400 cursor-default' 
                      : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                }`}
             >
                Play
             </button>
             <button 
                onClick={handleStop}
                disabled={!isPlaying}
                className={`px-6 py-3 rounded-xl font-bold transition-all ${
                   isPlaying 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30' 
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
             >
                Stop
             </button>
           </div>
           
           <div className="w-full flex flex-col gap-2">
             <label className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Download Format</label>
             <div className="flex gap-2 w-full">
                <select 
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  disabled={!audioBuffer || isProcessingDownload}
                  className="bg-slate-800 text-slate-300 text-sm rounded-xl px-3 outline-none border border-slate-700 focus:border-blue-500 flex-1 h-12"
                >
                  {formats.map(f => (
                    <option key={f.mimeType} value={f.mimeType}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button 
                    onClick={handleDownload}
                    disabled={!audioBuffer || isProcessingDownload}
                    className={`px-4 h-12 rounded-xl font-bold transition-all flex items-center justify-center ${
                      !audioBuffer || isProcessingDownload
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : 'bg-slate-800 text-blue-400 hover:bg-slate-700 hover:text-blue-300 border border-slate-700/50 hover:border-blue-500/50'
                    }`}
                    title="Download Audio"
                >
                    {isProcessingDownload ? (
                      <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    )}
                </button>
             </div>
             {isProcessingDownload && (
               <p className="text-xs text-center text-slate-500 animate-pulse">
                 Encoding in real-time. Please wait...
               </p>
             )}
           </div>
        </div>

      </main>

      <footer className="mt-8 text-slate-500 text-sm">
        <p>Powered by Google Gemini 2.5 Flash TTS</p>
      </footer>
    </div>
  );
};

export default App;