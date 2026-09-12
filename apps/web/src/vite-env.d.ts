/// <reference types="vite/client" />

/**
 * The one environment variable the frontend reads (tech-stack §4.6.1). Declaring
 * it here types `import.meta.env.VITE_API_BASE_URL` as `string | undefined`
 * rather than leaving it untyped.
 *
 * TODO: decide whether to opt into Vite's strict import.meta.env typing. Vite's
 * own `ImportMetaEnv` extends `Record<string, any>` unless a module declares
 * `interface ViteTypeOptions { strictImportMetaEnv: unknown }`. Until something
 * does, a misspelled variable name resolves to `any` and still compiles, so the
 * declaration below documents the variable but does not catch a typo.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
