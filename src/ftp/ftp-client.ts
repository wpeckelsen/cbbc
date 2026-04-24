import { Client } from 'basic-ftp';
import { config } from '../config/env';
import { logger } from '../logger';

export interface FtpFile {
  name: string;
  size: number;
  modifiedAt: Date;
}

export class FtpClient {
  private client: Client;

  constructor() {
    this.client = new Client();
    this.client.ftp.verbose = config.nodeEnv === 'development';
  }

  async connect(): Promise<void> {
    try {
      await this.client.access({
        host: config.ftp.host,
        port: config.ftp.port,
        user: config.ftp.user,
        password: config.ftp.pass,
        secure: config.ftp.secure, // Use FTPS if enabled
        secureOptions: config.ftp.secure ? { rejectUnauthorized: false } : undefined, // For self-signed certs, but ideally verify
      });
      logger.info('Connected to FTP server', { secure: config.ftp.secure });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to connect to FTP server', { error: err.message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.client.close();
    logger.info('Disconnected from FTP server');
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
      logger.error('Failed to list files', { remotePath, error: err.message });
      throw error;
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    try {
      await this.client.downloadTo(localPath, remotePath);
      logger.info('Downloaded file', { remotePath, localPath });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to download file', { remotePath, localPath, error: err.message });
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
        logger.warn(`Download attempt ${attempt} failed, retrying in ${delay}ms`, { remotePath, error: err.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    logger.error('Download failed after max retries', { remotePath, maxRetries });
    throw lastError;
  }
}