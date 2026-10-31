### Benchmark results

- Environment: Node v24.16.0, win32 x64, 12th Gen Intel(R) Core(TM) i5-1235U (12 threads), SQLite via node:sqlite (WAL), file database
- Dataset (built in 2.2 s): 2000 customers, 5000 subscriptions, 25024 invoices, 17891 payments, 500 subscriptions due today, 6245 overdue invoices
- Method: real HTTP requests to the real Express app, 20 timed runs after 1 warm-up, milliseconds

| Endpoint | median | p95 | max |
|---|---:|---:|---:|
| Finance dashboard summary | 97.8 | 111.5 | 130.9 |
| Dashboard with date range | 133.3 | 148.9 | 193.3 |
| Subscriptions list, page 1 | 3.5 | 4.4 | 7.8 |
| Subscriptions, status=Active, page 1 | 16.3 | 21.3 | 76.8 |
| Subscriptions, deep page (page 40) | 4.3 | 6.1 | 8.0 |
| Subscriptions, search by number prefix | 5.1 | 8.4 | 8.8 |
| Invoices list, page 1 | 3.2 | 4.9 | 5.5 |
| Invoices, status=Confirmed | 62.8 | 72.7 | 81.3 |
| Invoices, overdue only | 71.2 | 82.1 | 87.0 |
| Invoices, deep page (page 200) | 12.1 | 21.4 | 38.6 |
| Invoices, date range | 44.9 | 58.7 | 62.0 |
| Invoice detail with lines and payments | 2.2 | 3.1 | 3.3 |
| Payments list, page 1 | 11.1 | 14.9 | 35.7 |
| Payments, date range + method | 37.4 | 45.5 | 59.6 |
| Customer portal: own subscriptions | 2.1 | 2.6 | 2.7 |
| Customer portal: own invoices | 2.7 | 3.4 | 3.7 |
| Billing integrity report | 174.5 | 233.0 | 237.0 |

| Billing operation | result | time |
|---|---|---:|
| Dry run (compute, then roll back) | 500 invoices, 0 errors | 165 ms |
| Real billing run | 500 invoices created, 0 errors | 562 ms |
| Second run, same date | 0 invoices created | 0 ms |
| Integrity report (25524 invoices) | duplicates 0, missing 0, ok=true | 173 ms |

Query plans:
- Due subscriptions: SEARCH subscriptions USING COVERING INDEX idx_subscriptions_status_billing (status=? AND next_billing_date<?)
- Customer invoices: SEARCH invoices USING COVERING INDEX idx_invoices_customer (customer_id=?)
- Overdue invoices: SEARCH invoices USING INDEX idx_invoices_status_due (status=? AND due_date<?)
- Payments of an invoice: SEARCH payments USING COVERING INDEX idx_payments_invoice (invoice_id=?)
- Payments by date: SEARCH payments USING INDEX idx_payments_date (payment_date>? AND payment_date<?)
- Invoice period lookup: SEARCH invoices USING COVERING INDEX sqlite_autoindex_invoices_2 (subscription_id=? AND period_start=?)

Slowest single request: 237.0 ms; SLA (< 2000 ms) met.
