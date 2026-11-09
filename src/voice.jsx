import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, LoaderCircle } from 'lucide-react';

export async function recordingWave(blob) {
  const decoder = new AudioContext();
  let decoded;
  try { decoded = await decoder.decodeAudioData(await blob.arrayBuffer()); }
  finally { await decoder.close(); }
  const samples = Math.min(16000 * 60, Math.floor(decoded.duration * 16000));
  if (samples < 4800) throw new Error('Record at least a short sentence.');
  const offline = new OfflineAudioContext(1, samples, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const word = (offset, value) => [...value].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples * 2, true);
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const value = Math.max(-1, Math.min(1, pcm[i]));
    peak = Math.max(peak, Math.abs(value));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  if (peak < 0.001) throw new Error('No microphone sound was detected. Check your input device.');
  return bytes;
}

export function VoiceInput({ ready, disabled, language, automatic, onTranscript, onBusy, beforeRecord, notify }) {
  const [phase, setPhase] = useState('idle'), [seconds, setSeconds] = useState(0);
  const active = useRef(null), mounted = useRef(true), callbacks = useRef();
  callbacks.current = { onTranscript, onBusy, beforeRecord, notify };

  function clearCapture(session) {
    clearInterval(session?.timer);
    session?.stream?.getTracks().forEach(track => track.stop());
  }
  function cancel() {
    const session = active.current;
    active.current = null;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    clearCapture(session);
    if (session?.transcribing) window.buji.cancelTranscription().catch(() => {});
    if (mounted.current) setPhase('idle');
    callbacks.current.onBusy(false);
  }
  useEffect(() => () => { mounted.current = false; cancel(); }, []);

  async function start() {
    callbacks.current.beforeRecord();
    const session = { chunks: [], language };
    active.current = session;
    setPhase('requesting');
    setSeconds(0);
    callbacks.current.onBusy(true);
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (active.current !== session) { clearCapture(session); return; }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      session.recorder = new MediaRecorder(session.stream, { mimeType });
      session.recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
      session.recorder.onerror = () => { if (active.current === session) { cancel(); callbacks.current.notify('Microphone recording failed. Try again.'); } };
      session.recorder.onstop = async () => {
        clearCapture(session);
        if (active.current !== session) return;
        setPhase('transcribing');
        try {
          const bytes = await recordingWave(new Blob(session.chunks, { type: mimeType }));
          if (active.current !== session) return;
          session.transcribing = true;
          const result = await window.buji.transcribeVoice(bytes, session.language);
          if (active.current !== session) return;
          active.current = null;
          setPhase('idle');
          callbacks.current.onBusy(false);
          callbacks.current.onTranscript(result.text);
        } catch (error) {
          if (active.current === session) { cancel(); callbacks.current.notify(error); }
        }
      };
      session.recorder.start(250);
      setPhase('recording');
      const started = Date.now();
      session.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 60 && session.recorder.state === 'recording') session.recorder.stop();
      }, 250);
    } catch (error) {
      if (active.current !== session) return;
      cancel();
      callbacks.current.notify(error.name === 'NotAllowedError' ? 'Allow microphone access in Windows privacy settings to record a voice message.'
        : error.name === 'NotFoundError' ? 'Connect a microphone to record a voice message.' : error);
    }
  }

  const recording = phase === 'recording';
  return <div className="voice-input">
    {phase === 'idle' ? <button className="icon-button" aria-label="Record voice message" title={ready ? 'Record voice message' : 'Local speech recognition is unavailable'} disabled={disabled || !ready} onClick={start}><Mic size={17}/></button>
      : <>
        <span role="status" className="voice-progress">{recording ? `Recording ${seconds}s` : phase === 'requesting' ? 'Opening mic…' : 'Transcribing…'}</span>
        {recording ? <button className="icon-button recording" aria-label={automatic ? 'Send voice message' : 'Use recording'} title={automatic ? 'Stop and send voice message' : 'Stop and transcribe'} onClick={() => { if (active.current?.recorder.state === 'recording') active.current.recorder.stop(); }}><Square size={14} fill="currentColor"/></button> : <LoaderCircle size={14} className="spin"/>}
        <button className="icon-button" aria-label="Cancel recording" title="Cancel recording" onClick={cancel}><X size={14}/></button>
      </>}
  </div>;
}

export function useLocalSpeech(notify, hindiReady = false) {
  const [voices, setVoices] = useState([]), [speaking, setSpeaking] = useState(null);
  const current = useRef(0), spoken = useRef(null);
  const available = useRef([]);
  const nativeAudio = useRef(null), nativePending = useRef(false);
  function stop() {
    current.current++;
    spoken.current = null;
    window.speechSynthesis?.cancel();
    if (nativeAudio.current) {
      nativeAudio.current.audio.pause();
      URL.revokeObjectURL(nativeAudio.current.url);
      nativeAudio.current = null;
    }
    const cancelled = nativePending.current ? window.buji.cancelSpeech().catch(() => {}) : Promise.resolve();
    nativePending.current = false;
    setSpeaking(null);
    return cancelled;
  }
  useEffect(() => {
    const update = () => {
      available.current = window.speechSynthesis.getVoices().filter(voice => voice.localService);
      if (hindiReady) available.current.unshift({ voiceURI: 'buji:piper-hi', name: 'Pratham Hindi (Piper)', lang: 'hi-IN', localService: true });
      setVoices(available.current);
    };
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => { stop(); window.speechSynthesis.removeEventListener('voiceschanged', update); };
  }, [hindiReady]);
  async function speak(message, preferredVoice) {
    const cancelled = stop();
    const text = message.content.replace(/```[\s\S]*?```/g, ' Code is shown in the chat. ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!text) return;
    const hindi = /[\u0900-\u097f]/.test(text);
    const voice = available.current.find(voice => voice.voiceURI === preferredVoice) ||
      available.current.find(voice => voice.lang.startsWith(hindi ? 'hi' : 'en')) || (!hindi && available.current[0]);
    if (!voice) { notify(hindi ? 'Install a Hindi speech voice in Windows to read Hindi replies aloud.' : 'No local Windows speech voice is available.'); return; }
    const chunks = text.match(/.{1,160}(?:\s|$)|.{1,160}/g) || [text];
    const generation = current.current;
    setSpeaking(message.id);
    if (voice.voiceURI === 'buji:piper-hi') {
      await cancelled;
      if (generation !== current.current) return;
      nativePending.current = true;
      try {
        const bytes = await window.buji.synthesizeVoice(text);
        if (generation !== current.current) return;
        nativePending.current = false;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        const audio = new Audio(url);
        nativeAudio.current = { audio, url };
        audio.onended = () => { if (generation === current.current) stop(); };
        audio.onerror = () => { if (generation === current.current) { stop(); notify('Could not play the local Hindi recording.'); } };
        await audio.play();
      } catch (error) {
        if (generation === current.current) { stop(); notify(error); }
      }
      return;
    }
    function next(index) {
      if (generation !== current.current) return;
      if (index >= chunks.length) { spoken.current = null; setSpeaking(null); return; }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => next(index + 1);
      utterance.onerror = event => {
        if (generation !== current.current) return;
        setSpeaking(null);
        if (!['canceled', 'interrupted'].includes(event.error)) notify('Windows could not play this reply.');
      };
      spoken.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
    next(0);
  }
  return { voices, speaking, speak, stop };
}
