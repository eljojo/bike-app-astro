import { cleanDatabase, createFixture, adminConfig } from './fixture.ts';

cleanDatabase();
createFixture();

export default adminConfig('body.spec.ts', 4323);
