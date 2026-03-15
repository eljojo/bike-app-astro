/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth/auth';

/**
 * Cloudflare Workers runtime type stubs.
 *
 * These types exist at runtime on Cloudflare Workers but are not available
 * during local development without @cloudflare/workers-types. We declare
 * only the subset of methods our code (and drizzle-orm/d1) actually uses.
 */
declare global {
  namespace App {
    interface Locals {
      user?: SessionUser;
      cspNonce?: string;
    }
  }

  /** App repo git branch, baked in at build time via vite.define */
  const __APP_BRANCH__: string;

  /** City slug, baked in at build time via vite.define */
  const __CITY__: string;

  /** Video storage prefix, baked in at build time via vite.define */
  const __VIDEO_PREFIX__: string;

  // -- D1 (SQL database) types used by drizzle-orm/d1 --

  interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: Record<string, unknown>;
    error?: string;
  }

  interface D1Response {
    success: boolean;
    error?: string;
    meta: Record<string, unknown>;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run(): Promise<D1Response>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown[]>(): Promise<T[]>;
  }

  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1Result>;
    dump(): Promise<ArrayBuffer>;
  }

  // -- R2 (object storage) types used by storage.ts --

  interface R2ObjectBody {
    readonly key: string;
    readonly size: number;
    readonly httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    body: ReadableStream;
  }

  interface R2Object {
    readonly key: string;
    readonly size: number;
    readonly httpMetadata?: { contentType?: string };
  }

  interface R2Bucket {
    head(key: string): Promise<R2Object | null>;
    get(key: string): Promise<R2ObjectBody | null>;
    put(key: string, value: ArrayBuffer | ReadableStream | string | Uint8Array | null): Promise<R2Object>;
    delete(key: string | string[]): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      objects: R2Object[];
      truncated: boolean;
      cursor?: string;
    }>;
  }
}

// cloudflare:workers module is declared in cloudflare.d.ts (must be ambient, no imports)
// Virtual modules are declared in virtual-modules.d.ts (must be ambient, no imports)
