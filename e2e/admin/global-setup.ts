import { prepareFixture } from './fixture-setup.ts';

/** Runs exactly once before all workers and the webServer. */
export default function globalSetup() {
  prepareFixture();
}
