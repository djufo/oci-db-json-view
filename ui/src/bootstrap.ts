import { startApp } from "../security/frame-client.mjs";
void startApp(() => import("./main"), "./frame-config.json");
