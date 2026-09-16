// The one serverless function: every `/api/*` request arrives here.
//
// It carries no logic on purpose. The platform compiles a TypeScript function
// with esbuild, which does not emit the decorator metadata Nest's dependency
// injection reads, so the API is compiled by its own `nest build` in the build
// step and this file only forwards to the result.
//
// The load is deferred and its failure is answered, rather than left to crash
// the invocation: a module that will not load here is the difference between
// an opaque platform 500 and a sentence naming the module and the runtime it
// would not load under.
let loading = null;

async function load() {
  const compiled = await import('../apps/api/dist/serverless.bundle.mjs');

  // Two wrappers to unwrap, not one. The bundle is an ES module built from a
  // CommonJS entry, so its own default export is that entry's `module.exports`
  // — and the handler is the `default` on that.
  const exported = compiled.default ?? compiled;

  return exported.default ?? exported;
}

export default async function handler(req, res) {
  try {
    const app = await (loading ??= load());
    return app(req, res);
  } catch (cause) {
    loading = null;
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'the api did not load',
        node: process.version,
        detail: String(cause),
      }),
    );
  }
}
