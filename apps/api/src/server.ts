import { assertRuntimeConfig, env } from "./config/env.js";
import { createApp } from "./app.js";

assertRuntimeConfig();

const app = createApp();

app.listen(env.port, env.host, () => {
  console.log(`Phantom API listening on http://${env.host}:${env.port}`);
});
