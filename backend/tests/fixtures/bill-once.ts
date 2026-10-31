// Child process used by concurrency.test.ts: one billing run against the shared database file.
import { runBillingCycle } from '../../src/services/billingEngine.js';

const r = runBillingCycle(process.argv[2]);
console.log(JSON.stringify({ created: r.invoicesCreated, duplicates: r.skippedDuplicates, errors: r.errors }));
