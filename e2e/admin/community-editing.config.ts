import { cleanDatabase, createFixture, adminConfig } from './fixture.ts';

cleanDatabase();
createFixture();

export default adminConfig('community-editing.spec.ts', 4325);
