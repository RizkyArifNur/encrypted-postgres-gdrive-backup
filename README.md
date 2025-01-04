# Postgres Personal GDrive Backup

A fork repo from https://github.com/doiska/postgres-gdrive-backup but added the command line and encryption feature

## How to use

### Google Cloud Platform Setup

- Log-in to the [Google Cloud Console](https://console.cloud.google.com/).
- Enable [Google Drive API](https://console.cloud.google.com/apis/api/drive.googleapis.com/overview).
- Then [create a new service account](https://console.cloud.google.com/projectselector2/iam-admin/serviceaccounts/create)
- Click in the **three dots** on the right of the service account you just created and click on **Manage keys**.
- Create a new **json** key and download the file.
- Now go to **your** Google Drive and create a new folder where the backups will be stored.
  - Save the **Folder ID**, it's the string after `https://drive.google.com/drive/folders/{ID HERE}`.
- Share the folder with the **service account email** (**client_email**), you can find it on the JSON file you downloaded on the previous step.
  - The email looks like: `projectname@project.iam.gserviceaccount.com`
  - Make sure to include Editor permissions.

### Requirements

by default pg-drive use the `pm2`, `pg_dump` and `pg_restore` command to do the backup and restore database, please make sure it already installed on your machine

### Installation

`npm i -g pg-drive`

### Run command

after installation finish, you can just run the `pg-drive` command, and choose the command you want to run,

> Note: please run the `config` command before using the `cron` and `restore` to avoid environment error

### Configuration Setup

you can set the configuration by using `pg-drive` config command, but you can also add the configuration manually in `~/.pg_drive/.env`, list of configuration:

- `SERVICE_ACCOUNT_PATH`: The path to the JSON file of the service account.
  - Example: `/path/to/service-account.json` (please avoid using the `~/docs/service-account.json` somehow nodejs can't recognized it, use the `/home/docs/service-account.json`)
- `FOLDER_ID`: The ID of the folder where the backups will be stored.
  - You can find the ID on the URL of the folder, it's the string after `https://drive.google.com/drive/folders/`.
  - Example: `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q` => `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q`
- `DATABASE_URL`: The connection string of your Postgres database.
- `CRON_EXPRESSION`: A schedule for the backups.
  - Example: `0 0 * * *` (every day at midnight)
  - You can use [crontab.guru](https://crontab.guru/) to help you create the expression.
- `FILE_PREFIX`: A prefix for the backup files.
  - Example: `my-database-backup-`
  - Result: `my-database-backup-2024-02-01.sql.tar.gz`
- `RUN_ON_START`: If set to `true`, the backup will run once when the app starts.
- `ENCYRPTION_SECRET`: The secret key used for encrypting the backups.
