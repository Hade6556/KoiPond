<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0B3C5D,100:F28C28&height=210&section=header&text=Koi%20Pond&fontSize=68&fontColor=ffffff&fontAlignY=38&desc=Practice%20the%20talk%20you%20are%20dreading.%20Beat%20stage%20fright.&descSize=18&descAlignY=60" alt="Koi Pond banner" width="100%" />

**An AI speech coach: rehearse an interview, presentation, toast or pitch in the browser, take questions from a virtual audience, and get scored on clarity, pacing and confidence.**

[![Top language](https://img.shields.io/github/languages/top/Hade6556/KoiPond?style=for-the-badge)](https://github.com/Hade6556/KoiPond)
[![License](https://img.shields.io/github/license/Hade6556/KoiPond?style=for-the-badge)](#license)
[![Last commit](https://img.shields.io/github/last-commit/Hade6556/KoiPond?style=for-the-badge)](https://github.com/Hade6556/KoiPond/commits)
[![Stars](https://img.shields.io/github/stars/Hade6556/KoiPond?style=for-the-badge)](https://github.com/Hade6556/KoiPond/stargazers)

[![Vercel](https://img.shields.io/badge/Vercel-serverless-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![Supabase](https://img.shields.io/badge/Supabase-auth%20%2B%20db-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Claude](https://img.shields.io/badge/Claude-coach-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://docs.anthropic.com/)
[![Gemini](https://img.shields.io/badge/Gemini-delivery%20review-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CDN-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

</div>

---

## What it does

You pick a scenario and an audience persona, give your talk in front of your webcam, and answer the questions the audience throws at you. Koi Pond then scores the transcript, reviews your delivery from sampled camera frames, grades your answers, and stores the session so you can watch your progress and, if you opt in, compare yourself on a leaderboard.

> **[screenshot placeholder]** Capture the practice session page mid-talk (timer running, persona card visible), then the scored feedback view with the clarity, pacing and confidence numbers. 1440×900, no real faces.

The product started as a VC pitch trainer and is being re-themed as a general public-speaking trainer. The nine personas in `lib/scenarios.js` are still investor-flavoured (a skeptical seed partner, a hackathon jury, a pricing pushback, a "why now" attack) and the package name is still `salesecho-landing`. **[placeholder: rename personas and package once the pivot lands]**

## Features

- **Nine audience personas** with their own style, focus, difficulty and stage. One is locked behind a university email domain.
- **Transcript coaching** from Claude: structure, clarity and persuasion, with quotes from what you actually said.
- **Delivery review** from Gemini on JPEG keyframes sampled during the talk. The prompt forbids inventing anything the camera did not show and flags reading from a script only on evidence.
- **Audience Q&A.** Claude writes the hard questions, a text-to-speech endpoint (Fish Audio) gives them a voice, and a grader scores your answers.
- **Three languages for feedback:** English, Lithuanian, and a mixed mode that keeps startup vocabulary in English.
- **Guest mode.** Anonymous Supabase sign-in, so nobody has to register before trying it. Email accounts and password reset are also wired.
- **Dashboard, progress and past sessions**, backed by Supabase rows per session.
- **Opt-in leaderboard** with difficulty multipliers so a hard persona is worth more than an easy one.
- **No build step.** Plain HTML pages, Tailwind from the CDN, the Supabase SDK from esm.sh.

## Tech stack

| Layer | Choice |
|---|---|
| Pages | Static HTML: `index`, `practice`, `scenario`, `session`, `dashboard`, `progress`, `past-sessions`, `leaderboard`, `account` |
| Styling | Tailwind CSS via CDN, Lucide icons, custom `assets/koi.css` |
| Backend | Vercel serverless functions in `api/` (Node 20) |
| Models | Claude for transcript coaching, questions and grading; Gemini 2.5 Flash with a 2.0 fallback for delivery; DeepSeek configured as an alternative |
| Voice | Fish Audio text-to-speech |
| Auth and data | Supabase Auth (anonymous and email), Postgres tables from `lib/schema.sql` |
| Local dev | `scripts/dev-server.js`, a dependency-free Node server that serves the pages and the same five API routes |

## Quick start

Requirements: Node 20, an Anthropic key, and optionally Gemini and Fish Audio keys. There is nothing to `npm install`: the server and the pages have no dependencies.

```bash
git clone https://github.com/Hade6556/KoiPond.git
cd KoiPond
cat > .env <<'ENV'
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
FISH_API_KEY=...
ENV
export $(grep -v '^#' .env | xargs) && npm run dev     # http://localhost:8765
```

Supabase: create a project, paste `lib/schema.sql` into the SQL editor and run it (it is safe to re-run), and enable **Anonymous Sign-Ins** under Authentication → Providers. Then put your project URL and publishable key in `lib/supabase.js`. **[placeholder: the file currently holds the author's project; move these two values to a config step]**

### Environment variables

| Variable | Used by | Default |
|---|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `api/coach`, `api/qa-questions`, `api/qa-grade` | model `claude-sonnet-4-6` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | `api/multimodal-coach` | `gemini-2.5-flash`, `gemini-2.0-flash` |
| `FISH_API_KEY`, `FISH_VOICE_ID` | `api/tts` | a preset voice id |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL` | optional alternative model | `deepseek-chat` |

### Deploy

```bash
npx vercel          # vercel.json already sets clean URLs and per-function timeouts
```

Add the same variables in the Vercel project settings.

## Usage

1. Open the site and start as a guest or sign in.
2. **Practice** → pick a scenario and persona.
3. **Session**: allow camera and microphone, give the talk, then answer the audience's questions.
4. Read the scores and the coach's notes. Sessions appear under **Past sessions** and feed **Progress**.
5. Turn on the leaderboard in **Account** if you want your handle and country shown.

API routes, all `POST` with JSON bodies: `/api/coach` (transcript + scenario), `/api/multimodal-coach` (array of `{t, b64}` keyframes), `/api/qa-questions`, `/api/qa-grade`, `/api/tts`. The keyframe route stays under Vercel's 4.5 MB body cap by sampling roughly 30 small JPEGs instead of uploading a video.

## Contributing

1. Keep pages dependency-free. New client code goes in `lib/` as ES modules loaded straight from the HTML.
2. Any new serverless function must also get a handler in `scripts/dev-server.js`, so local development stays in sync.
3. Prompts live in `api/_shared.js`. When you change one, say in the pull request what you tested it on.
4. Schema changes go in `lib/schema.sql` as idempotent statements, since the file is meant to be re-run.
5. Public-speaking scenarios that are not investor pitches are the most useful contribution right now.

## License

No license file is in the repository yet, so the default "all rights reserved" applies. **[placeholder: add a LICENSE file; the badge above updates by itself]**
