import { Client } from 'basic-ftp';
import { Logger } from 'pino';
import { config } from '../config/env';
import { logger as defaultLogger } from '../logger';
import fs from 'fs';
import path from 'path';

export interface FtpFile {
  name: string;
  size: number;
  modifiedAt: Date;
}

export class FtpClient {
  private client: Client;
  private log: Logger;

  constructor(log: Logger = defaultLogger) {
    this.client = new Client();
    this.client.ftp.verbose = config.ftp.verbose;
    this.log = log;
  }

  async connect(): Promise<void> {
    try {
      await this.client.access({
        host: config.ftp.host,
        port: config.ftp.port,
        user: config.ftp.user,
        password: config.ftp.pass,
        secure: config.ftp.secure,
        secureOptions: config.ftp.secure ? { rejectUnauthorized: config.ftp.rejectUnauthorized } : undefined,
      });
      this.log.info('Connected to FTP server');
    } catch (error) {
      const err = error as Error;
      this.log.error({ error: err.message }, 'Failed to connect to FTP server');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.client.close();
    this.log.info('Disconnected from FTP server');
  }

  async listFiles(remotePath: string): Promise<FtpFile[]> {
    try {
      const files = await this.client.list(remotePath);
      return files.map(file => ({
        name: file.name,
        size: file.size,
        modifiedAt: file.modifiedAt || new Date(),
      }));
    } catch (error) {
      const err = error as Error;
      this.log.error({ remotePath, error: err.message }, 'Failed to list files');
      throw error;
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    try {
      await this.client.downloadTo(localPath, remotePath);
      this.log.debug({ remotePath, localPath }, 'Downloaded file');
    } catch (error) {
      const err = error as Error;
      this.log.error({ remotePath, error: err.message }, 'Failed to download file');
      throw error;
    }
  }

  async downloadWithRetry(remotePath: string, localPath: string, maxRetries = 3): Promise<void> {
    let lastError: Error = new Error('Unknown error');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.downloadFile(remotePath, localPath);
        return;
      } catch (error) {
        const err = error as Error;
        lastError = err;
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
        this.log.warn(`Download attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    this.log.error({ remotePath, maxRetries }, 'Download failed after max retries');
    throw lastError;
  }

  async downloadWithCache(remotePath: string, localPath: string): Promise<void> {
    // Use cached file if it exists
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      this.log.debug(`Using cached file for ${remotePath}`);
      return;
    }

    // Ensure the destination directory exists (cache dir)
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Download and cache
    await this.downloadWithRetry(remotePath, localPath);
  }
}