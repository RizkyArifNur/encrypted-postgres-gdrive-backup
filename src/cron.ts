import { CronJob } from "cron";
import { env } from "./env";
import { run } from "./backup-restore";

const isUsingCron = env.CRON_EXPRESSION !== "-1";

const main = async () => {
  if (!isUsingCron) {
    console.log(`Running backup once.`);
    await run();
    return;
  }

  console.log(`Running backup every ${env.CRON_EXPRESSION}.`);

  const cron = new CronJob(env.CRON_EXPRESSION, run);

  if (env.RUN_ON_START) {
    await run();
  } else {
    console.log(
      `Skipping initial backup, enable with RUN_ON_START=true if you want to run a backup on start.`
    );
  }

  cron.start();
};

void main();
