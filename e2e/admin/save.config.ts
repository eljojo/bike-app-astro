import { cleanDatabase, createFixture, adminConfig } from './fixture.ts';

cleanDatabase();
createFixture();

export default adminConfig('save.spec.ts', 4324);
