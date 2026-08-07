// Fill these in once you've created the repo, Supabase project, and Vercel
// project (see README.md). All of these are safe to commit publicly:
// - GITHUB_* is only used to read commit history via GitHub's public API.
// - SUPABASE_ANON_KEY is Supabase's public, RLS-protected client key —
//   it's designed to ship in browser code (unlike the service role key,
//   which stays server-side in Vercel's environment variables and never
//   appears in this repo).
window.SITE_CONFIG = {
  GITHUB_OWNER: "bRaInT00T",
  GITHUB_REPO: "HMC_Headquarters",
  GITHUB_BRANCH: "main",

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};