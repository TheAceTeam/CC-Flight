import { createServer } from "./server.js";

const port = Number(process.env.SUPERVIEW_API_PORT ?? 5174);
const app = createServer();

app.get("/", (_req, res) => {
  const clientUrl = process.env.SUPERVIEW_UI_URL ?? `http://127.0.0.1:${process.env.SUPERVIEW_UI_PORT ?? 5173}/`;
  res.redirect(302, clientUrl);
});

app.listen(port, "127.0.0.1", () => {
  console.log(`CC Flight API listening on http://127.0.0.1:${port}`);
});
