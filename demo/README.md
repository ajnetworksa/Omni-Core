# Screenshot demo

Regenerates `docs/screenshots/` from a live run: real server + real bot code, Telegram mocked at the HTTP level.

```bash
npm run build
node --disable-warning=ExperimentalWarning demo/run-demo.mjs   # live session → demo/out/session.json
node demo/render.mjs                                           # → demo/pages/*.html
node demo/shoot.mjs                                            # → demo/shots/*.png (needs Playwright + Chrome)
```

`demo/out/unit-*.txt`, `e2e.txt` and `security.txt` (the terminal screenshots) are the saved outputs of
`npx vitest run --reporter=verbose`, `node tests/e2e.mjs` and `node tests/security.mjs`.
