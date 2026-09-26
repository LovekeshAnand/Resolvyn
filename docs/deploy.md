# Hosting the UI on Vercel, with the backend on your laptop

The website (`frontend/`) is a static-friendly Next.js app and lives on Vercel. The backend (FastAPI, the local Qwen model, the SQLite data) cannot be hosted there, so it keeps running on your laptop and is exposed with an ngrok tunnel. The browser calls the backend directly, including the call WebSocket.

```
browser ── https ──> Vercel (the UI)
   └─────── https / wss ──> ngrok ──> your laptop: backend on :8000 (+ llama-server on the GPU)
```

The home page, this explainer (`/docs`) and the benchmarks read a static `benchmarks.json` shipped with the site, so they work even when the laptop is off. Only `/talk` and `/ops` need the backend, and they show a "backend is not reachable" box with a connect field when it is off.

## One-time setup

1. **ngrok address.** A free ngrok account gets one permanent address (an `*.ngrok-free.dev` domain), so the URL does not change between runs. `ngrok http 8000` prints it; this machine's is in `NEXT_PUBLIC_API_BASE_URL` below. If you have several, put the one you want in `backend\.env` as `NGROK_DOMAIN=...`.
2. **Deploy the frontend.** Either
   - `cd frontend ; npx vercel login ; npx vercel link ; npx vercel env add NEXT_PUBLIC_API_BASE_URL production` (value: `https://<your-domain>.ngrok-free.dev`, no `/api`), then `npx vercel deploy --prod`; or
   - import the GitHub repo in the Vercel dashboard, set **Root Directory** to `frontend`, add the `NEXT_PUBLIC_API_BASE_URL` variable, deploy.
3. Optional: in `backend\.env` set `VERCEL_APP_URL=https://<your-project>.vercel.app` so the start script prints a ready-to-open link.

## Every time you want the site to work

```
.\start-public.ps1
```

It starts the backend and the tunnel, checks that the backend answers through the tunnel, and prints the address. Then open the Vercel site. `.\stop.ps1` stops the backend (close the ngrok window too).

## If the address is different

Open `https://<site>/talk?api=https://<new-address>` once (the browser remembers it), or paste the address into the box the site shows when it cannot reach the backend. Setting `NEXT_PUBLIC_API_BASE_URL` on Vercel changes the default for everyone.

## Notes

- CORS already allows `localhost` and any `*.vercel.app` origin. For a custom domain add `CORS_ORIGINS=["https://your.domain"]` to `backend\.env`.
- ngrok's free tier puts a warning page in front of browser page loads. The site sends `ngrok-skip-browser-warning` on its own requests, so the API, audio and WebSockets are unaffected; only someone opening the ngrok address itself in a tab sees it.
- Voice calls need HTTPS for the microphone, which Vercel provides.
- Anyone with the ngrok address can reach the backend while it runs. The data is simulated demo data, but stop the tunnel when you are not demoing.
