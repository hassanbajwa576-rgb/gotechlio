// Deploys to production, then points gotechlio.vercel.app at the new deployment.
// Usage: npm run deploy   (needs `vercel login` and the project linked)
import { execSync } from "node:child_process";

const ALIAS = "gotechlio.vercel.app";
const out = execSync("npx vercel deploy --prod --yes", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const m = out.match(/https:\/\/gotechlio-[a-z0-9]+-[a-z0-9-]+\.vercel\.app/);
if (!m) { console.error("Couldn't find the deployment URL in the Vercel output:\n" + out); process.exit(1); }
console.log(`Deployed ${m[0]}`);
execSync(`npx vercel alias set ${m[0].replace("https://", "")} ${ALIAS}`, { stdio: "inherit" });
console.log(`Live at https://${ALIAS}`);
