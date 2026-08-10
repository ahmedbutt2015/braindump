import { loadEnv } from 'vite'

// Load .env.local (and .env, .env.test) so supabase/HF creds are available
const env = loadEnv('test', process.cwd(), '')
Object.assign(process.env, env)
