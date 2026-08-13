// lib/supabase.js reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY into module
// consts at require time, so any test that needs a working Supabase client has
// to set them before the first require. Requiring this file first does that —
// `node --test` runs each test file in its own process, so there's no bleed
// between files, and the one test that needs the vars *missing* re-requires
// lib/supabase.js in an isolated cache of its own.
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_PASSWORD = require("./http").ADMIN_PASSWORD;

module.exports = {};
