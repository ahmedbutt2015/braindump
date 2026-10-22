#!/usr/bin/env bash
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${CYAN}  BrainDump — Local Dev Setup${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── 1. Check Node ─────────────────────────────────────────────────────────────
echo -e "${BOLD}[1/5] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${NC}"
  exit 1
fi
NODE_VER=$(node --version)
echo -e "${GREEN}✓ Node.js ${NODE_VER}${NC}"

# ── 2. Check .env.local ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/5] Checking environment variables...${NC}"

if [ ! -f ".env.local" ]; then
  echo -e "${YELLOW}⚠  .env.local not found — creating from template...${NC}"
  cp .env.example .env.local
  echo -e "${RED}"
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  STOP: Fill in .env.local before continuing!        │"
  echo "  │                                                     │"
  echo "  │  NEXT_PUBLIC_SUPABASE_URL=       ← your project URL │"
  echo "  │  NEXT_PUBLIC_SUPABASE_ANON_KEY=  ← anon/public key  │"
  echo "  │  HUGGINGFACE_API_TOKEN=          ← HF access token  │"
  echo "  │                                                     │"
  echo "  │  Then re-run:  bash setup-local.sh                  │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo -e "${NC}"
  exit 1
fi

MISSING=()
source .env.local 2>/dev/null || true

[ -z "$NEXT_PUBLIC_SUPABASE_URL" ]    && MISSING+=("NEXT_PUBLIC_SUPABASE_URL")
[ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ] && MISSING+=("NEXT_PUBLIC_SUPABASE_ANON_KEY")
[ -z "$HUGGINGFACE_API_TOKEN" ]       && MISSING+=("HUGGINGFACE_API_TOKEN")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}✗ Missing required env vars in .env.local:${NC}"
  for v in "${MISSING[@]}"; do
    echo -e "    ${RED}• $v${NC}"
  done
  echo ""
  echo -e "${YELLOW}  See the Supabase setup instructions below.${NC}"
  echo ""
  echo -e "${BOLD}  Where to find them:${NC}"
  echo "  • Supabase URL + Anon Key → Supabase Dashboard → Project Settings → API"
  echo "  • HuggingFace token       → huggingface.co → Settings → Access Tokens"
  exit 1
fi

echo -e "${GREEN}✓ NEXT_PUBLIC_SUPABASE_URL${NC}    → ${NEXT_PUBLIC_SUPABASE_URL}"
echo -e "${GREEN}✓ NEXT_PUBLIC_SUPABASE_ANON_KEY${NC} → ${NEXT_PUBLIC_SUPABASE_ANON_KEY:0:20}..."
echo -e "${GREEN}✓ HUGGINGFACE_API_TOKEN${NC}        → ${HUGGINGFACE_API_TOKEN:0:10}..."

# ── 3. Install dependencies ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/5] Installing dependencies...${NC}"
if command -v pnpm &>/dev/null; then
  pnpm install --frozen-lockfile
else
  npm install
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── 4. Run tests ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/5] Running test suite...${NC}"
if command -v pnpm &>/dev/null; then
  pnpm test 2>&1 | tail -20
else
  npm test 2>&1 | tail -20
fi
echo -e "${GREEN}✓ Tests done${NC}"

# ── 5. Start dev server ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/5] Starting Next.js dev server...${NC}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  App running at → http://localhost:3000${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}  Sign up → /auth/sign-up"
echo -e "  Login   → /auth/login"
echo -e "  App     → /dashboard${NC}"
echo ""

if command -v pnpm &>/dev/null; then
  pnpm dev
else
  npm run dev
fi
