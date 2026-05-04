import { validateConfig } from "./config.js";
import { runDailyNews } from "./workflows/daily-news.js";

/* ------------------------------------------------------------------ */
/*  CLI arg parsing                                                    */
/* ------------------------------------------------------------------ */

interface CliOpts {
  publisher: boolean;
  skipVisuals: boolean;
  digestResume?: string;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const opts: CliOpts = {
    publisher: false,
    skipVisuals: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--publisher":
        opts.publisher = true;
        break;
      case "--skip-visuals":
        opts.skipVisuals = true;
        break;
      case "--digest-resume":
        opts.digestResume = args[++i];
        break;
      case "--digest":
        // no-op: implied by this runner
        break;
    }
  }

  return opts;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs();
  validateConfig(["parallelApiKey"]);
  await runDailyNews({ publish: opts.publisher, skipVisuals: opts.skipVisuals, resume: opts.digestResume });
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
