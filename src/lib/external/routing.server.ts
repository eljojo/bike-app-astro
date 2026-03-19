import type { RoutingService } from './routing';
import { createGoogleRoutingService } from './routing.adapter-google.server';

export function createRoutingService(): RoutingService {
  return createGoogleRoutingService();
}
