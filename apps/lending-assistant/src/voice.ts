/** Hands-free voice conversation for the lending assistant (Web Speech API). */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};

export type VoiceState = {
  listening: boolean;
  voiceMode: boolean;
  busy: boolean;
  actionBusy: boolean;
};

type VoiceDeps = {
  getState: () => VoiceState;
  setListening: (v: boolean) => void;
  setVoiceMode: (v: boolean) => void;
  addMessage: (role: "user" | "assistant", content: string) => void;
};

let recognition: SpeechRecognitionLike | null = null;
let deps: VoiceDeps | null = null;

export function initVoice(d: VoiceDeps) {
  deps = d;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function updateVoiceUi() {
  if (!deps) return;
  const state = deps.getState();
  const btn = document.querySelector<HTMLButtonElement>("#voice-btn");
  const status = document.querySelector<HTMLElement>("#assistant-status");
  if (btn) {
    btn.classList.toggle("recording", state.listening);
    btn.classList.toggle("voice-active", state.voiceMode);
    const label = btn.querySelector("span");
    if (label) label.textContent = state.listening ? "Listening…" : state.voiceMode ? "Voice on" : "Voice";
  }
  if (status) {
    if (state.listening) status.textContent = "Listening… · speak now";
    else if (state.voiceMode && !state.busy) status.textContent = "Voice mode on · tap mic or wait for next turn";
    else if (!state.busy) status.textContent = "Ready to help · English / Tagalog";
  }
}

export function stopVoiceListening() {
  if (!deps) return;
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
  deps.setListening(false);
  updateVoiceUi();
}

export function stopVoiceMode() {
  if (!deps) return;
  deps.setVoiceMode(false);
  stopVoiceListening();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  updateVoiceUi();
}

/** Start one listening turn. On final transcript, auto-send the message. */
export function startVoiceListening() {
  if (!deps) return;
  const state = deps.getState();
  const Speech = getSpeechRecognitionCtor();
  if (!Speech) {
    deps.addMessage("assistant", "Voice input is not supported in this browser. You can still type a message.");
    deps.setVoiceMode(false);
    updateVoiceUi();
    return;
  }
  if (state.busy || state.actionBusy) return;

  // Barge-in: stop any ongoing AI speech
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
  }

  recognition = new Speech();
  // Default to English; Tagalog speech is still accepted by most engines.
  recognition.lang = "en-PH";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ")
      .trim();
    if (!transcript) return;
    const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
    if (input) {
      input.value = transcript;
      input.focus();
    }
    const form = document.querySelector<HTMLFormElement>("#chat-form");
    if (form) form.requestSubmit();
  };

  recognition.onend = () => {
    if (!deps) return;
    deps.setListening(false);
    updateVoiceUi();
  };

  recognition.onerror = (event) => {
    if (!deps) return;
    deps.setListening(false);
    updateVoiceUi();
    const err = event?.error;
    if (err && err !== "no-speech" && err !== "aborted" && deps.getState().voiceMode) {
      const status = document.querySelector<HTMLElement>("#assistant-status");
      if (status) status.textContent = "Voice error · tap Voice to retry";
    }
  };

  deps.setListening(true);
  updateVoiceUi();
  try {
    recognition.start();
  } catch {
    recognition.onend?.();
  }
}

/** Toggle continuous voice conversation mode on/off. */
export function toggleVoice() {
  if (!deps) return;
  if (!getSpeechRecognitionCtor()) {
    deps.addMessage("assistant", "Voice input is not supported in this browser. You can still type a message.");
    return;
  }
  if (deps.getState().voiceMode) {
    stopVoiceMode();
    return;
  }
  deps.setVoiceMode(true);
  startVoiceListening();
}

/** Speak an assistant reply; when done, resume listening if voice mode is on. */
export function speakAssistantReply(content: string) {
  if (!deps) return;
  if (!deps.getState().voiceMode || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(content);
  // Default English; switch to Filipino only when the reply is clearly Tagalog-heavy.
  const looksFilipino = /\b(po|opo|sige|salamat|utang|bayad|walang|magkano|ano|paano|ninyo|natin|ko|mo)\b/i.test(content)
    || /[\u00F1\u00D1]/.test(content);
  utterance.lang = looksFilipino ? "fil-PH" : "en-PH";
  utterance.rate = 1.02;
  const status = document.querySelector<HTMLElement>("#assistant-status");
  if (status) status.textContent = "Speaking… · tap Voice to stop";
  utterance.onend = () => {
    if (!deps) return;
    const s = deps.getState();
    if (s.voiceMode && !s.busy && !s.listening) {
      startVoiceListening();
    } else if (status && !s.listening) {
      status.textContent = s.voiceMode ? "Voice mode on · tap mic or speak" : "Ready to help · English / Tagalog";
    }
  };
  utterance.onerror = utterance.onend;
  window.speechSynthesis.speak(utterance);
}
