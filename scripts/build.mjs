import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("bsma3b_class_funds_premium.html", "dist/index.html");
