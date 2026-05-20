import { IParams } from './types';

// Model Registry for User-Access-Based Selection
export interface AIModel {
  id: string // Unique model ID (e.g., 'gpt-4-turbo')
  name: string // Display name (e.g., 'GPT-4 Turbo')
  provider: 'openai' | 'mistralai' | 'anthropic' | 'moonshot' | 'ollama'
  description: string // Short description
  requiresAuth: boolean // Does it require login?
  isDefault: boolean // Is it the base free model?
  category: 'coding' | 'general' | 'local'
  capabilities: string[] // e.g., ['code', 'chat', 'completion']
}

export const AVAILABLE_MODELS: AIModel[] = [
  // Default free model (no auth required)
  {
    id: 'mistral-medium-latest',
    name: 'Mistral Medium (Free)',
    provider: 'mistralai',
    description: 'Fast and efficient for basic tasks',
    requiresAuth: false,
    isDefault: false,
    category: 'general',
    capabilities: ['chat', 'code']
  },
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small (Free)',
    provider: 'mistralai',
    description: 'Fast and efficient for basic tasks',
    requiresAuth: false,
    isDefault: true,
    category: 'general',
    capabilities: ['chat', 'code']
  },

  // Premium models (require auth + access)
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    description: 'Best for complex web3 contracts',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    description: 'Balanced performance and speed',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },
  {
    id: 'codestral-latest',
    name: 'Codestral',
    provider: 'mistralai',
    description: 'Specialized for code generation',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['code', 'completion']
  },

  // OpenAI models
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    description: 'Latest OpenAI flagship model',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    description: 'Fast and efficient OpenAI model',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },

  // Moonshot/Kimi models
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'moonshot',
    description: 'Moonshot Kimi K2 model',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot v1 (128K)',
    provider: 'moonshot',
    description: 'Moonshot v1 with 128K context',
    requiresAuth: true,
    isDefault: false,
    category: 'coding',
    capabilities: ['chat', 'code', 'completion']
  },

  // Special local models entry
  {
    id: 'ollama',
    name: 'Local Models (Ollama)',
    provider: 'ollama',
    description: 'Run AI models locally on your machine',
    requiresAuth: false,
    isDefault: false,
    category: 'local',
    capabilities: ['chat', 'code', 'completion']
  }
]

// Helper function to get default model
export function getDefaultModel(): AIModel {
  return AVAILABLE_MODELS.find(m => m.isDefault) || AVAILABLE_MODELS[0]
}

// Helper to get model by ID
export function getModelById(id: string): AIModel | undefined {
  return AVAILABLE_MODELS.find(m => m.id === id)
}

const CompletionParams:IParams = {
  temperature: 0.8,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 15,
  stream_result: false,
  max_tokens: 200,
  version: '1.0.0'
}

const InsertionParams:IParams = {
  temperature: 0.8,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 150,
  stream_result: false,
  stream: false,
  model: "",
  version: '1.0.0',
}

const GenerationParams:IParams = {
  temperature: 0.5,
  topK: 40,
  topP: 0.92,
  max_new_tokens: 20000,
  stream_result: false,
  stream: false,
  model: "",
  repeat_penalty: 1.2,
  terminal_output: false,
  version: '1.0.0',
}

const AssistantParams:IParams = GenerationParams
AssistantParams.provider = 'mistralai' // default provider

export { CompletionParams, InsertionParams, GenerationParams, AssistantParams }
