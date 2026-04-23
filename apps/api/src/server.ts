import { assertRuntimeConfig, env } from "./config/env.js";
import { createApp } from "./app.js";

assertRuntimeConfig();

const app = createApp();

app.listen(env.port, () => {
  console.log(`Phantom API listening on http://localhost:${env.port}`);
});
