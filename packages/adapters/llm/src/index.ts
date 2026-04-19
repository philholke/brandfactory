// LLM adapter — language-model port + provider factory.
//
// Shipped impls (selected via providerId at call time):
//   - anthropic  (@ai-sdk/anthropic)
//   - openai     (@ai-sdk/openai)
//   - openrouter (@openrouter/ai-sdk-provider)
//   - ollama     (ollama-ai-provider)
//
// Future impls: google, mistral, groq, bedrock.

export * from './port'
export * from './factory'
