// Realtime adapter — pub/sub bus port + impls.
//
// Shipped impls:
//   - native-ws (in-process Map<channel, Set<handler>> + ws.Server binder)
//
// Future impls: supabase realtime, ably, redis pubsub.

export * from './port'
export * from './native-ws'
