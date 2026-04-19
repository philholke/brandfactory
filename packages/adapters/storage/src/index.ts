// Storage adapter — blob store port + impls.
//
// Shipped impls:
//   - local-disk (filesystem + HMAC-signed URLs verified by the server)
//   - supabase   (Supabase Storage; native signed URLs)
//
// Future impls: s3, gcs, azure-blob, cloudflare-r2.

export * from './port'
export * from './local-disk'
export * from './supabase'
