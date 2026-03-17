import path from 'node:path';
import { CITY } from './config';

export const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve('..', 'bike-routes');
export const cityDir = path.join(CONTENT_DIR, CITY);
