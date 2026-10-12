# YouTube cookies (optional)

Sometimes YouTube answers IntelliNova's video reader with:

> Sign in to confirm you're not a bot

This happens when many videos are read from one internet connection. Most videos still work without
doing anything: IntelliNova reads the title from YouTube's public page and the words from the
captions. Only videos **without captions** need the audio downloaded, and that is what YouTube blocks.

If that keeps happening, you can let the reader use a signed-in YouTube session:

1. Sign in to YouTube in a browser. A spare Google account is best, not your main one.
2. Install a "cookies.txt" export extension (for example "Get cookies.txt LOCALLY") and export the
   cookies for `youtube.com` in **Netscape** format.
3. Save the file here as `infra/youtube/cookies.txt` (next to this README).
4. Restart: `docker compose restart api worker`

The file is only read by the api and worker containers and is listed in `.gitignore`, so it is
never committed. Treat it like a password: anyone with it can use that YouTube account. YouTube
expires these cookies after a while; export a fresh file if the message comes back.

Other ways round it: wait a few hours and press Retry, or upload the video file itself.
