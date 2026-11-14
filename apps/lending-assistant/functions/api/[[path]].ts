interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  return env.API.fetch(request);
};
