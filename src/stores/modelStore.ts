import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AIModel, PullProgress, ModelCategory } from '../types/models'
import { unloadModel } from '../api/ollama'

export interface PullState {
  progress: PullProgress
  controller: AbortController
  paused: boolean
  complete: boolean
}

interface ModelState {
  models: AIModel[]
  activeModel: string | null
  activePulls: Record<string, PullState>
  isModelLoading: boolean
  categoryFilter: ModelCategory
  setModels: (models: AIModel[]) => void
  setActiveModel: (name: string) => void
  startPull: (name: string, controller: AbortController) => void
  updatePullProgress: (name: string, progress: PullProgress) => void
  pausePull: (name: string) => void
  completePull: (name: string) => void
  dismissPull: (name: string) => void
  setIsModelLoading: (loading: boolean) => void
  setCategoryFilter: (category: ModelCategory) => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: [],
      activeModel: null,
      activePulls: {},
      isModelLoading: false,
      categoryFilter: 'all',

      setModels: (models) =>
        set((state) => {
          // Keep the persisted activeModel only if it's actually still
          // present in the freshly fetched list. Without this validation a
          // model name persists in the picker after the underlying provider
          // (e.g. Ollama) was uninstalled or the model was deleted — the
          // dropdown then shows a dead name and clicking it opens an empty
          // list. Falls back to the first available model, mirroring the
          // first-launch behavior so a user is never stuck with no
          // selection while a model exists.
          const stillValid = !!state.activeModel && models.some((m) => m.name === state.activeModel)
          return {
            models,
            activeModel: stillValid
              ? state.activeModel
              : (models.length > 0 ? models[0].name : null),
          }
        }),

      setActiveModel: (name) => {
        const prev = get().activeModel
        set({ activeModel: name })
        if (prev && prev !== name && !prev.includes('::')) {
          unloadModel(prev).catch((e) => console.warn('[modelStore] failed to unload previous model:', prev, e))
        }
      },

      startPull: (name, controller) =>
        set((state) => ({
          activePulls: {
            ...state.activePulls,
            [name]: { progress: { status: 'Starting download...' }, controller, paused: false, complete: false },
          },
        })),

      updatePullProgress: (name, progress) =>
        set((state) => {
          if (!state.activePulls[name]) return state
          return {
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], progress, paused: false },
            },
          }
        }),

      pausePull: (name) => {
        const pull = get().activePulls[name]
        if (pull && !pull.complete) {
          pull.controller.abort()
          set((state) => ({
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], paused: true, progress: { ...state.activePulls[name].progress, status: 'Paused' } },
            },
          }))
        }
      },

      completePull: (name) =>
        set((state) => {
          if (!state.activePulls[name]) return state
          return {
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], complete: true, paused: false, progress: { status: 'Complete' } },
            },
          }
        }),

      dismissPull: (name) =>
        set((state) => {
          const { [name]: _, ...rest } = state.activePulls
          return { activePulls: rest }
        }),

      setIsModelLoading: (loading) => set({ isModelLoading: loading }),
      setCategoryFilter: (category) => set({ categoryFilter: category }),
    }),
    {
      name: 'chat-models',
      partialize: (state) => ({ activeModel: state.activeModel, categoryFilter: state.categoryFilter }),
    }
  )
)
