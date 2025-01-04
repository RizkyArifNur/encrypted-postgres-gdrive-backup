import { cleanEnv, str, bool } from "envalid";
export const env = cleanEnv(
  process.env,
  {
    SERVICE_ACCOUNT_PATH: str(),
    FILE_PREFIX: str({ default: "db-backup-" }),
    RETENTION: str({
      choices: ["week", "month", "year", "disabled"],
      default: "disabled",
    }),
    DATABASE_URL: str(),
    FOLDER_ID: str(),
    CRON_EXPRESSION: str({ default: "0 17 * * *" }), // midnight Asia/Jakarta
    RUN_ON_START: bool({ default: true }),
    ENCYRPTION_SECRET: str(),
  },
  {
    reporter: ({ errors }) => {
      if (!Object.keys(errors).length) return;
      console.error(
        "Error loading config, please check your configuration file."
      );

      process.exit(1);
    },
  }
);
