/**
 * Model tiering, shared by the chat assistant and the checklist modal.
 *
 * Kept in its own small module rather than in `types/models.ts` so UI packages
 * can import it through a narrow alias without pulling the whole remix-ai-core
 * barrel into their bundle.
 */

import { AIModel, isAutoModelId } from '../types/models'

/**
 * Model tiers that hold up on heavy reasoning work such as a full audit.
 *
 * An audit asks the model to reason over a whole contract against dozens of
 * checklist items at once; the small routes Auto often lands on skim it. Kept
 * as a substring list rather than an exact catalogue so a new point release
 * (`claude-sonnet-4-6`, `gpt-5.1`) still matches without a code change.
 */
export const FRONTIER_MODEL_MARKERS = [
  // Anthropic
  'claude-opus',
  'claude-sonnet',
  'opus-',
  'sonnet-',
  // OpenAI
  'gpt-5',
  'gpt-4o',
  'gpt-4.1',
  'o3-',
  'o4-',
  // Google
  'gemini-2',
  'gemini-1.5-pro',
  // Zhipu GLM — the 4.5/4.6 line, not the small `glm-4-flash` routes
  'glm-4.5',
  'glm-4.6',
  'glm-4-plus',
  // DeepSeek
  'deepseek-v3',
  'deepseek-r1',
  'deepseek-chat',
  'deepseek-reasoner',
  // Alibaba Qwen — the flagship tiers only
  'qwen-max',
  'qwen3-',
  'qwen2.5-72b',
  // Moonshot
  'kimi-k2',
  // MiniMax
  'minimax-m'
]

export function isFrontierModelId(id: string | undefined | null): boolean {
  if (!id) return false
  const normalized = id.toLowerCase()
  return FRONTIER_MODEL_MARKERS.some(marker => normalized.includes(marker))
}

/**
 * The frontier models a user can actually pick right now, best first.
 *
 * Drops anything the backend marked unavailable — that covers feature-locked
 * rows and BYOK models whose key is missing, so callers never have to deal with
 * the paywall path. Auto itself is excluded: offering it as an alternative to
 * Auto is meaningless.
 */
export function selectFrontierModels(models: AIModel[] | undefined, limit = 4): AIModel[] {
  if (!Array.isArray(models)) return []
  return models
    .filter(model => !!model && model.available !== false)
    .filter(model => !isAutoModelId(model.id))
    .filter(model => isFrontierModelId(model.id))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .slice(0, Math.max(0, limit))
}

/**
 * The frontier models worth offering *instead of* the current one.
 *
 * Returns [] unless the user is on Auto: someone who picked a concrete model
 * has already made the choice, and second-guessing it would be nagging. Also []
 * when nothing frontier is actually available, so callers can treat "no choices"
 * as "just get on with it".
 */
export function frontierAlternativesFor(
  currentModelId: string | undefined | null,
  models: AIModel[] | undefined,
  limit = 4
): AIModel[] {
  if (!isAutoModelId(currentModelId)) return []
  return selectFrontierModels(models, limit)
}
