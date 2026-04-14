// scripts/pipeline/phases/finalize-write.ts
//
// Phase 12 (terminal): write the YAML output to disk.
//
// Pure I/O — takes fully resolved entries from finalize.resolve and
// writes bikepaths.yml via pipeline-io.ts. Skipped for tests (no
// dataDir) and dry runs.

import type { Phase } from './_phase-types.ts';
import * as path from 'node:path';
import { writeYaml } from '../lib/pipeline-io.ts';

interface Inputs {
  entries: any[];
  superNetworks: any[];
  slugMap: Map<any, string>;
  /** Destination directory for bikepaths.yml. When omitted (tests), no file is written. */
  dataDir?: string;
  /** When true, skip writeYaml(). */
  dryRun?: boolean;
}

interface Output {
  entries: any[];
  slugMap: Map<any, string>;
}

export const finalizeWritePhase: Phase<Inputs, Output> = async ({
  entries,
  superNetworks,
  slugMap,
  dataDir,
  dryRun,
}) => {
  if (dataDir && !dryRun) {
    writeYaml(entries, superNetworks, path.join(dataDir, 'bikepaths.yml'), slugMap);
  }

  return { entries, slugMap };
};
