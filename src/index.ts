#!/usr/bin/env node
import { select, input } from "@inquirer/prompts";
import { writeFile, stat, readFile } from "fs/promises";
import { mkdir } from "fs/promises";
import { join } from "path";
import * as pm2 from "pm2";
import { existsSync } from "fs";
import * as os from "os";
enum Action {
  Config = "Config",
  Cron = "Cron",
  Restore = "Restore",
}
import * as dotenv from "dotenv";
import { execSync } from "child_process";
const CONFIG_FOLDER = join(os.homedir(), ".pg_gdrive");
const ENV_FILENAME = ".env";

// handle ctrl+c on prompt
process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    console.log("👋 until next time!");
  } else {
    // Rethrow unknown errors
    throw error;
  }
});

async function loadEnv(): Promise<string> {
  const configExists = existsSync(join(CONFIG_FOLDER, ENV_FILENAME));
  if (!configExists) {
    console.error("Config file not found. Please run config first.");
    process.exit(1);
  }

  const envStr = await readFile(join(CONFIG_FOLDER, ENV_FILENAME));
  return envStr.toString();
}

async function main() {
  const action = await select({
    message: "What do you want to do?",
    choices: [
      { name: "Config", value: Action.Config },
      { name: "Cron", value: Action.Cron },
      { name: "Restore", value: Action.Restore },
    ],
  });

  if (action === Action.Config) {
    const serviceAccountPath = await input({
      message: "Enter SERVICE_ACCOUNT path:",
    });
    const folderId = await input({ message: "Enter FOLDER_ID:" });
    const databaseUrl = await input({ message: "Enter DATABASE_URL:" });
    const runOnStart = await select({
      message: "Run on Start?:",
      choices: [
        {
          name: "Yes",
          value: true,
        },
        {
          name: "No",
          value: false,
        },
      ],
    });
    const filePrefix = await input({ message: "Enter FILE_PREFIX:" });
    const retention = await await select({
      message: "Retention For Backup File:",
      choices: [
        {
          name: "Disabled (all backups will be kept)",
          value: "disabled",
        },
        {
          name: "week",
          value: "week",
        },
        {
          name: "month",
          value: "month",
        },
        {
          name: "year",
          value: "year",
        },
      ],
    });

    const cronExpression = await input({ message: "Enter CRON_EXPRESSION:" });

    const encryptionSecret = await input({
      message: "Enter ENCYRPTION_SECRET:",
    });

    const dirExists = existsSync(CONFIG_FOLDER);
    if (!dirExists) {
      await mkdir(CONFIG_FOLDER);
    }
    const dotenvStr =
      `SERVICE_ACCOUNT_PATH=${serviceAccountPath}\n` +
      `FOLDER_ID=${folderId}\n` +
      `DATABASE_URL=${databaseUrl}\n` +
      `RUN_ON_START=${runOnStart}\n` +
      `FILE_PREFIX=${filePrefix}\n` +
      `ENCYRPTION_SECRET=${encryptionSecret}\n` +
      `RETENTION=${retention}\n` +
      `CRON_EXPRESSION=${cronExpression}\n`;

    await writeFile(join(CONFIG_FOLDER, ENV_FILENAME), dotenvStr);
    console.log("Config written to ~/.gdrive_pgbackup/.env");
  } else if (action === Action.Cron) {
    const envStr = await loadEnv();

    const envJson = dotenv.parse(envStr);

    await new Promise((resolve, reject) => {
      pm2.start(
        {
          script: join(__dirname, "cron.js"),
          name: "gdrive_pgbackup",
          env: {
            ...envJson,
          },
        },
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });
    execSync("pm2 list");
    execSync("pm2 save");
    pm2.disconnect();
    console.log("Cron job started.");
  } else if (action === Action.Restore) {
    const envJson = await loadEnv();

    dotenv.config({ path: join(CONFIG_FOLDER, ENV_FILENAME) });

    const backupRestore = await import("./backup-restore");
    await backupRestore.restore();
  }
}

main();
