import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VoiceState {
  // Transient state (not persisted)
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  transcript: string;
  // Whether local Whisper STT is actually available. Probed at startup and
  // after the in-app install — transient (re-probed every launch) so a stale
  // "available" can never light up the mic on a machine where Whisper is gone,
  // and a fresh install lights it up without a restart.
  sttAvailable: boolean;
  // Whether local neural TTS (Piper) is installed + a voice model is present.
  // Same transient/probe model as sttAvailable.
  ttsAvailable: boolean;

  // Persisted settings
  sttEnabled: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;

  // Actions
  setRecording: (recording: boolean) => void;
  setTranscribing: (transcribing: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setTranscript: (transcript: string) => void;
  setSttAvailable: (available: boolean) => void;
  setTtsAvailable: (available: boolean) => void;
  updateVoiceSettings: (
    settings: Partial<{
      sttEnabled: boolean;
      ttsEnabled: boolean;
      ttsVoice: string;
      ttsRate: number;
      ttsPitch: number;
    }>
  ) => void;
  resetTransient: () => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      // Transient state
      isRecording: false,
      isTranscribing: false,
      isSpeaking: false,
      transcript: "",
      sttAvailable: false,
      ttsAvailable: false,

      // Persisted settings
      sttEnabled: true,
      // TTS (read-aloud) on by default — David 2026-06-06 "texttospeech
      // aktivieren". There is no auto-speak; this just shows/enables the
      // per-message read-aloud Speaker button when TTS is usable.
      ttsEnabled: true,
      ttsVoice: "",
      ttsRate: 1.0,
      ttsPitch: 1.0,

      // Actions
      setRecording: (recording) => set({ isRecording: recording }),
      setTranscribing: (transcribing) => set({ isTranscribing: transcribing }),
      setSpeaking: (speaking) => set({ isSpeaking: speaking }),
      setTranscript: (transcript) => set({ transcript }),
      setSttAvailable: (available) => set({ sttAvailable: available }),
      setTtsAvailable: (available) => set({ ttsAvailable: available }),

      updateVoiceSettings: (settings) => set((state) => ({ ...state, ...settings })),

      resetTransient: () =>
        set({
          isRecording: false,
          isTranscribing: false,
          isSpeaking: false,
          transcript: "",
        }),
    }),
    {
      name: "locally-uncensored-voice",
      partialize: (state) => ({
        sttEnabled: state.sttEnabled,
        ttsEnabled: state.ttsEnabled,
        ttsVoice: state.ttsVoice,
        ttsRate: state.ttsRate,
        ttsPitch: state.ttsPitch,
      }),
    }
  )
);
