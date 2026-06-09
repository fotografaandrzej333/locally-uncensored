/**
 * Bug C (aldrich): FLUX "CLIPLoader: Value not in list".
 *
 * Root cause was buildDynamicWorkflow's silent catch fallback
 * (`clip = models.clips[0] || ''`): when no matching text encoder was found it
 * emitted an empty/wrong clip_name, which ComfyUI rejects with that cryptic
 * error. The fix propagates findMatchingCLIP's actionable "download <encoder>"
 * message as a WorkflowUnavailableError instead.
 *
 * Run: npx vitest run src/api/__tests__/dynamic-workflow-clip-missing.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the live-fetch boundary; keep the real pure helpers (classifyModel,
// categorizeNodes, detectAvailableModels, determineStrategy).
vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})
vi.mock('../comfyui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui')>()
  return { ...actual, findMatchingCLIP: vi.fn(), findMatchingVAE: vi.fn() }
})

import { buildDynamicWorkflow, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { findMatchingCLIP, findMatchingVAE } from '../comfyui'

// Minimal /object_info that categorizes to a FLUX unet strategy.
const FLUX_NODES = {
  UNETLoader: { input: { required: { unet_name: [[]] } } },
  CLIPLoader: { input: { required: { clip_name: [[]] } } },
  VAELoader: { input: { required: { vae_name: [[]] } } },
  KSampler: { input: { required: {} } },
  EmptySD3LatentImage: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}

const fluxParams = {
  model: 'flux1-dev-fp8.safetensors',
  prompt: 'a cat', negativePrompt: '',
  width: 1024, height: 1024, steps: 20, cfg: 1, seed: 1,
} as never

describe('buildDynamicWorkflow — Bug C: missing FLUX text encoder', () => {
  beforeEach(() => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(FLUX_NODES as never)
    vi.mocked(findMatchingVAE).mockResolvedValue('ae.safetensors')
  })

  it('throws an actionable WorkflowUnavailableError instead of emitting clip_name:""', async () => {
    vi.mocked(findMatchingCLIP).mockRejectedValue(
      new Error('No FLUX text encoder (T5) found. Download "t5xxl_fp8_e4m3fn.safetensors" from the Model Manager.'),
    )
    await expect(buildDynamicWorkflow(fluxParams)).rejects.toBeInstanceOf(WorkflowUnavailableError)
    await expect(buildDynamicWorkflow(fluxParams)).rejects.toThrow(/download/i)
  })

  it('uses the resolved encoder (never an empty clip_name) when one is found', async () => {
    vi.mocked(findMatchingCLIP).mockResolvedValue('t5xxl_fp8_e4m3fn.safetensors')
    const wf = await buildDynamicWorkflow(fluxParams)
    const clipLoader = Object.values(wf).find((n) => (n as { class_type?: string }).class_type === 'CLIPLoader') as
      | { inputs: { clip_name: string } }
      | undefined
    expect(clipLoader?.inputs.clip_name).toBe('t5xxl_fp8_e4m3fn.safetensors')
    expect(clipLoader?.inputs.clip_name).not.toBe('')
  })
})
