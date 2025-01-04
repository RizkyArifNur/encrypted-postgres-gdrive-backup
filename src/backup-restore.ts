import { drive } from "@googleapis/drive";
import { JWT } from "google-auth-library";
import { env } from "./env";
import { exec, execSync } from "child_process";
import { unlink } from "fs/promises";
import { statSync } from "fs";
import * as path from "path";
import * as os from "os";
import { filesize } from "filesize";
import { createReadStream, createWriteStream } from "fs";
import dayjs from "dayjs";
import * as crypto from "crypto";
import { readFile } from "fs/promises";
import { writeFile } from "fs/promises";
import { select } from "@inquirer/prompts";
import * as cliProgress from "cli-progress";

// Encryption settings
const algorithm: string = "aes-256-cbc"; // Algorithm to use
const iterations = 100000; // Number of iterations for PBKDF2
const keyLength = 32; // Key length for AES-256
const ivLength = 16; // IV length for AES

const generateGdriveClient = async () => {
  const serviceAccountPath = env.SERVICE_ACCOUNT_PATH;
  const serviceAccount = JSON.parse(
    await readFile(serviceAccountPath, "utf-8")
  );

  const auth = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  const gdrive = drive({
    version: "v3",
    auth: auth,
  });

  return gdrive;
};

const deleteStaleBackups = async (cutOffDate: Date) => {
  const gdrive = await generateGdriveClient();
  const folderAccess = await gdrive.files.get({
    fileId: env.FOLDER_ID,
    fields: "id",
  });

  if (!folderAccess.data.id) {
    console.error(`No access to FOLDER_ID: ${env.FOLDER_ID}`);
    return;
  }

  const res = await gdrive.files.list({
    pageSize: 100,
    fields: "nextPageToken, files(id, createdTime)",
    q: `'${
      env.FOLDER_ID
    }' in parents and trashed=false and mimeType = 'application/gzip' and createdTime < '${cutOffDate.toISOString()}'`,
  });

  if (!res.data.files) {
    return;
  }

  for (const file of res.data.files) {
    if (!file.id) continue;
    await gdrive.files.delete({ fileId: file.id });
  }
};

const listBackupFiles = async (): Promise<
  Array<{ id: string; name: string; createdTime: Date }>
> => {
  const gdrive = await generateGdriveClient();
  const folderAccess = await gdrive.files.get({
    fileId: env.FOLDER_ID,
    fields: "id",
  });

  if (!folderAccess.data.id) {
    console.error(`No access to FOLDER_ID: ${env.FOLDER_ID}`);
    return;
  }

  const res = await gdrive.files.list({
    pageSize: 100,
    fields: "nextPageToken, files(id, createdTime, name)",
    orderBy: "createdTime desc",
    q: `'${env.FOLDER_ID}' in parents and trashed=false and mimeType = 'application/gzip'`,
  });

  if (!res.data.files) {
    return [];
  }

  return res.data.files.map((file) => ({
    id: file.id,
    name: file.name,
    createdTime: new Date(file.createdTime),
  }));
};

const downloadBackup = async (fileId: string, destinationPath: string) => {
  const gdrive = await generateGdriveClient();
  const dest = createWriteStream(destinationPath);
  const res = await gdrive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  const totalSize = parseInt(res.headers["content-length"], 10);
  let downloadedSize = 0;
  let startTime = Date.now();

  const progressBar = new cliProgress.SingleBar(
    {
      format:
        "Downloading [{bar}] {percentage}% | {value}/{total} MB | Speed: {speed} MB/s",
    },
    cliProgress.Presets.shades_classic
  );
  progressBar.start(Number((totalSize / (1024 * 1024)).toFixed(2)), 0);

  return new Promise((resolve, reject) => {
    res.data
      .on("data", (chunk) => {
        downloadedSize += chunk.length;
        const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
        const speed = downloadedSize / (1024 * 1024) / elapsedTime; // in MB/s
        progressBar.update(
          Number((downloadedSize / (1024 * 1024)).toFixed(2)),
          { speed: speed.toFixed(2) }
        );
      })
      .on("end", () => {
        progressBar.stop();
        console.log("Download complete.");
        resolve(destinationPath);
      })
      .on("error", (err: Error) => {
        progressBar.stop();
        console.error("Error downloading file.");
        reject(err);
      })
      .pipe(dest);
  });
};

const dumpToFile = async (path: string) => {
  return new Promise((resolve, reject) => {
    exec(
      `pg_dump --dbname=${env.DATABASE_URL} --format=tar | gzip > ${path}`,
      (err, stdout, stderr) => {
        if (err) {
          reject({
            error: err,
            stderr: stderr.trimEnd(),
          });
          return;
        }

        if (!!stderr) {
          console.log(stderr.trimEnd());
        }

        const isFileValid = execSync(`gzip -cd ${path} | head -c1`).length > 0;

        if (!isFileValid) {
          console.error("Backup file is empty");
          reject("Backup file is empty");
          return;
        }

        console.log(`Backup file size: ${filesize(statSync(path).size)}`);
        console.log(`Backup file created at: ${path}`);

        if (stdout) {
          console.log(stdout);
        }

        resolve(stdout);
      }
    );
  });
};

const deriveKeyAndIV = (password: string, salt: Buffer) => {
  // Derive the key using PBKDF2
  const key = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    keyLength,
    "sha256"
  );
  const iv = key.slice(0, ivLength); // Use the first 16 bytes as the IV
  return { key, iv };
};

// Function to encrypt the file content
const encryptFile = async (filePath: string, password: string) => {
  try {
    // Generate a random salt
    const salt = crypto.randomBytes(16);

    // Derive the key and IV from the passphrase and salt
    const { key, iv } = deriveKeyAndIV(password, salt);

    // Read the file data
    const fileData = await readFile(filePath);

    // Create cipher
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    // Encrypt the data
    const encryptedData = Buffer.concat([
      cipher.update(fileData),
      cipher.final(),
    ]);

    // Write the salt and encrypted data back to the file
    await writeFile(filePath, Buffer.concat([salt, encryptedData]));

    console.log("File encrypted successfully.");
  } catch (error) {
    console.error("Error during encryption:", error.message);
  }
};

// Function to decrypt the file content
const decryptFile = async (filePath: string, password: string) => {
  try {
    // Read the file data
    const fileData = await readFile(filePath);

    // Extract the salt (first 16 bytes) and the encrypted data
    const salt = fileData.slice(0, 16);
    const encryptedData = fileData.slice(16);

    // Derive the key and IV from the passphrase and extracted salt
    const { key, iv } = deriveKeyAndIV(password, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    // Decrypt the data
    const decryptedData = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    // Write the decrypted data back to the file
    await writeFile(filePath, decryptedData);

    console.log("File decrypted successfully.");
  } catch (error) {
    console.error("Error during decryption:", error.message);
  }
};

const pushToDrive = async (filename: string, path: string) => {
  const gdrive = await generateGdriveClient();
  const folderAccess = await gdrive.files.get({
    fileId: env.FOLDER_ID,
    fields: "id",
  });

  if (!folderAccess.data.id) {
    console.error(`No access to FOLDER_ID: ${env.FOLDER_ID}`);
    return;
  }

  const fileMetadata = {
    name: filename,
    parents: [env.FOLDER_ID],
  };

  const media = {
    mimeType: "application/gzip",
    body: createReadStream(path),
  };

  await gdrive.files.create({
    requestBody: fileMetadata,
    media: media,
  });
};

export async function run() {
  try {
    if (env.RETENTION && env.RETENTION !== "disabled") {
      console.log(`Deleting old backups older than a ${env.RETENTION}`);
      const cutOffDate = dayjs().subtract(1, env.RETENTION).toDate();
      await deleteStaleBackups(cutOffDate);
      console.log(`Delete complete! Procceding with backup.`);
    }

    const timestamp = new Date().toISOString().replace(".", "-");

    const filename = `${env.FILE_PREFIX}${timestamp}.tar.gz`;

    const filepath = path.join(os.tmpdir(), filename);

    console.log(`Starting backup of ${filename}`);

    await dumpToFile(filepath);

    console.log("Backup done! Encrypting...");

    await encryptFile(filepath, env.ENCYRPTION_SECRET);

    console.log("Encryption done! Uploading to Google Drive...");

    await pushToDrive(filename, filepath);

    console.log("Backup uploaded to Google Drive!");

    await unlink(filepath);

    console.log("All done!");
  } catch (err) {
    console.error("Something went wrong:", err);
  }
}

export async function restore() {
  const backupFiles = await listBackupFiles();

  const selectedBackupFileId = await select({
    message: "Select a backup file to restore",
    choices: backupFiles.map((file) => ({
      value: file.id,
      name: "Backup file: " + file.name + " created at: " + file.createdTime,
    })),
  });

  console.log(`Restoring backup fileId: ${selectedBackupFileId}`);

  const downloadPath = "./downloaded-backup.tar.gz";
  await downloadBackup(selectedBackupFileId, downloadPath);

  console.log("Backup downloaded. Decrypting...");

  await decryptFile(downloadPath, env.ENCYRPTION_SECRET);

  console.log("Backup decrypted. Restoring...");

  execSync(
    `gunzip -c ${downloadPath} | pg_restore --dbname=${env.DATABASE_URL} --clean --if-exists --no-owner`
  );

  console.log("Restore complete.");
}
