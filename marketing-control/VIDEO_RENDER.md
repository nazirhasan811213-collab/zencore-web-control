# ZenCore MP4 draft renderer

The rendering worker now includes `render-mp4.mjs` and `render-cli.mjs`.

Requirements: Node 20+, FFmpeg with libx264 and a licensed TrueType font file.
Set `MARKETING_RENDER_DIR` to a private writable folder and `MARKETING_FONT_FILE` to a font path, then run:

```bash
node marketing-control/render-cli.mjs "ZenCore Launch 19 October 2026"
```

This generates a 1080x1920 H.264 MP4 **DRAFT** locally with 5 text scenes. It is deliberately NOT connected to any social network, publisher, email, advertising service or marketing automation. It does not fake live screenshots or trade performance.

Security boundaries: the CLI is intended for an isolated trusted operator, NOT for untrusted HTTP input. It must never be exposed as a public render API without rate limits, authentication, resource limits, job isolation and sanitized asset handling. A production-grade compositor with Founder-supplied genuine ZenCore recordings, background motion, original voiceover, licensed music and subtitles still needs implementation and review. Generation of a local video does not signify permission to post it.

Deployment status: no production deployment or social authorization has been made.
