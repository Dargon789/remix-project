import { ChatAnthropic } from '@langchain/anthropic'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatOpenAI } from '@langchain/openai'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { endpointUrls } from '@remix-endpoints-helper'
import { ModelSelection, IUserApiKeyConfig } from '../../types/deepagent'
import { DAPP_MAX_TOKENS } from './constants'

export function createModelInstance(
  modelSelection: ModelSelection,
  maxTokens: number = DAPP_MAX_TOKENS,
  userApiKeys?: IUserApiKeyConfig
): BaseChatModel {
  const { provider, modelId } = modelSelection

  switch (provider) {
  case 'mistralai': {
    const useDirectApi = userApiKeys?.useOwnKeys && userApiKeys?.mistralApiKey
    console.log(`[ModelFactory] Creating MistralAI model: ${modelId}${useDirectApi ? ' (direct API)' : ' (proxy)'}`)
    return new ChatMistralAI({
      apiKey: useDirectApi ? userApiKeys.mistralApiKey : 'proxy-handled',
      model: modelId,
      temperature: 0.7,
      maxTokens: maxTokens,
      streaming: true,
      ...(useDirectApi ? {} : { serverURL: `${endpointUrls.langchain}/mistral` })
    })
  }

  case 'openai': {
    const useDirectApi = userApiKeys?.useOwnKeys && userApiKeys?.openaiApiKey
    console.log(`[ModelFactory] Creating OpenAI model: ${modelId}${useDirectApi ? ' (direct API)' : ' (proxy)'}`)
    return new ChatOpenAI({
      apiKey: useDirectApi ? userApiKeys.openaiApiKey : 'proxy-handled',
      model: modelId,
      temperature: 0.7,
      maxTokens: maxTokens,
      streaming: true,
      ...(useDirectApi ? {} : {
        configuration: { baseURL: `${endpointUrls.langchain}/openai` }
      })
    })
  }

  case 'moonshot': {
    // Moonshot/Kimi API - use proxy with user's API key to avoid CORS
    const moonshotApiKey = userApiKeys?.moonshotApiKey
    if (!moonshotApiKey) {
      console.error('[ModelFactory] Moonshot requires user API key. Please provide a Moonshot API key in Settings.')
      throw new Error('Moonshot models require a user API key. Please enter your Moonshot API key in Settings.')
    }
    // Debug: show key length and prefix to verify it's being read
    console.log(`[ModelFactory] Creating Moonshot model: ${modelId} (via proxy with user API key, key length: ${moonshotApiKey.length}, prefix: ${moonshotApiKey.substring(0, 6)}...)`)
    // Pass the user's API key - the proxy will forward it to Moonshot
    // Proxy expects /moonshot/v1/chat/completions, ChatOpenAI appends /chat/completions
    // Disable thinking mode for Kimi models to avoid reasoning_content requirement
    return new ChatOpenAI({
      apiKey: moonshotApiKey,
      model: modelId,
      maxTokens: maxTokens,
      streaming: true,
      configuration: {
        baseURL: `${endpointUrls.langchain}/moonshot/v1`
      },
      modelKwargs: {
        thinking: { type: 'disabled' }
      }
    })
  }

  case 'anthropic':
  default: {
    const useDirectApi = userApiKeys?.useOwnKeys && userApiKeys?.anthropicApiKey
    console.log(`[ModelFactory] Creating Anthropic model: ${modelId}${useDirectApi ? ' (direct API)' : ' (proxy)'}`)
    return new ChatAnthropic({
      apiKey: useDirectApi ? userApiKeys.anthropicApiKey : 'proxy-handled',
      model: modelId,
      temperature: 0.7,
      maxTokens: maxTokens,
      streaming: true,
      ...(useDirectApi ? {} : { clientOptions: { baseURL: endpointUrls.langchain } })
    })
  }
  }
}
